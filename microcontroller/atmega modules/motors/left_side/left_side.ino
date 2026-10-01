#include <CAN.h>
#include <Wire.h>

#include "Encoder.h"
#include "HBridgeController.h"
#include "Config.h"

#define MOTOR_COMMAND 0x100
#define MOTOR_DATA    0x110

#ifndef MOTOR_COMMAND_SIZE
#define MOTOR_COMMAND_SIZE (sizeof(int16_t) + sizeof(int16_t) + sizeof(bool) + sizeof(bool))
#endif

// ================= HARDWARE PINOUT =================

// --- Front Wheel Hardware ---
const uint8_t ENCODER_1_PIN = 2;
const uint8_t RPWM_1 = 10;
const uint8_t LPWM_1 = 9;

Encoder encoder1(ENCODER_1_PIN, CIRCUMFERENCE, PULSES_PER_ROT);
HBridgeController motor1(RPWM_1, LPWM_1);

// --- Rear Wheel Hardware ---
const uint8_t ENCODER_2_PIN = 3;
const uint8_t RPWM_2 = 5;
const uint8_t LPWM_2 = 6;

Encoder encoder2(ENCODER_2_PIN, CIRCUMFERENCE, PULSES_PER_ROT);
HBridgeController motor2(RPWM_2, LPWM_2);

// ================= SYSTEM CONTROL FLAGS =================

bool motor_enabled = false;
bool accelerating_active = false;
bool stopping_active = false;
bool reverse = false;
bool stop_car = false;

int16_t target_pwm = 0;      // PWM base recebido direto pela CAN (0..OUTPUT_LIMIT)
int16_t steering_angle = 0;

int pwm_1 = 0;
int pwm_2 = 0;

// ================= SMOOTH ACCEL STATE (non-blocking) =================

int accel_step = 0;
unsigned long last_accel_step_time = 0;
const unsigned long ACCEL_STEP_INTERVAL_MS = 10; // 100 steps x 10ms = 1s

// ================= TELEMETRY =================

float speed_1, speed_2, speed_3, speed_4;

unsigned long last_send = 0;
unsigned long last_command_received = 0;
const unsigned long COMMAND_TIMEOUT_MS = 1500;

// ================= SMOOTH STOP STATE (non-blocking) =================

int stop_counter = 0;
int angle_counter = 0;

int stop_start_pwm_1 = 0;
int stop_start_pwm_2 = 0;
int stop_step = 0;
unsigned long last_stop_step_time = 0;
const unsigned long STOP_STEP_INTERVAL_MS = 10;

// ================= SETUP =================

void setup() {
  uint8_t resetCause = MCUSR;
  MCUSR = 0;

  Serial.begin(115200);

  Serial.print("MCUSR=");
  Serial.println(resetCause, HEX);

  CAN.setPins(A1);

  motor1.begin();
  encoder1.begin();

  motor2.begin();
  encoder2.begin();

  motor1.move(0);
  motor2.move(0);

  if (!CAN.begin(500E3)) {
    Serial.println("Falha ao iniciar a CAN!");
    while (1);
  }

  Wire.begin();
  Wire.setWireTimeout(25000, true);
}

// ================= LOOP =================

void loop() {
  bool new_command = receiveCANData();
  if (new_command) {
    sendCommandWire();
  }

  encoder1.update();
  encoder2.update();

  bool command_timeout = last_command_received != 0 &&
                         millis() - last_command_received > COMMAND_TIMEOUT_MS;

  if (command_timeout) {
    target_pwm = 0;
    steering_angle = 0;
    reverse = false;

    if (motor_enabled && !stopping_active) {
      beginSmoothStop();
    }
  }

  sendTelemetryIfDue();

  if (reverse) {
    motor_enabled = true;

    motor1.move(REVERSE_PWM);
    motor2.move(REVERSE_PWM);

    pwm_1 = REVERSE_PWM;
    pwm_2 = REVERSE_PWM;

    return;
  }

  if (stopping_active) {
    taskSmoothStop();
    return;
  }

  if (new_command && target_pwm > 0 && !motor_enabled) {
    startMotors();
  }

  if (new_command && target_pwm <= 0 && motor_enabled && !stopping_active) {
    beginSmoothStop();
    return;
  }

  if (!motor_enabled) {
    motor1.move(0);
    motor2.move(0);
    return;
  }

  if (accelerating_active) {
    taskSmoothAccel();
    return;
  }

  applyDifferentialPwm();
}

