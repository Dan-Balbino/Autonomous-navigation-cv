#include <CAN.h>
#include <NewPing.h>

// ============================================================
// CONFIGURAÇÕES - ALTERE AQUI
// ============================================================

#define SONAR_NUM 5

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
#define SENSOR_DELAY 60

// ------------------------------------------------------------
// PINOS DOS ULTRASSÔNICOS
// ------------------------------------------------------------

// FRONT
#define FRONT_TRIG 6
#define FRONT_ECHO 5

// LEFT
#define LEFT_TRIG 8
#define LEFT_ECHO 7

// RIGHT
#define RIGHT_TRIG 4
#define RIGHT_ECHO 3

// REAR
#define REAR_TRIG 10
#define REAR_ECHO 9

// EXTRA
#define EXTRA_TRIG 12
#define EXTRA_ECHO 11

// ------------------------------------------------------------
// DISTÂNCIA MÁXIMA DE CADA SENSOR
// ------------------------------------------------------------

#define FRONT_MAX_DISTANCE 150
#define LEFT_MAX_DISTANCE 100
#define RIGHT_MAX_DISTANCE 100
#define REAR_MAX_DISTANCE 150
#define EXTRA_MAX_DISTANCE 100

// ------------------------------------------------------------
// LIMITES DO FRONT
// ------------------------------------------------------------

#define FRONT_SAFE_DISTANCE 90
#define FRONT_MID_DISTANCE 70
#define FRONT_CRITICAL_DISTANCE 50

// ------------------------------------------------------------
// LIMITES DO LEFT
// ------------------------------------------------------------

#define LEFT_SAFE_DISTANCE 75
#define LEFT_MID_DISTANCE 55
#define LEFT_CRITICAL_DISTANCE 35

// ------------------------------------------------------------
// LIMITES DO RIGHT
// ------------------------------------------------------------

#define RIGHT_SAFE_DISTANCE 75
#define RIGHT_MID_DISTANCE 55
#define RIGHT_CRITICAL_DISTANCE 35

// ------------------------------------------------------------
// LIMITES DO REAR
// ------------------------------------------------------------

#define REAR_SAFE_DISTANCE 90
#define REAR_MID_DISTANCE 70
#define REAR_CRITICAL_DISTANCE 50

// ------------------------------------------------------------
// LIMITES DO EXTRA
// ------------------------------------------------------------

#define EXTRA_SAFE_DISTANCE 75
#define EXTRA_MID_DISTANCE 55
#define EXTRA_CRITICAL_DISTANCE 35

// ------------------------------------------------------------
// QUAIS SENSORES FAZEM O VEÍCULO PARAR?
//
// true  = sensor pode mandar PARE
// false = sensor não influencia vehicleState
// ------------------------------------------------------------

#define FRONT_CAUSES_STOP true
#define LEFT_CAUSES_STOP true
#define RIGHT_CAUSES_STOP true
#define REAR_CAUSES_STOP false
#define EXTRA_CAUSES_STOP false

// ============================================================
// ESTADOS
// ============================================================

enum SensorState {
  FREE = 0,
  DISTANT = 1,
  NEAR = 2,
  CRITICAL = 3
};

// ============================================================
// SENSORES
// ============================================================

NewPing sonar[SONAR_NUM] = {
  NewPing(FRONT_TRIG, FRONT_ECHO, FRONT_MAX_DISTANCE),
  NewPing(LEFT_TRIG, LEFT_ECHO, LEFT_MAX_DISTANCE),
  NewPing(RIGHT_TRIG, RIGHT_ECHO, RIGHT_MAX_DISTANCE),
  NewPing(REAR_TRIG, REAR_ECHO, REAR_MAX_DISTANCE),
  NewPing(EXTRA_TRIG, EXTRA_ECHO, EXTRA_MAX_DISTANCE)
};

// ============================================================
// VARIÁVEIS
// ============================================================

unsigned int cm[SONAR_NUM] = {0, 0, 0, 0, 0};

SensorState sensorState[SONAR_NUM] = {
  FREE,
  FREE,
  FREE,
  FREE,
  FREE
};

bool vehicleState = true;
bool canConnected = false;

unsigned long lastCANAttempt = 0;

// ============================================================
// SETUP
// ============================================================

void setup() {
  Serial.begin(9600);

  Serial.println();
  Serial.println("Modulo ultrassonico iniciado!");

  connectCAN();
}

// ============================================================
// LOOP
// ============================================================

