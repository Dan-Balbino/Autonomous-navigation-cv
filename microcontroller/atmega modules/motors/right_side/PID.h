#ifndef PID_H
#define PID_H

#include <stdlib.h>

class PID {
public:
    PID(float Kp, float Ki, float Kd, float integral_limit, float output_limit);

    void setValues(float Kp, float Ki, float Kd);
    float update(float error, float dt);
    void reset();

private:
    float _Kp, _Ki, _Kd;
    float _integral_limit;
    float _output_limit;
    float _integral;
    float _previous_error;

    static constexpr float MIN_DT = 0.001f; // 1ms — piso de seguranca pro derivativo, evita pico quando dt vem quase zero
};

#endif