#pragma once

#include <stdint.h>

// ========= ENUMS ========= 

enum class TrafficLights : uint8_t {
    None   = 0,
    Red    = 1,
    Yellow = 2,
    Green  = 3
};

enum class Lights : uint8_t {
    Off  = 0,
    Low  = 1,
    High = 2,
    Auto = 3
};

enum class UltrassonicZone : uint8_t {
    Free     = 0,
    Far      = 1,
    Near     = 2,
    Critical = 3
};

enum CanModuleID : uint8_t {
    MOTOR = 0,
    ULTRASONIC,
    BATERY,

    NUM_CAN_MODULES
};

// ========= STRUCTS ========= 

// Struct to hold the car command data
struct CarCommand {
  bool run;
  Lights lights;
  bool stop;
  bool vehicleState;
  int servo;
  int16_t speed;
  bool reverse;
};

struct CanModule {
  const char* name;
  bool status;
};

struct Telemetry {
  uint8_t battery;

  float speed1, speed2, speed3, speed4;

  int left;
  int f_left;
  int f_right;
  int right;

  CanModule canModules[NUM_CAN_MODULES];
};

struct CANStatus {
    unsigned long ultrasonic;
    unsigned long motor;
    unsigned long batery;
};
