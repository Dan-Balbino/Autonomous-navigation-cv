#include "PID.h"

PID::PID(float Kp, float Ki, float Kd, float integral_limit, float output_limit) {
  _Kp = Kp;
  _Ki = Ki;
  _Kd = Kd;
  _integral_limit = integral_limit;
  _output_limit = output_limit;
  _integral = 0.0f;
  _previous_error = 0.0f;
}

void PID::setValues(float Kp, float Ki, float Kd) {
  _Kp = Kp;
  _Ki = Ki;
  _Kd = Kd;
}

float PID::update(float error, float dt) {
  float p = _Kp * error;
  _integral = _integral + (_Ki * error * dt);

  if (_integral_limit >= 0.0f) {
    if (_integral > _integral_limit) _integral = _integral_limit;
    if (_integral < -_integral_limit) _integral = -_integral_limit;
  }

  float d = ((error - _previous_error) * _Kd) / dt;

  float output = p + _integral + d;

  if (_output_limit >= 0.0f) {
    if (output > _output_limit) output = _output_limit;
    if (output < -_output_limit) output = -_output_limit;
  }

  _previous_error = error;

  return output;
}

void PID::reset() {
  _integral = 0.0f;
  _previous_error = 0.0f;
}