void loop() {

  // ----------------------------------------------------------
  // Reconexão CAN
  // ----------------------------------------------------------

  if (!canConnected && millis() - lastCANAttempt >= CAN_RECONNECT_INTERVAL) {
    connectCAN();
  }

  // ----------------------------------------------------------
  // Leitura dos sensores
  // ----------------------------------------------------------
  lerSensores();

  // ----------------------------------------------------------
  // Processamento
  // ----------------------------------------------------------
  processarLeituras();

  // ----------------------------------------------------------
  // Envio CAN
  // ----------------------------------------------------------
  if (canConnected) {
    sendData();
  }

  // ----------------------------------------------------------
  // Debug
  // ----------------------------------------------------------
  printDebug();

  delay(50);
}

// ============================================================
// LEITURA DOS 5 ULTRASSÔNICOS
// ============================================================
void lerSensores() {

  for (uint8_t i = 0; i < SONAR_NUM; i++) {

    cm[i] = sonar[i].ping_cm();

    // Pequeno intervalo para evitar interferência
    // entre os sensores.
    if (i < SONAR_NUM - 1) {
      delay(SENSOR_DELAY);
    }
  }
}

// ============================================================
// CLASSIFICA DISTÂNCIA
// ============================================================
SensorState classifyDistance(
  unsigned int distance,
  unsigned int safe,
  unsigned int mid,
  unsigned int critical
) {

  // ----------------------------------------------------------
  // Sem eco
  // ----------------------------------------------------------
  if (distance == 0) {
    return FREE;
  }

  // ----------------------------------------------------------
  // CRÍTICO
  // ----------------------------------------------------------
  if (distance <= critical) {
    return CRITICAL;
  }

  // ----------------------------------------------------------
  // PRÓXIMO
  // ----------------------------------------------------------
  if (distance <= mid) {
    return NEAR;
  }

  // ----------------------------------------------------------
  // DISTANTE
  // ----------------------------------------------------------
  if (distance <= safe) {
    return DISTANT;
  }

  // ----------------------------------------------------------
  // LIVRE
  // ----------------------------------------------------------
  return FREE;
}

// ============================================================
// PROCESSAMENTO
// ============================================================
void processarLeituras() {

  // ----------------------------------------------------------
  // FRONT
  // ----------------------------------------------------------
  sensorState[0] = classifyDistance(
    cm[0],
    FRONT_SAFE_DISTANCE,
    FRONT_MID_DISTANCE,
    FRONT_CRITICAL_DISTANCE
  );

  // ----------------------------------------------------------
  // LEFT
  // ----------------------------------------------------------
  sensorState[1] = classifyDistance(
    cm[1],
    LEFT_SAFE_DISTANCE,
    LEFT_MID_DISTANCE,
    LEFT_CRITICAL_DISTANCE
  );

  // ----------------------------------------------------------
  // RIGHT
  // ----------------------------------------------------------
  sensorState[2] = classifyDistance(
    cm[2],
    RIGHT_SAFE_DISTANCE,
    RIGHT_MID_DISTANCE,
    RIGHT_CRITICAL_DISTANCE
  );

  // ----------------------------------------------------------
  // REAR
  // ----------------------------------------------------------
  sensorState[3] = classifyDistance(
    cm[3],
    REAR_SAFE_DISTANCE,
    REAR_MID_DISTANCE,
    REAR_CRITICAL_DISTANCE
  );

  // ----------------------------------------------------------
  // EXTRA
  // ----------------------------------------------------------
  sensorState[4] = classifyDistance(
    cm[4],
    EXTRA_SAFE_DISTANCE,
    EXTRA_MID_DISTANCE,
    EXTRA_CRITICAL_DISTANCE
  );

  // ----------------------------------------------------------
  // ESTADO DO VEÍCULO
  //
  // true  = PROSSIGA
  // false = PARE
  // ----------------------------------------------------------
  vehicleState = true;

  if (FRONT_CAUSES_STOP && sensorState[0] == CRITICAL) {
    vehicleState = false;
  }

  if (LEFT_CAUSES_STOP && sensorState[1] == CRITICAL) {
    vehicleState = false;
  }

  if (RIGHT_CAUSES_STOP && sensorState[2] == CRITICAL) {
    vehicleState = false;
  }

  if (REAR_CAUSES_STOP && sensorState[3] == CRITICAL) {
    vehicleState = false;
  }

  if (EXTRA_CAUSES_STOP && sensorState[4] == CRITICAL) {
    vehicleState = false;
  }
}

