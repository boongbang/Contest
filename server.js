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

// ===== 센서 상태 추적 =====
let currentSensorValue = {
    a: 0,  // 센서값 (0: 약통 있음, 1: 약통 없음)
    timestamp: new Date().toISOString(),
    count: 0,  // 총 감지 횟수
    lastRemovalTime: null,  // 마지막 제거 시간
    lastReturnTime: null,   // 마지막 복귀 시간
    state: 'PRESENT'  // PRESENT(있음), REMOVED(제거됨), TAKEN(복약완료)
};

// 복약 이벤트 추적
let medicationEvents = [];

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

// ===== IR 센서 엔드포인트 (핵심) =====

// GET: 현재 센서값 조회 (웹 대시보드용)
app.get('/value', (req, res) => {
    console.log('GET /value - 현재값:', currentSensorValue);
    res.json(currentSensorValue);
});

// POST: Arduino에서 센서값 업데이트 (이탈-복귀 추적 로직 포함)
app.post('/value', async (req, res) => {
    const { a } = req.body;
    const now = new Date();
    
    console.log(`센서 값 수신: ${a} (이전: ${currentSensorValue.a})`);
    
    // 상태 전이 감지 및 처리
    if (currentSensorValue.a === 0 && a === 1) {
        // 약통이 제거됨 (0 -> 1)
        currentSensorValue.state = 'REMOVED';
        currentSensorValue.lastRemovalTime = now.toISOString();
        console.log('🔴 약통 제거 감지:', currentSensorValue.lastRemovalTime);
        
    } else if (currentSensorValue.a === 1 && a === 0) {
        // 약통이 복귀됨 (1 -> 0)
        if (currentSensorValue.state === 'REMOVED' && currentSensorValue.lastRemovalTime) {
            // 제거→복귀 완료: 복약 완료로 처리
            const removalTime = new Date(currentSensorValue.lastRemovalTime);
            const duration = (now - removalTime) / 1000; // 초 단위
            
            // 1초 이상 제거되었을 때만 유효한 복약으로 인정
            if (duration >= 1) {
                currentSensorValue.count++;
                currentSensorValue.state = 'TAKEN';
                currentSensorValue.lastReturnTime = now.toISOString();
                
                // 복약 이벤트 기록
                const medicationEvent = {
                    id: medicationEvents.length + 1,
                    timestamp: currentSensorValue.lastRemovalTime,
                    returnTime: now.toISOString(),
                    duration: duration,
                    event_type: 'MEDICATION_TAKEN'
                };
                medicationEvents.push(medicationEvent);
                
                // DB에 저장 (가능한 경우)
                if (pool) {
                    try {
                        const conn = await pool.getConnection();
                        await conn.query(
                            'INSERT INTO medication_logs (user_id, timestamp, event_type) VALUES (?, ?, ?)',
                            [1, currentSensorValue.lastRemovalTime, 'MEDICATION_TAKEN']
                        );
                        conn.release();
                    } catch (error) {
                        console.error('DB 저장 실패:', error);
                    }
                }
                
                console.log(`🟢 복약 완료! (${duration.toFixed(1)}초 소요)`);
            } else {
                console.log(`⚠️ 너무 짧은 제거 시간 (${duration.toFixed(1)}초) - 노이즈로 처리`);
            }
        }
        currentSensorValue.state = 'PRESENT';
    }
    
    // 현재 센서값 업데이트
    currentSensorValue.a = a;
    currentSensorValue.timestamp = now.toISOString();
    
    res.json({ 
        success: true, 
        data: currentSensorValue,
        message: `Sensor updated: ${currentSensorValue.state}`
    });
});

