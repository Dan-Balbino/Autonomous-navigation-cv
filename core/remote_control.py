import pygame

class RemoteControl:
    def __init__(self):
        pygame.init()
        pygame.joystick.init()
        self.joystick_name = ""
        self.connected = False
        self.joystick = None
        self.feedback = "Controle desconectado"


    def connect(self):
        if pygame.joystick.get_count() == 0:
            self.feedback = "Nenhum controle encontrado"
            self.connected = False
        else:
            self.joystick = pygame.joystick.Joystick(0)
            self.joystick_name = self.joystick.get_name()
            self.joystick.init()
            self.connected = True
            self.feedback = "Controle conectado: " + self.joystick_name


    def map_value(self, x, in_min, in_max, out_min, out_max):
        return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min      

    
    def read_inputs(self):
        if not self.connected:
            return None

        pygame.event.pump()  # atualiza o estado interno do joystick

        start_button = self.joystick.get_button(7)  # botão de start
        
        left_joystick_x = round(self.joystick.get_axis(0), 1)  # eixo X do joystick esquerdo
    
        right_trigger = round(self.map_value(self.joystick.get_axis(5), -1, 1, 0, 1), 1)    # gatilho direito
        left_trigger = round(self.map_value(self.joystick.get_axis(4), -1, 1, 0, 1), 1)  # gatilho esquerdo

        right_button = self.joystick.get_button(5)  # botão direito
        left_button = self.joystick.get_button(4)  # botão esquerdo
        
        return start_button, left_joystick_x, right_trigger, left_trigger, right_button, left_button


    def disconnect(self):
        if self.connected:
            self.joystick.quit()
            self.connected = False
            self.feedback = "Controle desconectado"


if __name__ == "__main__":
    rc = RemoteControl()
    rc.connect()
    print(rc.feedback)

    if rc.connected:
        clock = pygame.time.Clock()
        while True:
            data = rc.read_inputs()
            print(f"Start Button: {data[0]}, Left Joystick X: {data[1]}, Right Trigger: {data[2]}, Left Trigger: {data[3]}, Right Button: {data[4]}, Left Button: {data[5]}")
            clock.tick(20)