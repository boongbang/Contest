require('dotenv').config();
const express = require('express');
const mariadb = require('mariadb');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'coss-secret-key-2024';

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

// ===== 인증 미들웨어 =====
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// ===== 인증 관련 엔드포인트 =====

// 회원가입
app.post('/api/auth/signup', async (req, res) => {
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
        return res.status(400).json({ error: '모든 필드를 입력해주세요' });
    }
    
    if (password.length < 8) {
        return res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다' });
    }
    
    let conn;
    try {
        if (!pool) {
            // DB 없을 때 임시 처리
            return res.status(500).json({ error: 'Database not configured' });
        }
        
        conn = await pool.getConnection();
        
        // 이메일 중복 확인
        const existingUser = await conn.query(
            'SELECT id FROM users WHERE email = ?',
            [email]
        );
        
        if (existingUser.length > 0) {
            return res.status(400).json({ error: '이미 사용 중인 이메일입니다' });
        }
        
        // 비밀번호 해싱
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // 사용자 생성
        const result = await conn.query(
            'INSERT INTO users (name, email, password, created_at) VALUES (?, ?, ?, NOW())',
            [name, email, hashedPassword]
        );
        
        res.status(201).json({ 
            success: true, 
            message: '회원가입이 완료되었습니다' 
        });
        
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: '회원가입 처리 중 오류가 발생했습니다' });
    } finally {
        if (conn) conn.release();
    }
});

// 로그인
app.post('/api/auth/login', async (req, res) => {
    const { email, password, rememberMe } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요' });
    }
    
    let conn;
    try {
        if (!pool) {
            // 테스트용 임시 로그인
            if (email === 'test@test.com' && password === 'test1234') {
                const token = jwt.sign(
                    { id: 1, email: 'test@test.com', name: '테스트 사용자' },
                    JWT_SECRET,
                    { expiresIn: rememberMe ? '30d' : '24h' }
                );
                
                return res.json({
                    success: true,
                    token,
                    user: { id: 1, email: 'test@test.com', name: '테스트 사용자' }
                });
            }
            return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' });
        }
        
        conn = await pool.getConnection();
        
        // 사용자 조회
        const users = await conn.query(
            'SELECT id, name, email, password FROM users WHERE email = ?',
            [email]
        );
        
        if (users.length === 0) {
            return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' });
        }
        
        const user = users[0];
        
        // 비밀번호 확인
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' });
        }
        
        // JWT 토큰 생성
        const token = jwt.sign(
            { id: user.id, email: user.email, name: user.name },
            JWT_SECRET,
            { expiresIn: rememberMe ? '30d' : '24h' }
        );
        
        // 마지막 로그인 시간 업데이트
        await conn.query(
            'UPDATE users SET last_login = NOW() WHERE id = ?',
            [user.id]
        );
        
        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email
            }
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: '로그인 처리 중 오류가 발생했습니다' });
    } finally {
        if (conn) conn.release();
    }
});

// 토큰 검증
app.get('/api/auth/verify', authenticateToken, (req, res) => {
    res.json({ 
        success: true, 
        user: req.user 
    });
});

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
app.post('/value', async (req, res) => {
    const { a } = req.body;
    const now = new Date();
    
    // 감지 횟수 증가 및 복약 로그 기록 (0->1로 변경될 때만)
    if (a === 1 && currentSensorValue.a === 0) {
        currentSensorValue.count++;
        
        // 모든 사용자에게 복약 로그 저장 (실제로는 특정 사용자만 저장해야 함)
        // 이 부분은 추후 개선 필요
        if (pool) {
            let conn;
            try {
                conn = await pool.getConnection();
                // 현재는 모든 활성 사용자에게 기록 (개선 필요)
                await conn.query(
                    'INSERT INTO medication_logs (user_id, timestamp, event_type) VALUES (?, ?, ?)',
                    [1, now, 'MEDICATION_TAKEN'] // user_id는 추후 개선
                );
            } catch (error) {
                console.error('Error saving medication log:', error);
            } finally {
                if (conn) conn.release();
            }
        }
    }
    
    currentSensorValue.a = a;
    currentSensorValue.timestamp = now.toISOString();
    
    console.log('POST /value - 업데이트:', currentSensorValue);
    
    res.json({ 
        success: true, 
        data: currentSensorValue,
        message: 'Sensor value updated'
    });
});

