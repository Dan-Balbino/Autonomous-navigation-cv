#ifndef PID_H
#define PID_H

class PID {
public:
  PID(float Kp, float Ki, float Kd, float integral_limit = -1.0f, float output_limit = -1.0f);

  void setValues(float Kp, float Ki, float Kd);
  float update(float error, float dt = 0.1f);
  void reset();

private:
  float _Kp, _Ki, _Kd;
  float _integral_limit, _output_limit, _integral, _previous_error;
};

#endif