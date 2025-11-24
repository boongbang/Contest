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
    
    // 약통 제거 (복용) 감지
    if (finalValue === 1 && prevValue === 0) {
        sensor.lastOpened = now.toISOString();
        sensor.todayOpened = true;
        
        // 통계 업데이트
        const dateKey = now.toISOString().split('T')[0];
        if (!sensorData.dailyStats[dateKey]) sensorData.dailyStats[dateKey] = { sensors: {} };
        if (!sensorData.dailyStats[dateKey].sensors) sensorData.dailyStats[dateKey].sensors = {};
        if (!sensorData.dailyStats[dateKey].sensors[finalSensorId]) {
            sensorData.dailyStats[dateKey].sensors[finalSensorId] = { count: 0, times: [] };
        }
        
        sensorData.dailyStats[dateKey].sensors[finalSensorId].count++;
        sensorData.dailyStats[dateKey].sensors[finalSensorId].times.push(now.toISOString());
        
        // 이력 추가
        sensorData.history.unshift({
            sensorId: finalSensorId,
            sensorName: sensor.name,
            action: 'removed',
            timestamp: now.toISOString(),
            value: finalValue
        });
        if (sensorData.history.length > 500) sensorData.history = sensorData.history.slice(0, 500);
        
        console.log(`[Sensor ${finalSensorId}] Removed`);
        saveData();
    }
    
    // 약통 복귀 감지
    if (finalValue === 0 && prevValue === 1) {
        sensorData.history.unshift({
            sensorId: finalSensorId,
            sensorName: sensor.name,
            action: 'returned',
            timestamp: now.toISOString(),
            value: finalValue
        });
        console.log(`[Sensor ${finalSensorId}] Returned`);
        saveData();
    }
    
    sensor.value = finalValue;
    res.json({ success: true, sensor });
});

// 2. 로그인/회원가입
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

// 3. 대시보드 데이터
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

    res.json({
        sensors: sensorData.sensors,
        today: todayStats,
        weekly,
        adherenceRate: 85, // 임시 계산값
        lastAction: sensorData.history[0]
    });
});

// 4. 리포트 데이터
app.get('/api/reports/detailed', authenticateToken, (req, res) => {
    // 간단한 리포트 구조 반환
    res.json({
        sensorStats: sensorData.sensors,
        history: sensorData.history.slice(0, 50),
        totalDays: Object.keys(sensorData.dailyStats).length
    });
});

app.get('/api/medications', authenticateToken, (req, res) => {
    res.json(Object.values(sensorData.sensors));
});

// 5. [핵심 수정] 알림 체크 API (소리 및 시간 제한 로직)
app.get('/api/notifications/check', authenticateToken, (req, res) => {
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 5); // HH:MM
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
        // 양수: 지각, 음수: 아직 시간 안됨
        const diffMinutes = Math.round((now - targetDate) / 1000 / 60);
        
        // 1. 복용 시간 지각 알림 (30분 이내일 때만 소리 울림)
        if (diffMinutes > 0) {
            if (diffMinutes <= 30) {
                // 30분 이내: 소리 ON
                alerts.push({
                    sensorId: id,
                    type: 'warning',
                    message: `🔔 ${sensor.emoji} ${sensor.name} 복용 시간입니다! (${diffMinutes}분 지남)`,
                    playSound: true, // 프론트엔드에서 소리 재생 트리거
                    priority: 'high'
                });
            } else {
                // 30분 초과: 소리 OFF, 조용한 알림 (선택 사항, 여기선 뺌)
                // 요청사항: "30분이 지난 뒤에는 울리지 않게" -> 리스트에서 제외
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

// 6. 관리자 리셋
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

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 서버 시작
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📂 Data saved in: ${DATA_FILE}`);
});
