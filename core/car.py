from .serial_protocol import SerialProtocol
from .command import CarCommand
from .telemetry import CarTelemetry

class Car:
    def __init__(self, port: str=None):
        self.COM = port
        
        self.serial = SerialProtocol(self.COM)
        self.command = CarCommand()
        self.telemetry = CarTelemetry()
            
    def send_command(self):
        self.serial.send_data(self.command)

    def receive(self):
        return self.serial.receive_data()
