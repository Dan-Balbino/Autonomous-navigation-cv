#include "SerialProtocol.h"
#include "Types.h"
#include "CANProtocol.h"
#include "Lights.h"

#define CAN_CS_PIN 53
#define CAN_INTERRUPT_PIN 2
#define LED_PIN 12

Lights lights(LED_PIN, 42);

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
  Serial1.begin(115200);

  pinMode(LED_BUILTIN, OUTPUT);
  randomSeed(analogRead(A0));
  lights.begin();

  beginCAN(CAN_CS_PIN, CAN_INTERRUPT_PIN);

  initCAN(cmd, telemetry);

  cmd.speed = 0.0;
  cmd.vehicleState = true;
  cmd.reverse = false;
  lastVehicleState = cmd.vehicleState;

  cmd.lights = 0b00001000;

  telemetry.battery_percentage = 0;
  telemetry.battery_state = 0;

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

  bool vs = cmd.vehicleState;               // captura uma vez (a CAN pode mudar no meio)
  bool vehicleStateChanged = vs != lastVehicleState;

  if (receiveCommand(cmd) || vehicleStateChanged) {
    processCommand(cmd);
    lastVehicleState = vs;
  }

  // Lê Serial1
  readSerial1(telemetry.battery, telemetry.battery_current, telemetry.battery_percentage, telemetry.battery_state);

  testBlock();

  if (millis() - lastTelemetry >= 100) {
    lastTelemetry = millis();
    sendTelemetry(telemetry);
  }

  // LEDs sempre com o estado atual, não só quando chega comando
  lights.handleCommand((uint8_t)cmd.lights, cmd.run && (cmd.stop || !cmd.vehicleState),
                       telemetry.battery_percentage, telemetry.battery_state);

  lights.update();
}

// =====================================================
// TEST BLOCK
// =====================================================
void testBlock() {

  if (millis() - last >= 2000) {

    last = millis();

    digitalWrite( LED_BUILTIN, !digitalRead(LED_BUILTIN));
  }
}
