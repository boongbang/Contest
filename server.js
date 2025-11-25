require('dotenv').config();
const express = require('express');
const mariadb = require('mariadb');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

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

// ===== Nodemailer 설정 =====
let mailTransporter = null;
if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    mailTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD
        }
    });
    console.log('📧 이메일 서비스 설정 완료');
}

// 미들웨어
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static('public'));

// ===== 확장된 데이터 구조 =====
let sensorData = {
    sensors: {
        1: { id: 1, name: '아침 약', emoji: '🌅', value: 0, lastOpened: null, todayOpened: false, targetTime: '08:00', description: '혈압약 (식후 30분)', missedAlertSent: false },
        2: { id: 2, name: '점심 약', emoji: '☀️', value: 0, lastOpened: null, todayOpened: false, targetTime: '13:00', description: '비타민 D', missedAlertSent: false },
        3: { id: 3, name: '저녁 약', emoji: '🌙', value: 0, lastOpened: null, todayOpened: false, targetTime: '18:00', description: '관절약', missedAlertSent: false },
        4: { id: 4, name: '자기전 약', emoji: '🛌', value: 0, lastOpened: null, todayOpened: false, targetTime: '22:00', description: '수면 보조제', missedAlertSent: false }
    },
    history: [],
    dailyStats: {},
    users: [
        { id: 1, email: 'user@coss.com', password: '', name: '홍길동', guardianEmail: '', profileIcon: 'user', profileColor: '#6B8E6B' }
    ],
    userMedications: {},
    // [신규] 장치 정보
    deviceInfo: {
        ipAddress: null,
        firmwareVersion: '1.0.0',
        lastHeartbeat: null,
        isOnline: false
    },
    // [신규] 시스템 모드
    isRefillMode: false,
    // [신규] 알림 설정
    notificationSettings: {
        enabled: true,
        nightModeEnabled: false, // 야간 알림 끄기 (22시~06시)
        nightStart: '22:00',
        nightEnd: '06:00'
    }
};

// ===== 플리커링 방지를 위한 대기 상태 =====
let pendingRemoval = {
    1: null,
    2: null,
    3: null,
    4: null
};
const FLICKERING_THRESHOLD_MS = 1000;

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
            // 누락된 필드 초기화
            if (!sensorData.userMedications) sensorData.userMedications = {};
            if (!sensorData.deviceInfo) sensorData.deviceInfo = { ipAddress: null, firmwareVersion: '1.0.0', lastHeartbeat: null, isOnline: false };
            if (sensorData.isRefillMode === undefined) sensorData.isRefillMode = false;
            if (!sensorData.notificationSettings) sensorData.notificationSettings = { enabled: true, nightModeEnabled: false, nightStart: '22:00', nightEnd: '06:00' };
            // 센서별 missedAlertSent 필드 초기화
            for (let id in sensorData.sensors) {
                if (sensorData.sensors[id].missedAlertSent === undefined) {
                    sensorData.sensors[id].missedAlertSent = false;
                }
            }
            // 사용자 프로필 필드 초기화
            sensorData.users.forEach(user => {
                if (!user.guardianEmail) user.guardianEmail = '';
                if (!user.profileIcon) user.profileIcon = 'user';
                if (!user.profileColor) user.profileColor = '#6B8E6B';
            });
            console.log('📂 저장된 데이터 파일을 불러왔습니다.');
        } else {
            console.log('✨ 새로운 데이터를 시작합니다.');
            saveData();
        }
    } catch (error) {
        console.error('데이터 로드 실패:', error);
    }
}

// 테스트 계정 비밀번호 초기화/검증 함수
async function initTestAccount() {
    const testEmail = 'user@coss.com';
    const testPassword = 'coss1234';
    
    let user = sensorData.users.find(u => u.email === testEmail);
    
    if (!user) {
        const hashedPassword = await bcrypt.hash(testPassword, 10);
        user = { id: 1, email: testEmail, password: hashedPassword, name: '홍길동', guardianEmail: '', profileIcon: 'user', profileColor: '#6B8E6B' };
        sensorData.users.push(user);
        saveData();
        console.log('👤 테스트 계정 생성됨: user@coss.com / coss1234');
    } else {
        const isValid = user.password && await bcrypt.compare(testPassword, user.password);
        if (!isValid) {
            user.password = await bcrypt.hash(testPassword, 10);
            saveData();
            console.log('🔑 테스트 계정 비밀번호 업데이트됨: coss1234');
        } else {
            console.log('✅ 테스트 계정 확인됨: user@coss.com / coss1234');
        }
    }
}

