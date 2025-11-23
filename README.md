# 🚨 IR 센서 실시간 모니터링 시스템

Arduino와 Node.js를 활용한 적외선 장애물 감지 센서의 실시간 웹 모니터링 시스템입니다.

## 📋 프로젝트 구성

### 시스템 아키텍처
```
[IR 센서] → [Arduino R4 WiFi] → [Node.js 서버 (Cloudtype)] → [웹 대시보드]
```

## 🛠 기술 스택

- **하드웨어**: Arduino R4 WiFi, IR 장애물 감지 센서 (4핀)
- **백엔드**: Node.js, Express.js
- **프론트엔드**: HTML5, CSS3, Vanilla JavaScript
- **배포**: Cloudtype, GitHub Actions
- **시뮬레이션**: Wokwi

## 📦 파일 구조
```
ir-sensor-monitoring/
├── diagram.json          # Wokwi 회로도
├── sketch.ino           # Arduino 코드
├── server.js            # Node.js 서버
├── package.json         # 의존성 패키지
├── coss.yaml           # Cloudtype 설정
├── index.html          # 웹 대시보드
├── README.md           # 프로젝트 문서
├── LICENSE             # MIT 라이선스
├── .gitignore          # Git 제외 파일
└── .github/
    └── workflows/
        └── deploy.yml  # GitHub Actions
```

## 🚀 빠른 시작

### 1. 레포지토리 클론
```bash
git clone https://github.com/yourusername/ir-sensor-monitoring.git
cd ir-sensor-monitoring
```

### 2. 서버 실행
```bash
npm install
npm start
```

### 3. 웹 대시보드 접속
브라우저에서 `index.html` 파일을 열거나 `http://localhost:3000`으로 접속

## 🔌 하드웨어 연결

### 4핀 IR 센서 연결
| 핀 | 기능 | Arduino 연결 |
|---|------|------------|
| VCC | 전원 (+) | 5V |
| GND | 접지 (-) | GND |
| OUT | 디지털 출력 | D2 |
| EN | Enable | NC 또는 5V |

## 💻 API 엔드포인트

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/` | 서버 상태 확인 |
| GET | `/value` | 현재 센서값 조회 |
| POST | `/value` | 센서값 업데이트 |

## 🌐 Cloudtype 배포

1. Cloudtype 계정 생성
2. GitHub 레포지토리 연결
3. `coss.yaml` 설정 확인
4. 배포 실행

## 📝 라이선스

MIT License - [LICENSE](LICENSE) 파일 참조

## 👨‍💻 개발자

- 병현 (Chung-Ang University)
- AI·SW 융합 프로젝트

---

**문의사항이 있으시면 이슈를 등록해주세요!** 🚀
