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

// MariaDB 연결 풀
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

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static('public'));

// 인증 미들웨어
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    constXH token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access token required' });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

// --- [API] 인증 ---
app.post('/api/auth/signup', async (req, res) => {
    /* 기존 회원가입 로직 유지, box_id 컬럼 추가 고려 */
    const { name, email, password } = req.body;
    let conn;
    try {
        if(!pool) return res.status(500).json({error: 'No DB'});
        conn = await pool.getConnection();
        const hashedPassword = await bcrypt.hash(password, 10);
        await conn.query('INSERT INTO users (name, email, password, created_at) VALUES (?, ?, ?, NOW())', [name, email, hashedPassword]);
        res.status(201).json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); } 
    finally { if (conn) conn.release(); }
});

app.post('/api/auth/login', async (req, res) => {
    /* 기존 로그인 로직 + box_id 정보 반환 */
    const { email, password } = req.body;
    let conn;
    try {
        if(!pool) { /* 테스트 계정 로직 유지 */ 
             if(email === 'test@test.com') return res.json({ success: true, token: 'test', user: {id:1, email, name:'Tester'} });
             return res.status(401).json({error: 'No DB'});
        }
        conn = await pool.getConnection();
        const users = await conn.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0 || !await bcrypt.compare(password, users[0].password)) 
            return res.status(401).json({ error: 'Invalid credentials' });
        
        const token = jwt.sign({ id: users[0].id, email: users[0].email }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ success: true, token, user: { id: users[0].id, name: users[0].name, email: users[0].email, box_id: users[0].box_id } });
    } catch (e) { res.status(500).json({ error: e.message }); }
    finally { if (conn) conn.release(); }
});

app.get('/api/auth/verify', authenticateToken, (req, res) => res.json({ success: true, user: req.user }));

// --- [API] 사용자 설정 (기기 연동) ---
app.post('/api/user/settings', authenticateToken, async (req, res) => {
    const { box_id } = req.body;
    const userId = req.user.id;
    let conn;
    try {
        if(!pool) return res.json({success:true});
        conn = await pool.getConnection();
        await conn.query('UPDATE users SET box_id = ? WHERE id = ?', [box_id, userId]);
        res.json({ success: true, message: '기기 연동 완료' });
    } catch(e) { res.status(500).json({error:e.message}); }
    finally { if(conn) conn.release(); }
});

// --- [API] 복약 일정 (Schedule) ---
app.get('/api/schedule', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    let conn;
    try {
        if(!pool) return res.json({success:true, data:[]});
        conn = await pool.getConnection();
        // users 테이블과 조인하거나 user_id 컬럼 추가 필요. 여기선 box_id 기반으로 가정하거나 user_id 직접 사용
        // 편의상 medication_schedule에 user_id가 있다고 가정하거나 box_id를 통해 조회
        const rows = await conn.query('SELECT * FROM medication_schedule WHERE user_id = ? ORDER BY scheduled_time', [userId]);
        res.json({ success: true, data: rows });
    } catch(e) { res.status(500).json({error: e.message}); }
    finally { if(conn) conn.release(); }
});

app.post('/api/schedule', authenticateToken, async (req, res) => {
    const { time, label } = req.body; // time format: '09:00'
    const userId = req.user.id;
    let conn;
    try {
        if(!pool) return res.json({success:true});
        conn = await pool.getConnection();
        await conn.query('INSERT INTO medication_schedule (user_id, scheduled_time, label) VALUES (?, ?, ?)', [userId, time, label]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({error: e.message}); }
    finally { if(conn) conn.release(); }
});

app.delete('/api/schedule/:id', authenticateToken, async (req, res) => {
    const scheduleId = req.params.id;
    let conn;
    try {
        if(!pool) return res.json({success:true});
        conn = await pool.getConnection();
        await conn.query('DELETE FROM medication_schedule WHERE id = ?', [scheduleId]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({error: e.message}); }
    finally { if(conn) conn.release(); }
});

// --- [API] 센서 및 로그 ---
// 기존 /value, /api/sensor-data 유지하되, sensor-data 수신 시 box_id와 매핑된 user를 찾아 로그 기록하는 로직 보강 권장
let currentSensorValue = { a: 0, timestamp: new Date().toISOString() };

app.get('/value', (req, res) => res.json(currentSensorValue));

app.post('/value', async (req, res) => {
    const { a } = req.body;
    // 상태 변화 감지 (0 -> 1)
    if (a === 1 && currentSensorValue.a === 0) {
        if (pool) {
            let conn;
            try {
                conn = await pool.getConnection();
                // 임시: user_id 1번에게 기록. 실제론 box_id로 유저 조회해야 함
                await conn.query('INSERT INTO medication_logs (user_id, timestamp) VALUES (?, NOW())', [1]);
            } catch(e) { console.error(e); } 
            finally { if(conn) conn.release(); }
        }
    }
    currentSensorValue = { a, timestamp: new Date().toISOString() };
    res.json({ success: true, data: currentSensorValue });
});

app.get('/api/medication-logs', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    let conn;
    try {
        if(!pool) return res.json({success:true, data:[]});
        conn = await pool.getConnection();
        const logs = await conn.query('SELECT * FROM medication_logs WHERE user_id = ? ORDER BY timestamp DESC LIMIT 50', [userId]);
        res.json({ success: true, data: logs });
    } catch(e) { res.status(500).json({error: e.message}); }
    finally { if(conn) conn.release(); }
});

// DB 초기화
async function initDatabase() {
    if (!pool) return;
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(`CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100), email VARCHAR(100) UNIQUE, 
            password VARCHAR(255), box_id VARCHAR(50), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        await conn.query(`CREATE TABLE IF NOT EXISTS medication_schedule (
            id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, scheduled_time VARCHAR(10), label VARCHAR(50)
        )`);
        await conn.query(`CREATE TABLE IF NOT EXISTS medication_logs (
            id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('✅ Tables Initialized');
    } catch (e) { console.error(e); } 
    finally { if (conn) conn.release(); }
}

app.listen(PORT, async () => {
    await initDatabase();
    console.log(`🚀 Server running on port ${PORT}`);
});
