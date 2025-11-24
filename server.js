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

// ===== 메모리 저장소 (DB 없을 때 사용) =====
let sensorData = {
    current: {
        value: 0,  // 0: 약통 있음, 1: 약통 제거됨
        timestamp: null,
        count: 0  // 총 감지 횟수
    },
    history: [],  // 최근 100개 이력
    dailyStats: {},  // 일별 통계
    users: [
        { id: 1, email: 'user@coss.com', password: '$2a$10$X4kv7j5ZcGJLFwJHcXpKKutzCFvN.VIwmOm2T7JD.qPugXvVqWFCO', name: '홍길동' } // password: coss123
    ]
};

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

// ===== Arduino 센서 엔드포인트 =====

// GET: 현재 센서값 조회 (Arduino & Dashboard용)
app.get('/value', (req, res) => {
    console.log('[GET /value]', sensorData.current);
    res.json(sensorData.current);
});

// POST: Arduino에서 센서값 업데이트
app.post('/value', (req, res) => {
    const { a } = req.body;
    const now = new Date();
    
    // 상태 변경 감지 (0->1: 약통 제거됨)
    if (a === 1 && sensorData.current.value === 0) {
        sensorData.current.count++;
        
        // 일별 통계 업데이트
        const dateKey = now.toISOString().split('T')[0];
        if (!sensorData.dailyStats[dateKey]) {
            sensorData.dailyStats[dateKey] = { count: 0, times: [] };
        }
        sensorData.dailyStats[dateKey].count++;
        sensorData.dailyStats[dateKey].times.push(now.toISOString());
        
        // 이력에 추가
        sensorData.history.unshift({
            action: 'removed',
            timestamp: now.toISOString(),
            value: a
        });
        
        // 최대 100개 이력 유지
        if (sensorData.history.length > 100) {
            sensorData.history = sensorData.history.slice(0, 100);
        }
        
        console.log(`[센서 감지] 약통이 제거되었습니다. (총 ${sensorData.current.count}회)`);
    }
    
    // 상태 변경 감지 (1->0: 약통 복귀)
    if (a === 0 && sensorData.current.value === 1) {
        sensorData.history.unshift({
            action: 'returned',
            timestamp: now.toISOString(),
            value: a
        });
        console.log('[센서 감지] 약통이 제자리로 돌아왔습니다.');
    }
    
    // 현재 상태 업데이트
    sensorData.current.value = a;
    sensorData.current.timestamp = now.toISOString();
    
    res.json({ 
        success: true, 
        data: sensorData.current,
        message: a === 1 ? 'Medicine box removed' : 'Medicine box in place'
    });
});

// ===== 사용자 인증 API =====

// 로그인
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // 메모리에서 사용자 찾기 (실제로는 DB 조회)
        const user = sensorData.users.find(u => u.email === email);
        
        if (!user) {
            return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
        }
        
        // 비밀번호 검증
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
        }
        
        // JWT 토큰 생성
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
        
        // 중복 확인
        const existingUser = sensorData.users.find(u => u.email === email);
        if (existingUser) {
            return res.status(400).json({ error: '이미 등록된 이메일입니다.' });
        }
        
        // 비밀번호 해싱
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // 새 사용자 추가
        const newUser = {
            id: sensorData.users.length + 1,
            email,
            password: hashedPassword,
            name
        };
        sensorData.users.push(newUser);
        
        // 토큰 생성
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

// ===== 대시보드 데이터 API =====