// 초기 데이터 로드
loadData();
initTestAccount().catch(err => console.error('테스트 계정 초기화 실패:', err));

// ===== 이메일 발송 함수 =====
async function sendGuardianEmail(userId, subject, htmlContent) {
    if (!mailTransporter) {
        console.log('📧 이메일 서비스가 설정되지 않았습니다.');
        return false;
    }
    
    const user = sensorData.users.find(u => u.id === userId);
    if (!user || !user.guardianEmail) {
        console.log('📧 보호자 이메일이 설정되지 않았습니다.');
        return false;
    }
    
    try {
        await mailTransporter.sendMail({
            from: `"COSS 스마트약통" <${process.env.GMAIL_USER}>`,
            to: user.guardianEmail,
            subject: subject,
            html: htmlContent
        });
        console.log(`📧 이메일 발송 완료: ${user.guardianEmail}`);
        return true;
    } catch (error) {
        console.error('📧 이메일 발송 실패:', error);
        return false;
    }
}

// ===== 미복용 체크 및 알림 함수 =====
async function checkMissedMedication() {
    const now = new Date();
    const currentHour = now.getHours();
    
    // 야간 모드 체크
    if (sensorData.notificationSettings.nightModeEnabled) {
        const [nightStartH] = sensorData.notificationSettings.nightStart.split(':').map(Number);
        const [nightEndH] = sensorData.notificationSettings.nightEnd.split(':').map(Number);
        
        if (currentHour >= nightStartH || currentHour < nightEndH) {
            return; // 야간 시간대는 알림 스킵
        }
    }
    
    if (!sensorData.notificationSettings.enabled) return;
    
    const GRACE_PERIOD_MINUTES = 30;
    
    for (let id in sensorData.sensors) {
        const sensor = sensorData.sensors[id];
        
        // 이미 복용했거나 이미 알림을 보낸 경우 스킵
        if (sensor.todayOpened || sensor.missedAlertSent) continue;
        
        const [tHour, tMin] = sensor.targetTime.split(':').map(Number);
        const targetDate = new Date(now);
        targetDate.setHours(tHour, tMin, 0, 0);
        
        const diffMinutes = Math.round((now - targetDate) / 1000 / 60);
        
        // 유예 시간(30분) 초과 시 알림 발송
        if (diffMinutes > GRACE_PERIOD_MINUTES) {
            const user = sensorData.users[0]; // 첫 번째 사용자 (단일 사용자 시스템)
            
            if (user && user.guardianEmail) {
                const subject = `[긴급] ${user.name}님이 ${sensor.name}을 복용하지 않았습니다.`;
                const htmlContent = `
                    <div style="font-family: 'Poppins', sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
                        <div style="background: #6B8E6B; color: white; padding: 20px; border-radius: 15px 15px 0 0; text-align: center;">
                            <h1 style="margin: 0;">💊 COSS 알림</h1>
                        </div>
                        <div style="background: #f5f5f5; padding: 25px; border-radius: 0 0 15px 15px;">
                            <p style="font-size: 16px; color: #333;">
                                <strong>${user.name}</strong> 보호자님 안녕하세요,
                            </p>
                            <p style="font-size: 16px; color: #333;">
                                환자분이 설정된 시간(<strong>${sensor.targetTime}</strong>)에서 
                                <strong style="color: #F44336;">${diffMinutes}분</strong>이 지나도록 
                                <strong>${sensor.emoji} ${sensor.name}</strong>을 복용하지 않으셨습니다.
                            </p>
                            <div style="background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 10px; margin: 20px 0;">
                                <p style="margin: 0; color: #856404;">
                                    ⚠️ 확인 부탁드립니다.
                                </p>
                            </div>
                            <p style="font-size: 14px; color: #666;">
                                - COSS 스마트 약통 관리 시스템
                            </p>
                        </div>
                    </div>
                `;
                
                const sent = await sendGuardianEmail(user.id, subject, htmlContent);
                if (sent) {
                    sensor.missedAlertSent = true;
                    saveData();
                    console.log(`[Sensor ${id}] 미복용 알림 발송 완료`);
                }
            }
        }
    }
}

