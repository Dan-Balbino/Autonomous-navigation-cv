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

    def update_lane(self):
        if len(self.route) == 0:
            return "neutral"

        lanes = lane_guide_map.get(self.current_route, [])
        lane_preference = lanes[self.action_counter]
        self.action_counter += 1

        if self.action_counter >= len(lanes):
            self.route.pop(0)
            self.action_counter = 0

            if len(self.route) == 0:
                self.current_route = ""
            else:
                self.current_route = self.route[0]
                print(f"Current route updated to: {self.current_route}")

        lane_preference = lanes[self.action_counter]
        self.action_counter += 1
        return lane_preference
        

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
    