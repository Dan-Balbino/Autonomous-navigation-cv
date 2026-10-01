from dataclasses import dataclass

@dataclass
class CarCommand:
    run: bool = False
    lights: int = 0
    stop: bool = False
    servo: int = 90
    speed: int = 0
    reverse: bool = False
    
    def to_dict(self):
        return {
            "run": self.run,
            "lights": self.lights,
            "stop": self.stop,
            "servo": self.servo,
            "speed": self.speed,
            "reverse": self.reverse
        }