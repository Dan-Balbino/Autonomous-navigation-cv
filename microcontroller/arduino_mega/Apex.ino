// Include necessary headers

#include "SerialProtocol.h"
#include "Types.h"
#include "CANProtocol.h"
#include "HBridgeController.h"

#include <Servo.h>

#define CAN_CS_PIN 53
#define CAN_INTERRUPT_PIN 2

CarCommand cmd;
Telemetry telemetry;

unsigned long last = 0;
unsigned long lastTelemetry = 0;


// =====================================================
// SERVO
// =====================================================

Servo myservo;

const int SERVO_PIN = 12;

float angleTarget = 90.0;
float angle = 90.0;

unsigned long lastUpdate = 0;


// =====================================================
// SERIAL1
// =====================================================

String serial1Message = "";


// =====================================================
// SETUP
// =====================================================

void setup() {

  Serial.begin(115200);

  // Serial1 do Arduino Mega
  Serial1.begin(9600);

  pinMode(LED_BUILTIN, OUTPUT);

  myservo.attach(SERVO_PIN);
  myservo.write(90);

  beginCAN(CAN_CS_PIN, CAN_INTERRUPT_PIN);

  initCAN(cmd, telemetry);

  cmd.vehicleState = true;

  telemetry.canModules[MOTOR] = {"Motor", false};
  telemetry.canModules[ULTRASONIC] = {"Ultrasonic", false};
  telemetry.canModules[ENCODER] = {"Encoder", false};
  telemetry.canModules[LIGHTING] = {"Lighting", false};
}


// =====================================================
// LOOP
// =====================================================

void loop() {

  pollCAN();
  updateCANStatus();

  if (receiveCommand(cmd)) {

    angleTarget = constrain(cmd.servo, 0, 180);
    processCommand(cmd);
  }

  // Lê Serial1
  readSerial1();
  testBlock();
  taskServo();

  if (millis() - lastTelemetry >= 100) {
    lastTelemetry = millis();
    sendTelemetry(telemetry);
  }
}


// =====================================================
// SERIAL1
// =====================================================

void readSerial1() {

  while (Serial1.available()) {

    char c = Serial1.read();

    // Fim da mensagem
    if (c == '\n') {

      serial1Message = "";
    }

    else if (c != '\r') {

      serial1Message += c;
    }
  }
}


// =====================================================
// TEST BLOCK
// =====================================================

void testBlock() {

  if (millis() - last >= 2000) {

    last = millis();

    digitalWrite(
      LED_BUILTIN,
      !digitalRead(LED_BUILTIN)
    );
  }
}


// =====================================================
// SERVO
// =====================================================

void taskServo() {

  unsigned long now = millis();

  if (now - lastUpdate < 1) {

    return;
  }

  lastUpdate = now;

  if (abs(angle - angleTarget) < 0.5) {

    return;
  }

  angle += (angle < angleTarget) ? 1 : -1;

  angle = constrain(angle, 0, 180);

  if (abs(angle - angleTarget) < 1) {

    angle = angleTarget;
  }

  myservo.write((int)angle);
}