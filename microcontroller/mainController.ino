#include <Servo.h>
#include <ArduinoJson.h>

#include "HBridgeController.h"

// --- Ponte H 1 ---
const int RPWM_1 = 2;
const int LPWM_1 = 3;

// --- Ponte H 2 --
const int RPWM_2 = 4;
const int LPWM_2 = 5;

// --- Ponte H 3 --
const int RPWM_3 = 6;
const int LPWM_3 = 7;

// --- Ponte H 4 --
const int RPWM_4 = 9;
const int LPWM_4 = 8;

HBridgeController motors[] = {
  HBridgeController(RPWM_1, LPWM_1),
  HBridgeController(RPWM_2, LPWM_2),
  HBridgeController(RPWM_3, LPWM_3),
  HBridgeController(RPWM_4, LPWM_4)
};
/*
Os pinos de enable estão todos conectados ao 5v que vem do arduino
*/

// --- Servo ---
const int SERVO_PIN = 13;
Servo myservo;
float angleTarget = 90.0;
float angle = 90.0;
unsigned long lastUpdate = 0;

// --- Seriais não-bloqueantes ---
String bufferSerial = "";
String bufferUNO = "";

// --- Estados do carro ---
enum estados {
  PROSSIGA,
  PARE
};

enum estados estado = PROSSIGA;

bool stop = false;


int c1 = 0; // contagem de "PARE"
int c2 = 0; // contagem de "PROSSIGA"
int limit = 10;

// ─────────────────────────────────────────────
void setup() {
  myservo.attach(SERVO_PIN);
  myservo.write(90);

  for(int i = 0; i < 4; i++) {
    motors[i].begin();
  }

  Serial.begin(9600);
  Serial.println("=== Conexão Mega - PC estabelecida ===");

  Serial1.begin(9600);
  Serial.println("=== Conexão Mega - UNO estabelecida ===");

  Serial.println("PRONTO");

}

// ─────────────────────────────────────────────
void loop() {
  SerialPC();
  SerialUNO();
  taskMotores();
  taskServo();
}

// ─────────────────────────────────────────────
void SerialPC() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\n') {
      bufferSerial.trim();
      if (bufferSerial.length() > 0) processarJSON(bufferSerial);
      bufferSerial = "";
    } else {
      bufferSerial += c;
    }
  }
}

// ─────────────────────────────────────────────
void SerialUNO() {
  while (Serial1.available() > 0) {
    char c = Serial1.read();
    if (c == '\n') {
      bufferUNO.trim();
      if (bufferUNO == "PARE") {
        c1++;
        c2 = 0;
        if (c1 >= limit) {
          estado = PARE;
          c1 = 0;
        }
      } else {
        c2++;
        c1 = 0;
        if (c2 >= limit) {
          estado = PROSSIGA;
          c2 = 0;
        }
      }
      bufferUNO = "";
    } else {
      bufferUNO += c;
    }
  }
}

// ─────────────────────────────────────────────
void processarJSON(String json) {
  StaticJsonDocument<256> doc;
  DeserializationError erro = deserializeJson(doc, json);

  if (erro) {
    Serial.print("[ERRO] JSON invalido: ");
    Serial.println(erro.c_str());
    return;
  }

  bool deviation = doc["DEVIATION"] | false;
  stop = doc["STOP"] | false;
  bool sg = doc["SG"] | true;
  bool sv = doc["SV"] | false;
  int servo = doc["SERVO"] | 90;
  int pwm = doc["PWM"] | 0;

  angleTarget = constrain(servo, 0, 180);

  if (stop or estado == PARE) {
    for(int i = 0; i < 4; i++) {
      motors[i].stop();
    }
    angleTarget = angle;
    if(stop) {
      Serial.println("VEÍCULO PARADO PELO PAINEL DE CONTROLE");
    }
    else if(estado == PARE) {
      Serial.println("OBSTÁCULO DETECTADO");
    }

  } else {
    for(int i = 0; i < 4; i++) {
      motors[i].move(pwm);
    }
    Serial.println("VEÍCULO EM MOVIMENTO");
  }
}

// ─────────────────────────────────────────────
void taskMotores() {
  if (stop or estado == PARE) {
    for(int i = 0; i < 4; i++) {
      motors[i].stop();
    }
    angleTarget = angle;
  }
}

// ─────────────────────────────────────────────
void taskServo() {
  unsigned long now = millis();
  if (now - lastUpdate < 1) return;
  lastUpdate = now;
  if (abs(angle - angleTarget) < 0.5) return;
  ;

  angle += (angle < angleTarget) ? 1 : -1;
  angle = constrain(angle, 0, 180);
  if (abs(angle - angleTarget) < 1) angle = angleTarget;

  myservo.write((int)angle);
}

// ─────────────────────────────────────────────