// ===== 통계 계산 함수들 =====
function calculatePDC(dailyStats, sensors) {
    const dates = Object.keys(dailyStats).sort();
    if (dates.length === 0) return 0;
    
    const startDate = new Date(dates[0]);
    const endDate = new Date(dates[dates.length - 1]);
    const totalDays = Math.max(1, Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1);
    
    let successDays = 0;
    for (let dateKey in dailyStats) {
        const daySensors = dailyStats[dateKey].sensors || {};
        const takenCount = Object.values(daySensors).filter(s => s.count > 0).length;
        if (takenCount > 0) successDays++;
    }
    
    return Math.round((successDays / totalDays) * 100);
}

function calculateMaxStreak(dailyStats) {
    const dates = Object.keys(dailyStats).sort();
    if (dates.length === 0) return 0;
    
    let maxStreak = 0;
    let currentStreak = 0;
    let prevDate = null;
    
    for (let dateKey of dates) {
        const daySensors = dailyStats[dateKey].sensors || {};
        const takenCount = Object.values(daySensors).filter(s => s.count > 0).length;
        
        if (takenCount > 0) {
            if (prevDate) {
                const prev = new Date(prevDate);
                const curr = new Date(dateKey);
                const diffDays = Math.round((curr - prev) / (1000 * 60 * 60 * 24));
                
                if (diffDays === 1) {
                    currentStreak++;
                } else {
                    currentStreak = 1;
                }
            } else {
                currentStreak = 1;
            }
            prevDate = dateKey;
        } else {
            currentStreak = 0;
            prevDate = null;
        }
        
        maxStreak = Math.max(maxStreak, currentStreak);
    }
    
    return maxStreak;
}

function calculateTimeAccuracy(dailyStats, sensors) {
    let totalDiff = 0;
    let count = 0;
    
    for (let dateKey in dailyStats) {
        const daySensors = dailyStats[dateKey].sensors || {};
        
        for (let sensorId in daySensors) {
            const sensorStat = daySensors[sensorId];
            const targetTime = sensors[sensorId]?.targetTime || '12:00';
            
            if (sensorStat.times && sensorStat.times.length > 0) {
                const firstTime = new Date(sensorStat.times[0]);
                const [tHour, tMin] = targetTime.split(':').map(Number);
                
                const targetDate = new Date(firstTime);
                targetDate.setHours(tHour, tMin, 0, 0);
                
                const diffMinutes = Math.abs(firstTime - targetDate) / (1000 * 60);
                totalDiff += diffMinutes;
                count++;
            }
        }
    }
    
    return count > 0 ? Math.round(totalDiff / count) : 0;
}

function calculateMaxGap(dailyStats) {
    const dates = Object.keys(dailyStats).sort();
    if (dates.length < 2) return 0;
    
    let maxGap = 0;
    
    for (let i = 1; i < dates.length; i++) {
        const prev = new Date(dates[i - 1]);
        const curr = new Date(dates[i]);
        const gap = Math.round((curr - prev) / (1000 * 60 * 60 * 24)) - 1;
        maxGap = Math.max(maxGap, gap);
    }
    
    return maxGap;
}

function calculateAdherenceMetrics() {
    const totalDays = Object.keys(sensorData.dailyStats).length;
    const totalCount = sensorData.history.filter(h => h.action === 'removed').length;
    
    return {
        totalDays: totalDays,
        totalCount: totalCount,
        averagePerDay: totalDays > 0 ? totalCount / totalDays : 0,
        pdc: calculatePDC(sensorData.dailyStats, sensorData.sensors),
        maxStreak: calculateMaxStreak(sensorData.dailyStats),
        timeAccuracy: calculateTimeAccuracy(sensorData.dailyStats, sensorData.sensors),
        maxGap: calculateMaxGap(sensorData.dailyStats)
    };
}

// ===== JWT 인증 미들웨어 =====
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({ error: 'No token provided' });
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
}

// ===== API 엔드포인트 =====

