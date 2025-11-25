require('dotenv').config();
const express = require('express');
const mariadb = require('mariadb');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'coss-secret-key-2025';

// 데이터 파일 경로
const DATA_FILE = path.join(__dirname, 'coss-data.json');

// MariaDB 연결 풀 (DB 정보가 있을 때만 생성)
let pool = null;
if (process.env.DB_HOST) {
    pool = mariadb.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 3306,
        connectionLimit: 5
    });
}

// 미들웨어
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static('public'));

// ===== 데이터 구조 =====
let sensorData = {
    sensors: {
        1: { id: 1, name: '아침 약', emoji: '🌅', value: 0, lastOpened: null, todayOpened: false, targetTime: '08:00', description: '혈압약 (식후 30분)' },
        2: { id: 2, name: '점심 약', emoji: '☀️', value: 0, lastOpened: null, todayOpened: false, targetTime: '13:00', description: '비타민 D' },
        3: { id: 3, name: '저녁 약', emoji: '🌙', value: 0, lastOpened: null, todayOpened: false, targetTime: '18:00', description: '관절약' },
        4: { id: 4, name: '자기전 약', emoji: '🛌', value: 0, lastOpened: null, todayOpened: false, targetTime: '22:00', description: '수면 보조제' }
    },
    history: [],
    dailyStats: {},
    users: [
        { id: 1, email: 'user@coss.com', password: '$2a$10$X4kv7j5ZcGJLFwJHcXpKKutzCFvN.VIwmOm2T7JD.qPugXvVqWFCO', name: '홍길동' }
    ]
};

// ===== 플리커링 방지를 위한 대기 상태 =====
// 센서별로 제거 시작 시간을 기록하여 1초 이상 유지되어야 복약으로 인정
let pendingRemoval = {
    1: null,
    2: null,
    3: null,
    4: null
};
const FLICKERING_THRESHOLD_MS = 1000; // 1초

// ===== 파일 저장/로드 함수 =====
function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(sensorData, null, 2));
    } catch (error) {
        console.error('데이터 저장 실패:', error);
    }
}

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const rawData = fs.readFileSync(DATA_FILE);
            const loadedData = JSON.parse(rawData);
            sensorData = { ...sensorData, ...loadedData };
            console.log('📂 저장된 데이터 파일을 불러왔습니다.');
        } else {
            console.log('✨ 새로운 데이터를 시작합니다.');
            saveData();
        }
    } catch (error) {
        console.error('데이터 로드 실패:', error);
    }
}

// 초기 데이터 로드
loadData();

// ===== 통계 계산 함수들 =====

// PDC (Proportion of Days Covered) 계산
function calculatePDC(dailyStats, sensors) {
    const dates = Object.keys(dailyStats).sort();
    if (dates.length === 0) return 0;
    
    const startDate = new Date(dates[0]);
    const endDate = new Date(dates[dates.length - 1]);
    const totalDays = Math.max(1, Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1);
    
    // 하루에 4개 센서 중 최소 1개 이상 복용한 날 = 성공
    let successDays = 0;
    for (let dateKey in dailyStats) {
        const daySensors = dailyStats[dateKey].sensors || {};
        const takenCount = Object.values(daySensors).filter(s => s.count > 0).length;
        if (takenCount > 0) successDays++;
    }
    
    return Math.round((successDays / totalDays) * 100);
}

// 최대 연속 복용일 계산
function calculateMaxStreak(dailyStats) {
    const dates = Object.keys(dailyStats).sort();
    if (dates.length === 0) return 0;
    
    let maxStreak = 0;
    let currentStreak = 0;
    let prevDate = null;
    
    for (let dateKey of dates) {
        const daySensors = dailyStats[dateKey].sensors || {};
        const takenCount = Object.values(daySensors).filter(s => s.count > 0).length;
        
        if (takenCount > 0) {
            if (prevDate) {
                const prev = new Date(prevDate);
                const curr = new Date(dateKey);
                const diffDays = Math.round((curr - prev) / (1000 * 60 * 60 * 24));
                
                if (diffDays === 1) {
                    currentStreak++;
                } else {
                    currentStreak = 1;
                }
            } else {
                currentStreak = 1;
            }
            prevDate = dateKey;
        } else {
            currentStreak = 0;
            prevDate = null;
        }
        
        maxStreak = Math.max(maxStreak, currentStreak);
    }
    
    return maxStreak;
}

