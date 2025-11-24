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

// 미들웨어 설정
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static('public'));

// [핵심] 현재 활성 사용자 추적 (토큰 -> userId 매핑)
let activeUsers = new Map(); 

// [핵심] 메모리 기반 데이터 저장소 (DB 없을 때 사용, userId -> logs 배열)
let memoryMedicationLogs = new Map(); 

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
        req.token = token;
        
        // 요청이 들어올 때마다 활성 사용자로 갱신 (로그인 유지 효과)
        activeUsers.set(token, user.id);
        
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
            return res.status(500).json({ error: 'Database not configured' });
        }
        
        conn = await pool.getConnection();
        
        // 이메일 중복 확인
        const existingUser = await conn.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser.length > 0) {
            return res.status(400).json({ error: '이미 사용 중인 이메일입니다' });
        }
        
        // 비밀번호 해싱 및 사용자 생성
        const hashedPassword = await bcrypt.hash(password, 10);
        await conn.query(
            'INSERT INTO users (name, email, password, created_at) VALUES (?, ?, ?, NOW())',
            [name, email, hashedPassword]
        );
        
        res.status(201).json({ success: true, message: '회원가입이 완료되었습니다' });
        
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
        // DB 없는 경우 테스트 계정 처리
        if (!pool) {
            if (email === 'test@test.com' && password === 'test1234') {
                const token = jwt.sign(
                    { id: 1, email: 'test@test.com', name: '테스트 사용자' },
                    JWT_SECRET,
                    { expiresIn: rememberMe ? '30d' : '24h' }
                );
                
                // 활성 사용자에 등록
                activeUsers.set(token, 1);
                
                return res.json({
                    success: true, 
                    token, 
                    user: { id: 1, email: 'test@test.com', name: '테스트 사용자' }
                });
            }
            return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' });
        }
        
        // DB 로그인 처리
        conn = await pool.getConnection();
        const users = await conn.query('SELECT id, name, email, password FROM users WHERE email = ?', [email]);
        
        if (users.length === 0) return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' });
        
        const user = users[0];
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' });
        
        const token = jwt.sign(
            { id: user.id, email: user.email, name: user.name },
            JWT_SECRET,
            { expiresIn: rememberMe ? '30d' : '24h' }
        );
        
        // 활성 사용자에 등록
        activeUsers.set(token, user.id);
        
        await conn.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
        
        res.json({
            success: true,
            token,
            user: { id: user.id, name: user.name, email: user.email }
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
    res.json({ success: true, user: req.user });
});

// 로그아웃
app.post('/api/auth/logout', authenticateToken, (req, res) => {
    // 활성 사용자 목록에서 해당 토큰 제거 (데이터는 memoryMedicationLogs에 남아있음)
    activeUsers.delete(req.token);
    res.json({ success: true, message: 'Logged out successfully' });
});

// ===== IR 센서 및 데이터 처리 엔드포인트 =====

// 현재 센서값 상태 변수
let currentSensorValue = { 
    a: 0,  // 0: 정상, 1: 감지
    timestamp: new Date().toISOString(),
    count: 0 
};

// GET: 현재 센서값 조회
app.get('/value', (req, res) => {
    // console.log('GET /value - 현재값:', currentSensorValue); // 로그 너무 많으면 주석 처리
    res.json(currentSensorValue);
});

// [최종 수정] POST: Arduino 센서값 업데이트 및 중복 방지 저장
app.post('/value', async (req, res) => {
    const { a } = req.body;
    const now = new Date();
    
    // 상태가 0(정상)에서 1(감지)로 변할 때만 기록
    if (a === 1 && currentSensorValue.a === 0) {
        currentSensorValue.count++;
        
        // 활성 사용자가 있는 경우 기록
        if (activeUsers.size > 0) {
            // ★ 중요: Set을 사용하여 중복된 userId 제거 (한 사람이 여러 번 로그인해도 1번만 기록)
            const uniqueUserIds = new Set(activeUsers.values());

            for (const userId of uniqueUserIds) {
                if (pool) {
                    // DB 모드
                    let conn;
                    try {
                        conn = await pool.getConnection();
                        await conn.query(
                            'INSERT INTO medication_logs (user_id, timestamp, event_type) VALUES (?, ?, ?)',
                            [userId, now, 'SENSOR_TRIGGERED']
                        );
                        console.log(`[DB] Log saved for user ${userId}`);
                    } catch (error) {
                        console.error('Error saving log:', error);
                    } finally {
                        if (conn) conn.release();
                    }
                } else {
                    // 메모리 모드 (DB 없음)
                    if (!memoryMedicationLogs.has(userId)) {
                        memoryMedicationLogs.set(userId, []);
                    }
                    memoryMedicationLogs.get(userId).push({
                        timestamp: now.toISOString(),
                        event_type: 'SENSOR_TRIGGERED'
                    });
                    console.log(`[Memory] Log saved for user ${userId} (Total: ${memoryMedicationLogs.get(userId).length})`);
                }
            }
        }
    }
    
    currentSensorValue.a = a;
    currentSensorValue.timestamp = now.toISOString();
    
    console.log(`POST /value - State: ${a}, Count: ${currentSensorValue.count}`);
    
    res.json({ 
        success: true, 
        data: currentSensorValue,
        message: 'Sensor value updated'
    });
});