// 복약 로그 조회 (실제 센서 이벤트 기반)
app.get('/api/medication-logs', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const { days = 30, page = 1, limit = 50 } = req.query;
    
    // 실제 센서 이벤트가 있으면 그것을 반환
    if (medicationEvents.length > 0) {
        // 최근 순으로 정렬
        const sortedEvents = [...medicationEvents].sort((a, b) => 
            new Date(b.timestamp) - new Date(a.timestamp)
        );
        
        // 날짜 필터링
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));
        
        const filteredEvents = sortedEvents.filter(event => 
            new Date(event.timestamp) >= cutoffDate
        );
        
        return res.json({ 
            success: true, 
            data: filteredEvents,
            total: filteredEvents.length,
            source: 'sensor'
        });
    }
    
    // DB에서 가져오기
    if (pool) {
        let conn;
        try {
            conn = await pool.getConnection();
            
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));
            
            const logs = await conn.query(
                `SELECT ml.*, m.name as medication_name
                 FROM medication_logs ml
                 LEFT JOIN medications m ON ml.medication_id = m.id
                 WHERE ml.user_id = ? AND ml.timestamp > ?
                 ORDER BY ml.timestamp DESC
                 LIMIT ? OFFSET ?`,
                [userId, cutoffDate, parseInt(limit), (parseInt(page) - 1) * parseInt(limit)]
            );
            
            const total = await conn.query(
                'SELECT COUNT(*) as count FROM medication_logs WHERE user_id = ? AND timestamp > ?',
                [userId, cutoffDate]
            );
            
            res.json({ 
                success: true, 
                data: logs,
                total: total[0].count,
                page: parseInt(page),
                limit: parseInt(limit),
                source: 'database'
            });
        } catch (error) {
            console.error('Error fetching logs:', error);
            res.status(500).json({ success: false, error: error.message });
        } finally {
            if (conn) conn.release();
        }
    } else {
        // DB 없을 때는 빈 배열 반환 (더미 데이터 생성하지 않음)
        res.json({ 
            success: true, 
            data: [],
            total: 0,
            source: 'none'
        });
    }
});

