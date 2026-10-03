#include "SerialProtocol.h"
#include "Types.h"
#include "CANProtocol.h"
#include "Lights.h"

#define CAN_CS_PIN 53
#define CAN_INTERRUPT_PIN 2
// Lights lights(6, 43);

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
  //lights.begin();

  beginCAN(CAN_CS_PIN, CAN_INTERRUPT_PIN);

  initCAN(cmd, telemetry);

  cmd.speed = 0.0;
  cmd.vehicleState = true;
  cmd.reverse = false;
  lastVehicleState = cmd.vehicleState;

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
  bool vehicleStateChanged = cmd.vehicleState != lastVehicleState;

  if (receiveCommand(cmd)) {
    processCommand(cmd);

    // Realiza o controle dos LEDs com base no comando recebido
    // lights.handleCommand((uint8_t)cmd.lights, cmd.stop || !cmd.vehicleState, telemetry.battery_percentage, telemetry.battery_state);

  } else if (vehicleStateChanged) {
    processCommand(cmd);
  }

  // Lê Serial1
  //readSerial1(telemetry.battery, telemetry.battery_current, telemetry.battery_percentage, telemetry.battery_state);
  
  // Bloco de teste para piscar o LED embutido a cada 2 segundos
  testBlock();

  // Envio de telemetria a cada 100 ms
  if (millis() - lastTelemetry >= 100) {
    lastTelemetry = millis();
    sendTelemetry(telemetry);
  }

  //lights.update();
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


