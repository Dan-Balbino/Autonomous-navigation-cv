import time
import serial
import json

class SerialProtocol:
    def __init__(self, port, baudrate=115200, timeout=0.1):
        self.ser = None

        if port is None:
            print("[SERIAL] Modo teste.")
            return

        try:
            self.ser = serial.Serial(port, baudrate, timeout=timeout)
            time.sleep(2)
            print(f"[SERIAL] Conectado à porta {port}")
        except serial.SerialException as e:
            print(f"[ERRO SERIAL] {e}")
            self.ser = None


    def close(self):
        if self.ser is None:
            return
        if self.ser and self.ser.is_open:
            self.ser.close()
            print("[SERIAL] Porta serial fechada.")


    def send_data(self, data):
        if self.ser is None:
            return
        message = json.dumps(data.to_dict())
        self.ser.write((message + "\n").encode())


    def receive_data(self):
        if self.ser is None:
            return
        if self.ser.in_waiting > 0:
            try:
                response = self.ser.readline().decode("utf-8").strip()
                if response:
                    return response
            except Exception as e:
                print("Erro ao ler:", e)