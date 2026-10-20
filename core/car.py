import threading

from .serial_protocol import SerialProtocol
from .command import CarCommand
from .telemetry import CarTelemetry

class Car:
    def __init__(self, port: str=None):
        self.COM = port
        self._serial_lock = threading.Lock()
        
        self.serial = SerialProtocol(self.COM)
        self.command = CarCommand()
        self.telemetry = CarTelemetry()

    def reconnect(self, port: str=None):
        with self._serial_lock:
            self.serial.close()
            self.COM = port
            self.serial = SerialProtocol(port)

    def close(self):
        with self._serial_lock:
            self.serial.close()
            
    def send_command(self):
        with self._serial_lock:
            self.serial.send_data(self.command)

    def receive(self):
        with self._serial_lock:
            return self.serial.receive_data()
