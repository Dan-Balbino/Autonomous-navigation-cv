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
  // Piso de seguranca: nunca deixa o dt ser tao pequeno a ponto
  // do termo derivativo explodir por causa de um pulso "curto"
  // do encoder (espacamento desigual dos imas).
  if (dt < MIN_DT) {
    dt = MIN_DT;
  }

  // Se o erro trocou de sinal de forma brusca (ex.: estava bem positivo
  // e virou bem negativo de um ciclo pro outro), é muito mais provavel
  // ser ruido de leitura do que uma mudanca real de velocidade da roda.
  // Nesse caso, descarta parte da "memoria" acumulada em vez de deixar
  // ela reagir ao pico.
  bool suspicious_flip =
      (_previous_error > 0.0f && error < 0.0f) ||
      (_previous_error < 0.0f && error > 0.0f);

  float error_jump = error - _previous_error;
  const float SUSPICIOUS_JUMP_THRESHOLD = 40.0f; // ajuste conforme a faixa tipica de erro do seu sistema

  if (suspicious_flip && abs(error_jump) > SUSPICIOUS_JUMP_THRESHOLD) {
    _integral *= 0.3f; // desconta 70% da "divida" acumulada de uma vez
  }

  float p = _Kp * error;

  float d = ((error - _previous_error) * _Kd) / dt;

  // Calcula a saida ANTES de decidir se acumula integral,
  // pra saber se ja estamos saturados.
  float output_unclamped = p + _integral + d;

  float output = output_unclamped;
  bool saturated = false;

  if (_output_limit >= 0.0f) {
    if (output > _output_limit) {
      output = _output_limit;
      saturated = true;
    }
    if (output < -_output_limit) {
      output = -_output_limit;
      saturated = true;
    }
  }

  // Anti-windup: so acumula integral se NAO estivermos saturados,
  // ou se a saturacao ja estiver "ajudando" a reduzir o erro
  // (ou seja, o integral so anda na direcao que tira a saida da saturacao).
  bool integral_would_help =
      (output_unclamped > _output_limit && error < 0.0f) ||
      (output_unclamped < -_output_limit && error > 0.0f);

  if (!saturated || integral_would_help) {
    _integral = _integral + (_Ki * error * dt);

    if (_integral_limit >= 0.0f) {
      if (_integral > _integral_limit) _integral = _integral_limit;
      if (_integral < -_integral_limit) _integral = -_integral_limit;
    }
  }

  _previous_error = error;

  return output;
}

void PID::reset() {
  _integral = 0.0f;
  _previous_error = 0.0f;
}