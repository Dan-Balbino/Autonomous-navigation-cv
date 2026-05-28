#include <Servo.h>
#include <ArduinoJson.h>

#include "HBridgeController.h"

// --- Ponte H 1 ---
const int RPWM_1 = 2;
const int LPWM_1 = 3;
HBridgeController bridge1(RPWM_1, LPWM_1);

// --- Ponte H 2 --
const int RPWM_2 = 4;
const int LPWM_2 = 5;
HBridgeController bridge2(RPWM_2, LPWM_2);

// --- Ponte H 3 --
const int RPWM_3 = 6;
const int LPWM_3 = 7;
HBridgeController bridge3(RPWM_3, LPWM_3);

// --- Ponte H 4 --
const int RPWM_4 = 9;
const int LPWM_4 = 8;
HBridgeController bridge4(RPWM_4, LPWM_4);

/*
Os pinos de enable estão todos conectados ao 5v que
vem do arduino
*/

// --- Servo ---
const int SERVO_PIN = 13;
Servo myservo;
float angleTarget = 90.0;
float angle = 90.0;
unsigned long lastUpdate = 0;

// --- Seria não-bloqueante ---
String bufferSerial = "";
String bufferUNO = "";

// --- Estados do carro ---
enum estados {
  PROSSIGA,
  PARE
};

enum estados estado = PROSSIGA;

int c1 = 0; // contagem de "PARE"
int c2 = 0; // contagem de "PROSSIGA"
int limit = 10;

// ─────────────────────────────────────────────
void setup() {
  myservo.attach(SERVO_PIN);
  myservo.write(90);

  bridge1.begin();
  bridge2.begin();
  bridge3.begin();
  bridge4.begin();

  Serial.begin(9600);
  Serial.print("=== Conexão Mega - PC estabelecida ===");

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
          Serial.println("Parado");
          c1 = 0;
        }
      } else {
        c2++;
        c1 = 0;
        if (c2 >= limit) {
          estado = PROSSIGA;
          Serial.println("Andando");
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
  bool stop = doc["STOP"] | false;
  bool sg = doc["SG"] | true;
  bool sv = doc["SV"] | false;
  int servo = doc["SERVO"] | 90;
  int m1 = doc["M1"] | 0;
  int m2 = doc["M2"] | 0;
  int m3 = doc["M3"] | 0;
  int m4 = doc["M4"] | 0;

  angleTarget = constrain(servo, 0, 180);

  if (stop or estado == PARE) {
    bridge1.move(0);
    bridge2.move(0);
    bridge3.move(0);
    bridge4.move(0);
    angleTarget = angle;  // opcional: congela o servo também
    Serial.println("OBSTACULO DETECTADO");
  } else {
    bridge1.move(m1);
    bridge2.move(m2);
    bridge3.move(m3);
    bridge4.move(m4);
    Serial.println("SEM OBSTACULOS");
  }

}

// ─────────────────────────────────────────────
void taskMotores() {
  if (estado == PARE) {
    bridge1.move(0);
    bridge2.move(0);
    bridge3.move(0);
    bridge4.move(0);
    angleTarget = angle;  // opcional: congela o servo também
  }
  
  // bridge1.update();
  // bridge2.update();
  // bridge3.update();
  // bridge4.update();
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
