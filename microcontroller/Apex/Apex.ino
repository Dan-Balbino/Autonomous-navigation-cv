// Include necessary headers

#include "SerialProtocol.h"
#include "Types.h"
#include "CANProtocol.h"
#include "Lights.h"


#define CAN_CS_PIN 53
#define CAN_INTERRUPT_PIN 2
Lights lights(6, 43);

CarCommand cmd;
Telemetry telemetry;

unsigned long last = 0;
unsigned long lastTelemetry = 0;
bool lastVehicleState = true;

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
  randomSeed(analogRead(A0));
  lights.begin();

  beginCAN(CAN_CS_PIN, CAN_INTERRUPT_PIN);

  initCAN(cmd, telemetry);

  cmd.speed = 0.0;
  cmd.vehicleState = true;
  cmd.reverse = false;
  lastVehicleState = cmd.vehicleState;

  telemetry.canModules[MOTOR] = {"Controle", false};
  telemetry.canModules[ULTRASONIC] = {"Sensoriamento", false};
  telemetry.canModules[BATERY] = {"Carregamento e Alimentação", false};
}


// =====================================================
// LOOP
// =====================================================

void loop() {

  pollCAN();
  updateCANStatus();
  bool vehicleStateChanged = cmd.vehicleState != lastVehicleState;

  if (receiveCommand(cmd)) {
    processCommand(cmd);
    // Realiza o controle dos LEDs com base no comando recebido
    lights.handleCommand((uint8_t)cmd.lights);
  } else if (vehicleStateChanged) {
    processCommand(cmd);
  }
  lastVehicleState = cmd.vehicleState;
  lights.setStopped(cmd.stop || !cmd.vehicleState);

  // Lê Serial1
  readSerial1();
  testBlock();

  if (millis() - lastTelemetry >= 100) {
    lastTelemetry = millis();
    sendTelemetry(telemetry);
  }

  lights.update();
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


