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
  if (packetSize != 2)
      return;

  uint8_t data[2];
  CAN.readBytes(data, 2);

  telemetry->left    = (data[0] >> 0) & 0x03;
  telemetry->f_left  = (data[0] >> 2) & 0x03;
  telemetry->f_right = (data[0] >> 4) & 0x03;
  telemetry->right   = (data[0] >> 6) & 0x03;

  command->vehicleState = data[1] & 0x01;

  lastMessage.ultrasonic = millis();
}

void receiveMotor(Telemetry* telemetry, int packetSize)
{
  if (packetSize != 8)
    return;

  int16_t sp1, sp2, sp3, sp4;

  if (CAN.readBytes((uint8_t*)&sp1, sizeof(sp1)) != sizeof(sp1) ||
      CAN.readBytes((uint8_t*)&sp2, sizeof(sp2)) != sizeof(sp2) ||
      CAN.readBytes((uint8_t*)&sp3, sizeof(sp3)) != sizeof(sp3) ||
      CAN.readBytes((uint8_t*)&sp4, sizeof(sp4)) != sizeof(sp4)) {
    return;
  }

  telemetry->speed1 = sp1 / 10.0;
  telemetry->speed2 = sp2 / 10.0;
  telemetry->speed3 = sp3 / 10.0;
  telemetry->speed4 = sp4 / 10.0;
  lastMessage.motor = millis();
}


void onReceive(int packetSize) {
  switch (CAN.packetId()) {

    case ULTRASONIC_DATA:
      receiveUltrasonic(telemetry, command, packetSize);
      break;
    
    case MOTOR_DATA:
      receiveMotor(telemetry, packetSize);
      break;
  }
}


void sendCommand(int id, int data) {
  CAN.beginPacket(id);
  CAN.write((uint8_t)data);
  CAN.endPacket();
}

void sendMotorCommand(int id, int16_t ang, int16_t pwm, bool reverse, bool stop, bool vehicle_state) {
  bool stop_car = stop || !vehicle_state;

  CAN.beginPacket(id);
  CAN.write((uint8_t*)&pwm, sizeof(pwm));
  CAN.write((uint8_t*)&ang, sizeof(ang));
  CAN.write((uint8_t*)&reverse, sizeof(reverse));
  //CAN.write((uint8_t*)&stop_car, sizeof(stop_car));

  CAN.endPacket();
}


bool isModuleOnline(unsigned long lastMessage, unsigned long timeout) {
  return (millis() - lastMessage) <= timeout;
}


void updateCANStatus() {
  telemetry->canModules[MOTOR].status = isModuleOnline(lastMessage.motor, 1000);
  telemetry->canModules[ULTRASONIC].status = isModuleOnline(lastMessage.ultrasonic, 1000);
}

