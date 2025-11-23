const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 센서값 저장 변수
let sensorData = {
  a: 0,
  lastUpdated: null
};

// 루트 경로
app.get('/', (req, res) => {
  res.json({
    status: 'IR Sensor Server Running',
    currentValue: sensorData.a,
    lastUpdated: sensorData.lastUpdated
  });
});

// 센서값 수신
app.post('/value', (req, res) => {
  const { a } = req.body;
  
  if (a !== undefined) {
    sensorData.a = parseInt(a);
    sensorData.lastUpdated = new Date().toISOString();
    
    console.log(`Sensor value received: ${a}`);
    res.json({
      success: true,
      received: a,
      timestamp: sensorData.lastUpdated
    });
  } else {
    res.status(400).json({
      success: false,
      error: 'Missing sensor value'
    });
  }
});

// 현재 센서값 조회
app.get('/value', (req, res) => {
  res.json(sensorData);
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`IR Sensor Server running on port ${PORT}`);
});