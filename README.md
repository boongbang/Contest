# 🚨 IR 센서 실시간 모니터링 시스템

Arduino와 Node.js를 활용한 **적외선 장애물 감지(IR) 센서**의 변화를  
실시간으로 웹 대시보드에서 확인할 수 있는 모니터링 시스템입니다.

---

## 📋 프로젝트 구성

### 🔗 시스템 아키텍처
**[IR 센서] → [Arduino R4 WiFi] → [Node.js 서버 (Cloudtype)] → [웹 대시보드]**

---

## 🛠 기술 스택

- **하드웨어**: Arduino R4 WiFi, IR 장애물 감지 센서 (4핀)
- **백엔드**: Node.js, Express.js  
- **프론트엔드**: HTML5, CSS3, Vanilla JavaScript  
- **배포**: Cloudtype, GitHub Actions  
- **시뮬레이션**: Wokwi  

---

## 📦 파일 구조

ir-sensor-monitoring/
├── diagram.json # Wokwi 회로도
├── sketch.ino # Arduino 코드
├── server.js # Node.js 서버
├── package.json # 의존성 패키지
├── coss.yaml # Cloudtype 설정
├── index.html # 웹 대시보드
├── README.md # 프로젝트 문서
└── .github/
└── workflows/
└── deploy.yml # GitHub Actions 설정

yaml
코드 복사

---

## 🚀 빠른 시작

### 1. 🔧 Wokwi 시뮬레이션 실행

1. [Wokwi](https://wokwi.com) 접속  
2. 새 프로젝트 생성 → **Arduino UNO** 선택  
3. `diagram.json` 내용 복사  
4. `sketch.ino` 코드 붙여넣기 또는 업로드  

---

### 2. ☁ 서버 배포 (Cloudtype)

```bash
# 1. 저장소 클론
git clone https://github.com/yourname/ir-sensor-monitoring.git
cd ir-sensor-monitoring

# 2. 의존성 설치
npm install

# 3. 로컬 테스트 실행
