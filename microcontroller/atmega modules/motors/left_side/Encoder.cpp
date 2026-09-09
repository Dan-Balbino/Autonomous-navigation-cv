#include "Encoder.h"
#include <PinChangeInterrupt.h>

// Definição dos membros estáticos
Encoder* Encoder::instances[Encoder::MAX_ENCODERS] = { nullptr };
uint8_t Encoder::instance_count = 0;

// Trampolins fixos: cada um "conhece" seu índice em tempo de compilação,
// já que attachPCINT só aceita callbacks do tipo void(*)(void), sem parâmetro.
template <uint8_t N>
void encoderTrampoline() {
  if (Encoder::instances[N] != nullptr) {
    Encoder::instances[N]->handle_pulse();
  }
}

// Constructor
Encoder::Encoder(int int_pin, float wheel_circumference, int pulses_per_rotation, float alpha) {
  encoder_pin = int_pin;
  circumference = wheel_circumference;
  pulses_per_rot = pulses_per_rotation;

  last_pulse_time = 0;
  pulse_period = 0;
  new_pulse = false;

  new_speed = false;
  new_speed_dt = 0.0;
  speed = 0.0;

  filter_alpha = alpha;
  first_speed = true;
}

void Encoder::begin() {
  pinMode(encoder_pin, INPUT_PULLUP);

  if (instance_count >= MAX_ENCODERS) {
    // Sem slot livre — aumente MAX_ENCODERS no .h se precisar de mais
    return;
  }

  uint8_t slot = instance_count++;
  instances[slot] = this;

  byte pcintNum = digitalPinToPCINT(encoder_pin);
  if (pcintNum == NOT_AN_INTERRUPT) {
    // Este pino não suporta PCINT nesta placa
    return;
  }

  switch (slot) {
    case 0: attachPCINT(pcintNum, encoderTrampoline<0>, FALLING); break;
    case 1: attachPCINT(pcintNum, encoderTrampoline<1>, FALLING); break;
    case 2: attachPCINT(pcintNum, encoderTrampoline<2>, FALLING); break;
    case 3: attachPCINT(pcintNum, encoderTrampoline<3>, FALLING); break;
    // Se aumentar MAX_ENCODERS, adicione mais cases aqui
  }
}

void Encoder::handle_pulse() {
  unsigned long now = micros();

  if (last_pulse_time == 0) {
    last_pulse_time = now;
    return;
  }

  unsigned long dt = now - last_pulse_time;

  // Debounce: ignora pulsos mais rápidos que 3000µs (ruído)
  if (dt < 3000) {
    return;
  }

  pulse_period = dt;
  last_pulse_time = now;
  new_pulse = true;
}

void Encoder::update() {
  unsigned long period;
  unsigned long last_pulse;
  bool has_new_pulse;

  noInterrupts();
  period = pulse_period;
  last_pulse = last_pulse_time;
  has_new_pulse = new_pulse;
  new_pulse = false;
  interrupts();

  if (has_new_pulse && period > 0) {
    float time_seconds = period / 1000000.0;
    float distance_per_pulse = circumference / pulses_per_rot;
    float new_speed_value = distance_per_pulse / time_seconds;

    if (first_speed) {
      speed = new_speed_value;
      first_speed = false;
    } else {
      speed = (filter_alpha * new_speed_value) + ((1.0 - filter_alpha) * speed);
    }

    noInterrupts();
    new_speed_dt = time_seconds;
    new_speed = true;
    interrupts();
  }

  // Timeout: sem pulsos por 300ms, assume parado
  if (last_pulse != 0 && micros() - last_pulse > 300000) {
    speed = 0.0;
    first_speed = true;

    noInterrupts();
    new_speed_dt = 0.0;
    new_speed = true;
    interrupts();
  }
}

float Encoder::get_speed() {
  return speed;
}

bool Encoder::consume_new_speed(float& measurement_dt) {
  bool has_new_speed;

  noInterrupts();
  has_new_speed = new_speed;
  measurement_dt = new_speed_dt;
  new_speed = false;
  interrupts();

  return has_new_speed;
}