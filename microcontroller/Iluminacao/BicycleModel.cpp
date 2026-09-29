#include "BicycleModel.h"
#include <numbers>
#include <cmath>

BicycleModel::BicycleModel(double start_x, double start_y, double start_angle, double wheel_base) {
    L = wheel_base;
    x = start_x;
    y = start_y;
    theta = start_angle * std::numbers::pi / 180.0;
}

void BicycleModel::calc_pos(double distance, double steering_angle) {
    double steering = steering_angle * std::numbers::pi / 180.0;
    double delta = steering - std::numbers::pi / 2.0;

    if (std::abs(delta) < 1e-10) {
        x += distance * std::cos(theta);
        y += distance * std::sin(theta);
        return;
    }

    double radius = L / std::tan(delta);
    double dtheta = distance / radius;

    double center_x = x - radius * std::sin(theta);
    double center_y = y + radius * std::cos(theta);

    double new_theta = theta + dtheta;

    x = center_x + radius * std::sin(new_theta);
    y = center_y - radius * std::cos(new_theta);
    theta = new_theta;
}

std::tuple<double, double, double> BicycleModel::get_pos() const {
    return {x, y, theta};
}
