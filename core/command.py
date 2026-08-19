from dataclasses import dataclass

@dataclass
class CarCommand:
    traffic_light: int = 0
    lights: int = 0
    stop: bool = False
    servo: int = 90
    pwm: int = 0
    
    def to_dict(self):
        return {
            "tl": self.traffic_light,
            "lights": self.lights,
            "stop": self.stop,
            "servo": self.servo,
            "pwm": self.pwm
        }