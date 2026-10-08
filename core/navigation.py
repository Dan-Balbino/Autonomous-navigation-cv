lane_guide_map = {
    "A": ["right"],
    "B": ["left", "right"],
    "C": ["left", "left"]
}

class Navigation:
    def __init__(self):
        self.route = []
        self.current_route = ""
        self.action_counter = 0

    def add_point(self, point):
        self.route.append(point)

        if self.current_route == "":
            self.current_route = point

    def _next_point(self):
        self.route.pop(0)
        self.action_counter = 0
        self.current_route = self.route[0] if self.route else ""
        if self.current_route:
            print(f"Current route updated to: {self.current_route}")

    def confirm_current_point(self, point):
        """Avança a rota somente quando a placa do destino atual foi detectada."""
        if not self.route or str(self.route[0]).casefold() != str(point).casefold():
            return False
        self._next_point()
        return True

    def update_lane(self):
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

if __name__ == "__main__":
    nav = Navigation()
    nav.add_point("B")
    print(f"Added point B. Current route: {nav.current_route}")
    next_lane = nav.update_lane()
    print(f"Next lane: {next_lane}")
    
    next_lane = nav.update_lane()
    print(f"Next lane: {next_lane}")

    next_lane = nav.update_lane()
    print(f"Next lane: {next_lane}")    
    
    nav.add_point("C")
    print(f"Added point C. Current route: {nav.current_route}")
    
    next_lane = nav.update_lane()
    print(f"Next lane: {next_lane}")
    
    next_lane = nav.update_lane()
    print(f"Next lane: {next_lane}")
    
    next_lane = nav.update_lane()
    print(f"Next lane: {next_lane}")
    
    nav.add_point("A")
    print(f"Added point A. Current route: {nav.current_route}")
    
    nav.add_point("B")
    print(f"Added point B. Current route: {nav.current_route}")
    
    next_lane = nav.update_lane()
    print(f"Next lane: {next_lane}")
    
    next_lane = nav.update_lane()
    print(f"Next lane: {next_lane}")
    
    next_lane = nav.update_lane()
    print(f"Next lane: {next_lane}")
    
    next_lane = nav.update_lane()
    print(f"Next lane: {next_lane}")
    