// 복약 통계 조회 (실제 데이터 기반)
app.get('/api/medication-stats', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const { period = '30' } = req.query;
    
    try {
        const periodDays = parseInt(period);
        const now = new Date();
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - periodDays);
        
        // 실제 센서 이벤트 기반 통계
        let eventCount = 0;
        let streakDays = 0;
        let currentStreak = 0;
        
        if (medicationEvents.length > 0) {
            // 기간 내 이벤트 필터링
            const periodEvents = medicationEvents.filter(event => 
                new Date(event.timestamp) >= cutoffDate
            );
            eventCount = periodEvents.length;
            
            // 연속 복약일 계산
            const eventsByDate = {};
            periodEvents.forEach(event => {
                const dateKey = new Date(event.timestamp).toDateString();
                eventsByDate[dateKey] = true;
            });
            
            // 오늘부터 역순으로 연속일 확인
            const checkDate = new Date();
            while (checkDate >= cutoffDate) {
                const dateKey = checkDate.toDateString();
                if (eventsByDate[dateKey]) {
                    currentStreak++;
                } else if (currentStreak > 0) {
                    break; // 연속이 끊김
                }
                checkDate.setDate(checkDate.getDate() - 1);
            }
            streakDays = currentStreak;
        }
        
        // DB에서 추가 데이터 가져오기 (가능한 경우)
        if (pool) {
            let conn;
            try {
                conn = await pool.getConnection();
                
                const dbLogs = await conn.query(
                    'SELECT COUNT(*) as count FROM medication_logs WHERE user_id = ? AND timestamp > ?',
                    [userId, cutoffDate]
                );
                
                // DB 데이터와 센서 데이터 병합
                if (dbLogs[0].count > eventCount) {
                    eventCount = dbLogs[0].count;
                }
            } catch (error) {
                console.error('DB 조회 실패:', error);
            } finally {
                if (conn) conn.release();
            }
        }
        
        // 순응도 계산
        const expectedDoses = periodDays; // 하루 1회 가정
        const adherenceRate = expectedDoses > 0 
            ? Math.min(100, Math.round((eventCount / expectedDoses) * 100))
            : 0;
        
        res.json({
            success: true,
            data: {
                period: periodDays,
                total_count: eventCount,
                adherence_rate: adherenceRate,
                streak_days: streakDays,
                sensor_count: currentSensorValue.count,
                last_taken: currentSensorValue.lastRemovalTime || null,
                pdc: adherenceRate, // Proportion of Days Covered
                mpr: Math.min(100, Math.round((eventCount / periodDays) * 100)) // Medication Possession Ratio
            }
        });
    } catch (error) {
        console.error('Error calculating stats:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===== 약물 관리 엔드포인트 =====

// 약물 목록 조회
app.get('/api/medications', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    
    if (!pool) {
        // 테스트용 샘플 데이터
        return res.json({ 
            success: true, 
            data: [
                {
                    id: 1,
                    name: '아스피린',
                    type: 'pill',
                    dosage: '100mg',
                    frequency: 1,
                    schedule: ['08:00'],
                    start_date: '2024-01-01',
                    is_active: true
                }
            ] 
        });
    }
    
    let conn;
    try {
        conn = await pool.getConnection();
        const medications = await conn.query(
            `SELECT * FROM medications 
             WHERE user_id = ? AND is_active = 1 
             ORDER BY created_at DESC`,
            [userId]
        );
        
        // 복약 시간 정보도 함께 조회
        for (let med of medications) {
            const schedule = await conn.query(
                'SELECT time FROM medication_schedule WHERE medication_id = ? ORDER BY time',
                [med.id]
            );
            med.schedule = schedule.map(s => s.time);
        }
        
        res.json({ success: true, data: medications });
    } catch (error) {
        console.error('Error fetching medications:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// 약물 추가
app.post('/api/medications', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const { name, type, dosage, frequency, schedule, start_date, end_date, notes } = req.body;
    
    if (!pool) {
        return res.json({ success: true, message: 'Medication added (no DB)', id: Math.random() });
    }
    
    let conn;
    try {
        conn = await pool.getConnection();
        
        // 약물 정보 저장
        const result = await conn.query(
            `INSERT INTO medications (user_id, name, type, dosage, frequency, start_date, end_date, notes, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [userId, name, type, dosage, frequency, start_date, end_date, notes]
        );
        
        const medicationId = result.insertId;
        
        // 복약 시간 저장
        if (schedule && schedule.length > 0) {
            for (const time of schedule) {
                await conn.query(
                    'INSERT INTO medication_schedule (medication_id, time) VALUES (?, ?)',
                    [medicationId, time]
                );
            }
        }
        
        res.json({ success: true, message: '약물이 추가되었습니다', id: medicationId });
    } catch (error) {
        console.error('Error adding medication:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// ===== 알림 관련 엔드포인트 =====

// 알림 목록 조회
app.get('/api/reminders', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    
    if (!pool) {
        return res.json({ 
            success: true, 
            data: [
                {
                    id: 1,
                    medication_name: '아스피린',
                    time: '08:00:00',
                    message: '아스피린 복용 시간입니다',
                    is_active: true
                }
            ] 
        });
    }
    
    let conn;
    try {
        conn = await pool.getConnection();
        const reminders = await conn.query(
            `SELECT r.*, m.name as medication_name
             FROM reminders r
             LEFT JOIN medications m ON r.medication_id = m.id
             WHERE r.user_id = ? AND r.is_active = 1
             ORDER BY r.time`,
            [userId]
        );
        
        res.json({ success: true, data: reminders });
    } catch (error) {
        console.error('Error fetching reminders:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// ===== 리포트 엔드포인트 =====

// 상세 리포트 조회
app.get('/api/reports', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const { type = 'adherence', period = '30' } = req.query;
    
    try {
        const stats = await calculateDetailedStats(userId, parseInt(period));
        res.json({ success: true, data: stats });
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 상세 통계 계산 함수
async function calculateDetailedStats(userId, periodDays) {
    const now = new Date();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - periodDays);
    
    // 실제 센서 이벤트 기반 계산
    const periodEvents = medicationEvents.filter(event => 
        new Date(event.timestamp) >= cutoffDate
    );
    
    // 요일별 패턴 분석
    const dayPattern = {
        0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0
    };
    
    // 시간대별 패턴 분석
    const hourPattern = new Array(24).fill(0);
    
    periodEvents.forEach(event => {
        const date = new Date(event.timestamp);
        dayPattern[date.getDay()]++;
        hourPattern[date.getHours()]++;
    });
    
    return {
        period: periodDays,
        total_events: periodEvents.length,
        adherence_rate: Math.min(100, Math.round((periodEvents.length / periodDays) * 100)),
        day_pattern: dayPattern,
        hour_pattern: hourPattern,
        sensor_state: currentSensorValue.state,
        last_event: periodEvents[0] || null
    };
}

// ===== 기존 센서 데이터 엔드포인트 (호환성 유지) =====

// Arduino에서 복잡한 센서 데이터 수신
app.post('/api/sensor-data', async (req, res) => {
    console.log('Received sensor data:', req.body);
    
    if (!pool) {
        const { boxId, sensorValue, temperature, humidity, compartmentStatus } = req.body;
        
        if (sensorValue !== undefined) {
            // 센서값을 /value 엔드포인트와 동일하게 처리
            const mockReq = { body: { a: sensorValue } };
            const mockRes = { json: () => {} };
            await app.post('/value')(mockReq, mockRes);
        }
        
        res.json({ 
            success: true, 
            message: 'Data received (no DB)',
            data: req.body 
        });
        return;
    }
    
    let conn;
    try {
        const { boxId, temperature, humidity, compartmentStatus, sensorValue } = req.body;
        
        if (sensorValue !== undefined) {
            // 센서값을 /value 엔드포인트와 동일하게 처리
            const mockReq = { body: { a: sensorValue } };
            const mockRes = { json: () => {} };
            await app.post('/value')(mockReq, mockRes);
        }
        
        conn = await pool.getConnection();
        
        if (temperature !== undefined && humidity !== undefined) {
            await conn.query(
                'INSERT INTO sensor_logs (box_id, temperature, humidity, timestamp) VALUES (?, ?, ?, NOW())',
                [boxId, temperature, humidity]
            );
        }

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

// ===== 기본 엔드포인트 =====

// 루트 경로
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 정적 HTML 파일 서빙
app.get('/dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/medication.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'medication.html'));
});

app.get('/reports.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'reports.html'));
});

app.get('/reminder.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'reminder.html'));
});

app.get('/profile.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

// 건강 체크
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        sensorStatus: currentSensorValue,
        eventCount: medicationEvents.length,
        dbStatus: pool ? 'connected' : 'not configured'
    });
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

// 데이터베이스 초기화
async function initDatabase() {
    if (!pool) {
        console.log('Database not configured - running in memory mode');
        return;
    }
    
    let conn;
    try {
        conn = await pool.getConnection();
        
        // users 테이블
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
        
        // medications 테이블
        await conn.query(`
            CREATE TABLE IF NOT EXISTS medications (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                name VARCHAR(200) NOT NULL,
                type VARCHAR(50),
                dosage VARCHAR(100),
                frequency INT,
                start_date DATE,
                end_date DATE,
                notes TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_user_active (user_id, is_active)
            )
        `);
        
        // medication_schedule 테이블
        await conn.query(`
            CREATE TABLE IF NOT EXISTS medication_schedule (
                id INT AUTO_INCREMENT PRIMARY KEY,
                medication_id INT NOT NULL,
                time TIME NOT NULL,
                FOREIGN KEY (medication_id) REFERENCES medications(id) ON DELETE CASCADE,
                INDEX idx_medication_time (medication_id, time)
            )
        `);
        
        // medication_logs 테이블
        await conn.query(`
            CREATE TABLE IF NOT EXISTS medication_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                medication_id INT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                event_type VARCHAR(50) DEFAULT 'MEDICATION_TAKEN',
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (medication_id) REFERENCES medications(id) ON DELETE SET NULL,
                INDEX idx_user_timestamp (user_id, timestamp),
                INDEX idx_medication_timestamp (medication_id, timestamp)
            )
        `);
        
        // reminders 테이블
        await conn.query(`
            CREATE TABLE IF NOT EXISTS reminders (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                medication_id INT,
                time TIME NOT NULL,
                message TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (medication_id) REFERENCES medications(id) ON DELETE CASCADE,
                INDEX idx_user_active (user_id, is_active)
            )
        `);
        
        // sensor_logs 테이블 (기존)
        await conn.query(`
            CREATE TABLE IF NOT EXISTS sensor_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                box_id VARCHAR(50),
                temperature FLOAT,
                humidity FLOAT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // compartment_status 테이블 (기존)
        await conn.query(`
            CREATE TABLE IF NOT EXISTS compartment_status (
                id INT AUTO_INCREMENT PRIMARY KEY,
                box_id VARCHAR(50),
                compartment_id INT,
                is_open BOOLEAN,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
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
║   Sensor Tracking:                     ║
║   ✅ Real-time IR sensor monitoring    ║
║   ✅ Removal-Return event tracking     ║
║   ✅ Noise filtering (>1 sec)          ║
║   ✅ Actual data (no dummy data)       ║
╠════════════════════════════════════════╣
║   API Endpoints:                       ║
║   Sensor: /value (GET/POST)            ║
║   Auth: /api/auth/*                    ║
║   Medications: /api/medications/*      ║
║   Logs: /api/medication-logs           ║
║   Stats: /api/medication-stats         ║
║   Reports: /api/reports                ║
╚════════════════════════════════════════╝
    `);
    
    // 데이터베이스 초기화
    await initDatabase();
    
    if (!pool) {
        console.log('⚠️  Warning: No database configured. Using memory storage only.');
        console.log('📝 Test account: test@test.com / test1234');
    }
    
    console.log('🟢 센서 모니터링 시작 - 상태:', currentSensorValue.state);
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