// ================= ACCEL START HELPER =================

void startMotors() {
  motor_enabled = true;
  accelerating_active = true;
  accel_step = 0;
  last_accel_step_time = millis();

  Serial.println("Partida iniciada pela CAN.");
}

// ================= DIFFERENTIAL CONTROL (malha aberta) =================

void applyDifferentialPwm() {
  float ratio = calculate_side_pwm_ratio();

  pwm_1 = round(target_pwm * ratio);
  pwm_2 = round(target_pwm * ratio);

  pwm_1 = constrain(pwm_1, -OUTPUT_LIMIT, OUTPUT_LIMIT);
  pwm_2 = constrain(pwm_2, -OUTPUT_LIMIT, OUTPUT_LIMIT);

  motor1.move(pwm_1);
  motor2.move(pwm_2);
}

float calculate_side_pwm_ratio() {
  if (steering_angle == 0) {
    return 1.0;
  }

  int16_t clamped_angle = constrain(steering_angle, -45, 45);
  float angle_rad = clamped_angle * PI / 180.0;
  float radius = WHEEL_BASE / tan(abs(angle_rad));

  float inner_radius = max(radius - (TRACK_WIDTH / 2.0), 0.0);
  float outer_radius = radius + (TRACK_WIDTH / 2.0);

  float ratio = (SIDE == SIDE_LEFT)
      ? (clamped_angle > 0 ? outer_radius / radius : inner_radius / radius)
      : (clamped_angle > 0 ? inner_radius / radius : outer_radius / radius);

  return ratio;
}

// ================= SMOOTH ACCEL (non-blocking) =================
// Rampa de 1s (100 passos x 10ms), igual em estrutura ao smooth stop.
// Usa target_pwm a cada passo (não um valor congelado no início), entao
// se a CAN atualizar o comando durante a rampa, o alvo acompanha em tempo real.

void taskSmoothAccel() {
  if (millis() - last_accel_step_time < ACCEL_STEP_INTERVAL_MS) {
    return;
  }

  last_accel_step_time = millis();
  accel_step++;

  float ratio = calculate_side_pwm_ratio();
  float ramp_fraction = min(accel_step / 100.0, 1.0);
  int ramped_base = round(target_pwm * ramp_fraction);

  pwm_1 = constrain((int)round(ramped_base * ratio), -OUTPUT_LIMIT, OUTPUT_LIMIT);
  pwm_2 = constrain((int)round(ramped_base * ratio), -OUTPUT_LIMIT, OUTPUT_LIMIT);

  motor1.move(pwm_1);
  motor2.move(pwm_2);

  if (accel_step >= 100) {
    accelerating_active = false;
    Serial.println("Aceleracao concluida. Controle direto por PWM ativado.");
  }
}

// ================= SMOOTH STOP (non-blocking) =================

void beginSmoothStop() {
  stop_start_pwm_1 = pwm_1;
  stop_start_pwm_2 = pwm_2;
  stop_step = 100;
  last_stop_step_time = millis();

  accelerating_active = false;
  stopping_active = true;
}

void taskSmoothStop() {
  if (millis() - last_stop_step_time < STOP_STEP_INTERVAL_MS) {
    return;
  }

  last_stop_step_time = millis();

  pwm_1 = round(stop_start_pwm_1 * (stop_step / 100.0));
  pwm_2 = round(stop_start_pwm_2 * (stop_step / 100.0));

  motor1.move(pwm_1);
  motor2.move(pwm_2);

  if (stop_step == 0) {
    pwm_1 = 0;
    pwm_2 = 0;

    motor1.move(0);
    motor2.move(0);

    motor_enabled = false;
    stopping_active = false;

    Serial.println("Motores parados suavemente.");
    return;
  }

  stop_step--;
}

