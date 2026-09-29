// MÓDULO ULTRASSÔNICO — APEX
//
// Lê 4 sensores ultrassônicos (NewPing) de forma sequencial,
// classifica cada distância em 4 estados (FREE, DISTANT, NEAR,
// CRITICAL) e envia o resultado para a ECU pela CAN (ID 0x200).
//
// Índice dos sensores (vale para sonar[], cm[] e sensorState[]):
//
//   [0] Lateral esquerdo
//   [1] Frontal esquerdo
//   [2] Frontal direito
//   [3] Lateral direito
//
// Os limites de cada região e as configurações de pinos, CAN e
// tempo entre disparos ficam em Config.h.
// ============================================================

#include <CAN.h>
#include <NewPing.h>

#include "Config.h"


// SENSORES
// Ordem igual ao índice descrito no cabeçalho.
// ============================================================

NewPing sonar[SONAR_NUM] = {
  NewPing(LEFT_TRIG,    LEFT_ECHO,    SIDE_MAX_DISTANCE),
  NewPing(F_LEFT_TRIG,  F_LEFT_ECHO,  FRONTAL_MAX_DISTANCE),
  NewPing(F_RIGHT_TRIG, F_RIGHT_ECHO, FRONTAL_MAX_DISTANCE),
  NewPing(RIGHT_TRIG,   RIGHT_ECHO,   SIDE_MAX_DISTANCE),
};


// VARIÁVEIS
// ============================================================

// Última distância lida em cada sensor, em cm.
// 0 = sem eco ou acima da distância máxima do sensor.
unsigned int cm[SONAR_NUM] = {0, 0, 0, 0};

// Estado de cada sensor após a classificação.
SensorState sensorState[SONAR_NUM] = {
  FREE,
  FREE,
  FREE,
  FREE,
};

// true  = PROSSIGA
// false = PARE (algum sensor em CRITICAL)
bool vehicleState = true;

bool canConnected = false;

// Instante (millis) da última tentativa de conexão com a CAN.
unsigned long lastCANAttempt = 0;


// SETUP
// ============================================================

void setup() {
  Serial.begin(9600);

  Serial.println();
  Serial.println("Modulo ultrassonico iniciado!");

  connectCAN();
}


// LOOP.
// ============================================================

void loop() {

  // Reconexão CAN
  // Tenta de novo a cada CAN_RECONNECT_INTERVAL ms.

  if (!canConnected && millis() - lastCANAttempt >= CAN_RECONNECT_INTERVAL) {
    connectCAN();
  }

  // Leitura dos sensores
  lerSensores();

  // Processamento
  processarLeituras();

  // Envio CAN
  if (canConnected) {
    sendData();
  }

  // Debug
  //printDebug();
}

// LEITURA DOS 4 ULTRASSÔNICOS
//
// Leitura sequencial, com SENSOR_DELAY ms entre um sensor e
// outro para o eco anterior sumir antes do próximo disparo.
// Não há delay depois do último sensor.
// ============================================================
void lerSensores() {

  for (uint8_t i = 0; i < SONAR_NUM; i++) {

    // ping_cm() bloqueia até o eco voltar ou estourar o
    // timeout (definido pela distância máxima do sensor).
    cm[i] = sonar[i].ping_cm();

    if (i < SONAR_NUM - 1) {
      delay(SENSOR_DELAY);
    }
  }
}


// CLASSIFICA DISTÂNCIA
//
// Converte uma distância em um estado, usando os limites da
// região do sensor (frontal ou lateral):
//
//   distance == 0        -> FREE (sem eco)
//   distance <= critical -> CRITICAL
//   distance <= mid      -> NEAR
//   distance <= safe     -> DISTANT
//   acima de safe        -> FREE
// ============================================================
SensorState classifyDistance(
  unsigned int distance,
  unsigned int safe,
  unsigned int mid,
  unsigned int critical
) {

  // Sem eco ou acima do alcance máximo: tratado como livre.
  if (distance == 0) {
    return FREE;
  }

  // CRÍTICO
  if (distance <= critical) {
    return CRITICAL;
  }

  // PRÓXIMO
  if (distance <= mid) {
    return NEAR;
  }

  // DISTANTE
  if (distance <= safe) {
    return DISTANT;
  }

  // LIVRE
  return FREE;
}

