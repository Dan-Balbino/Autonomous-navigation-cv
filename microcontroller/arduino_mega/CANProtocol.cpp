#include <Arduino.h>
#include <CAN.h>
#include "CANProtocol.h"

static CarCommand* command = nullptr;
static Telemetry* telemetry = nullptr;

CANStatus lastMessage;


void beginCAN(int cs_pin, int interrupt_pin) {
  CAN.setPins(cs_pin, interrupt_pin);

  if (!CAN.begin(500E3)) {
    digitalWrite(LED_BUILTIN, HIGH);
    Serial.println("Falha ao iniciar a CAN!");
    while (1);
  }
}


void initCAN (CarCommand& cmd, Telemetry& tel) {
  command = &cmd;
  telemetry = &tel;

  CAN.onReceive(onReceive);
}


void pollCAN() {
  CAN.parsePacket();
}


void receiveUltrasonic(Telemetry* telemetry, CarCommand* command, int packetSize) {
  if (packetSize != 1)
      return;

  uint8_t data;
  CAN.readBytes(&data, 1);

  telemetry->left  = (data >> 0) & 0x03;
  telemetry->front = (data >> 2) & 0x03;
  telemetry->right = (data >> 4) & 0x03;
  command->vehicleState = (data >> 6) & 0x01;

  lastMessage.ultrasonic = millis();
}



void onReceive(int packetSize) {
  switch (CAN.packetId()) {

    case ULTRASONIC_DATA:
      receiveUltrasonic(telemetry, command, packetSize);
      break;
    
  }
}


void sendCommand(int id, int data) {
  CAN.beginPacket(id);
  CAN.write((uint8_t)data);
  CAN.endPacket();
}

void sendMotorCommand(int id, int ang, float speed) {
  CAN.beginPacket(id);
  // Envia o float (4 bytes)
  CAN.write((uint8_t*)&speed, sizeof(speed));
  // Envia o int (4 bytes)
  CAN.write((uint8_t*)&ang, sizeof(ang));
  CAN.endPacket();
}


bool isModuleOnline(unsigned long lastMessage, unsigned long timeout) {
  return (millis() - lastMessage) <= timeout;
}


void updateCANStatus() {
  telemetry->canModules[ULTRASONIC].status = isModuleOnline(lastMessage.ultrasonic, 1000);
}