// 1. 센서 값 (아두이노 → 서버, 리필 모드 시 무시)
app.get('/value', (req, res) => {
    res.json(sensorData.sensors);
});

app.post('/update', (req, res) => {
    const { sensor: sensorId, value, ipAddress, firmwareVersion } = req.body;
    
    // 장치 정보 업데이트
    if (ipAddress) sensorData.deviceInfo.ipAddress = ipAddress;
    if (firmwareVersion) sensorData.deviceInfo.firmwareVersion = firmwareVersion;
    sensorData.deviceInfo.lastHeartbeat = new Date().toISOString();
    sensorData.deviceInfo.isOnline = true;
    
    // 리필 모드일 경우 센서 데이터 무시
    if (sensorData.isRefillMode) {
        console.log(`[Refill Mode] 센서 ${sensorId} 데이터 무시됨 (value: ${value})`);
        return res.json({ success: true, ignored: true, message: 'Refill mode active' });
    }
    
    const finalSensorId = parseInt(sensorId, 10);
    const finalValue = parseInt(value, 10);
    
    if (finalSensorId < 1 || finalSensorId > 4) {
        return res.status(400).json({ error: 'Invalid sensor ID' });
    }
    
    const sensor = sensorData.sensors[finalSensorId];
    
    // 약이 제거됨 감지 (value가 1로 변경)
    if (finalValue === 1 && sensor.value === 0) {
        pendingRemoval[finalSensorId] = {
            timestamp: Date.now(),
            startTime: new Date().toISOString()
        };
        console.log(`[Sensor ${finalSensorId}] 🔴 Pill REMOVED - Timer started`);
    }
    
    // 약이 다시 들어옴 (value가 0으로 변경)
    if (finalValue === 0 && sensor.value === 1 && pendingRemoval[finalSensorId]) {
        const elapsedMs = Date.now() - pendingRemoval[finalSensorId].timestamp;
        
        if (elapsedMs >= FLICKERING_THRESHOLD_MS) {
            const now = new Date();
            sensor.lastOpened = now.toISOString();
            sensor.todayOpened = true;
            sensor.missedAlertSent = false; // 복용 시 알림 플래그 초기화
            
            const today = now.toISOString().split('T')[0];
            if (!sensorData.dailyStats[today]) {
                sensorData.dailyStats[today] = { date: today, sensors: {} };
            }
            if (!sensorData.dailyStats[today].sensors[finalSensorId]) {
                sensorData.dailyStats[today].sensors[finalSensorId] = { count: 0, times: [] };
            }
            sensorData.dailyStats[today].sensors[finalSensorId].count++;
            sensorData.dailyStats[today].sensors[finalSensorId].times.push(now.toISOString());
            
            const historyEntry = {
                sensorId: finalSensorId,
                sensorName: sensor.name,
                action: 'removed',
                timestamp: pendingRemoval[finalSensorId].startTime,
                returnedAt: now.toISOString(),
                duration: Math.round(elapsedMs / 1000)
            };
            sensorData.history.unshift(historyEntry);
            if (sensorData.history.length > 500) sensorData.history.pop();
            
            console.log(`[Sensor ${finalSensorId}] ✅ Pill RETURNED (duration: ${Math.round(elapsedMs/1000)}s) - RECORDED`);
            saveData();
        } else {
            console.log(`[Sensor ${finalSensorId}] ⚠️ Flickering ignored (${elapsedMs}ms < 1000ms)`);
        }
        
        pendingRemoval[finalSensorId] = null;
        sensor.value = finalValue;
        
        return res.json({ 
            success: true, 
            sensor,
            confirmed: elapsedMs >= FLICKERING_THRESHOLD_MS
        });
    }
    
    sensor.value = finalValue;
    res.json({ success: true, sensor });
});

// 2. 센서 시간 설정 업데이트 API (동기화 포함)
app.put('/api/sensors/:id/time', authenticateToken, (req, res) => {
    const sensorId = parseInt(req.params.id);
    const { targetTime } = req.body;
    
    if (sensorId < 1 || sensorId > 4) {
        return res.status(400).json({ error: 'Invalid sensor ID' });
    }
    
    if (!targetTime || !/^\d{2}:\d{2}$/.test(targetTime)) {
        return res.status(400).json({ error: 'Invalid time format. Use HH:MM' });
    }
    
    sensorData.sensors[sensorId].targetTime = targetTime;
    saveData();
    
    console.log(`[Sensor ${sensorId}] Target time updated to ${targetTime}`);
    
    res.json({ 
        success: true, 
        sensor: sensorData.sensors[sensorId],
        message: `복용 시간이 ${targetTime}으로 설정되었습니다.`
    });
});