// 시간 정확도 계산 (목표 시간 대비 실제 복용 시간 오차, 분 단위 평균)
function calculateTimeAccuracy(dailyStats, sensors) {
    let totalDiff = 0;
    let count = 0;
    
    for (let dateKey in dailyStats) {
        const daySensors = dailyStats[dateKey].sensors || {};
        
        for (let sensorId in daySensors) {
            const sensorStat = daySensors[sensorId];
            const targetTime = sensors[sensorId]?.targetTime || '12:00';
            
            if (sensorStat.times && sensorStat.times.length > 0) {
                const firstTime = new Date(sensorStat.times[0]);
                const [tHour, tMin] = targetTime.split(':').map(Number);
                
                // 같은 날 목표 시간
                const targetDate = new Date(firstTime);
                targetDate.setHours(tHour, tMin, 0, 0);
                
                const diffMinutes = Math.abs(firstTime - targetDate) / (1000 * 60);
                totalDiff += diffMinutes;
                count++;
            }
        }
    }
    
    return count > 0 ? Math.round(totalDiff / count) : 0;
}

// 최장 미복용 기간 계산 (일)
function calculateMaxGap(dailyStats) {
    const dates = Object.keys(dailyStats).sort();
    if (dates.length < 2) return 0;
    
    let maxGap = 0;
    
    for (let i = 1; i < dates.length; i++) {
        const prev = new Date(dates[i - 1]);
        const curr = new Date(dates[i]);
        const gap = Math.round((curr - prev) / (1000 * 60 * 60 * 24)) - 1;
        maxGap = Math.max(maxGap, gap);
    }
    
    return maxGap;
}

// 전체 adherenceMetrics 계산
function calculateAdherenceMetrics() {
    const totalDays = Object.keys(sensorData.dailyStats).length;
    const totalCount = sensorData.history.filter(h => h.action === 'removed').length;
    
    return {
        totalDays: totalDays,
        averagePerDay: totalDays > 0 ? (totalCount / totalDays) : 0,
        maxStreak: calculateMaxStreak(sensorData.dailyStats),
        pdc: calculatePDC(sensorData.dailyStats, sensorData.sensors),
        timeAccuracy: calculateTimeAccuracy(sensorData.dailyStats, sensorData.sensors),
        maxGap: calculateMaxGap(sensorData.dailyStats)
    };
}

// ===== 인증 미들웨어 =====
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access token required' });
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

// ===== API 엔드포인트 =====

// 1. 센서 값 조회 및 업데이트
app.get('/value', (req, res) => res.json(sensorData.sensors));