// 대시보드 통계
app.get('/api/dashboard/stats', authenticateToken, (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const todayStats = sensorData.dailyStats[today] || { count: 0, times: [] };
    
    // 최근 7일 데이터
    const weeklyData = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateKey = date.toISOString().split('T')[0];
        const dayStats = sensorData.dailyStats[dateKey] || { count: 0 };
        weeklyData.push({
            date: dateKey,
            count: dayStats.count,
            day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()]
        });
    }
    
    // 순응도 계산 (목표: 하루 3회)
    const targetPerDay = 3;
    const totalDays = Object.keys(sensorData.dailyStats).length || 1;
    const totalCount = sensorData.current.count;
    const adherenceRate = Math.min(100, Math.round((totalCount / (totalDays * targetPerDay)) * 100));
    
    res.json({
        current: sensorData.current,
        today: todayStats,
        weekly: weeklyData,
        adherenceRate,
        totalCount: sensorData.current.count,
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

// 상세 통계 데이터
app.get('/api/reports/detailed', authenticateToken, (req, res) => {
    // 시간대별 분석
    const hourlyDistribution = new Array(24).fill(0);
    Object.values(sensorData.dailyStats).forEach(day => {
        day.times?.forEach(time => {
            const hour = new Date(time).getHours();
            hourlyDistribution[hour]++;
        });
    });
    
    // 요일별 분석
    const weekdayDistribution = new Array(7).fill(0);
    Object.entries(sensorData.dailyStats).forEach(([date, stats]) => {
        const dayOfWeek = new Date(date).getDay();
        weekdayDistribution[dayOfWeek] += stats.count;
    });
    
    res.json({
        totalCount: sensorData.current.count,
        dailyStats: sensorData.dailyStats,
        hourlyDistribution,
        weekdayDistribution,
        history: sensorData.history,
        adherenceMetrics: {
            totalDays: Object.keys(sensorData.dailyStats).length,
            averagePerDay: sensorData.current.count / (Object.keys(sensorData.dailyStats).length || 1),
            maxStreak: calculateStreak(sensorData.dailyStats),
            currentStreak: calculateCurrentStreak(sensorData.dailyStats)
        }
    });
});

// 연속 복약 일수 계산
function calculateStreak(dailyStats) {
    const dates = Object.keys(dailyStats).sort();
    let maxStreak = 0;
    let currentStreak = 0;
    let lastDate = null;
    
    dates.forEach(date => {
        if (dailyStats[date].count > 0) {
            if (!lastDate || isConsecutiveDay(lastDate, date)) {
                currentStreak++;
                maxStreak = Math.max(maxStreak, currentStreak);
            } else {
                currentStreak = 1;
            }
            lastDate = date;
        } else {
            currentStreak = 0;
            lastDate = null;
        }
    });
    
    return maxStreak;
}

function calculateCurrentStreak(dailyStats) {
    const today = new Date().toISOString().split('T')[0];
    const dates = Object.keys(dailyStats).sort().reverse();
    let streak = 0;
    
    for (const date of dates) {
        if (dailyStats[date].count > 0) {
            if (streak === 0 || isConsecutiveDay(date, dates[dates.indexOf(date) - 1])) {
                streak++;
            } else {
                break;
            }
        } else if (date === today) {
            continue; // 오늘은 아직 진행 중
        } else {
            break;
        }
    }
    
    return streak;
}

function isConsecutiveDay(date1, date2) {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    const diffTime = Math.abs(d2 - d1);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays === 1;
}

// ===== 관리자 API =====

// 시스템 상태
app.get('/api/admin/status', (req, res) => {
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
        sensor: {
            lastUpdate: sensorData.current.timestamp,
            currentValue: sensorData.current.value,
            totalCount: sensorData.current.count
        },
        statistics: {
            totalUsers: sensorData.users.length,
            totalRecords: sensorData.history.length,
            daysWithData: Object.keys(sensorData.dailyStats).length
        }
    });
});

// 센서 데이터 리셋 (관리자용)
app.post('/api/admin/reset', (req, res) => {
    const { password } = req.body;
    
    // 간단한 관리자 비밀번호 확인
    if (password !== 'admin2025') {
        return res.status(403).json({ error: 'Invalid admin password' });
    }
    
    // 데이터 리셋
    sensorData.current.count = 0;
    sensorData.history = [];
    sensorData.dailyStats = {};
    
    res.json({ success: true, message: 'Sensor data reset successfully' });
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
        sensorStatus: sensorData.current
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
║   Arduino Endpoints:                   ║
║   GET  /value     (센서값 조회)         ║
║   POST /value     (센서값 업데이트)     ║
╠════════════════════════════════════════╣
║   User Endpoints:                      ║
║   POST /api/auth/login                 ║
║   POST /api/auth/register              ║
║   GET  /api/dashboard/stats            ║
║   GET  /api/reports/detailed           ║
╚════════════════════════════════════════╝
    `);
    
    if (!pool) {
        console.log('⚠️  Warning: No database configured. Using memory storage.');
    }
    
    console.log('\n📌 Admin panel (hidden): /admin.html');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    app.close(() => {
        console.log('HTTP server closed');
        if (pool) pool.end();
    });
});
