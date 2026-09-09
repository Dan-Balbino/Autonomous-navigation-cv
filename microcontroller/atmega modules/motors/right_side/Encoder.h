#ifndef ENCODER_H
#define ENCODER_H

#include <Arduino.h>

class Encoder {
public:
  Encoder(int int_pin, float wheel_circumference, int pulses_per_rotation, float alpha = 0.25);

  void begin();
  void update();
  float get_speed();
  bool consume_new_speed(float& measurement_dt);

  // Precisa ser público para o trampolim/ISR acessar
  void handle_pulse();

  static const uint8_t MAX_ENCODERS = 4; // ajuste para o número máximo de encoders que vai usar
  static Encoder* instances[MAX_ENCODERS];
  static uint8_t instance_count;

private:
  int encoder_pin;
  float circumference;
  int pulses_per_rot;

  volatile unsigned long last_pulse_time;
  volatile unsigned long pulse_period;
  volatile bool new_pulse;

  volatile bool new_speed;
  volatile float new_speed_dt;

  float speed;
  float filter_alpha;
  bool first_speed;
};

#endif