app.post('/value', (req, res) => {
    const { sensorId, value, a } = req.body;
    const now = new Date();
    
    let finalSensorId = sensorId || 1;
    let finalValue = value !== undefined ? value : a;
    
    if (finalSensorId < 1 || finalSensorId > 4) return res.status(400).json({ error: 'Invalid ID' });
    
    const sensor = sensorData.sensors[finalSensorId];
    const prevValue = sensor.value;
    
    // 약통 제거 시작 (0 → 1)
    if (finalValue === 1 && prevValue === 0) {
        // 플리커링 방지: 제거 시작 시간 기록
        pendingRemoval[finalSensorId] = now.getTime();
        sensor.value = finalValue;
        
        console.log(`[Sensor ${finalSensorId}] Removal started (pending confirmation)`);
        
        return res.json({ 
            success: true, 
            sensor,
            status: 'pending',
            message: 'Removal detected, waiting for confirmation'
        });
    }
    
    // 약통 복귀 (1 → 0)
    if (finalValue === 0 && prevValue === 1) {
        const removalStartTime = pendingRemoval[finalSensorId];
        const elapsedMs = removalStartTime ? (now.getTime() - removalStartTime) : 0;
        
        // 1초 이상 이탈했을 경우에만 복약으로 인정
        if (elapsedMs >= FLICKERING_THRESHOLD_MS) {
            // 복약 확정
            sensor.lastOpened = new Date(removalStartTime).toISOString();
            sensor.todayOpened = true;
            
            // 통계 업데이트
            const dateKey = new Date(removalStartTime).toISOString().split('T')[0];
            if (!sensorData.dailyStats[dateKey]) sensorData.dailyStats[dateKey] = { sensors: {} };
            if (!sensorData.dailyStats[dateKey].sensors) sensorData.dailyStats[dateKey].sensors = {};
            if (!sensorData.dailyStats[dateKey].sensors[finalSensorId]) {
                sensorData.dailyStats[dateKey].sensors[finalSensorId] = { count: 0, times: [] };
            }
            
            sensorData.dailyStats[dateKey].sensors[finalSensorId].count++;
            sensorData.dailyStats[dateKey].sensors[finalSensorId].times.push(sensor.lastOpened);
            
            // 이력 추가 (제거)
            sensorData.history.unshift({
                sensorId: finalSensorId,
                sensorName: sensor.name,
                action: 'removed',
                timestamp: sensor.lastOpened,
                value: 1,
                duration: Math.round(elapsedMs / 1000) // 복약 소요 시간 (초)
            });
            
            // 이력 추가 (복귀)
            sensorData.history.unshift({
                sensorId: finalSensorId,
                sensorName: sensor.name,
                action: 'returned',
                timestamp: now.toISOString(),
                value: 0
            });
            
            if (sensorData.history.length > 1000) sensorData.history = sensorData.history.slice(0, 1000);
            
            console.log(`[Sensor ${finalSensorId}] ✅ Medication confirmed (${Math.round(elapsedMs/1000)}s)`);
            saveData();
        } else {
            // 1초 미만: 노이즈로 간주, 무시
            console.log(`[Sensor ${finalSensorId}] ⚠️ Flickering ignored (${elapsedMs}ms < 1000ms)`);
        }
        
        // 대기 상태 초기화
        pendingRemoval[finalSensorId] = null;
        sensor.value = finalValue;
        
        return res.json({ 
            success: true, 
            sensor,
            confirmed: elapsedMs >= FLICKERING_THRESHOLD_MS
        });
    }
    
    sensor.value = finalValue;
    res.json({ success: true, sensor });
});

// 2. 센서 시간 설정 업데이트 API (신규)
app.put('/api/sensors/:id/time', authenticateToken, (req, res) => {
    const sensorId = parseInt(req.params.id);
    const { targetTime } = req.body;
    
    if (sensorId < 1 || sensorId > 4) {
        return res.status(400).json({ error: 'Invalid sensor ID' });
    }
    
    if (!targetTime || !/^\d{2}:\d{2}$/.test(targetTime)) {
        return res.status(400).json({ error: 'Invalid time format. Use HH:MM' });
    }
    
    sensorData.sensors[sensorId].targetTime = targetTime;
    saveData();
    
    console.log(`[Sensor ${sensorId}] Target time updated to ${targetTime}`);
    
    res.json({ 
        success: true, 
        sensor: sensorData.sensors[sensorId],
        message: `복용 시간이 ${targetTime}으로 설정되었습니다.`
    });
});

// 3. 로그인/회원가입
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = sensorData.users.find(u => u.email === email);
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
    res.json({ success: true, token, user: { name: user.name, email: user.email } });
});

app.post('/api/auth/register', async (req, res) => {
    const { email, password, name } = req.body;
    if (sensorData.users.find(u => u.email === email)) return res.status(400).json({ error: 'Exists' });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = { id: sensorData.users.length + 1, email, password: hashedPassword, name };
    sensorData.users.push(newUser);
    saveData();
    
    const token = jwt.sign({ id: newUser.id, email }, JWT_SECRET);
    res.json({ success: true, token, user: { name, email } });
});

// 4. 대시보드 데이터 (adherenceMetrics 추가)
app.get('/api/dashboard/stats', authenticateToken, (req, res) => {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const todayStats = sensorData.dailyStats[today] || { sensors: {} };
    
    // 주간 데이터
    const weekly = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const k = d.toISOString().split('T')[0];
        const s = sensorData.dailyStats[k];
        let count = 0;
        if (s && s.sensors) Object.values(s.sensors).forEach(v => { if(v.count > 0) count++; });
        weekly.push({ date: k, completedCount: count, day: ['일','월','화','수','목','금','토'][d.getDay()] });
    }
    
    // adherenceMetrics 계산
    const adherenceMetrics = calculateAdherenceMetrics();

    res.json({
        sensors: sensorData.sensors,
        today: todayStats,
        weekly,
        adherenceRate: adherenceMetrics.pdc,
        adherenceMetrics: adherenceMetrics,
        lastAction: sensorData.history[0]
    });
});

