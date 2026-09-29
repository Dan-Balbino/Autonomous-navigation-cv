#ifndef ENCODER_H
#define ENCODER_H

#include <Arduino.h>

class Encoder {
public:
    Encoder(int int_pin, float wheel_circumference, int pulses_per_rotation, float alpha = 0.35);

    void begin();
    void update();
    float get_speed();
    bool consume_new_speed(float& measurement_dt); // mantido por compatibilidade
    void handle_pulse();

private:
    static const uint8_t AVG_SAMPLES = 4; // media dos ultimos N periodos, absorve o padrao curto/longo do ima

    int encoder_pin;
    float circumference;
    int pulses_per_rot;

    volatile unsigned long last_pulse_time;
    volatile unsigned long pulse_period;
    volatile bool new_pulse;

    volatile unsigned long period_buffer[AVG_SAMPLES];
    volatile uint8_t buffer_index;
    volatile uint8_t buffer_count;

    bool new_speed;
    float new_speed_dt;
    float speed;

    float filter_alpha;
    bool first_speed;

    unsigned long get_avg_period();
};

#endif