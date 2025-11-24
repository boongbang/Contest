require('dotenv').config();
const express = require('express');
const mariadb = require('mariadb');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'coss-secret-key-2025';

// MariaDB 연결 풀 생성
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

// ===== 4개 센서 데이터 구조 (핵심 변경) =====
let sensorData = {
    // 4개 센서별 현재 상태
    sensors: {
        1: { 
            id: 1, 
            name: '아침 약', 
            emoji: '🌅',
            value: 0,  // 0: 약통 있음, 1: 약통 제거됨
            lastOpened: null,
            todayOpened: false,
            targetTime: '08:00',
            description: '혈압약 (식후 30분)'
        },
        2: { 
            id: 2, 
            name: '점심 약', 
            emoji: '☀️',
            value: 0,
            lastOpened: null,
            todayOpened: false,
            targetTime: '13:00',
            description: '비타민 D'
        },
        3: { 
            id: 3, 
            name: '저녁 약', 
            emoji: '🌙',
            value: 0,
            lastOpened: null,
            todayOpened: false,
            targetTime: '18:00',
            description: '관절약'
        },
        4: { 
            id: 4, 
            name: '자기전 약', 
            emoji: '🛌',
            value: 0,
            lastOpened: null,
            todayOpened: false,
            targetTime: '22:00',
            description: '수면 보조제'
        }
    },
    history: [],  // 전체 이력
    dailyStats: {},  // 일별 통계
    users: [
        { id: 1, email: 'user@coss.com', password: '$2a$10$X4kv7j5ZcGJLFwJHcXpKKutzCFvN.VIwmOm2T7JD.qPugXvVqWFCO', name: '홍길동' } // password: coss123
    ],
    medications: {} // 약물 정보 저장
};

// ===== 자정 리셋 스케줄러 =====
function scheduleMidnightReset() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    
    const msUntilMidnight = midnight - now;
    
    setTimeout(() => {
        resetDailySensors();
        // 다음 날 자정도 예약
        scheduleMidnightReset();
    }, msUntilMidnight);
    
    console.log(`⏰ 자정 리셋 예약됨 (${Math.round(msUntilMidnight / 1000 / 60)}분 후)`);
}

// 일일 센서 상태 리셋
function resetDailySensors() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateKey = yesterday.toISOString().split('T')[0];
    
    // 어제 데이터를 history에 저장
    const dailyRecord = {
        date: dateKey,
        sensors: {}
    };
    
    for (let id in sensorData.sensors) {
        const sensor = sensorData.sensors[id];
        dailyRecord.sensors[id] = {
            opened: sensor.todayOpened,
            lastTime: sensor.lastOpened
        };
        
        // 센서 상태 리셋
        sensor.todayOpened = false;
        sensor.value = 0;
    }
    
    // dailyStats에 저장
    if (!sensorData.dailyStats[dateKey]) {
        sensorData.dailyStats[dateKey] = dailyRecord;
    }
    
    console.log('✅ 자정 리셋 완료 - 모든 센서 초기화됨');
}

// 서버 시작시 자정 리셋 스케줄러 시작
scheduleMidnightReset();

// ===== 인증 미들웨어 =====
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

// ===== Arduino 센서 엔드포인트 (수정됨) =====

// GET: 모든 센서 상태 조회
app.get('/value', (req, res) => {
    console.log('[GET /value] 모든 센서 상태 조회');
    res.json(sensorData.sensors);
});

// GET: 특정 센서 상태 조회
app.get('/value/:sensorId', (req, res) => {
    const sensorId = parseInt(req.params.sensorId);
    if (sensorId < 1 || sensorId > 4) {
        return res.status(400).json({ error: 'Invalid sensor ID (1-4)' });
    }
    
    console.log(`[GET /value/${sensorId}]`, sensorData.sensors[sensorId]);
    res.json(sensorData.sensors[sensorId]);
});