// 5. 리포트 데이터 (강화된 통계)
app.get('/api/reports/detailed', authenticateToken, (req, res) => {
    const adherenceMetrics = calculateAdherenceMetrics();
    
    // 시간대별 분포 계산
    const hourlyDistribution = new Array(24).fill(0);
    const weekdayDistribution = new Array(7).fill(0);
    
    sensorData.history.forEach(h => {
        if (h.action === 'removed' && h.timestamp) {
            const d = new Date(h.timestamp);
            hourlyDistribution[d.getHours()]++;
            weekdayDistribution[d.getDay()]++;
        }
    });
    
    res.json({
        sensorStats: sensorData.sensors,
        history: sensorData.history.slice(0, 200), // 50 → 200으로 증가
        totalDays: Object.keys(sensorData.dailyStats).length,
        dailyStats: sensorData.dailyStats,
        adherenceMetrics: adherenceMetrics,
        distributions: {
            hourly: hourlyDistribution,
            weekday: weekdayDistribution
        }
    });
});

app.get('/api/medications', authenticateToken, (req, res) => {
    res.json(Object.values(sensorData.sensors));
});

// 6. 알림 체크 API (소리 및 시간 제한 로직)
app.get('/api/notifications/check', authenticateToken, (req, res) => {
    const now = new Date();
    const alerts = [];
    
    for (let id in sensorData.sensors) {
        const sensor = sensorData.sensors[id];
        
        // 이미 복용했으면 알림 없음
        if (sensor.todayOpened) continue;
        
        // 목표 시간 파싱
        const [tHour, tMin] = sensor.targetTime.split(':').map(Number);
        const targetDate = new Date(now);
        targetDate.setHours(tHour, tMin, 0, 0);
        
        // 시간 차이 계산 (분 단위)
        const diffMinutes = Math.round((now - targetDate) / 1000 / 60);
        
        // 1. 복용 시간 지각 알림 (30분 이내일 때만 소리 울림)
        if (diffMinutes > 0) {
            if (diffMinutes <= 30) {
                alerts.push({
                    sensorId: id,
                    type: 'warning',
                    message: `🔔 ${sensor.emoji} ${sensor.name} 복용 시간입니다! (${diffMinutes}분 지남)`,
                    playSound: true,
                    priority: 'high'
                });
            }
        }
        
        // 2. 10분 전 예고 알림 (소리 없음)
        if (diffMinutes >= -10 && diffMinutes < 0) {
            alerts.push({
                sensorId: id,
                type: 'info',
                message: `ℹ️ 곧 ${sensor.emoji} ${sensor.name} 복용 시간입니다.`,
                playSound: false,
                priority: 'low'
            });
        }
    }
    
    res.json({ alerts });
});

// 7. 관리자 리셋
app.post('/api/admin/reset', (req, res) => {
    if (req.body.password !== 'admin2025') return res.status(403).json({ error: '비번 오류' });
    
    // 전체 리셋
    for(let id in sensorData.sensors) {
        sensorData.sensors[id].value = 0;
        sensorData.sensors[id].todayOpened = false;
        sensorData.sensors[id].lastOpened = null;
    }
    sensorData.history = [];
    sensorData.dailyStats = {};
    saveData();
    res.json({ success: true, message: '리셋 완료' });
});

// 8. 매일 자정에 todayOpened 리셋 (서버 시작 시 스케줄링)
function resetDailyFlags() {
    const now = new Date();
    const todayKey = now.toISOString().split('T')[0];
    
    // 마지막 리셋 날짜 확인
    if (!sensorData.lastResetDate || sensorData.lastResetDate !== todayKey) {
        for (let id in sensorData.sensors) {
            sensorData.sensors[id].todayOpened = false;
        }
        sensorData.lastResetDate = todayKey;
        saveData();
        console.log(`[System] Daily flags reset for ${todayKey}`);
    }
}

// 1분마다 날짜 변경 체크
setInterval(resetDailyFlags, 60000);
resetDailyFlags(); // 서버 시작 시 즉시 실행

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 서버 시작
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📂 Data saved in: ${DATA_FILE}`);
});
