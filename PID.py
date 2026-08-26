class PID:
    def __init__(self, Kp, Ki, Kd, output_limit=None):
        self.Kp = Kp
        self.Ki = Ki
        self.Kd = Kd
        self.output_limit = output_limit       # ex: 30.0 (graus máx de esterçamento)
        self.integral = 0
        self.previous_error = 0

    def setValues(self, Kp, Ki, Kd):
        self.Kp = Kp
        self.Ki = Ki
        self.Kd = Kd

    def update(self, error, dt=0.1):
        p = self.Kp * error
        self.integral = self.integral + ((self.Ki * error) * dt)
        d = ((error - self.previous_error) * self.Kd) / dt

        output = p + self.integral + d

        if self.output_limit is not None:
            output = max(min(output, self.output_limit), -self.output_limit)

        self.previous_error = error

        return output
    
    def reset(self):
        self.integral = 0
        self.previous_error = 0