// POST: Arduino에서 센서값 업데이트 (핵심 변경)
app.post('/value', (req, res) => {
    const { sensorId, value, a } = req.body;
    const now = new Date();
    
    // 하위 호환성: 기존 'a' 파라미터 지원
    let finalSensorId = sensorId || 1; // 기본값 센서 1
    let finalValue = value !== undefined ? value : a;
    
    // 센서 ID 검증
    if (finalSensorId < 1 || finalSensorId > 4) {
        return res.status(400).json({ error: 'Invalid sensor ID (1-4)' });
    }
    
    const sensor = sensorData.sensors[finalSensorId];
    const prevValue = sensor.value;
    
    // 상태 변경 감지 (0->1: 약통 제거됨)
    if (finalValue === 1 && prevValue === 0) {
        sensor.lastOpened = now.toISOString();
        sensor.todayOpened = true;
        
        // 일별 통계 업데이트
        const dateKey = now.toISOString().split('T')[0];
        if (!sensorData.dailyStats[dateKey]) {
            sensorData.dailyStats[dateKey] = { 
                sensors: {
                    1: { count: 0, times: [] },
                    2: { count: 0, times: [] },
                    3: { count: 0, times: [] },
                    4: { count: 0, times: [] }
                }
            };
        }
        
        if (!sensorData.dailyStats[dateKey].sensors[finalSensorId]) {
            sensorData.dailyStats[dateKey].sensors[finalSensorId] = { count: 0, times: [] };
        }
        
        sensorData.dailyStats[dateKey].sensors[finalSensorId].count++;
        sensorData.dailyStats[dateKey].sensors[finalSensorId].times.push(now.toISOString());
        
        // 전체 이력에 추가
        sensorData.history.unshift({
            sensorId: finalSensorId,
            sensorName: sensor.name,
            action: 'removed',
            timestamp: now.toISOString(),
            value: finalValue
        });
        
        // 최대 500개 이력 유지
        if (sensorData.history.length > 500) {
            sensorData.history = sensorData.history.slice(0, 500);
        }
        
        console.log(`[센서 ${finalSensorId}] ${sensor.emoji} ${sensor.name} 약통이 제거되었습니다.`);
    }
    
    // 상태 변경 감지 (1->0: 약통 복귀)
    if (finalValue === 0 && prevValue === 1) {
        sensorData.history.unshift({
            sensorId: finalSensorId,
            sensorName: sensor.name,
            action: 'returned',
            timestamp: now.toISOString(),
            value: finalValue
        });
        console.log(`[센서 ${finalSensorId}] ${sensor.emoji} ${sensor.name} 약통이 제자리로 돌아왔습니다.`);
    }
    
    // 현재 상태 업데이트
    sensor.value = finalValue;
    
    res.json({ 
        success: true, 
        sensor: sensor,
        message: finalValue === 1 ? 
            `${sensor.name} 약통이 제거되었습니다` : 
            `${sensor.name} 약통이 제자리에 있습니다`
    });
});

// ===== 약물 관리 API =====

// GET: 약물 정보 조회
app.get('/api/medications', authenticateToken, (req, res) => {
    const medications = [];
    for (let id in sensorData.sensors) {
        medications.push({
            sensorId: id,
            name: sensorData.sensors[id].name,
            emoji: sensorData.sensors[id].emoji,
            description: sensorData.sensors[id].description,
            targetTime: sensorData.sensors[id].targetTime
        });
    }
    res.json(medications);
});

// POST: 약물 정보 업데이트
app.post('/api/medications/:sensorId', authenticateToken, (req, res) => {
    const sensorId = parseInt(req.params.sensorId);
    const { name, description, targetTime } = req.body;
    
    if (sensorId < 1 || sensorId > 4) {
        return res.status(400).json({ error: 'Invalid sensor ID' });
    }
    
    const sensor = sensorData.sensors[sensorId];
    if (name) sensor.name = name;
    if (description) sensor.description = description;
    if (targetTime) sensor.targetTime = targetTime;
    
    res.json({ success: true, sensor });
});

// ===== 사용자 인증 API =====

