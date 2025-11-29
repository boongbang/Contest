<p align="center">
  <img src="https://img.shields.io/badge/Arduino-00979D?style=for-the-badge&logo=Arduino&logoColor=white" alt="Arduino"/>
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js"/>
  <img src="https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express"/>
  <img src="https://img.shields.io/badge/MariaDB-003545?style=for-the-badge&logo=mariadb&logoColor=white" alt="MariaDB"/>
  <img src="https://img.shields.io/badge/Chart.js-FF6384?style=for-the-badge&logo=chartdotjs&logoColor=white" alt="Chart.js"/>
</p>

<h1 align="center">🟢 COSS - Smart Pillcase</h1>

<p align="center">
  <strong>IoT 기반 스마트 복약 관리 시스템</strong><br>
  고령자와 만성질환자를 위한 실시간 복약 모니터링 솔루션
</p>

<p align="center">
  <em>2025 SDGs 기반 사회문제 해결 경진대회 본선 출품작</em><br>
  <strong>16팀 '먹었약'</strong>
</p>

---

## 📋 목차

1. [프로젝트 개요](#-프로젝트-개요)
2. [팀 소개](#-팀-소개)
3. [시스템 아키텍처](#-시스템-아키텍처)
4. [하드웨어 구성](#-하드웨어-구성)
5. [소프트웨어 구성](#-소프트웨어-구성)
6. [주요 기능](#-주요-기능)
7. [API 명세](#-api-명세)
8. [설치 및 실행](#-설치-및-실행)
9. [환경 변수 설정](#-환경-변수-설정)
10. [파일 구조](#-파일-구조)
11. [기술 스택](#-기술-스택)
12. [향후 계획](#-향후-계획)

---

## 🎯 프로젝트 개요

### 배경

대한민국은 2025년 초고령사회 진입을 앞두고 있으며, 65세 이상 인구의 복약 순응도 문제가 심각한 사회적 이슈로 대두되고 있습니다. 특히 독거노인과 치매 초기 환자의 경우, 복약 시간을 잊거나 이미 복용했는지 기억하지 못하는 경우가 빈번합니다.

### 솔루션

**COSS(Care Of Smart Seniors)**는 이러한 문제를 해결하기 위해 개발된 IoT 기반 스마트 약통 시스템입니다.

- **적외선(IR) 센서**를 활용한 약통 개폐 실시간 감지
- **자동 복약 기록** 및 통계 분석
- **복약 시간 알람** 및 보호자 **이메일 알림** 시스템
- **직관적인 웹 대시보드**를 통한 복약 이력 관리

### SDGs 연계

| Goal | 설명 |
|------|------|
| **SDG 3** | 건강과 웰빙 - 고령자 건강 관리 지원 |
| **SDG 10** | 불평등 감소 - 디지털 소외 계층을 위한 기술 접근성 향상 |

---

## 👥 팀 소개

<table align="center">
  <tr>
    <th>이름</th>
    <th>학과</th>
    <th>역할</th>
  </tr>
  <tr>
    <td><strong>임병현</strong> (팀장)</td>
    <td>공간연출학과</td>
    <td>프로젝트 총괄, 웹 프론트엔드/백엔드 개발, UI/UX 디자인</td>
  </tr>
  <tr>
    <td><strong>김지우</strong></td>
    <td>응용통계학과</td>
    <td>데이터 분석, 복약 통계 알고리즘 설계</td>
  </tr>
  <tr>
    <td><strong>김수민</strong></td>
    <td>전기전자공학부</td>
    <td>하드웨어 설계, Arduino 펌웨어 개발</td>
  </tr>
  <tr>
    <td><strong>박서연</strong></td>
    <td>전기전자공학부</td>
    <td>센서 회로 설계, 하드웨어 통합</td>
  </tr>
</table>

<p align="center"><em>중앙대학교 AI·SW융합학부 프로젝트</em></p>

---

## 🏗 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────────────┐
│                        COSS System Architecture                      │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────┐     HTTPS/WiFi     ┌──────────────────┐
│   Arduino    │ ─────────────────> │   Node.js        │
│   R4 WiFi    │                    │   Server         │
│              │ <───────────────── │   (Cloudtype)    │
│  - IR센서 x4 │    JSON Response   │                  │
│  - LCD 16x2  │                    │  - Express.js    │
│  - 버저      │                    │  - MariaDB       │
└──────────────┘                    │  - JWT Auth      │
       │                            │  - Nodemailer    │
       │                            └────────┬─────────┘
       │                                     │
       ▼                                     ▼
┌──────────────┐                    ┌──────────────────┐
│  약통 하드웨어 │                    │   Web Dashboard  │
│              │                    │                  │
│  4개 슬롯:   │                    │  - 대시보드      │
│  ┌─────┬─────┐                    │  - 복약 통계     │
│  │아침 │점심 │                    │  - 기록 관리     │
│  ├─────┼─────┤                    │  - 프로필 설정   │
│  │저녁 │취침 │                    │  - 관리자 페이지 │
│  └─────┴─────┘                    └──────────────────┘
└──────────────┘                             │
                                             ▼
                                    ┌──────────────────┐
                                    │   보호자 알림    │
                                    │   (Email)        │
                                    └──────────────────┘
```

### 데이터 흐름

1. **센서 감지**: IR 센서가 약통 슬롯의 개폐를 감지
2. **데이터 전송**: Arduino가 WiFi를 통해 서버로 센서 데이터 전송
3. **데이터 처리**: 서버에서 디바운싱 및 플리커링 필터링 후 복약 기록 생성
4. **실시간 반영**: 웹 대시보드에서 실시간 복약 상태 확인
5. **알림 발송**: 미복약 시 보호자에게 이메일 알림 자동 발송

---

## 🔧 하드웨어 구성

### 핵심 부품

| 부품 | 모델 | 용도 |
|------|------|------|
| **마이크로컨트롤러** | Arduino R4 WiFi | WiFi 통신 및 전체 제어 |
| **적외선 센서** | IR 센서 x4 | 약통 슬롯 개폐 감지 |
| **디스플레이** | I2C LCD 16x2 (KS0061) | 상태 표시 |
| **버저** | 피에조 버저 | 알람 출력 |

### 핀 배치

```
Arduino R4 WiFi 핀 구성
─────────────────────────
Digital Pins:
  D2 → IR 센서 1 (아침 약)
  D3 → IR 센서 2 (점심 약)
  D4 → IR 센서 3 (저녁 약)
  D5 → IR 센서 4 (취침 약)

Analog Pins:
  A0 → 배터리 전압 모니터링

I2C:
  SDA → LCD SDA (주소: 0x27 또는 0x3F)
  SCL → LCD SCL
```

### 펌웨어 기능 (MyArduinoCode.c)

```c
// 주요 기능
├── WiFi 자동 연결 및 재연결
├── HTTPS SSL 통신 지원
├── 센서 디바운싱 (100ms)
├── 최소 전송 간격 (500ms)
├── Heartbeat 신호 (10초 주기)
├── LCD 상태 표시
│   ├── IDLE: 센서 상태 요약
│   ├── ALERT: 복약 알림
│   └── ERROR: 오류 표시
└── 배터리 잔량 모니터링
```

### LCD 표시 예시

```
┌────────────────┐     ┌────────────────┐     ┌────────────────┐
│A:O L:O E:X N:O │     │>>> MORNING <<< │     │! ERROR !       │
│WiFi:OK 123     │     │Medicine Taken! │     │WiFi Lost!      │
└────────────────┘     └────────────────┘     └────────────────┘
    (IDLE 모드)          (ALERT 모드)          (ERROR 모드)
```

---

## 💻 소프트웨어 구성

### 백엔드 서버 (server.js)

Node.js + Express 기반의 RESTful API 서버로, 다음 기능을 제공합니다:

#### 핵심 모듈

```javascript
// 의존성
├── express      // 웹 프레임워크
├── mariadb      // 데이터베이스 연결
├── bcryptjs     // 비밀번호 암호화
├── jsonwebtoken // JWT 인증
├── nodemailer   // 이메일 발송 (선택적)
├── cors         // CORS 처리
└── dotenv       // 환경 변수 관리
```

#### 데이터 구조

```javascript
sensorData = {
    sensors: {
        1: { id: 1, name: '아침 약', emoji: '🌅', value: 0, 
             lastOpened: null, todayOpened: false, 
             targetTime: '08:00', description: '혈압약',
             missedAlertSent: false, alarmDismissed: false },
        // ... 점심(2), 저녁(3), 취침(4) 슬롯
    },
    history: [],           // 복약 이력
    dailyStats: {},        // 일별 통계
    users: [],             // 사용자 정보
    userMedications: {},   // 사용자별 약 설정
    deviceInfo: {          // 디바이스 상태
        ipAddress: null,
        firmwareVersion: '1.0.0',
        lastHeartbeat: null,
        isOnline: false
    },
    isRefillMode: false,   // 리필 모드 상태
    notificationSettings: {...}  // 알림 설정
}
```

#### 플리커링 방지 로직

센서의 불안정한 신호를 필터링하기 위한 타이머 기반 로직:

```javascript
const FLICKERING_THRESHOLD_MS = 1000;  // 1초 이상 유지되어야 유효

// 센서값 1 → 0 변화 시
if (finalValue === 0 && sensor.value === 1 && pendingRemoval[finalSensorId]) {
    const elapsedMs = Date.now() - pendingRemoval[finalSensorId].timestamp;
    if (elapsedMs >= FLICKERING_THRESHOLD_MS) {
        // 유효한 복약으로 기록
        sensor.lastOpened = now.toISOString();
        sensor.todayOpened = true;
        sensorData.history.unshift({...});
    }
}
```

### 프론트엔드 페이지

| 페이지 | 파일 | 설명 |
|--------|------|------|
| **로그인/회원가입** | `index.html` | JWT 기반 인증, 세션 관리 |
| **대시보드** | `dashboard.html` | 실시간 복약 상태, 통계 차트, 알람 |
| **프로필** | `profile.html` | 사용자 정보, 보호자 이메일 설정 |
| **관리자** | `admin.html` | 디바이스 상태, 시스템 관리 |

---

## ⭐ 주요 기능

### 1. 실시간 복약 감지

```
센서 감지 → 디바운싱(100ms) → 플리커링 필터(1초) → 복약 기록 생성
```

- INPUT_PULLUP 모드로 안정적인 신호 처리
- 최소 전송 간격(500ms)으로 서버 과부하 방지

### 2. 복약 알람 시스템

```javascript
// 알람 조건: 목표 시간 경과 후 30분 이내
if (diffMinutes > 0 && diffMinutes <= 30) {
    alerts.push({
        sensorId: id,
        type: 'warning',
        message: `🔔 ${sensor.name} 복용 시간입니다! (${diffMinutes}분 지남)`,
        playSound: true
    });
}
```

- 시간대별 알람 설정 (아침/점심/저녁/취침)
- 알람 확인(dismiss) 기능으로 하루 동안 비활성화
- 야간 모드 지원 (설정 시간대 알림 차단)

### 3. 보호자 이메일 알림

```javascript
// 미복약 감지 시 자동 이메일 발송
async function checkMissedMedication() {
    // 목표 시간 10초 이상 경과 시 보호자에게 알림
    if (diffMinutes > 0.17 && mailTransporter) {
        await sendGuardianEmail(user.id, subject, htmlContent);
        sensor.missedAlertSent = true;
    }
}
```

- Gmail SMTP를 통한 이메일 발송
- HTML 포맷의 시각적 알림 메일
- 미복약 알림 중복 방지 플래그

### 4. 복약 통계 및 분석

| 지표 | 설명 |
|------|------|
| **PDC (Proportion of Days Covered)** | 복약 성공 일수 비율 |
| **최장 연속 복약일** | 연속으로 복약한 최대 일수 |
| **시간 정확도** | 목표 시간 대비 실제 복약 시간 오차 |
| **시간대별 분포** | 24시간 기준 복약 패턴 |
| **요일별 분포** | 주간 복약 패턴 |

```javascript
function calculateAdherenceMetrics(userId) {
    return {
        totalDays,           // 총 기록 일수
        totalCount,          // 총 복약 횟수
        averagePerDay,       // 일 평균 복약
        pdc,                 // 복약 순응도(%)
        maxStreak,           // 최장 연속일
        maxGap,              // 최장 미복용 기간
        timeAccuracy         // 시간 정확도(%)
    };
}
```

### 5. 리필 모드

약을 다시 채울 때 오탐지를 방지하는 모드:

```javascript
// 리필 모드 활성화 시
if (sensorData.isRefillMode) {
    console.log('📦 리필 모드 - 복용 기록 건너뜀');
    return res.json({ success: true, ignored: true });
}
```

- 리필 중 센서 활동 무시
- 리필 종료 시 특정 슬롯 복약 상태 초기화 옵션

### 6. 디바이스 상태 모니터링

```javascript
// Heartbeat 수신 (10초 주기)
app.post('/api/device/heartbeat', (req, res) => {
    sensorData.deviceInfo.ipAddress = ipAddress;
    sensorData.deviceInfo.firmwareVersion = firmwareVersion;
    sensorData.deviceInfo.lastHeartbeat = new Date().toISOString();
    sensorData.deviceInfo.isOnline = true;
});

// 오프라인 감지 (30초 이상 Heartbeat 없음)
if ((now - lastHB) >= 30000) {
    sensorData.deviceInfo.isOnline = false;
}
```

---

## 📡 API 명세

### 인증 API

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/auth/login` | 로그인 |
| POST | `/api/auth/register` | 회원가입 |

### 센서 API

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/value` | 전체 센서 상태 조회 |
| POST | `/value` | 센서 데이터 수신 (Arduino) |

### 디바이스 API

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/device/status` | 디바이스 상태 조회 |
| POST | `/api/device/heartbeat` | Heartbeat 수신 |
| POST | `/api/device/calibrate` | 센서 영점 조절 |

### 복약 관리 API

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/medications` | 약 목록 조회 |
| GET | `/api/medications/user` | 사용자별 약 설정 조회 |
| POST | `/api/medications/user` | 사용자별 약 설정 저장 |

### 통계 API

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/dashboard/stats` | 대시보드 통계 |
| GET | `/api/reports/detailed` | 상세 리포트 |

### 알림 API

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/notifications/check` | 알람 체크 |
| POST | `/api/notifications/dismiss` | 알람 확인 |
| GET | `/api/notifications/settings` | 알림 설정 조회 |
| PUT | `/api/notifications/settings` | 알림 설정 수정 |

### 리필 API

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/refill/status` | 리필 모드 상태 |
| POST | `/api/refill/start` | 리필 모드 시작 |
| POST | `/api/refill/end` | 리필 모드 종료 |

### 프로필 API

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/profile` | 프로필 조회 |
| PUT | `/api/profile` | 프로필 수정 |

### 관리자 API

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/admin/reset` | 전체 데이터 초기화 |
| POST | `/api/data/reset` | 사용자 데이터 초기화 |
| DELETE | `/api/history/:index` | 특정 기록 삭제 |

---

## 🚀 설치 및 실행

### 사전 요구사항

- **Node.js** 18.0.0 이상
- **npm** 또는 **yarn**
- **Arduino IDE** 2.0 이상
- **Arduino R4 WiFi** 보드 패키지

### 서버 설치

```bash
# 1. 저장소 클론
git clone https://github.com/your-repo/coss.git
cd coss

# 2. 의존성 설치
npm install

# 3. 환경 변수 설정
cp .env.example .env
# .env 파일 수정

# 4. 서버 실행
npm start

# 개발 모드 (nodemon)
npm run dev
```

### Arduino 설정

```c
// 1. WiFi 설정 수정
const char* WIFI_SSID = "your-wifi-ssid";
const char* WIFI_PASSWORD = "your-wifi-password";

// 2. 서버 주소 설정
const char* SERVER_HOST = "your-server-domain.com";
const int SERVER_PORT = 443;
```

### Arduino 라이브러리 설치

- **WiFiS3** (Arduino R4 WiFi 내장)
- **ArduinoJson** (v6 이상)
- **LiquidCrystal_I2C**
- **Wire** (내장)

---

## ⚙ 환경 변수 설정

`.env` 파일 예시:

```env
# 서버 설정
PORT=3000
JWT_SECRET=your-secret-key-here

# 데이터베이스 (선택적)
DB_HOST=your-db-host
DB_USER=your-db-user
DB_PASSWORD=your-db-password
DB_NAME=coss_db
DB_PORT=3306

# 이메일 알림 (선택적)
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=your-app-password
```

> **참고**: Gmail 앱 비밀번호는 Google 계정 보안 설정에서 생성해야 합니다.

---

## 📁 파일 구조

```
coss/
├── server.js              # 메인 서버 파일
├── package.json           # npm 패키지 설정
├── package-lock.json      # 의존성 잠금
├── .env                   # 환경 변수 (git 제외)
├── coss-data.json         # 로컬 데이터 저장소
│
├── public/                # 정적 파일
│   ├── index.html         # 로그인/회원가입
│   ├── dashboard.html     # 메인 대시보드
│   ├── profile.html       # 프로필 설정
│   └── admin.html         # 관리자 페이지
│
└── arduino/
    └── MyArduinoCode.c    # Arduino 펌웨어
```

---

## 🛠 기술 스택

### 하드웨어

| 기술 | 용도 |
|------|------|
| **Arduino R4 WiFi** | 마이크로컨트롤러 |
| **IR 센서** | 적외선 감지 |
| **I2C LCD** | 상태 디스플레이 |

### 백엔드

| 기술 | 버전 | 용도 |
|------|------|------|
| **Node.js** | ≥18.0.0 | 런타임 |
| **Express** | ^4.18.2 | 웹 프레임워크 |
| **MariaDB** | ^3.2.2 | 데이터베이스 |
| **bcryptjs** | ^2.4.3 | 비밀번호 암호화 |
| **jsonwebtoken** | ^9.0.2 | JWT 인증 |
| **nodemailer** | ^7.0.10 | 이메일 발송 |
| **cors** | ^2.8.5 | CORS 처리 |
| **dotenv** | ^16.3.1 | 환경 변수 |

### 프론트엔드

| 기술 | 용도 |
|------|------|
| **Vanilla JS** | 클라이언트 로직 |
| **Chart.js** | 통계 차트 |
| **Three.js** | 심장 미디어아트 |
| **Font Awesome** | 아이콘 |
| **Google Fonts** | 폰트 (Poppins, Merriweather) |

### 인프라

| 서비스 | 용도 |
|--------|------|
| **Cloudtype** | 서버 호스팅 |
| **Gmail SMTP** | 이메일 발송 |

---

## 🎨 UI/UX 특징

### 디자인 컨셉

- **Zen Minimalism**: 차분하고 직관적인 인터페이스
- **고령자 친화적**: 큰 버튼, 명확한 색상 대비, 이모지 활용
- **모바일 퍼스트**: 414px 기준 반응형 디자인

### 색상 팔레트

```css
:root {
    --primary-green: #6B8E6B;    /* 메인 그린 */
    --dark-green: #556b57;       /* 다크 그린 */
    --light-green: #E8F5E9;      /* 라이트 그린 */
    --text-light: #F1F5EF;       /* 밝은 텍스트 */
    --text-dark: #333333;        /* 어두운 텍스트 */
}
```

### 시간대별 테마

| 시간대 | 색상 | 설명 |
|--------|------|------|
| 아침 | `#6B8E6B` | 밝은 자연 그린 |
| 점심 | `#537053` | 중간 톤 그린 |
| 저녁 | `#3c523c` | 어두운 그린 |
| 취침 | `#253325` | 가장 어두운 그린 |

### 심장 미디어아트

대시보드 '약통 소개' 섹션에 포함된 인터랙티브 Three.js 아트:

- **상징**: 규칙적인 복약 = 건강한 심장 박동
- **상호작용**: 클릭 시 심장 수축/이완 애니메이션
- **색상 변화**: 복약 습관의 다양성과 개인화 표현

---

## 🔮 향후 계획

### 단기 (1-3개월)

- [ ] 푸시 알림 기능 (PWA)
- [ ] 복약 패턴 AI 분석
- [ ] 다국어 지원 (영어)

### 중기 (3-6개월)

- [ ] 모바일 앱 개발 (React Native)
- [ ] 음성 알림 기능
- [ ] 가족 그룹 기능

### 장기 (6개월 이상)

- [ ] 의료기관 연동 API
- [ ] 처방전 OCR 인식
- [ ] 헬스케어 플랫폼 통합

---

## 📄 라이선스

이 프로젝트는 교육 및 연구 목적으로 개발되었습니다.

---

## 📞 문의

프로젝트 관련 문의사항은 아래로 연락해 주세요.

- **이메일**: sean3124@naver.com (테스트 계정)
- **주소**: https://port-0-coss-mi0kk25df8c7e306.sel3.cloudtype.app

---

<p align="center">
  <strong>💚 COSS는 사랑하는 가족의 심장이 오래도록 건강하게 뛰기를 바라는 마음으로 만들어졌습니다.</strong>
</p>

<p align="center">
  © 2025 COSS - 16팀 '먹었약' | 중앙대학교 AI·SW융합학부
</p>
