#include <CAN.h>
#include <Wire.h>

#include "PID.h"
#include "Encoder.h"
#include "HBridgeController.h"
#include "Config.h"

#define MOTOR_COMMAND 0x100
#define MOTOR_DATA    0x110

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

// ================= VALORES DE TUNAGEM DO PID =================

float kp = 30.0;
float ki = 2.25;
float kd = 0.3;

PID pid1(kp, ki, kd, INTEGRAL_LIMIT, OUTPUT_LIMIT);
PID pid2(kp, ki, kd, INTEGRAL_LIMIT, OUTPUT_LIMIT);

float pid_output_1 = 0.0;
float pid_output_2 = 0.0;

int pwm_1 = 0;
int pwm_2 = 0;

// ================= FLASG DE CONTROLE DO SISTEMA =================

bool motor_enabled = false;
bool startup_active = false;

unsigned long startup_time = 0;

float target_speed = 0.0;
int16_t steering_angle = 0;
float target_side_speed = 0.0;


// -----------------------------------------------------------------
float speed_1, speed_2, speed_3, speed_4;

unsigned long last_send = 0;

// ================= SETUP DO SISTEMA =================

void setup() {
  Serial.begin(115200);
  
  // Inicia o motor e o encoder da roda dianteira
  motor1.begin();
  encoder1.begin();

  // Inicia o motor e o encoder da roda traseira
  motor2.begin();
  encoder2.begin();

  // Aplica 0 PWM aos motores
  motor1.move(0);
  motor2.move(0);

  // Inicia o módulo CAN
  if (!CAN.begin(500E3)) {
    Serial.println("Falha ao iniciar a CAN!");
    while (1);
  }

  // Inicía a comunicação I2C como mestre
  Wire.begin();
}

// ================= LOOP DO SISTEMA =================

void loop() {
  // Se um novo dado for recebido pela CAN,
  // imaediatamente envia ele pela comunicação I2C
  bool new_command = receiveCANData();
  if (new_command) {
    sendCommandWire();
  }
  
  // Atualiza os dados lidos pelos encoders
  encoder1.update();
  encoder2.update();

  // Processa e aplcia a velocidade
  if (new_command && target_speed > 0.0 && !motor_enabled) {
    motor_enabled = true;
    startup_active = true;
    startup_time = millis();

    pid1.reset();
    pid_output_1 = 0.0;
    pwm_1 = STARTUP_PWM;

    pid2.reset();
    pid_output_2 = 0.0;
    pwm_2 = STARTUP_PWM;

    motor1.move(STARTUP_PWM);
    motor2.move(STARTUP_PWM);

    Serial.println("Partida iniciada pela CAN.");
  }

  if (new_command && target_speed <= 0.0 && motor_enabled) {
    smoothStop();
  }

  if (!motor_enabled) {
    motor1.move(0);
    motor2.move(0);
    return;
  }

  if (startup_active) {
    motor1.move(STARTUP_PWM);
    motor2.move(STARTUP_PWM);

    if (millis() - startup_time >= STARTUP_TIME) {
        startup_active = false;

        pid1.reset();
        pid_output_1 = 0.0;
        pwm_1 = STARTUP_PWM;

        pid2.reset();
        pid_output_2 = 0.0;
        pwm_2 = STARTUP_PWM;

        Serial.println("Partida concluida. PID ativado.");
    }
    return;
  }

  float measurement_dt_1 = 0.0;
  float measurement_dt_2 = 0.0;

  bool new_speed_1 = encoder1.consume_new_speed(measurement_dt_1);
  bool new_speed_2 = encoder2.consume_new_speed(measurement_dt_2);

  if (new_speed_1 || new_speed_2) {
      run_pid(new_speed_1, measurement_dt_1, new_speed_2, measurement_dt_2);
  }

  // Envia os dados pela CAN a cada 100ms
  if (millis() - last_send >= 100) {
    last_send = millis();
    requestWireData();
    sendCANData();
  }
}


// ================= CONTROLE PID =================

void run_pid(bool new_speed_1, float measurement_dt_1, bool new_speed_2, float measurement_dt_2) {
    target_side_speed = calculate_side_speed();

    if (new_speed_1 && measurement_dt_1 > 0.0) {
        float current_speed_1 = encoder1.get_speed();
        float error_1 = target_side_speed - current_speed_1;

        if (abs(error_1) < ERROR_DEADBAND) {
            error_1 = 0.0;
        }

        pid_output_1 = pid1.update(error_1, measurement_dt_1);

        int target_pwm_1 = round(pid_output_1);

        if (abs(target_pwm_1 - pwm_1) > PWM_DEADBAND) {
            int pwm_difference_1 = target_pwm_1 - pwm_1;
            pwm_difference_1 = constrain(pwm_difference_1, -MAX_PWM_CHANGE, MAX_PWM_CHANGE);
            pwm_1 += pwm_difference_1;
        }

        pwm_1 = constrain(pwm_1, -OUTPUT_LIMIT, OUTPUT_LIMIT);
        motor1.move(pwm_1);
    }

    if (new_speed_2 && measurement_dt_2 > 0.0) {
        float current_speed_2 = encoder2.get_speed();
        float error_2 = target_side_speed - current_speed_2;

        if (abs(error_2) < ERROR_DEADBAND) {
            error_2 = 0.0;
        }

        pid_output_2 = pid2.update(error_2, measurement_dt_2);

        int target_pwm_2 = round(pid_output_2);

        if (abs(target_pwm_2 - pwm_2) > PWM_DEADBAND) {
            int pwm_difference_2 = target_pwm_2 - pwm_2;
            pwm_difference_2 = constrain(pwm_difference_2, -MAX_PWM_CHANGE, MAX_PWM_CHANGE);
            pwm_2 += pwm_difference_2;
        }

        pwm_2 = constrain(pwm_2, -OUTPUT_LIMIT, OUTPUT_LIMIT);
        motor2.move(pwm_2);
    }
}

