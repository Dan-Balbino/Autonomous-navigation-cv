#include "Encoder.h"

Encoder* encoder1_instance = nullptr;
Encoder* encoder2_instance = nullptr;

void encoder1ISR() {
    if (encoder1_instance != nullptr) {
        encoder1_instance->handle_pulse();
    }
}

void encoder2ISR() {
    if (encoder2_instance != nullptr) {
        encoder2_instance->handle_pulse();
    }
}

Encoder::Encoder(int int_pin, float wheel_circumference, int pulses_per_rotation, float alpha) {
    encoder_pin = int_pin;
    circumference = wheel_circumference;
    pulses_per_rot = pulses_per_rotation;

    last_pulse_time = 0;
    pulse_period = 0;
    new_pulse = false;

    buffer_index = 0;
    buffer_count = 0;
    for (uint8_t i = 0; i < AVG_SAMPLES; i++) period_buffer[i] = 0;

    new_speed = false;
    new_speed_dt = 0.0;
    speed = 0.0;

    filter_alpha = alpha;
    first_speed = true;
}

void Encoder::begin() {
    pinMode(encoder_pin, INPUT_PULLUP);

    if (encoder_pin == 2) {
        encoder1_instance = this;
        attachInterrupt(digitalPinToInterrupt(2), encoder1ISR, FALLING);
    }
    else if (encoder_pin == 3) {
        encoder2_instance = this;
        attachInterrupt(digitalPinToInterrupt(3), encoder2ISR, FALLING);
    }
}

void Encoder::handle_pulse() {
    unsigned long now = micros();

    if (last_pulse_time == 0) {
        last_pulse_time = now;
        return;
    }

    unsigned long dt = now - last_pulse_time;

    // Debounce: ignora pulsos mais rapidos que 3000 us
    if (dt < 3000) {
        return;
    }

    pulse_period = dt;
    last_pulse_time = now;

    // Guarda no buffer circular para a media movel
    period_buffer[buffer_index] = dt;
    buffer_index = (buffer_index + 1) % AVG_SAMPLES;
    if (buffer_count < AVG_SAMPLES) buffer_count++;

    new_pulse = true;
}

unsigned long Encoder::get_avg_period() {
    unsigned long sum = 0;
    for (uint8_t i = 0; i < buffer_count; i++) {
        sum += period_buffer[i];
    }
    return sum / buffer_count;
}

void Encoder::update() {
    bool has_new_pulse;
    unsigned long avg_period;
    unsigned long last_pulse;

    noInterrupts();
    has_new_pulse = new_pulse;
    new_pulse = false;
    last_pulse = last_pulse_time;
    avg_period = (buffer_count > 0) ? get_avg_period() : 0;
    interrupts();

    if (has_new_pulse && avg_period > 0) {
        // Usa o periodo MEDIO em vez do periodo do ultimo pulso isolado.
        // Isso cancela o padrao curto/longo do espacamento desigual dos imas:
        // um pulso curto seguido de um longo tendem a se compensar na media.
        float time_seconds = avg_period / 1000000.0;
        float distance_per_pulse = circumference / pulses_per_rot;
        float new_speed_value = distance_per_pulse / time_seconds;

        if (first_speed) {
            speed = new_speed_value;
            first_speed = false;
        }
        else {
            speed = (filter_alpha * new_speed_value) + ((1.0 - filter_alpha) * speed);
        }

        new_speed_dt = time_seconds;
        new_speed = true;
    }

    // Timeout de parada real (inalterado)
    const unsigned long STOP_TIMEOUT_US = 600000UL;

    if (last_pulse != 0 && micros() - last_pulse > STOP_TIMEOUT_US) {
        speed = 0.0;
        first_speed = true;
        buffer_count = 0;
        buffer_index = 0;

        new_speed_dt = 0.0;
        new_speed = true;
        last_pulse_time = 0;
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