// ================= CAN =================

bool receiveCANData() {
  int packet_size = CAN.parsePacket();

  if (packet_size <= 0) {
    return false;
  }

  if (CAN.packetId() != MOTOR_COMMAND) {
    return false;
  }

  if (packet_size != MOTOR_COMMAND_SIZE) {
    Serial.println("Pacote CAN invalido.");
    return false;
  }

  int16_t received_pwm;
  int16_t received_angle;
  bool received_reverse;
    bool received_stop;

  if (CAN.readBytes((uint8_t *)&received_pwm, sizeof(received_pwm)) != sizeof(received_pwm) ||
      CAN.readBytes((uint8_t *)&received_angle, sizeof(received_angle)) != sizeof(received_angle) ||
      CAN.readBytes((uint8_t *)&received_reverse, sizeof(received_reverse)) != sizeof(received_reverse) ||
      CAN.readBytes((uint8_t *)&received_stop, sizeof(received_stop)) != sizeof(received_stop)) {

    Serial.println("Leitura do comando CAN incompleta.");
    return false;
  }

  stop_car = received_stop;
  received_pwm = constrain(received_pwm, (int16_t)-OUTPUT_LIMIT, (int16_t)OUTPUT_LIMIT);

  if (stop_car) {
    target_pwm = 0;
    reverse = false;
    stop_counter = 0;
    if (motor_enabled && !stopping_active) {
      beginSmoothStop();
    }
  } else if (received_pwm == 0) {
    stop_counter++;

    if (stop_counter >= 2) {
      target_pwm = 0;
    }
  } else {
    stop_counter = 0;
    target_pwm = received_pwm;
  }

  if (received_angle == -90) {
    angle_counter++;

    if (angle_counter >= 2) {
      steering_angle = received_angle;
    }
  } else {
    angle_counter = 0;
    steering_angle = received_angle;
  }

  if (!stop_car) {
    reverse = received_reverse;
  }
  last_command_received = millis();

  return true;
}

void sendTelemetryIfDue() {
  if (millis() - last_send < 100) {
    return;
  }

  last_send = millis();
  requestWireData();
  sendCANData();
}

void sendCANData() {
  int16_t sp1 = speed_1 * 10;
  int16_t sp2 = speed_2 * 10;
  int16_t sp3 = speed_3 * 10;
  int16_t sp4 = speed_4 * 10;

  CAN.beginPacket(MOTOR_DATA);

  CAN.write((uint8_t *)&sp1, sizeof(sp1));
  CAN.write((uint8_t *)&sp2, sizeof(sp2));
  CAN.write((uint8_t *)&sp3, sizeof(sp3));
  CAN.write((uint8_t *)&sp4, sizeof(sp4));

  CAN.endPacket();
}

// ================= I2C =================
// Agora repassa PWM (int16_t) em vez de target_speed (float) pro slave.

void sendCommandWire() {
  Wire.beginTransmission(8);
  Wire.write((uint8_t *)&target_pwm, sizeof(target_pwm));
  Wire.write((uint8_t *)&steering_angle, sizeof(steering_angle));
  Wire.write((uint8_t *)&reverse, sizeof(reverse));
  Wire.write((uint8_t *)&stop_car, sizeof(stop_car));

  byte error = Wire.endTransmission();

  if (error != 0) {
    Serial.print("I2C error: ");
    Serial.println(error);
  }
}

void requestWireData() {
  speed_1 = encoder1.get_speed();
  speed_2 = encoder2.get_speed();

  Wire.requestFrom(8, 8);

  if (Wire.available() >= 8) {
    Wire.readBytes((uint8_t *)&speed_3, sizeof(speed_3));
    Wire.readBytes((uint8_t *)&speed_4, sizeof(speed_4));
  }
}
