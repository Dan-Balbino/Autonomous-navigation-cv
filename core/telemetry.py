from dataclasses import dataclass, field

@dataclass
class CarTelemetry:
    speed: float = 0.0
    battery: int = 0

    front: int = 0
    left: int = 0
    right: int = 0

    can: dict = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data):
        ultrasonic = data.get("ultrassonics", {})
        return cls(
            speed=float(data.get("spd", 0)),
            battery=int(data.get("bat", 0)),
            front=int(ultrasonic.get("front", 0)),
            left=int(ultrasonic.get("left", 0)),
            right=int(ultrasonic.get("right", 0)),
            can=dict(data.get("can", {})),
        )