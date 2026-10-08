#include <Wire.h>
#include <ServoTimer2Plus.h>

#include "Encoder.h"
#include "HBridgeController.h"
#include "Config.h"

// ================= HARDWARE PINOUT =================

// --- Front Wheel Hardware ---
const uint8_t ENCODER_1_PIN = 2;
const uint8_t RPWM_1 = 5;
const uint8_t LPWM_1 = 6;

Encoder encoder1(ENCODER_1_PIN, CIRCUMFERENCE, PULSES_PER_ROT);
HBridgeController motor1(RPWM_1, LPWM_1);

// --- Rear Wheel Hardware ---
const uint8_t ENCODER_2_PIN = 3;
const uint8_t RPWM_2 = 9;
const uint8_t LPWM_2 = 10;

Encoder encoder2(ENCODER_2_PIN, CIRCUMFERENCE, PULSES_PER_ROT);
HBridgeController motor2(RPWM_2, LPWM_2);

// ================= SYSTEM CONTROL FLAGS =================

bool motor_enabled = false;
bool accelerating_active = false;
bool stopping_active = false;
bool reverse = false;

int16_t target_pwm = 0;
int16_t steering_angle = 0;

int pwm_1 = 0;
int pwm_2 = 0;

volatile int16_t received_target_pwm = 0;
volatile int16_t received_steering_angle = 0;
volatile bool received_reverse = false;
volatile bool received_stop_car = false;
volatile unsigned long last_command_received = 0;
const unsigned long COMMAND_TIMEOUT_MS = 1500;

// ================= SERVO =================

ServoTimer2Plus myservo;

const int SERVO_PIN = 11;

int angle_target = 90;
int angle = 90;

unsigned long last_servo_update = 0;
const unsigned long SERVO_STEP_INTERVAL_MS = 2;

// ================= SMOOTH ACCEL STATE (non-blocking) =================

int accel_step = 0;
unsigned long last_accel_step_time = 0;
const unsigned long ACCEL_STEP_INTERVAL_MS = 10; // 100 steps x 10ms = 1s

// ================= SMOOTH STOP STATE (non-blocking) =================

int stop_start_pwm_1 = 0;
int stop_start_pwm_2 = 0;
int stop_step = 0;
unsigned long last_stop_step_time = 0;
const unsigned long STOP_STEP_INTERVAL_MS = 10;

// ================= RATIO LIMITS =================
float max_ratio = 1.0 + DIFFERENTIAL_LIMIT;
float min_ratio = 1.0 - DIFFERENTIAL_LIMIT;

// ================= TELEMETRY =================

float speed_3 = 0.0;
float speed_4 = 0.0;

// ================= SETUP =================

void setup() {
  Serial.begin(9600); // matches master baudrate

  Wire.begin(8);
  Wire.onReceive(onReceive);
  Wire.onRequest(sendData);

  myservo.attach(SERVO_PIN);
  myservo.write(angle);

  motor1.begin();
  encoder1.begin();

  motor2.begin();
  encoder2.begin();

  Serial.println("Modulo iniciado");
}

// ================= LOOP =================

