import time

lane_guide_map = {
    "A": ["right"],
    "B": ["left", "right"],
    "C": ["left", "left"]
}

# Tempo (s) sem ver a placa pra considerar que ela "acabou" e a próxima detecção é outra placa.
# Tem que ser MAIOR que o maior buraco de detecção da mesma placa
# e MENOR que o tempo entre duas placas diferentes.
SIGN_RELEASE_TIME = 12.0


class Navigation:
    def __init__(self):
        self.route = []
        self.current_route = ""
        self.action_counter = 0

        # Trava da placa: enquanto ativa, novas detecções da mesma placa não avançam a ação
        self.current_lane = "left"
        self.sign_latched = False
        self.last_sign_seen = 0.0

    def add_point(self, point):
        self.route.append(point)

        if self.current_route == "":
            self.current_route = point

    def _next_point(self):
        self.route.pop(0)
        self.action_counter = 0
        self.sign_latched = False  # novo ponto: a próxima placa é sempre nova
        self.current_route = self.route[0] if self.route else ""
        if self.current_route:
            print(f"Current route updated to: {self.current_route}")

    def confirm_current_point(self, point):
        """Avança a rota somente quando a placa do destino atual foi detectada."""
        if not self.route or str(self.route[0]).casefold() != str(point).casefold():
            return False
        self._next_point()
        return True

    def on_sign_detected(self, now=None):
        """Chame a cada frame em que a placa de desvio é detectada (no lugar de update_lane).

        A primeira detecção consome uma ação da rota e trava. Enquanto a placa continuar
        aparecendo, ou voltar a aparecer em menos de SIGN_RELEASE_TIME, devolve a mesma
        preferência sem avançar. Só destrava depois de SIGN_RELEASE_TIME sem ver a placa.
        """
        now = time.monotonic() if now is None else now

        if self.sign_latched and now - self.last_sign_seen > SIGN_RELEASE_TIME:
            self.sign_latched = False

        self.last_sign_seen = now

        if not self.sign_latched:
            self.sign_latched = True
            self.current_lane = self.update_lane()

        return self.current_lane

    def update_lane(self):
        """Consome a próxima ação da rota. Use on_sign_detected() no loop de detecção."""
        if not self.route:
            return "left"  # Faixa de preferência padrão quando não há rota definida

        lanes = lane_guide_map.get(self.current_route, [])
        if not lanes:
            # Um ponto desconhecido permanece na rota até confirmação explícita.
            return "left"

        if self.action_counter >= len(lanes):
            return lanes[-1]

        lane_preference = lanes[self.action_counter]
        self.action_counter += 1

        return lane_preference

    def _reset_route(self):
        self.route = []
        self.current_route = ""
        self.action_counter = 0
        self.sign_latched = False
        self.current_lane = "left"


if __name__ == "__main__":
    nav = Navigation()
    nav.add_point("B")

    # Placa 1 do ponto B: vista, perdida por 0.5s, vista de novo -> mesma placa (left, left, left)
    print(nav.on_sign_detected())
    time.sleep(2)

    # Fica 5s sem ver nada, aí aparece a placa 2 -> próxima ação (right, right)
    print(nav.on_sign_detected())
    print(nav.route)
    nav._next_point()
    print(nav.route)