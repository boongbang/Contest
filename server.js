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

// MariaDB 연결 풀 (DB 정보가 있을 때만 생성 - 현재는 JSON 파일 모드)
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
// 비밀번호 'coss1234'의 Bcrypt Hash: $2a$10$vI8Z... (실제 생성된 해시로 가정)
// 여기서는 서버 시작 시 해시를 생성하거나 고정된 해시를 사용합니다.
const DEFAULT_HASH = '$2a$10$E9.k.h.z.a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p.q.r.s.t.u'; // Placeholder logic replaces this below

let sensorData = {
    sensors: {
        1: { id: 1, name: '아침 약', emoji: '🌅', value: 0, lastOpened: null, todayOpened: false, targetTime: '09:00', description: '식후 30분' },
        2: { id: 2, name: '점심 약', emoji: '☀️', value: 0, lastOpened: null, todayOpened: false, targetTime: '13:00', description: '비타민' },
        3: { id: 3, name: '저녁 약', emoji: '🌙', value: 0, lastOpened: null, todayOpened: false, targetTime: '18:00', description: '식후 30분' },
        4: { id: 4, name: '자기전', emoji: '🛌', value: 0, lastOpened: null, todayOpened: false, targetTime: '22:00', description: '수면 전' }
    },
    history: [],
    dailyStats: {},
    // 사용자별 약물 설정 저장소 (userId를 키로 사용)
    userMedications: {
        1: { // 홍길동의 기본 데이터
            1: { time: '09:00', meds: [] },
            2: { time: '13:00', meds: [] },
            3: { time: '18:00', meds: [] },
            4: { time: '22:00', meds: [] }
        }
    },
    users: []
};

// 초기 사용자 설정 (비밀번호 coss1234)
(async () => {
    const hash = await bcrypt.hash('coss1234', 10);
    sensorData.users = [
        { id: 1, email: 'user@coss.com', password: hash, name: '홍길동' }
    ];
})();

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
            
            // 기존 데이터 병합 (users 비밀번호 업데이트를 위해 users는 제외하거나 로직 조정 가능하나, 
            // 여기서는 파일 우선하되 없으면 초기값 사용)
            sensorData = { ...sensorData, ...loadedData };
            
            // userMedications가 없는 구버전 파일 호환성 처리
            if (!sensorData.userMedications) sensorData.userMedications = {};
            
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

// 1. 센서 값 조회 및 업데이트 (Arduino 통신용)
app.get('/value', (req, res) => res.json(sensorData.sensors));

app.post('/value', (req, res) => {
    // Arduino에서 a 또는 value로 보냄, sensorId도 받을 수 있게 수정
    const { sensorId, value, a } = req.body;
    const now = new Date();
    
    let finalSensorId = sensorId || 1; // 기본값 1
    let finalValue = value !== undefined ? value : a;
    
    if (finalSensorId < 1 || finalSensorId > 4) return res.status(400).json({ error: 'Invalid ID' });
    
    const sensor = sensorData.sensors[finalSensorId];
    const prevValue = sensor.value;
    
    // 1 -> 0 : Arduino는 감지됨을 0으로 보낼수도 있고 1로 보낼수도 있음. 
    // 메뉴얼에는 "removed as 1"이라고 되어 있으므로 1이 열림(복용)
    
    // 약통 제거 (복용) 감지: 0 -> 1
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
        
        console.log(`[Sensor ${finalSensorId}] Removed (Taken)`);
        saveData();
    }
    
    // 약통 복귀 감지: 1 -> 0
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
    
    if (!user) return res.status(401).json({ error: 'User not found' });
    
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
    res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email } });
});

app.post('/api/auth/register', async (req, res) => {
    const { email, password, name } = req.body;
    if (sensorData.users.find(u => u.email === email)) return res.status(400).json({ error: 'User already exists' });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = { id: sensorData.users.length + 1, email, password: hashedPassword, name };
    sensorData.users.push(newUser);
    
    // 새 유저를 위한 빈 약물 데이터 생성
    sensorData.userMedications[newUser.id] = {
        1: { time: '09:00', meds: [] },
        2: { time: '13:00', meds: [] },
        3: { time: '18:00', meds: [] },
        4: { time: '22:00', meds: [] }
    };

    saveData();
    
    const token = jwt.sign({ id: newUser.id, email }, JWT_SECRET);
    res.json({ success: true, token, user: { id: newUser.id, name, email } });
});

// 3. 사용자 약물 데이터 API (GET/POST) - 수정 사항 반영
app.get('/api/medications/:userId', authenticateToken, (req, res) => {
    const userId = req.params.userId;
    const data = sensorData.userMedications[userId] || {
        1: { time: '09:00', meds: [] },
        2: { time: '13:00', meds: [] },
        3: { time: '18:00', meds: [] },
        4: { time: '22:00', meds: [] }
    };
    res.json(data);
});