// ===== 사용자 데이터 조회 API =====

// 복약 로그 조회
app.get('/api/medication-logs', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const { start_date, end_date, limit = 100 } = req.query;
    
    // DB 없으면 메모리에서 조회
    if (!pool) {
        const logs = memoryMedicationLogs.get(userId) || [];
        // 날짜 역순 정렬 (최신순)
        const sortedLogs = [...logs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        return res.json({ success: true, data: sortedLogs });
    }
    
    let conn;
    try {
        conn = await pool.getConnection();
        let query = 'SELECT * FROM medication_logs WHERE user_id = ?';
        const params = [userId];
        
        if (start_date) { query += ' AND timestamp >= ?'; params.push(start_date); }
        if (end_date) { query += ' AND timestamp <= ?'; params.push(end_date); }
        
        query += ' ORDER BY timestamp DESC LIMIT ?';
        params.push(parseInt(limit));
        
        const logs = await conn.query(query, params);
        res.json({ success: true, data: logs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// 복약 로그 수동 추가
app.post('/api/medication-logs', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const { timestamp } = req.body;
    const logTime = timestamp || new Date();

    if (!pool) {
        if (!memoryMedicationLogs.has(userId)) memoryMedicationLogs.set(userId, []);
        memoryMedicationLogs.get(userId).push({
            timestamp: new Date(logTime).toISOString(),
            event_type: 'MANUAL_RECORD'
        });
        return res.json({ success: true, message: 'Log saved in memory' });
    }
    
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(
            'INSERT INTO medication_logs (user_id, timestamp, event_type) VALUES (?, ?, ?)',
            [userId, logTime, 'MANUAL_RECORD']
        );
        res.json({ success: true, message: 'Log saved to DB' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// 복약 로그 초기화 (캐시 삭제)
app.delete('/api/medication-logs/reset', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    
    if (!pool) {
        memoryMedicationLogs.set(userId, []); // 빈 배열로 초기화
        console.log(`Memory logs reset for user ${userId}`);
        return res.json({ success: true, message: 'Memory logs reset' });
    }
    
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query('DELETE FROM medication_logs WHERE user_id = ?', [userId]);
        res.json({ success: true, message: 'DB logs reset' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// 복약 통계 조회 (대시보드 차트용)
app.get('/api/medication-stats', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    
    // 통계 계산 로직 함수
    const calculateStats = (logs) => {
        const now = new Date();
        const todayStr = now.toDateString();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());

        return {
            total_count: logs.length,
            today_count: logs.filter(l => new Date(l.timestamp).toDateString() === todayStr).length,
            week_count: logs.filter(l => new Date(l.timestamp) >= weekAgo).length,
            month_count: logs.filter(l => new Date(l.timestamp) >= monthAgo).length,
            // 최근 7일간 복약한 날짜 수 / 7 * 100
            adherence_rate: Math.round(new Set(logs.filter(l => new Date(l.timestamp) >= weekAgo).map(l => new Date(l.timestamp).toDateString())).size / 7 * 100) || 0,
            streak_days: 0 // (복잡한 스트릭 계산은 일단 생략하거나 간단히 구현)
        };
    };

    if (!pool) {
        const logs = memoryMedicationLogs.get(userId) || [];
        return res.json({ success: true, data: calculateStats(logs) });
    }
    
    let conn;
    try {
        conn = await pool.getConnection();
        // DB에서 전체 로그 가져와서 계산 (데이터 양이 적을 때 유효)
        const logs = await conn.query('SELECT * FROM medication_logs WHERE user_id = ? ORDER BY timestamp DESC', [userId]);
        res.json({ success: true, data: calculateStats(logs) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// 기존 API 및 에러 처리
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/dashboard.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        sensorStatus: currentSensorValue,
        activeSessions: activeUsers.size // 현재 연결된 토큰 수
    });
});

// COSS 프로젝트용 복합 데이터 수신 (Optional)
app.post('/api/sensor-data', async (req, res) => {
    // ... (기존 로직 유지, 필요시 사용)
    res.json({ success: true, message: 'Data received' });
});

app.use((req, res) => res.status(404).json({ error: 'Not Found' }));
app.use((err, req, res, next) => {
    console.error('Error:', err.stack);
    res.status(500).json({ error: 'Internal Server Error' });
});

// DB 초기화 함수
async function initDatabase() {
    if (!pool) return console.log('Running in Memory Mode (No DB)');
    let conn;
    try {
        conn = await pool.getConnection();
        // 테이블 생성 쿼리들...
        await conn.query(`CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(100) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP NULL
        )`);
        await conn.query(`CREATE TABLE IF NOT EXISTS medication_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            event_type VARCHAR(50) DEFAULT 'MEDICATION_TAKEN',
            notes TEXT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);
        console.log('✅ Database tables initialized');
    } catch (error) {
        console.error('DB Init Error:', error);
    } finally {
        if (conn) conn.release();
    }
}

// 서버 시작
app.listen(PORT, async () => {
    console.log(`🚀 COSS Server Running on Port ${PORT}`);
    await initDatabase();
});

process.on('SIGTERM', () => {
    app.close(() => pool && pool.end());
});
