#include "BicycleModel.h"
#include <numbers>
#include <cmath>
#include <algorithm>
#include <tuple>

namespace {
// Mapeia o ângulo do servo (0–180) pro esterçamento real (-45 a 45)
double map_range(double v, double in_min, double in_max, double out_min, double out_max) {
    v = std::clamp(v, in_min, in_max);
    return out_min + (v - in_min) * (out_max - out_min) / (in_max - in_min);
}
}

BicycleModel::BicycleModel(double start_x, double start_y, double start_angle, double wheel_base) {
    L = wheel_base;
    x = start_x;
    y = start_y;
    theta = start_angle * std::numbers::pi / 180.0;
}

void BicycleModel::calc_pos(double distance, double steering_angle) {
    // servo 0–180 → esterçamento -45° a +45° (90 = reto)
    double delta_deg = map_range(steering_angle, 0.0, 180.0, -45.0, 45.0);
    double delta = delta_deg * std::numbers::pi / 180.0;

    double dtheta = distance * std::tan(delta) / L;

    // integração por ponto médio: estável pra qualquer delta, inclusive reta
    x += distance * std::cos(theta + dtheta / 2.0);
    y += distance * std::sin(theta + dtheta / 2.0);
    theta += dtheta;
}

std::tuple<double, double, double> BicycleModel::get_pos() const {
    return {x, y, theta};
}