// 로그인
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const user = sensorData.users.find(u => u.email === email);
        
        if (!user) {
            return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
        }
        
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
        }
        
        const token = jwt.sign(
            { id: user.id, email: user.email, name: user.name },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// 회원가입
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        
        const existingUser = sensorData.users.find(u => u.email === email);
        if (existingUser) {
            return res.status(400).json({ error: '이미 등록된 이메일입니다.' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const newUser = {
            id: sensorData.users.length + 1,
            email,
            password: hashedPassword,
            name
        };
        sensorData.users.push(newUser);
        
        const token = jwt.sign(
            { id: newUser.id, email: newUser.email, name: newUser.name },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        res.json({
            success: true,
            token,
            user: {
                id: newUser.id,
                email: newUser.email,
                name: newUser.name
            }
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== 대시보드 데이터 API (수정됨) =====

// 대시보드 통계
app.get('/api/dashboard/stats', authenticateToken, (req, res) => {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const currentTime = now.toTimeString().slice(0, 5); // HH:MM
    
    // 오늘의 센서별 통계
    const todayStats = sensorData.dailyStats[today] || { 
        sensors: { 1: { count: 0, times: [] }, 2: { count: 0, times: [] }, 
                  3: { count: 0, times: [] }, 4: { count: 0, times: [] } }
    };
    
    // 현재 시간 기준 다음 약 복용 시간 계산
    let nextMedication = null;
    let timeUntilNext = Infinity;
    
    for (let id in sensorData.sensors) {
        const sensor = sensorData.sensors[id];
        if (!sensor.todayOpened && sensor.targetTime > currentTime) {
            const [targetHour, targetMin] = sensor.targetTime.split(':').map(Number);
            const targetDate = new Date(now);
            targetDate.setHours(targetHour, targetMin, 0, 0);
            const timeDiff = targetDate - now;
            
            if (timeDiff > 0 && timeDiff < timeUntilNext) {
                timeUntilNext = timeDiff;
                nextMedication = {
                    sensor,
                    timeRemaining: Math.round(timeDiff / 1000 / 60) // minutes
                };
            }
        }
    }
    
    // 최근 7일 데이터
    const weeklyData = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateKey = date.toISOString().split('T')[0];
        const dayStats = sensorData.dailyStats[dateKey];
        
        let completedCount = 0;
        if (dayStats && dayStats.sensors) {
            for (let sId in dayStats.sensors) {
                if (dayStats.sensors[sId].count > 0) completedCount++;
            }
        }
        
        weeklyData.push({
            date: dateKey,
            completedCount,
            day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()]
        });
    }
    
    // 순응도 계산 (4개 약통 모두 복용시 100%)
    let totalCompleted = 0;
    let totalExpected = 0;
    
    Object.values(sensorData.dailyStats).forEach(day => {
        if (day.sensors) {
            Object.values(day.sensors).forEach(sensor => {
                if (sensor.count > 0) totalCompleted++;
            });
        }
        totalExpected += 4; // 하루 4개 약통
    });
    
    const adherenceRate = totalExpected > 0 ? 
        Math.round((totalCompleted / totalExpected) * 100) : 0;
    
    res.json({
        sensors: sensorData.sensors,
        today: todayStats,
        weekly: weeklyData,
        adherenceRate,
        nextMedication,
        currentTime,
        lastAction: sensorData.history[0] || null
    });
});

// 센서 이력 조회
app.get('/api/sensor/history', authenticateToken, (req, res) => {
    res.json({
        history: sensorData.history,
        dailyStats: sensorData.dailyStats
    });
});

// 상세 통계 데이터 (수정됨)
app.get('/api/reports/detailed', authenticateToken, (req, res) => {
    // 센서별 통계 계산
    const sensorStats = {};
    
    for (let sensorId = 1; sensorId <= 4; sensorId++) {
        sensorStats[sensorId] = {
            name: sensorData.sensors[sensorId].name,
            emoji: sensorData.sensors[sensorId].emoji,
            totalCount: 0,
            successRate: 0,
            averageTime: null,
            weeklyPattern: new Array(7).fill(0),
            hourlyDistribution: new Array(24).fill(0)
        };
    }
    
    // 데이터 집계
    let totalDays = 0;
    Object.entries(sensorData.dailyStats).forEach(([date, dayData]) => {
        totalDays++;
        const dayOfWeek = new Date(date).getDay();
        
        if (dayData.sensors) {
            for (let sensorId in dayData.sensors) {
                const sensorDayData = dayData.sensors[sensorId];
                if (sensorDayData.count > 0) {
                    sensorStats[sensorId].totalCount += sensorDayData.count;
                    sensorStats[sensorId].weeklyPattern[dayOfWeek]++;
                    
                    // 시간대 분석
                    sensorDayData.times?.forEach(time => {
                        const hour = new Date(time).getHours();
                        sensorStats[sensorId].hourlyDistribution[hour]++;
                    });
                }
            }
        }
    });
    
    // 성공률 계산
    for (let sensorId in sensorStats) {
        if (totalDays > 0) {
            sensorStats[sensorId].successRate = 
                Math.round((sensorStats[sensorId].totalCount / totalDays) * 100);
        }
    }
    
    // 연속 복약 일수 계산
    const streakData = calculateStreakBySensor(sensorData.dailyStats);
    
    res.json({
        sensorStats,
        totalDays,
        history: sensorData.history.slice(0, 100), // 최근 100개
        streakData,
        adherenceMetrics: {
            totalDays,
            overallAdherence: calculateOverallAdherence(sensorData.dailyStats),
            sensorComparison: compareSensorPerformance(sensorStats)
        }
    });
});

// 센서별 연속 복약 계산
function calculateStreakBySensor(dailyStats) {
    const streaks = { 1: 0, 2: 0, 3: 0, 4: 0 };
    const currentStreaks = { 1: 0, 2: 0, 3: 0, 4: 0 };
    
    const dates = Object.keys(dailyStats).sort();
    
    dates.forEach(date => {
        const dayData = dailyStats[date];
        if (dayData.sensors) {
            for (let sensorId = 1; sensorId <= 4; sensorId++) {
                if (dayData.sensors[sensorId] && dayData.sensors[sensorId].count > 0) {
                    currentStreaks[sensorId]++;
                    streaks[sensorId] = Math.max(streaks[sensorId], currentStreaks[sensorId]);
                } else {
                    currentStreaks[sensorId] = 0;
                }
            }
        }
    });
    
    return { maxStreaks: streaks, currentStreaks };
}

// 전체 순응도 계산
function calculateOverallAdherence(dailyStats) {
    let totalSuccess = 0;
    let totalExpected = 0;
    
    Object.values(dailyStats).forEach(day => {
        if (day.sensors) {
            for (let sensorId = 1; sensorId <= 4; sensorId++) {
                totalExpected++;
                if (day.sensors[sensorId] && day.sensors[sensorId].count > 0) {
                    totalSuccess++;
                }
            }
        }
    });
    
    return totalExpected > 0 ? Math.round((totalSuccess / totalExpected) * 100) : 0;
}

// 센서간 성과 비교
function compareSensorPerformance(sensorStats) {
    const comparison = [];
    for (let sensorId in sensorStats) {
        comparison.push({
            sensorId,
            name: sensorStats[sensorId].name,
            emoji: sensorStats[sensorId].emoji,
            successRate: sensorStats[sensorId].successRate,
            totalCount: sensorStats[sensorId].totalCount
        });
    }
    return comparison.sort((a, b) => b.successRate - a.successRate);
}

// ===== 실시간 알림 체크 API =====
app.get('/api/notifications/check', authenticateToken, (req, res) => {
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 5);
    const alerts = [];
    
    for (let id in sensorData.sensors) {
        const sensor = sensorData.sensors[id];
        const [targetHour, targetMin] = sensor.targetTime.split(':').map(Number);
        const targetDate = new Date(now);
        targetDate.setHours(targetHour, targetMin, 0, 0);
        
        // 목표 시간이 지났는데 아직 복용하지 않은 경우
        if (currentTime > sensor.targetTime && !sensor.todayOpened) {
            const minutesLate = Math.round((now - targetDate) / 1000 / 60);
            alerts.push({
                sensorId: id,
                type: 'warning',
                message: `⚠️ ${sensor.emoji} ${sensor.name}을 아직 복용하지 않으셨습니다. (${minutesLate}분 지연)`,
                priority: minutesLate > 60 ? 'high' : 'medium'
            });
        }
        
        // 10분 전 알림
        const timeDiff = targetDate - now;
        if (timeDiff > 0 && timeDiff < 10 * 60 * 1000 && !sensor.todayOpened) {
            alerts.push({
                sensorId: id,
                type: 'info',
                message: `🔔 ${sensor.emoji} ${sensor.name} 복용 시간이 다가옵니다.`,
                priority: 'low'
            });
        }
    }
    
    res.json({ alerts });
});

// ===== 관리자 API =====

// 시스템 상태
app.get('/api/admin/status', (req, res) => {
    const sensorSummary = {};
    for (let id in sensorData.sensors) {
        const sensor = sensorData.sensors[id];
        sensorSummary[id] = {
            name: sensor.name,
            currentValue: sensor.value,
            todayOpened: sensor.todayOpened,
            lastOpened: sensor.lastOpened
        };
    }
    
    res.json({
        server: {
            status: 'running',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            timestamp: new Date().toISOString()
        },
        database: {
            connected: pool !== null,
            type: pool ? 'MariaDB' : 'Memory Storage'
        },
        sensors: sensorSummary,
        statistics: {
            totalUsers: sensorData.users.length,
            totalRecords: sensorData.history.length,
            daysWithData: Object.keys(sensorData.dailyStats).length
        }
    });
});

// 센서 데이터 리셋 (관리자용)
app.post('/api/admin/reset', (req, res) => {
    const { password, sensorId } = req.body;
    
    if (password !== 'admin2025') {
        return res.status(403).json({ error: 'Invalid admin password' });
    }
    
    if (sensorId) {
        // 특정 센서만 리셋
        if (sensorId >= 1 && sensorId <= 4) {
            sensorData.sensors[sensorId].value = 0;
            sensorData.sensors[sensorId].todayOpened = false;
            sensorData.sensors[sensorId].lastOpened = null;
            res.json({ success: true, message: `Sensor ${sensorId} reset successfully` });
        } else {
            res.status(400).json({ error: 'Invalid sensor ID' });
        }
    } else {
        // 모든 데이터 리셋
        for (let id in sensorData.sensors) {
            sensorData.sensors[id].value = 0;
            sensorData.sensors[id].todayOpened = false;
            sensorData.sensors[id].lastOpened = null;
        }
        sensorData.history = [];
        sensorData.dailyStats = {};
        res.json({ success: true, message: 'All sensor data reset successfully' });
    }
});

// ===== 정적 파일 서빙 =====
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        sensors: sensorData.sensors
    });
});

