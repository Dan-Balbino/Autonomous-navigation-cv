#include <Wire.h>
#include <Servo.h>

#include "PID.h"
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

// ================= PID TUNING VALUES =================

float kp = 30.0;
float ki = 2.25;
float kd = 0.3;

PID pid1(kp, ki, kd, INTEGRAL_LIMIT, OUTPUT_LIMIT);
PID pid2(kp, ki, kd, INTEGRAL_LIMIT, OUTPUT_LIMIT);

float pid_output_1 = 0.0;
float pid_output_2 = 0.0;

int pwm_1 = 0;
int pwm_2 = 0;

// ================= SYSTEM CONTROL FLAGS =================

bool motor_enabled = false;
bool startup_active = false;

unsigned long startup_time = 0;

float target_speed = 0.0;
int16_t steering_angle = 0;
float target_side_speed = 0.0;
volatile float received_target_speed = 0.0;
volatile int16_t received_steering_angle = 0;

// ================= SERVO =================
Servo myservo;

const int SERVO_PIN = 11;

float angle_target = 90.0;
float angle = 90.0;

unsigned long lastUpdate = 0;





float speed_3;
float speed_4;

void setup() {
  Serial.begin(9600);  

  Wire.begin(8);
  Wire.onReceive(onReceive);
  Wire.onRequest(sendData);

  myservo.attach(SERVO_PIN);
  myservo.write(90);

  motor1.begin();
  encoder1.begin();

  motor2.begin();
  encoder2.begin();

  Serial.println("Módulo iniciado");
}


void loop() {
    noInterrupts();
    target_speed = received_target_speed;
    steering_angle = received_steering_angle;
    interrupts();
    angle_target = steering_angle + 90;

    taskServo();

    encoder1.update();
    encoder2.update();

    if (target_speed > 0.0 && !motor_enabled) {
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

    if (target_speed <= 0.0 && motor_enabled) {
        smooth_stop();
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
}


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

// ================= SIDE SPEED CALCULATION =================

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

    if (side_speed < 1.5) {
        side_speed = 1.5;
    }

    return round(side_speed * 10.0) / 10.0;
}

// ================= SMOOTH STOP =================

void smooth_stop() {
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
}

void onReceive(int packetSize) {
    constexpr int MOTOR_COMMAND_SIZE = sizeof(float) + sizeof(int16_t);

    if (packetSize == MOTOR_COMMAND_SIZE) {
        float received_speed;
        int16_t received_angle;

        if (Wire.readBytes((uint8_t *)&received_speed, sizeof(received_speed)) == sizeof(received_speed) &&
                Wire.readBytes((uint8_t *)&received_angle, sizeof(received_angle)) == sizeof(received_angle)) {
            received_target_speed = received_speed;
            received_steering_angle = received_angle;
        }
  }

}


void sendData() {
  speed_3 = encoder1.get_speed();
  speed_4 = encoder2.get_speed();

  Wire.write((uint8_t *)&speed_3, sizeof(speed_3));
  Wire.write((uint8_t *)&speed_4, sizeof(speed_4));
}

// =====================================================
// SERVO
// =====================================================

void taskServo() {

  unsigned long now = millis();
  Serial.println(angle_target);

  if (now - lastUpdate < 1) {

    return;
  }

  lastUpdate = now;

  if (abs(angle - angle_target) < 0.5) {

    return;
  }

  angle += (angle < angle_target) ? 1 : -1;

  angle = constrain(angle, 0, 180);

  if (abs(angle - angle_target) < 1) {

    angle = angle_target;
  }

  myservo.write((int)angle);
}