// 3. 로그인/회원가입
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = sensorData.users.find(u => u.email === email);
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
    res.json({ 
        success: true, 
        token, 
        user: { 
            id: user.id, 
            name: user.name, 
            email: user.email,
            guardianEmail: user.guardianEmail,
            profileIcon: user.profileIcon,
            profileColor: user.profileColor
        } 
    });
});

app.post('/api/auth/register', async (req, res) => {
    const { email, password, name } = req.body;
    if (sensorData.users.find(u => u.email === email)) return res.status(400).json({ error: 'Exists' });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = { 
        id: sensorData.users.length + 1, 
        email, 
        password: hashedPassword, 
        name,
        guardianEmail: '',
        profileIcon: 'user',
        profileColor: '#6B8E6B'
    };
    sensorData.users.push(newUser);
    saveData();
    
    const token = jwt.sign({ id: newUser.id, email }, JWT_SECRET);
    res.json({ 
        success: true, 
        token, 
        user: { 
            id: newUser.id, 
            name, 
            email,
            guardianEmail: '',
            profileIcon: 'user',
            profileColor: '#6B8E6B'
        } 
    });
});

// ===== [신규] 프로필 관리 API =====

// 프로필 조회
app.get('/api/profile', authenticateToken, (req, res) => {
    const user = sensorData.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    res.json({
        success: true,
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            guardianEmail: user.guardianEmail || '',
            profileIcon: user.profileIcon || 'user',
            profileColor: user.profileColor || '#6B8E6B'
        }
    });
});

// 프로필 업데이트
app.put('/api/profile', authenticateToken, (req, res) => {
    const user = sensorData.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const { name, guardianEmail, profileIcon, profileColor } = req.body;
    
    if (name) user.name = name;
    if (guardianEmail !== undefined) user.guardianEmail = guardianEmail;
    if (profileIcon) user.profileIcon = profileIcon;
    if (profileColor) user.profileColor = profileColor;
    
    saveData();
    
    res.json({
        success: true,
        message: '프로필이 업데이트되었습니다.',
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            guardianEmail: user.guardianEmail,
            profileIcon: user.profileIcon,
            profileColor: user.profileColor
        }
    });
});

// 비밀번호 변경
app.put('/api/profile/password', authenticateToken, async (req, res) => {
    const user = sensorData.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: '현재 비밀번호와 새 비밀번호를 입력하세요.' });
    }
    
    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
        return res.status(401).json({ error: '현재 비밀번호가 일치하지 않습니다.' });
    }
    
    if (newPassword.length < 8) {
        return res.status(400).json({ error: '새 비밀번호는 8자 이상이어야 합니다.' });
    }
    
    user.password = await bcrypt.hash(newPassword, 10);
    saveData();
    
    res.json({ success: true, message: '비밀번호가 변경되었습니다.' });
});

// ===== 사용자별 약물 데이터 API =====

app.get('/api/medications/user', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const userMeds = sensorData.userMedications[userId] || null;
    res.json({ success: true, data: userMeds });
});

app.post('/api/medications/user', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { cardData } = req.body;
    
    if (!cardData) {
        return res.status(400).json({ error: 'cardData is required' });
    }
    
    sensorData.userMedications[userId] = cardData;
    
    // 센서 시간도 동기화
    for (let id in cardData) {
        if (sensorData.sensors[id] && cardData[id].time) {
            sensorData.sensors[id].targetTime = cardData[id].time;
        }
    }
    
    saveData();
    
    console.log(`[User ${userId}] 약물 데이터 저장됨`);
    res.json({ success: true, message: '약물 데이터가 저장되었습니다.' });
});

// ===== [신규] 장치 정보 API =====