// 404 처리
app.use((req, res) => {
    res.status(404).json({ 
        error: 'Not Found', 
        path: req.url,
        method: req.method 
    });
});

// 에러 처리
app.use((err, req, res, next) => {
    console.error('Error:', err.stack);
    res.status(500).json({ 
        error: 'Internal Server Error',
        message: err.message 
    });
});

// 서버 시작
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║   🚀 COSS Server Started Successfully   ║
╠════════════════════════════════════════╣
║   Port: ${PORT}                           ║
║   Environment: ${process.env.NODE_ENV || 'development'}         ║
║   Time: ${new Date().toLocaleString()}     ║
╠════════════════════════════════════════╣
║   ✨ Multi-Sensor Architecture (v2.0)   ║
║   Sensor 1: 🌅 아침 약 (08:00)         ║
║   Sensor 2: ☀️ 점심 약 (13:00)         ║
║   Sensor 3: 🌙 저녁 약 (18:00)         ║
║   Sensor 4: 🛌 자기전 약 (22:00)       ║
╠════════════════════════════════════════╣
║   Arduino Endpoints:                   ║
║   GET  /value        (모든 센서 조회)   ║
║   GET  /value/:id    (특정 센서 조회)   ║
║   POST /value        (센서값 업데이트)   ║
║         {sensorId: 1-4, value: 0/1}    ║
╠════════════════════════════════════════╣
║   User Endpoints:                      ║
║   POST /api/auth/login                 ║
║   GET  /api/dashboard/stats            ║
║   GET  /api/medications                ║
║   GET  /api/notifications/check        ║
╚════════════════════════════════════════╝
    `);
    
    if (!pool) {
        console.log('⚠️  Warning: No database configured. Using memory storage.');
    }
    
    console.log('\n📌 Admin panel (hidden): /admin.html');
    console.log('🔄 자정 자동 리셋 활성화됨');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    app.close(() => {
        console.log('HTTP server closed');
        if (pool) pool.end();
    });
});
