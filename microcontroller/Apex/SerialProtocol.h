#pragma once

#include "./Types.h"

bool receiveCommand(CarCommand& cmd);

void processCommand(CarCommand& cmd);

void sendTelemetry(const Telemetry& telemetry);

void readSerial1(int &battery, int &current, int &percentage, uint8_t &battery_state);