#pragma once

#include "./Types.h"

bool receiveCommand(CarCommand& cmd);

void processCommand(CarCommand& cmd);

void sendTelemetry(const Telemetry& telemetry);