app.get('/api/device/status', authenticateToken, (req, res) => {
    const now = Date.now();
    const lastHB = sensorData.deviceInfo.lastHeartbeat 
        ? new Date(sensorData.deviceInfo.lastHeartbeat).getTime() 
        : 0;
    
    // 30초 이상 heartbeat가 없으면 오프라인으로 간주
    const isOnline = (now - lastHB) < 30000;
    sensorData.deviceInfo.isOnline = isOnline;
    
    // 센서 Raw 값
    const sensorRawData = {};
    for (let id in sensorData.sensors) {
        sensorRawData[id] = {
            name: sensorData.sensors[id].name,
            value: sensorData.sensors[id].value
        };
    }
    
    res.json({
        success: true,
        device: {
            ...sensorData.deviceInfo,
            isOnline,
            timeSinceLastHeartbeat: lastHB ? Math.round((now - lastHB) / 1000) : null
        },
        sensorRawData,
        isRefillMode: sensorData.isRefillMode
    });
});

// 아두이노 Heartbeat (장치에서 주기적 호출)
app.post('/api/device/heartbeat', (req, res) => {
    const { ipAddress, firmwareVersion } = req.body;
    
    if (ipAddress) sensorData.deviceInfo.ipAddress = ipAddress;
    if (firmwareVersion) sensorData.deviceInfo.firmwareVersion = firmwareVersion;
    sensorData.deviceInfo.lastHeartbeat = new Date().toISOString();
    sensorData.deviceInfo.isOnline = true;
    
    res.json({ success: true, serverTime: new Date().toISOString() });
});

// 센서 영점 조절
app.post('/api/device/calibrate', authenticateToken, (req, res) => {
    for (let id in sensorData.sensors) {
        sensorData.sensors[id].value = 0;
    }
    saveData();
    console.log('[System] 센서 영점 조절 완료');
    res.json({ success: true, message: '센서가 영점 조절되었습니다.' });
});

// 테스트 이메일 발송
app.post('/api/device/test-email', authenticateToken, async (req, res) => {
    const user = sensorData.users.find(u => u.id === req.user.id);
    
    if (!user || !user.guardianEmail) {
        return res.status(400).json({ error: '보호자 이메일이 설정되지 않았습니다.' });
    }
    
    const subject = '[COSS] 테스트 알림';
    const htmlContent = `
        <div style="font-family: 'Poppins', sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
            <div style="background: #6B8E6B; color: white; padding: 20px; border-radius: 15px 15px 0 0; text-align: center;">
                <h1 style="margin: 0;">✅ COSS 테스트 알림</h1>
            </div>
            <div style="background: #f5f5f5; padding: 25px; border-radius: 0 0 15px 15px;">
                <p style="font-size: 16px; color: #333;">
                    이 이메일은 COSS 스마트 약통 시스템에서 발송된 테스트 알림입니다.
                </p>
                <p style="font-size: 16px; color: #333;">
                    이메일이 정상적으로 수신되었습니다! 🎉
                </p>
                <p style="font-size: 14px; color: #666; margin-top: 20px;">
                    - COSS 스마트 약통 관리 시스템
                </p>
            </div>
        </div>
    `;
    
    const sent = await sendGuardianEmail(user.id, subject, htmlContent);
    
    if (sent) {
        res.json({ success: true, message: `테스트 이메일이 ${user.guardianEmail}로 발송되었습니다.` });
    } else {
        res.status(500).json({ error: '이메일 발송에 실패했습니다.' });
    }
});

// ===== [신규] 리필 모드 API =====

app.get('/api/refill/status', authenticateToken, (req, res) => {
    res.json({ 
        success: true, 
        isRefillMode: sensorData.isRefillMode 
    });
});

app.post('/api/refill/start', authenticateToken, (req, res) => {
    sensorData.isRefillMode = true;
    saveData();
    console.log('[System] 리필 모드 시작');
    res.json({ success: true, message: '리필 모드가 시작되었습니다.', isRefillMode: true });
});