// ===== 사용자별 복약 관리 엔드포인트 =====

// 복약 로그 조회 (사용자별)
app.get('/api/medication-logs', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const { start_date, end_date, limit = 100 } = req.query;
    
    if (!pool) {
        return res.json({ success: true, data: [] });
    }
    
    let conn;
    try {
        conn = await pool.getConnection();
        let query = 'SELECT * FROM medication_logs WHERE user_id = ?';
        const params = [userId];
        
        if (start_date) {
            query += ' AND timestamp >= ?';
            params.push(start_date);
        }
        if (end_date) {
            query += ' AND timestamp <= ?';
            params.push(end_date);
        }
        
        query += ' ORDER BY timestamp DESC LIMIT ?';
        params.push(parseInt(limit));
        
        const logs = await conn.query(query, params);
        res.json({ success: true, data: logs });
    } catch (error) {
        console.error('Error fetching medication logs:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// 복약 로그 추가 (수동 기록)
app.post('/api/medication-logs', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const { timestamp } = req.body;
    
    if (!pool) {
        return res.json({ success: true, message: 'Log saved (no DB)' });
    }
    
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(
            'INSERT INTO medication_logs (user_id, timestamp, event_type) VALUES (?, ?, ?)',
            [userId, timestamp || new Date(), 'MANUAL_RECORD']
        );
        
        res.json({ success: true, message: 'Medication log saved' });
    } catch (error) {
        console.error('Error saving medication log:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// 복약 로그 초기화 (사용자별)
app.delete('/api/medication-logs/reset', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    
    if (!pool) {
        return res.json({ success: true, message: 'Logs reset (no DB)' });
    }
    
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(
            'DELETE FROM medication_logs WHERE user_id = ?',
            [userId]
        );
        
        res.json({ success: true, message: 'Medication logs reset' });
    } catch (error) {
        console.error('Error resetting logs:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// 복약 통계 조회 (사용자별)
app.get('/api/medication-stats', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const stats = {
        total_count: 0,
        today_count: 0,
        week_count: 0,
        month_count: 0,
        adherence_rate: 0,
        streak_days: 0
    };
    
    if (!pool) {
        return res.json({ success: true, data: stats });
    }
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    
    let conn;
    try {
        conn = await pool.getConnection();
        
        // 전체 카운트
        const totalResult = await conn.query(
            'SELECT COUNT(*) as count FROM medication_logs WHERE user_id = ?',
            [userId]
        );
        stats.total_count = totalResult[0].count;
        
        // 오늘 카운트
        const todayResult = await conn.query(
            'SELECT COUNT(*) as count FROM medication_logs WHERE user_id = ? AND DATE(timestamp) = CURDATE()',
            [userId]
        );
        stats.today_count = todayResult[0].count;
        
        // 주간 카운트
        const weekResult = await conn.query(
            'SELECT COUNT(*) as count FROM medication_logs WHERE user_id = ? AND timestamp >= ?',
            [userId, weekAgo]
        );
        stats.week_count = weekResult[0].count;
        
        // 월간 카운트
        const monthResult = await conn.query(
            'SELECT COUNT(*) as count FROM medication_logs WHERE user_id = ? AND timestamp >= ?',
            [userId, monthAgo]
        );
        stats.month_count = monthResult[0].count;
        
        // 순응도 계산 (최근 7일)
        const adherenceResult = await conn.query(
            'SELECT COUNT(DISTINCT DATE(timestamp)) as days FROM medication_logs WHERE user_id = ? AND timestamp >= ?',
            [userId, weekAgo]
        );
        stats.adherence_rate = Math.round((adherenceResult[0].days / 7) * 100);
        
        // 연속 복약일 계산
        const streakResult = await conn.query(
            `SELECT DATE(timestamp) as date 
             FROM medication_logs 
             WHERE user_id = ?
             GROUP BY DATE(timestamp) 
             ORDER BY date DESC`,
            [userId]
        );
        
        let streak = 0;
        const dates = streakResult.map(r => new Date(r.date));
        for (let i = 0; i < dates.length; i++) {
            const expectedDate = new Date(today);
            expectedDate.setDate(expectedDate.getDate() - i);
            
            if (dates[i].toDateString() === expectedDate.toDateString()) {
                streak++;
            } else {
                break;
            }
        }
        stats.streak_days = streak;
        
        res.json({ success: true, data: stats });
        
    } catch (error) {
        console.error('Error calculating stats:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// ===== 기존 엔드포인트 =====

// 루트 경로
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 대시보드 경로
app.get('/dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
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

// 데이터베이스 초기화 (첫 실행 시)
async function initDatabase() {
    if (!pool) {
        console.log('Database not configured - running in memory mode');
        return;
    }
    
    let conn;
    try {
        conn = await pool.getConnection();
        
        // users 테이블 생성
        await conn.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP NULL
            )
        `);
        
        // medication_logs 테이블 생성
        await conn.query(`
            CREATE TABLE IF NOT EXISTS medication_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                event_type VARCHAR(50) DEFAULT 'MEDICATION_TAKEN',
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_user_timestamp (user_id, timestamp)
            )
        `);
        
        // 기존 테이블들도 생성
        await conn.query(`
            CREATE TABLE IF NOT EXISTS sensor_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                box_id VARCHAR(50),
                temperature FLOAT,
                humidity FLOAT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await conn.query(`
            CREATE TABLE IF NOT EXISTS compartment_status (
                id INT AUTO_INCREMENT PRIMARY KEY,
                box_id VARCHAR(50),
                compartment_id INT,
                is_open BOOLEAN,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await conn.query(`
            CREATE TABLE IF NOT EXISTS medication_schedule (
                id INT AUTO_INCREMENT PRIMARY KEY,
                box_id VARCHAR(50),
                scheduled_time DATETIME,
                is_taken BOOLEAN DEFAULT 0,
                taken_time DATETIME
            )
        `);
        
        console.log('✅ Database tables initialized successfully');
        
    } catch (error) {
        console.error('Error initializing database:', error);
    } finally {
        if (conn) conn.release();
    }
}

// 서버 시작
app.listen(PORT, async () => {
    console.log(`
╔════════════════════════════════════════╗
║   🚀 COSS Server Started Successfully   ║
╠════════════════════════════════════════╣
║   Port: ${PORT}                           ║
║   Environment: ${process.env.NODE_ENV || 'development'}         ║
║   Time: ${new Date().toLocaleString()}     ║
╠════════════════════════════════════════╣
║   Auth Endpoints:                      ║
║   POST /api/auth/signup                ║
║   POST /api/auth/login                 ║
║   GET  /api/auth/verify                ║
╠════════════════════════════════════════╣
║   User Endpoints:                      ║
║   GET  /api/medication-logs            ║
║   POST /api/medication-logs            ║
║   DELETE /api/medication-logs/reset    ║
║   GET  /api/medication-stats           ║
╠════════════════════════════════════════╣
║   Sensor Endpoints:                    ║
║   GET  /value     (센서값 조회)         ║
║   POST /value     (센서값 업데이트)     ║
║   GET  /health                         ║
║   POST /api/sensor-data                ║
╚════════════════════════════════════════╝
    `);
    
    // 데이터베이스 초기화
    await initDatabase();
    
    if (!pool) {
        console.log('⚠️  Warning: No database configured. Using memory storage only.');
        console.log('📝 Test account: test@test.com / test1234');
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