// ============================================================
// CONEXÃO CAN
// ============================================================
void connectCAN() {

  Serial.println("Tentando conectar na CAN...");

  CAN.setPins(CAN_CS_PIN, CAN_INTERRUPT_PIN);
  if (CAN.begin(CAN_SPEED)) {

    canConnected = true;

    Serial.println("CAN conectada!");

    // Envia estado inicial
    sendData();

    Serial.println("Estado inicial enviado pela CAN.");

  } else {

    canConnected = false;

    Serial.println("Falha na CAN. Nova tentativa em 1 segundo.");
  }

  lastCANAttempt = millis();
}

// ============================================================
// ENVIO CAN
// ============================================================
//
// UMA ÚNICA MENSAGEM
//
// ID: 0x200
//
// BYTE:
//
// Bit 0-1 = LEFT
// Bit 2-3 = FRONT
// Bit 4-5 = RIGHT
// Bit 6   = VEHICLE
// Bit 7   = RESERVADO
//
// ESTADOS:
//
// 00 = FREE
// 01 = DISTANT
// 10 = NEAR
// 11 = CRITICAL
//
// VEHICLE:
//
// 1 = PROSSIGA
// 0 = PARE
//
// ============================================================
void sendData() {

  uint8_t data = 0;

  // ----------------------------------------------------------
  // LEFT
  // Bits 0-1
  // ----------------------------------------------------------
  data |= (sensorState[1] & 0x03) << 0;

  // ----------------------------------------------------------
  // FRONT
  // Bits 2-3
  // ----------------------------------------------------------
  data |= (sensorState[0] & 0x03) << 2;

  // ----------------------------------------------------------
  // RIGHT
  // Bits 4-5
  // ----------------------------------------------------------
  data |= (sensorState[2] & 0x03) << 4;

  // ----------------------------------------------------------
  // VEHICLE
  // Bit 6
  // ----------------------------------------------------------
  data |= (vehicleState & 0x01) << 6;

  // ----------------------------------------------------------
  // Bit 7 reservado
  // ----------------------------------------------------------

  // ----------------------------------------------------------
  // Envia
  // ----------------------------------------------------------
  CAN.beginPacket(ULTRASONIC_DATA);
  CAN.write(data);
  CAN.endPacket();
}

// ============================================================
// DEBUG SERIAL
// ============================================================
void printDebug() {

  uint8_t data = 0;

  // Monta exatamente o mesmo byte enviado pela CAN
  data |= (sensorState[1] & 0x03) << 0;
  data |= (sensorState[0] & 0x03) << 2;
  data |= (sensorState[2] & 0x03) << 4;
  data |= (vehicleState & 0x01) << 6;

  // ----------------------------------------------------------
  // FRONT
  // ----------------------------------------------------------
  Serial.print("FRONT: ");
  Serial.print(cm[0]);
  Serial.print("cm [");
  Serial.print(sensorState[0]);
  Serial.print("]");

  // ----------------------------------------------------------
  // LEFT
  // ----------------------------------------------------------
  Serial.print(" | LEFT: ");
  Serial.print(cm[1]);
  Serial.print("cm [");
  Serial.print(sensorState[1]);
  Serial.print("]");

  // ----------------------------------------------------------
  // RIGHT
  // ----------------------------------------------------------
  Serial.print(" | RIGHT: ");
  Serial.print(cm[2]);
  Serial.print("cm [");
  Serial.print(sensorState[2]);
  Serial.print("]");

  // ----------------------------------------------------------
  // REAR
  // ----------------------------------------------------------
  Serial.print(" | REAR: ");
  Serial.print(cm[3]);
  Serial.print("cm [");
  Serial.print(sensorState[3]);
  Serial.print("]");

  // ----------------------------------------------------------
  // EXTRA
  // ----------------------------------------------------------
  Serial.print(" | EXTRA: ");
  Serial.print(cm[4]);
  Serial.print("cm [");
  Serial.print(sensorState[4]);
  Serial.print("]");

  // ----------------------------------------------------------
  // VEHICLE
  // ----------------------------------------------------------
  Serial.print(" | VEHICLE: ");

  if (vehicleState) {
    Serial.print("PROSSIGA");
  } else {
    Serial.print("PARE");
  }

  // ----------------------------------------------------------
  // CAN
  // ----------------------------------------------------------
  Serial.print(" | CAN: 0x");

  if (data < 0x10) {
    Serial.print("0");
  }

  Serial.print(data, HEX);

  // ----------------------------------------------------------
  // BINÁRIO
  // ----------------------------------------------------------
  Serial.print(" | BIN: ");

  for (int i = 7; i >= 0; i--) {
    Serial.print((data >> i) & 1);
  }

  Serial.println();
}

