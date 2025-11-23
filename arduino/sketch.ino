#define IR_SENSOR_PIN 2

int a = 0;  // IR 센서 감지값
int lastState = HIGH;
unsigned long lastSendTime = 0;
const unsigned long SEND_INTERVAL = 1000;  // 1초마다 전송

void setup() {
  Serial.begin(9600);
  pinMode(IR_SENSOR_PIN, INPUT);
  Serial.println("IR Sensor Started");
}

void loop() {
  int currentState = digitalRead(IR_SENSOR_PIN);
  
  // 센서 상태 변화 감지 (LOW = 장애물 감지)
  if (currentState != lastState) {
    a = (currentState == LOW) ? 1 : 0;
    lastState = currentState;
    
    Serial.print("Sensor Value Changed: ");
    Serial.println(a);
  }
  
  // 주기적으로 서버에 전송 (WiFi 모듈 연결 시 사용)
  if (millis() - lastSendTime > SEND_INTERVAL) {
    sendToServer();
    lastSendTime = millis();
  }
  
  delay(50);
}

void sendToServer() {
  // Arduino UNO는 WiFi 미지원 - Serial로 대체
  Serial.print("POST /value HTTP/1.1\n");
  Serial.print("Host: YOUR_SERVER_URL\n");
  Serial.print("Content-Type: application/json\n");
  Serial.print("Content-Length: ");
  
  String jsonData = "{\"a\":" + String(a) + "}";
  Serial.print(jsonData.length());
  Serial.print("\n\n");
  Serial.println(jsonData);
}
