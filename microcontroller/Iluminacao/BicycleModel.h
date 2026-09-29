#pragma once

#include <tuple>

class BicycleModel {
private:
    double L;
    double x;
    double y;
    double theta;

public:
    BicycleModel(double start_x, double start_y, double start_angle, double wheel_base);
    void calc_pos(double distance, double steering_angle);
    std::tuple<double, double, double> get_pos() const;
};