app.post('/api/refill/end', authenticateToken, (req, res) => {
    const { refilledSlots } = req.body; // [1, 2] 형태로 채워진 슬롯 ID 배열
    
    sensorData.isRefillMode = false;
    
    // 선택된 슬롯의 todayOpened만 초기화
    if (refilledSlots && Array.isArray(refilledSlots)) {
        refilledSlots.forEach(slotId => {
            if (sensorData.sensors[slotId]) {
                sensorData.sensors[slotId].todayOpened = false;
                sensorData.sensors[slotId].missedAlertSent = false;
                console.log(`[Sensor ${slotId}] todayOpened 초기화됨`);
            }
        });
    }
    
    saveData();
    console.log('[System] 리필 모드 종료');
    res.json({ success: true, message: '리필 모드가 종료되었습니다.', isRefillMode: false });
});

// ===== [신규] 히스토리 삭제 API =====

app.delete('/api/history/:index', authenticateToken, (req, res) => {
    const index = parseInt(req.params.index);
    
    if (isNaN(index) || index < 0 || index >= sensorData.history.length) {
        return res.status(400).json({ error: 'Invalid history index' });
    }
    
    const removed = sensorData.history.splice(index, 1);
    saveData();
    
    console.log(`[History] 기록 삭제됨: ${JSON.stringify(removed[0])}`);
    res.json({ success: true, message: '기록이 삭제되었습니다.', removed: removed[0] });
});

// ===== [신규] 알림 설정 API =====

app.get('/api/notifications/settings', authenticateToken, (req, res) => {
    res.json({ 
        success: true, 
        settings: sensorData.notificationSettings 
    });
});

app.put('/api/notifications/settings', authenticateToken, (req, res) => {
    const { enabled, nightModeEnabled, nightStart, nightEnd } = req.body;
    
    if (enabled !== undefined) sensorData.notificationSettings.enabled = enabled;
    if (nightModeEnabled !== undefined) sensorData.notificationSettings.nightModeEnabled = nightModeEnabled;
    if (nightStart) sensorData.notificationSettings.nightStart = nightStart;
    if (nightEnd) sensorData.notificationSettings.nightEnd = nightEnd;
    
    saveData();
    
    res.json({ 
        success: true, 
        message: '알림 설정이 업데이트되었습니다.',
        settings: sensorData.notificationSettings 
    });
});

// ===== [신규] 데이터 초기화 API (비밀번호 확인) =====

app.post('/api/data/reset', authenticateToken, async (req, res) => {
    const { password, confirmText } = req.body;
    
    const user = sensorData.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    // 비밀번호 또는 확인 텍스트 검증
    if (confirmText !== '초기화') {
        const isValid = await bcrypt.compare(password || '', user.password);
        if (!isValid) {
            return res.status(401).json({ error: '비밀번호가 일치하지 않거나 "초기화"를 입력하지 않았습니다.' });
        }
    }
    
    // 센서 데이터 초기화
    for (let id in sensorData.sensors) {
        sensorData.sensors[id].value = 0;
        sensorData.sensors[id].todayOpened = false;
        sensorData.sensors[id].lastOpened = null;
        sensorData.sensors[id].missedAlertSent = false;
    }
    
    // 히스토리 및 통계 초기화
    sensorData.history = [];
    sensorData.dailyStats = {};
    
    // 사용자 약물 데이터 초기화
    sensorData.userMedications[user.id] = null;
    
    saveData();
    
    console.log(`[System] 사용자 ${user.id} 데이터 초기화 완료`);
    res.json({ success: true, message: '모든 데이터가 초기화되었습니다.' });
});

// ===== 기존 API 엔드포인트 =====

// 4. 대시보드 데이터
app.get('/api/dashboard/stats', authenticateToken, (req, res) => {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const todayStats = sensorData.dailyStats[today] || { sensors: {} };
    
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
    
    const adherenceMetrics = calculateAdherenceMetrics();

    res.json({
        sensors: sensorData.sensors,
        today: todayStats,
        weekly,
        adherenceRate: adherenceMetrics.pdc,
        adherenceMetrics: adherenceMetrics,
        lastAction: sensorData.history[0],
        isRefillMode: sensorData.isRefillMode
    });
});

