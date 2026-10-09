from dataclasses import dataclass, field

@dataclass
class CarTelemetry:
    speed: float = 0.0
    battery: int = 70
    battery_state: int = 0
    
    speed1: float = 0.0
    speed2: float = 0.0
    speed3: float = 0.0
    speed4: float = 0.0
    
    left: int = 0
    f_left: int = 0
    f_right: int = 0
    right: int = 0

    can: dict = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data):
        if not isinstance(data, dict):
            raise TypeError("A telemetria deve ser um objeto JSON")

        speed = data.get("speed", {})
        if not isinstance(speed, dict):
            speed = {}

        ultrasonic = data.get("ultrassonic", data.get("ultrasonic", {}))
        if not isinstance(ultrasonic, dict):
            ultrasonic = {}

        can = data.get("can", {})
        if not isinstance(can, dict):
            can = {}

        wheel_speeds = [
            float(speed.get("speed1", 0.0)),
            float(speed.get("speed2", 0.0)),
            float(speed.get("speed3", 0.0)),
            float(speed.get("speed4", 0.0)),
        ]

        return cls(
            speed=sum(wheel_speeds) / len(wheel_speeds),
            battery=int(data.get("bat", data.get("battery", 0))),
            battery_state=int(data.get("bat_state", data.get("battery_state", 0))),
            speed1=wheel_speeds[0],
            speed2=wheel_speeds[1],
            speed3=wheel_speeds[2],
            speed4=wheel_speeds[3],
            left=int(ultrasonic.get("f_left", 0)),
            f_left=int(ultrasonic.get("left", 0)),
            f_right=int(ultrasonic.get("f_right", 0)),
            right=int(ultrasonic.get("right", 0)),
            can=dict(can),
        )