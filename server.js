require('dotenv').config();
const express = require('express');
const mariadb = require('mariadb');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// MariaDB 연결 풀 생성 (선택사항 - DB 사용시)
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

// ===== IR 센서 전용 엔드포인트 =====
// 현재 센서값 저장용 메모리 변수
let currentSensorValue = { 
    a: 0,  // 센서값 (0: 정상, 1: 감지)
    timestamp: new Date().toISOString(),
    count: 0,  // 총 감지 횟수
    lastDetection: null,  // 마지막 감지 시간
    dailyCount: 0,  // 오늘 감지 횟수
    connectionStatus: 'waiting'  // waiting, connected, disconnected
};

// 복약 기록 저장용 메모리 (DB 없을 때 사용)
let medicationHistory = [];

// GET: 현재 센서값 조회 (웹 대시보드용)
app.get('/value', (req, res) => {
    console.log('GET /value - 현재값:', currentSensorValue);
    
    // 연결 상태 업데이트
    currentSensorValue.connectionStatus = 'connected';
    
    res.json(currentSensorValue);
});

// POST: Arduino에서 센서값 업데이트
app.post('/value', (req, res) => {
    const { a } = req.body;
    const now = new Date();
    
    // 감지 횟수 증가 (1로 변경될 때만)
    if (a === 1 && currentSensorValue.a === 0) {
        currentSensorValue.count++;
        currentSensorValue.dailyCount++;
        currentSensorValue.lastDetection = now.toISOString();
        
        // 복약 기록 추가
        medicationHistory.push({
            timestamp: now.toISOString(),
            type: 'detection',
            value: a,
            hour: now.getHours(),
            date: now.toLocaleDateString('ko-KR')
        });
        
        // 최대 100개까지만 메모리에 보관
        if (medicationHistory.length > 100) {
            medicationHistory = medicationHistory.slice(-100);
        }
    } else if (a === 0 && currentSensorValue.a === 1) {
        // 약통이 다시 제자리로 돌아옴
        medicationHistory.push({
            timestamp: now.toISOString(),
            type: 'return',
            value: a,
            hour: now.getHours(),
            date: now.toLocaleDateString('ko-KR')
        });
    }
    
    currentSensorValue.a = a;
    currentSensorValue.timestamp = now.toISOString();
    currentSensorValue.connectionStatus = 'connected';
    
    console.log('POST /value - 업데이트:', currentSensorValue);
    
    res.json({ 
        success: true, 
        data: currentSensorValue,
        message: 'Sensor value updated'
    });
});

// ===== 새로운 엔드포인트 =====

// GET: 복약 통계 조회
app.get('/api/stats', (req, res) => {
    const today = new Date();
    const todayStr = today.toLocaleDateString('ko-KR');
    
    // 오늘의 복약 기록 필터링
    const todayRecords = medicationHistory.filter(record => 
        record.date === todayStr && record.type === 'detection'
    );
    
    // 시간대별 복약 체크
    const morningTaken = todayRecords.some(r => r.hour >= 6 && r.hour < 11);
    const afternoonTaken = todayRecords.some(r => r.hour >= 11 && r.hour < 16);
    const eveningTaken = todayRecords.some(r => r.hour >= 16 && r.hour < 22);
    
    // 주간 통계 계산
    const weeklyStats = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toLocaleDateString('ko-KR');
        const dayRecords = medicationHistory.filter(r => 
            r.date === dateStr && r.type === 'detection'
        );
        
        weeklyStats.push({
            date: dateStr,
            day: ['일', '월', '화', '수', '목', '금', '토'][date.getDay()],
            count: dayRecords.length
        });
    }
    
    res.json({
        success: true,
        today: {
            total: todayRecords.length,
            morning: morningTaken,
            afternoon: afternoonTaken,
            evening: eveningTaken
        },
        weekly: weeklyStats,
        allTime: {
            total: currentSensorValue.count,
            lastDetection: currentSensorValue.lastDetection
        }
    });
});

// GET: 복약 히스토리 조회
app.get('/api/history', (req, res) => {
    const { limit = 20 } = req.query;
    
    const recentHistory = medicationHistory
        .slice(-limit)
        .reverse()
        .map(record => ({
            ...record,
            timeAgo: getTimeAgo(new Date(record.timestamp))
        }));
    
    res.json({
        success: true,
        data: recentHistory,
        total: medicationHistory.length
    });
});

