// Include necessary headers

#include "SerialProtocol.h"
#include "Types.h"
#include "CANProtocol.h"

#define CAN_CS_PIN 53
#define CAN_INTERRUPT_PIN 2

CarCommand cmd;
Telemetry telemetry;

unsigned long last = 0;
unsigned long lastTelemetry = 0;

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

  beginCAN(CAN_CS_PIN, CAN_INTERRUPT_PIN);

  initCAN(cmd, telemetry);

  cmd.speed = 0.0;
  cmd.vehicleState = true;
  cmd.reverse = false;

  telemetry.canModules[MOTOR] = {"Motor", false};
  telemetry.canModules[ULTRASONIC] = {"Ultrasonic", false};
  telemetry.canModules[LIGHTING] = {"Lighting", false};
}


// =====================================================
// LOOP
// =====================================================

void loop() {

  pollCAN();
  updateCANStatus();

  if (receiveCommand(cmd)) {
    processCommand(cmd);
  }

  // Lê Serial1
  readSerial1();
  testBlock();

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


