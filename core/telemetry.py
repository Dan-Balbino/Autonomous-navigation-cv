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
        if not isinstance(data, dict):
            raise TypeError("A telemetria deve ser um objeto JSON")

        ultrasonic = data.get("ultrassonic", data.get("ultrasonic", {}))
        if not isinstance(ultrasonic, dict):
            ultrasonic = {}

        can = data.get("can", {})
        if not isinstance(can, dict):
            can = {}

        return cls(
            speed=float(data.get("spd", data.get("speed", 0))),
            battery=int(data.get("bat", data.get("battery", 0))),
            front=int(ultrasonic.get("front", 0)),
            left=int(ultrasonic.get("left", 0)),
            right=int(ultrasonic.get("right", 0)),
            can=dict(can),
        )