void loop() {
  noInterrupts();
  target_pwm = received_target_pwm;
  steering_angle = received_steering_angle;
  reverse = received_reverse;
  bool stop_car = received_stop_car;
  interrupts();

  if (stop_car) {
    target_pwm = 0;
    reverse = false;
    if (motor_enabled && !stopping_active) {
      beginSmoothStop();
    }
  }

  angle_target = steering_angle + 90;

  taskServo();

  encoder1.update();
  encoder2.update();

  unsigned long command_age;
  noInterrupts();
  command_age = millis() - last_command_received;
  interrupts();

  if (last_command_received != 0 && command_age > COMMAND_TIMEOUT_MS) {
    noInterrupts();
    received_target_pwm = 0;
    received_steering_angle = 0;
    received_reverse = false;
    interrupts();

    target_pwm = 0;
    steering_angle = 0;
    reverse = false;
  }

  if (reverse && !stop_car) {
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

  if (target_pwm > 0 && !motor_enabled) {
    startMotors();
  }

  if (target_pwm <= 0 && motor_enabled) {
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

  applyTargetPwm();
}

// ================= ACCEL START HELPER =================

void startMotors() {
  motor_enabled = true;
  accelerating_active = true;
  accel_step = 0;
  last_accel_step_time = millis();

  Serial.println("Partida iniciada.");
}

// ================= DIRECT PWM CONTROL =================
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

  //return constrain(ratio, min_ratio, max_ratio);
  return 1.0;
}

void applyTargetPwm() {
  float ratio = calculate_side_pwm_ratio();

  int side_pwm = round(target_pwm * ratio);
  side_pwm = constrain(side_pwm, 0, OUTPUT_LIMIT);

  //pwm_1 = side_pwm;
  //pwm_2 = side_pwm;

  pwm_1 = target_pwm;
  pwm_2 = target_pwm;

  motor1.move(side_pwm);
  motor2.move(side_pwm);
}

// ================= SMOOTH ACCEL (non-blocking) =================
// Rampa de 1s (100 passos x 10ms). Usa target_pwm a cada passo, entao
// se o master atualizar o comando via I2C durante a rampa, o alvo
// acompanha em tempo real em vez de ficar preso ao valor do inicio.

void taskSmoothAccel() {
  if (millis() - last_accel_step_time < ACCEL_STEP_INTERVAL_MS) {
    return;
  }

  last_accel_step_time = millis();
  accel_step++;

  float ratio = calculate_side_pwm_ratio();
  float ramp_fraction = min(accel_step / 100.0, 1.0);
  int ramped_base = round(target_pwm * ramp_fraction);

  int side_pwm = constrain((int)round(ramped_base * ratio), 0, OUTPUT_LIMIT);

  //pwm_1 = side_pwm;
  //pwm_2 = side_pwm;

  pwm_1 = target_pwm;
  pwm_2 = target_pwm;

  motor1.move(side_pwm);
  motor2.move(side_pwm);

  if (accel_step >= 100) {
    accelerating_active = false;
    Serial.println("Aceleracao concluida. Controle direto por PWM ativado.");
  }
}

// ================= SMOOTH STOP (non-blocking) =================
// Was a blocking for-loop with delay(10) x 101 (~1s), which stalled this
// I2C slave and could leave a transaction with the master half-finished.
// Now it's driven from loop() one step at a time.

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

// ================= I2C =================

void onReceive(int packetSize) {
  constexpr int MOTOR_COMMAND_SIZE = sizeof(int16_t) + sizeof(int16_t) + sizeof(bool) + sizeof(bool);

  if (packetSize != MOTOR_COMMAND_SIZE) {
    return;
  }

  int16_t received_pwm;
  int16_t received_angle;
  bool received_reverse_cmd;
  bool received_stop_cmd;

  if (Wire.readBytes((uint8_t *)&received_pwm, sizeof(received_pwm)) == sizeof(received_pwm) &&
      Wire.readBytes((uint8_t *)&received_angle, sizeof(received_angle)) == sizeof(received_angle) &&
      Wire.readBytes((uint8_t *)&received_reverse_cmd, sizeof(received_reverse_cmd)) == sizeof(received_reverse_cmd) &&
      Wire.readBytes((uint8_t *)&received_stop_cmd, sizeof(received_stop_cmd)) == sizeof(received_stop_cmd)) {
    received_stop_car = received_stop_cmd;
    received_target_pwm = received_stop_cmd ? 0 : constrain(received_pwm, 0, 255);
    if (received_target_pwm < 30) {
      received_target_pwm = 0;
    }
    received_steering_angle = received_angle;
    received_reverse = received_stop_cmd ? false : received_reverse_cmd;
    last_command_received = millis();
  }
}

void sendData() {
  speed_3 = encoder1.get_speed();
  speed_4 = encoder2.get_speed();

  Wire.write((uint8_t *)&speed_3, sizeof(speed_3));
  Wire.write((uint8_t *)&speed_4, sizeof(speed_4));
}

// ================= SERVO =================

void taskServo() {
  unsigned long now = millis();

  if (now - last_servo_update < SERVO_STEP_INTERVAL_MS) {
    return;
  }
  last_servo_update = now;

  if (angle == angle_target) {
    return;
  }

  angle += (angle < angle_target) ? 1 : -1;
  angle = constrain(angle, 0, 180);

  myservo.write(angle);
}
