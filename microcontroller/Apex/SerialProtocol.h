#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "./Types.h"

bool receiveCommand(CarCommand& cmd);

void processCommand(CarCommand& cmd);

void sendTelemetry(const Telemetry& telemetry);

void readSerial1(uint8_t &battery, uint8_t &current, uint8_t &percentage, uint8_t &battery_state);

int freeRam();