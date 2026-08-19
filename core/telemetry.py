from dataclasses import dataclass

@dataclass
class CarTelemetry:
    speed: float = 0
    battery: int = 100

    front: int = 0
    left: int = 0
    right: int = 0

    can = {}

    @classmethod
    def from_dict(cls, data):

        return cls(
            speed=data["spd"],
            battery=data["bat"],
            front=data["ultrasonic"]["front"],
            left=data["ultrasonic"]["left"],
            right=data["ultrasonic"]["right"],
            can=data["can"]
        )