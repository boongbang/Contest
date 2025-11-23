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
    count: 0  // 총 감지 횟수
};

// GET: 현재 센서값 조회 (웹 대시보드용)
app.get('/value', (req, res) => {
    console.log('GET /value - 현재값:', currentSensorValue);
    res.json(currentSensorValue);
});

// POST: Arduino에서 센서값 업데이트
app.post('/value', (req, res) => {
    const { a } = req.body;
    
    // 감지 횟수 증가 (1로 변경될 때만)
    if (a === 1 && currentSensorValue.a === 0) {
        currentSensorValue.count++;
    }
    
    currentSensorValue.a = a;
    currentSensorValue.timestamp = new Date().toISOString();
    
    console.log('POST /value - 업데이트:', currentSensorValue);
    
    res.json({ 
        success: true, 
        data: currentSensorValue,
        message: 'Sensor value updated'
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
        sensorStatus: currentSensorValue
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

// 최신 센서 데이터 조회 (DB 사용시)
app.get('/api/sensor-data/latest/:boxId', async (req, res) => {
    if (!pool) {
        res.json({ 
            success: true, 
            sensor: currentSensorValue,
            message: 'Using memory storage'
        });
        return;
    }
    
    let conn;
    try {
        const { boxId } = req.params;
        conn = await pool.getConnection();
        
        const sensorData = await conn.query(
            'SELECT * FROM sensor_logs WHERE box_id = ? ORDER BY timestamp DESC LIMIT 1',
            [boxId]
        );

        const compartmentData = await conn.query(
            'SELECT * FROM compartment_status WHERE box_id = ? ORDER BY timestamp DESC LIMIT 4',
            [boxId]
        );

        res.json({
            success: true,
            sensor: sensorData[0] || currentSensorValue,
            compartments: compartmentData || []
        });
    } catch (error) {
        console.error('Error fetching sensor data:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// 센서 데이터 히스토리 조회 (최근 24시간)
app.get('/api/sensor-data/history/:boxId', async (req, res) => {
    if (!pool) {
        res.json({ 
            success: true, 
            data: [currentSensorValue],
            message: 'No database configured'
        });
        return;
    }
    
    let conn;
    try {
        const { boxId } = req.params;
        conn = await pool.getConnection();
        
        const history = await conn.query(
            `SELECT * FROM sensor_logs 
             WHERE box_id = ? AND timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
             ORDER BY timestamp DESC`,
            [boxId]
        );

        res.json({ success: true, data: history });
    } catch (error) {
        console.error('Error fetching history:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// 복약 일정 조회
app.get('/api/medication-schedule/:boxId', async (req, res) => {
    if (!pool) {
        res.json({ 
            success: true, 
            data: [],
            message: 'No database configured'
        });
        return;
    }
    
    let conn;
    try {
        const { boxId } = req.params;
        conn = await pool.getConnection();
        
        const schedules = await conn.query(
            `SELECT * FROM medication_schedule 
             WHERE box_id = ? AND is_taken = 0
             ORDER BY scheduled_time ASC`,
            [boxId]
        );

        res.json({ success: true, data: schedules });
    } catch (error) {
        console.error('Error fetching schedule:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// 복약 완료 처리
app.post('/api/medication-schedule/complete', async (req, res) => {
    if (!pool) {
        res.json({ 
            success: true, 
            message: 'No database configured'
        });
        return;
    }
    
    let conn;
    try {
        const { scheduleId } = req.body;
        conn = await pool.getConnection();
        
        await conn.query(
            'UPDATE medication_schedule SET is_taken = 1, taken_time = NOW() WHERE id = ?',
            [scheduleId]
        );

        res.json({ success: true, message: 'Medication marked as taken' });
    } catch (error) {
        console.error('Error updating schedule:', error);
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
║   Endpoints:                           ║
║   GET  /                               ║
║   GET  /value     (센서값 조회)         ║
║   POST /value     (센서값 업데이트)     ║
║   GET  /health                         ║
║   POST /api/sensor-data                ║
╚════════════════════════════════════════╝
    `);
    
    if (!pool) {
        console.log('⚠️  Warning: No database configured. Using memory storage only.');
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    app.close(() => {
        console.log('HTTP server closed');
        if (pool) {
            pool.end();
        }
    });
});