app.post('/api/medications/:userId', authenticateToken, (req, res) => {
    const userId = req.params.userId;
    const medData = req.body; // { 1: {time, meds}, 2: ... }
    
    if (!medData) return res.status(400).json({ error: 'No data provided' });
    
    sensorData.userMedications[userId] = medData;
    
    // 센서 메타데이터(targetTime)도 동기화하여 알림 로직에 반영
    for(let i=1; i<=4; i++) {
        if(medData[i] && medData[i].time) {
            sensorData.sensors[i].targetTime = medData[i].time;
        }
    }
    
    saveData();
    res.json({ success: true });
});


// 4. 대시보드 통계 및 Adherence Rate
app.get('/api/dashboard/stats', authenticateToken, (req, res) => {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const todayStats = sensorData.dailyStats[today] || { sensors: {} };
    
    // 복약 이행률(Adherence Rate) 계산
    // 오늘 복용했어야 하는 약(targetTime 지난 것) vs 실제 복용한 약
    let scheduledCount = 0;
    let takenCount = 0;
    const currentHM = now.getHours() * 60 + now.getMinutes();

    for(let i=1; i<=4; i++) {
        const sensor = sensorData.sensors[i];
        const [th, tm] = sensor.targetTime.split(':').map(Number);
        const targetHM = th * 60 + tm;
        
        // 현재 시간이 목표 시간을 지났으면 '복용해야 할 약'으로 간주
        if (currentHM >= targetHM) {
            scheduledCount++;
            if (sensor.todayOpened) takenCount++;
        }
    }
    
    const adherenceRate = scheduledCount === 0 ? 100 : Math.round((takenCount / scheduledCount) * 100);

    // 주간 데이터 구성
    const weekly = [];
    const dayNames = ['일','월','화','수','목','금','토'];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const k = d.toISOString().split('T')[0];
        const s = sensorData.dailyStats[k];
        let count = 0;
        if (s && s.sensors) Object.values(s.sensors).forEach(v => { if(v.count > 0) count++; });
        weekly.push({ date: k, completedCount: count, day: dayNames[d.getDay()] });
    }

    res.json({
        sensors: sensorData.sensors,
        today: todayStats,
        weekly,
        adherenceMetrics: {
            totalDays: Object.keys(sensorData.dailyStats).length,
            averagePerDay: (weekly.reduce((a,b)=>a+b.completedCount,0) / 7),
            maxStreak: 0 // (Optional: Streak calculation logic can be added)
        },
        adherenceRate: adherenceRate,
        lastAction: sensorData.history[0]
    });
});

// 5. 리포트 데이터 (서버에서 통계 가공)
app.get('/api/reports/detailed', authenticateToken, (req, res) => {
    // 시간대별(Hourly) 및 요일별(Weekday) 통계 계산
    const hourly = new Array(24).fill(0);
    const weekday = new Array(7).fill(0);
    
    // 'removed'(복용) 액션만 카운트
    sensorData.history.forEach(h => {
        if (h.action === 'removed') {
            const d = new Date(h.timestamp);
            hourly[d.getHours()]++;
            weekday[d.getDay()]++;
        }
    });

    res.json({
        sensorStats: sensorData.sensors,
        history: sensorData.history.slice(0, 100),
        totalDays: Object.keys(sensorData.dailyStats).length,
        hourly: hourly,
        weekday: weekday
    });
});

// 6. 알림 체크 API (30분 규칙 적용)
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
        
        // 현재 시간과의 차이 (밀리초 -> 분)
        // 양수: 지각, 음수: 아직 시간 안됨
        const diffMs = now - targetDate;
        const diffMinutes = Math.floor(diffMs / 1000 / 60);
        
        // 알림 로직: 복용 시간이 지났고, 30분 이내인 경우에만 'warning' 알림
        if (diffMinutes > 0 && diffMinutes <= 30) {
            alerts.push({
                sensorId: id,
                type: 'warning',
                message: `🔔 ${sensor.name} 복용 시간입니다! (${diffMinutes}분 지남)`,
                playSound: true // 클라이언트에서 이 플래그를 보고 소리 재생
            });
        }
    }
    
    res.json({ alerts });
});

// 7. 관리자 리셋
app.post('/api/admin/reset', (req, res) => {
    const { password } = req.body;
    // 간단한 관리자 비번 체크
    if (password !== 'admin2025' && password !== 'coss1234') return res.status(403).json({ error: '비번 오류' });
    
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

// 헬스 체크
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 서버 시작
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📂 Data file: ${DATA_FILE}`);
});
