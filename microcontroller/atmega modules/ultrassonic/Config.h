#pragma once

// ============================================================
// CONFIGURAÇÕES
// ============================================================

#define SONAR_NUM 4

// Velocidade CAN
#define CAN_SPEED 500E3

// Pinos do transceptor CAN/MCP2515 neste módulo.
#define CAN_CS_PIN 10
#define CAN_INTERRUPT_PIN 2

// ID da mensagem CAN
#define ULTRASONIC_DATA 0x200

// Intervalo para tentar reconectar a CAN
#define CAN_RECONNECT_INTERVAL 1000

// Tempo entre disparos dos ultrassônicos
// Aumente se houver interferência entre os sensores
#define SENSOR_DELAY 30

// ------------------------------------------------------------
// PINOS DOS ULTRASSÔNICOS
// ------------------------------------------------------------

// echo - branco
// trig - azul

// LEFT
#define LEFT_TRIG A0
#define LEFT_ECHO A1

// FRONT LEFT
#define F_LEFT_TRIG 3
#define F_LEFT_ECHO 4

// FRONT RIGHT
#define F_RIGHT_TRIG 7
#define F_RIGHT_ECHO 8

// RIGHT
#define RIGHT_TRIG 5
#define RIGHT_ECHO 6


// ------------------------------------------------------------
// LIMITES FRONTAIS
// ------------------------------------------------------------

#define FRONTAL_MAX_DISTANCE 150
#define FRONTAL_SAFE_DISTANCE 90
#define FRONTAL_MID_DISTANCE 70
#define FRONTAL_CRITICAL_DISTANCE 50

// ------------------------------------------------------------
// LIMITES LATERAIS
// ------------------------------------------------------------
#define SIDE_MAX_DISTANCE 100
#define SIDE_SAFE_DISTANCE 75
#define SIDE_MID_DISTANCE 55
#define SIDE_CRITICAL_DISTANCE 35


// ============================================================
// ESTADOS
// ============================================================

enum SensorState {
  FREE = 0,
  DISTANT = 1,
  NEAR = 2,
  CRITICAL = 3
};