// PROCESSAMENTO
//
// Classifica os 4 sensores e define o estado do veículo.
// Se qualquer sensor estiver em CRITICAL, vehicleState = PARE.
// ============================================================
void processarLeituras() {

  // [0] Lateral esquerdo
  sensorState[0] = classifyDistance(
    cm[0],
    SIDE_SAFE_DISTANCE,
    SIDE_MID_DISTANCE,
    SIDE_CRITICAL_DISTANCE
  );

  // [1] Frontal esquerdo
  sensorState[1] = classifyDistance(
    cm[1],
    FRONTAL_SAFE_DISTANCE,
    FRONTAL_MID_DISTANCE,
    FRONTAL_CRITICAL_DISTANCE
  );

  // [2] Frontal direito
  sensorState[2] = classifyDistance(
    cm[2],
    FRONTAL_SAFE_DISTANCE,
    FRONTAL_MID_DISTANCE,
    FRONTAL_CRITICAL_DISTANCE
  );

  // [3] Lateral direito
  sensorState[3] = classifyDistance(
    cm[3],
    SIDE_SAFE_DISTANCE,
    SIDE_MID_DISTANCE,
    SIDE_CRITICAL_DISTANCE
  );

  // ESTADO DO VEÍCULO
  //
  // true  = PROSSIGA
  // false = PARE
  vehicleState = true;

  if (sensorState[0] == CRITICAL) {
    vehicleState = false;
  }

  if (sensorState[1] == CRITICAL) {
    vehicleState = false;
  }

  if (sensorState[2] == CRITICAL) {
    vehicleState = false;
  }

  if (sensorState[3] == CRITICAL) {
    vehicleState = false;
  }
}


// CONEXÃO CAN
//
// Inicializa o MCP2515. Se conectar, envia o estado inicial.
// Se falhar, o loop() tenta de novo após CAN_RECONNECT_INTERVAL.
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

// ENVIO CAN
//
// UMA ÚNICA MENSAGEM, 2 BYTES
//
// ID: 0x200
//
// BYTE 0 (estado dos sensores, 2 bits cada):
//
// Bit 0-1 = Frontal esquerdo  (sensorState[1])
// Bit 2-3 = Lateral esquerdo  (sensorState[0])
// Bit 4-5 = Frontal direito   (sensorState[2])
// Bit 6-7 = Lateral direito   (sensorState[3])
//
// BYTE 1 (estado do veículo):
//
// Bit 0   = VEHICLE
// Bit 1-7 = RESERVADO
//
// ESTADOS DOS SENSORES:
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

  uint8_t byte0 = 0;
  byte0 |= (sensorState[1] & 0x03) << 0;  // Frontal esquerdo
  byte0 |= (sensorState[0] & 0x03) << 2;  // Lateral esquerdo
  byte0 |= (sensorState[2] & 0x03) << 4;  // Frontal direito
  byte0 |= (sensorState[3] & 0x03) << 6;  // Lateral direito

  uint8_t byte1 = vehicleState & 0x01;    // Bit 0: PROSSIGA/PARE

  CAN.beginPacket(ULTRASONIC_DATA);
  CAN.write(byte0);
  CAN.write(byte1);
  CAN.endPacket();
}


// DEBUG SERIAL
//
// Imprime distância e estado de cada sensor, o estado do
// veículo e os 2 bytes montados da mesma forma que em sendData().
// ============================================================
void printDebug() {

  // Monta exatamente os mesmos bytes enviados pela CAN
  uint8_t byte0 = 0;
  byte0 |= (sensorState[1] & 0x03) << 0;
  byte0 |= (sensorState[0] & 0x03) << 2;
  byte0 |= (sensorState[2] & 0x03) << 4;
  byte0 |= (sensorState[3] & 0x03) << 6;

  uint8_t byte1 = vehicleState & 0x01;

  // LEFT (lateral esquerdo)
  Serial.print("LEFT: ");
  Serial.print(cm[0]);
  Serial.print("cm [");
  Serial.print(sensorState[0]);
  Serial.print("]");

  // F_LEFT (frontal esquerdo)
  Serial.print(" | F_LEFT: ");
  Serial.print(cm[1]);
  Serial.print("cm [");
  Serial.print(sensorState[1]);
  Serial.print("]");

  // F_RIGHT (frontal direito)
  Serial.print(" | F_RIGHT: ");
  Serial.print(cm[2]);
  Serial.print("cm [");
  Serial.print(sensorState[2]);
  Serial.print("]");

  // RIGHT (lateral direito)
  Serial.print(" | RIGHT: ");
  Serial.print(cm[3]);
  Serial.print("cm [");
  Serial.print(sensorState[3]);
  Serial.print("]");

  // VEHICLE
  Serial.print(" | VEHICLE: ");

  if (vehicleState) {
    Serial.print("PROSSIGA");
  } else {
    Serial.print("PARE");
  }

  // CAN (hexadecimal)
  Serial.print(" | CAN: 0x");

  if (byte0 < 0x10) {
    Serial.print("0");
  }
  Serial.print(byte0, HEX);

  Serial.print(" 0x");

  if (byte1 < 0x10) {
    Serial.print("0");
  }
  Serial.print(byte1, HEX);

  // BINÁRIO (byte 0 e byte 1)
  Serial.print(" | BIN: ");

  for (int i = 7; i >= 0; i--) {
    Serial.print((byte0 >> i) & 1);
  }

  Serial.print(" ");

  for (int i = 7; i >= 0; i--) {
    Serial.print((byte1 >> i) & 1);
  }

  Serial.println();
}