// 5. 리포트 데이터
app.get('/api/reports/detailed', authenticateToken, (req, res) => {
    const adherenceMetrics = calculateAdherenceMetrics();
    
    const hourlyDistribution = new Array(24).fill(0);
    const weekdayDistribution = new Array(7).fill(0);
    
    sensorData.history.forEach(h => {
        if (h.action === 'removed' && h.timestamp) {
            const d = new Date(h.timestamp);
            hourlyDistribution[d.getHours()]++;
            weekdayDistribution[d.getDay()]++;
        }
    });
    
    res.json({
        sensorStats: sensorData.sensors,
        history: sensorData.history.slice(0, 200),
        totalDays: Object.keys(sensorData.dailyStats).length,
        dailyStats: sensorData.dailyStats,
        adherenceMetrics: adherenceMetrics,
        distributions: {
            hourly: hourlyDistribution,
            weekday: weekdayDistribution
        }
    });
});

app.get('/api/medications', authenticateToken, (req, res) => {
    res.json(Object.values(sensorData.sensors));
});

// 6. 알림 체크 API
app.get('/api/notifications/check', authenticateToken, (req, res) => {
    const now = new Date();
    const currentHour = now.getHours();
    const alerts = [];
    
    // 야간 모드 체크
    if (sensorData.notificationSettings.nightModeEnabled) {
        const [nightStartH] = sensorData.notificationSettings.nightStart.split(':').map(Number);
        const [nightEndH] = sensorData.notificationSettings.nightEnd.split(':').map(Number);
        
        if (currentHour >= nightStartH || currentHour < nightEndH) {
            return res.json({ alerts: [] }); // 야간 시간대는 알림 없음
        }
    }
    
    if (!sensorData.notificationSettings.enabled) {
        return res.json({ alerts: [] });
    }
    
    for (let id in sensorData.sensors) {
        const sensor = sensorData.sensors[id];
        
        if (sensor.todayOpened) continue;
        
        const [tHour, tMin] = sensor.targetTime.split(':').map(Number);
        const targetDate = new Date(now);
        targetDate.setHours(tHour, tMin, 0, 0);
        
        const diffMinutes = Math.round((now - targetDate) / 1000 / 60);
        
        if (diffMinutes > 0) {
            if (diffMinutes <= 30) {
                alerts.push({
                    sensorId: id,
                    type: 'warning',
                    message: `🔔 ${sensor.emoji} ${sensor.name} 복용 시간입니다! (${diffMinutes}분 지남)`,
                    playSound: true,
                    priority: 'high'
                });
            }
        }
        
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

// 7. 관리자 리셋
app.post('/api/admin/reset', (req, res) => {
    if (req.body.password !== 'admin2025') return res.status(403).json({ error: '비번 오류' });
    
    for(let id in sensorData.sensors) {
        sensorData.sensors[id].value = 0;
        sensorData.sensors[id].todayOpened = false;
        sensorData.sensors[id].lastOpened = null;
        sensorData.sensors[id].missedAlertSent = false;
    }
    sensorData.history = [];
    sensorData.dailyStats = {};
    saveData();
    res.json({ success: true, message: '리셋 완료' });
});

// 8. 매일 자정에 todayOpened 리셋
function resetDailyFlags() {
    const now = new Date();
    const todayKey = now.toISOString().split('T')[0];
    
    if (!sensorData.lastResetDate || sensorData.lastResetDate !== todayKey) {
        for (let id in sensorData.sensors) {
            sensorData.sensors[id].todayOpened = false;
            sensorData.sensors[id].missedAlertSent = false;
        }
        sensorData.lastResetDate = todayKey;
        saveData();
        console.log(`[System] Daily flags reset for ${todayKey}`);
    }
}

// 30초 이상 heartbeat 없으면 오프라인 처리
function checkDeviceStatus() {
    const now = Date.now();
    const lastHB = sensorData.deviceInfo.lastHeartbeat 
        ? new Date(sensorData.deviceInfo.lastHeartbeat).getTime() 
        : 0;
    
    if ((now - lastHB) >= 30000) {
        sensorData.deviceInfo.isOnline = false;
    }
}

setInterval(resetDailyFlags, 60000);
setInterval(checkMissedMedication, 60000); // 1분마다 미복용 체크
setInterval(checkDeviceStatus, 10000); // 10초마다 장치 상태 체크
resetDailyFlags();

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 서버 시작
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📂 Data saved in: ${DATA_FILE}`);
    if (mailTransporter) {
        console.log('📧 Email notifications enabled');
    }
});
