require('dotenv').config();
const express = require('express');
const mariadb = require('mariadb');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// MariaDB 연결 풀 생성
const pool = mariadb.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    connectionLimit: 5
});

// 미들웨어
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 루트 경로
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 건강 체크
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Arduino에서 센서 데이터 수신
app.post('/api/sensor-data', async (req, res) => {
    let conn;
    try {
        const { boxId, temperature, humidity, compartmentStatus } = req.body;
        
        console.log('Received sensor data:', req.body);

        conn = await pool.getConnection();
        
        // 센서 데이터 저장
        await conn.query(
            'INSERT INTO sensor_logs (box_id, temperature, humidity, timestamp) VALUES (?, ?, ?, NOW())',
            [boxId, temperature, humidity]
        );

        // 각 칸막이 상태 저장
        if (compartmentStatus && Array.isArray(compartmentStatus)) {
            for (const compartment of compartmentStatus) {
                await conn.query(
                    'INSERT INTO compartment_status (box_id, compartment_id, is_open, timestamp) VALUES (?, ?, ?, NOW())',
                    [boxId, compartment.id, compartment.isOpen ? 1 : 0]
                );
            }
        }

        res.json({ success: true, message: 'Data received successfully' });
    } catch (error) {
        console.error('Error saving sensor data:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// 최신 센서 데이터 조회
app.get('/api/sensor-data/latest/:boxId', async (req, res) => {
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
            sensor: sensorData[0] || null,
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

// 서버 시작
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