// ================= CÁLCULO DA VELOCIDADE NO LADO =================

float calculate_side_speed() {
    if (steering_angle == 0) {
        return round(target_speed * 10.0) / 10.0;
    }

    float angle_rad = steering_angle * PI / 180.0;
    float radius = WHEEL_BASE / tan(abs(angle_rad));
    float inner_radius = radius - (TRACK_WIDTH / 2.0);
    float outer_radius = radius + (TRACK_WIDTH / 2.0);

    inner_radius = max(inner_radius, 0.0);

    float inner_speed = target_speed * (inner_radius / radius);
    float outer_speed = target_speed * (outer_radius / radius);

    float side_speed;

    if (SIDE == SIDE_LEFT) {
        if (steering_angle > 0) {
            side_speed = outer_speed;
        } else {
            side_speed = inner_speed;
        }
    } else {
        if (steering_angle > 0) {
            side_speed = inner_speed;
        } else {
            side_speed = outer_speed;
        }
    }

    if (side_speed < 1.0) {
        side_speed = 1.0;
    }

    return round(side_speed * 10.0) / 10.0;
}

// ================= PARADA SUAVE =================

void smoothStop() {
    int start_pwm_1 = pwm_1;
    int start_pwm_2 = pwm_2;

    startup_active = false;

    for (int step = 100; step >= 0; step--) {
        pwm_1 = round(start_pwm_1 * (step / 100.0));
        pwm_2 = round(start_pwm_2 * (step / 100.0));

        motor1.move(pwm_1);
        motor2.move(pwm_2);

        delay(10);
    }

    pwm_1 = 0;
    pwm_2 = 0;

    motor1.move(0);
    motor2.move(0);

    motor_enabled = false;

    pid1.reset();
    pid_output_1 = 0.0;

    pid2.reset();
    pid_output_2 = 0.0;

    Serial.println("Motores parados suavemente.");
}

// ================= RECEBE OS DADOS VIA CAN =================

bool receiveCANData() {
  int packetSize = CAN.parsePacket();

  if (packetSize <= 0) {
      return false;
  }

  if (CAN.packetId() != MOTOR_COMMAND) {
      return false;
  }

  constexpr int MOTOR_COMMAND_SIZE = sizeof(float) + sizeof(int16_t);

  if (packetSize != MOTOR_COMMAND_SIZE) {
      Serial.println("Pacote CAN invalido.");
      return false;
  }

  float received_speed;
  int16_t received_angle;

  if (CAN.readBytes((uint8_t *)&received_speed, sizeof(received_speed)) != sizeof(received_speed) ||
      CAN.readBytes((uint8_t *)&received_angle, sizeof(received_angle)) != sizeof(received_angle)) {
    Serial.println("Leitura do comando CAN incompleta.");
    return false;
  }

  target_speed = received_speed;
  steering_angle = received_angle;

  return true;
}

// ================= ENVIA OS DADOS VIA CAN =================

void sendCANData() {
  int16_t sp1 = speed_1 * 10;
  int16_t sp2 = speed_2 * 10;
  int16_t sp3 = speed_3 * 10;
  int16_t sp4 = speed_4 * 10;

  CAN.beginPacket(MOTOR_DATA);

  CAN.write((uint8_t*)&sp1, sizeof(sp1));
  CAN.write((uint8_t*)&sp2, sizeof(sp2));
  CAN.write((uint8_t*)&sp3, sizeof(sp3));
  CAN.write((uint8_t*)&sp4, sizeof(sp4));

  CAN.endPacket();
}

// ================= ENVIA OS DADOS VIA I2C =================

void sendCommandWire() {
  Wire.beginTransmission(8);
  Wire.write((uint8_t *)&target_speed,sizeof(target_speed));
  Wire.write((uint8_t *)&steering_angle, sizeof(steering_angle));

  byte error = Wire.endTransmission();

  if (error != 0) {
    Serial.print("I2C error: ");
    Serial.println(error);
  }
}

// ================= RECEBE REQUISIÇÃO VIA I2C =================

void requestWireData() {
  speed_1 = encoder1.get_speed();
  speed_2 = encoder2.get_speed();

  Wire.requestFrom(8, 8);

  if (Wire.available() >= 8) {
    Wire.readBytes((uint8_t *)&speed_3, sizeof(speed_3));
    Wire.readBytes((uint8_t *)&speed_4, sizeof(speed_4));
  }
}