// POST: 일일 카운터 리셋 (자정 자동 리셋용)
app.post('/api/reset-daily', (req, res) => {
    currentSensorValue.dailyCount = 0;
    
    res.json({
        success: true,
        message: 'Daily counter reset'
    });
});

// ===== 기존 엔드포인트 =====

// 루트 경로
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 건강 체크
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        sensorStatus: currentSensorValue,
        medicationRecords: medicationHistory.length
    });
});

// Arduino에서 복잡한 센서 데이터 수신 (COSS 프로젝트용)
app.post('/api/sensor-data', async (req, res) => {
    console.log('Received sensor data:', req.body);
    
    // DB 연결이 없으면 메모리에만 저장
    if (!pool) {
        const { boxId, sensorValue, temperature, humidity, compartmentStatus } = req.body;
        
        // 간단한 센서값도 업데이트
        if (sensorValue !== undefined) {
            currentSensorValue.a = sensorValue;
            currentSensorValue.timestamp = new Date().toISOString();
        }
        
        res.json({ 
            success: true, 
            message: 'Data received (no DB)',
            data: req.body 
        });
        return;
    }
    
    // DB 연결이 있으면 데이터베이스에 저장
    let conn;
    try {
        const { boxId, temperature, humidity, compartmentStatus, sensorValue } = req.body;
        
        // 간단한 센서값 업데이트
        if (sensorValue !== undefined) {
            currentSensorValue.a = sensorValue;
            currentSensorValue.timestamp = new Date().toISOString();
        }
        
        conn = await pool.getConnection();
        
        // 센서 데이터 저장
        if (temperature !== undefined && humidity !== undefined) {
            await conn.query(
                'INSERT INTO sensor_logs (box_id, temperature, humidity, timestamp) VALUES (?, ?, ?, NOW())',
                [boxId, temperature, humidity]
            );
        }

        // 각 칸막이 상태 저장
        if (compartmentStatus && Array.isArray(compartmentStatus)) {
            for (const compartment of compartmentStatus) {
                await conn.query(
                    'INSERT INTO compartment_status (box_id, compartment_id, is_open, timestamp) VALUES (?, ?, ?, NOW())',
                    [boxId, compartment.id, compartment.isOpen ? 1 : 0]
                );
            }
        }

        res.json({ success: true, message: 'Data saved to database' });
    } catch (error) {
        console.error('Error saving sensor data:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// 404 처리
app.use((req, res) => {
    console.log('404 - Not Found:', req.method, req.url);
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

// Helper 함수들
function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + '년 전';
    
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + '개월 전';
    
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + '일 전';
    
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + '시간 전';
    
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + '분 전';
    
    return '방금 전';
}

// 일일 카운터 자동 리셋 (매일 자정)
function scheduleDailyReset() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const msUntilMidnight = tomorrow - now;
    
    setTimeout(() => {
        currentSensorValue.dailyCount = 0;
        console.log('일일 카운터가 리셋되었습니다');
        
        // 다음 날 자정에도 리셋되도록 재귀 호출
        scheduleDailyReset();
    }, msUntilMidnight);
}

// 서버 시작
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════╗
║   🚀 COSS Smart Medicine Box Server        ║
╠════════════════════════════════════════════╣
║   포트: ${PORT}                              ║
║   환경: ${process.env.NODE_ENV || 'production'}           ║
║   시간: ${new Date().toLocaleString('ko-KR')}  ║
╠════════════════════════════════════════════╣
║   주요 엔드포인트:                          ║
║   GET  /                  (대시보드)        ║
║   GET  /value             (센서값 조회)     ║
║   POST /value             (센서값 업데이트) ║
║   GET  /api/stats         (복약 통계)       ║
║   GET  /api/history       (복약 기록)       ║
║   GET  /health            (헬스체크)        ║
╚════════════════════════════════════════════╝
    `);
    
    if (!pool) {
        console.log('⚠️  경고: 데이터베이스가 구성되지 않았습니다. 메모리 저장소를 사용합니다.');
    }
    
    // 일일 리셋 스케줄러 시작
    scheduleDailyReset();
    console.log('📅 일일 카운터 자동 리셋 스케줄러가 활성화되었습니다.');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM 신호 수신: HTTP 서버를 종료합니다');
    app.close(() => {
        console.log('HTTP 서버가 종료되었습니다');
        if (pool) {
            pool.end();
        }
    });
});
