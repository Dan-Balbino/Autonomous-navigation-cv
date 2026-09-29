#pragma once

#include "./CANIds.h"
#include "./Types.h"

void beginCAN(int cs_pin, int interrupt_pin);

void initCAN (CarCommand& cmd, Telemetry& tel);

void receiveUltrasonic(Telemetry* telemetry, CarCommand* command, int packetSize);

void receiveMotor(Telemetry* telemetry, int packetSize);

void pollCAN();

void onReceive(int packetSize);

bool isModuleOnline(unsigned long lastMessage, unsigned long timeout);

void sendCommand(int id, int data);

void sendMotorCommand(int id, int16_t ang, int16_t pwm, bool reverse);

void updateCANStatus();