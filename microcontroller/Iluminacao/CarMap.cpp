#include "CarMap.h"

#define PIXELS_PER_METER 21.0
#define UPDATE_INTERVAL 25

extern Arduino_GFX *gfx;

BicycleModel car(220.0 / PIXELS_PER_METER, 140.0 / PIXELS_PER_METER, 0.0, 0.89);

double car_speed = 0.0;
double car_steering = 90.0;

int car_x = 220;
int car_y = 140;

void init_car_map() {
    gfx->draw16bitRGBBitmap(0, 0, Track, TRACK_WIDTH, TRACK_HEIGHT);
    draw_rotated_bitmap(car_x, car_y, CarArrow, ARROW_WIDTH, ARROW_HEIGHT, 0.0);
}

void update_car_map() {
    static int old_x = car_x;
    static int old_y = car_y;
    static unsigned long last_update = 0;

    unsigned long current_time = millis();

    if (current_time - last_update >= UPDATE_INTERVAL) {
        double dt = (current_time - last_update) / 1000.0;
        last_update = current_time;

        restore_background(old_x, old_y, ARROW_WIDTH, ARROW_HEIGHT);

        double distance = car_speed * dt;

        car.calc_pos(distance, car_steering);

        auto [x, y, theta] = car.get_pos();

        car_x = static_cast<int>(x * PIXELS_PER_METER);
        car_y = static_cast<int>(y * PIXELS_PER_METER);

        draw_rotated_bitmap(car_x, car_y, CarArrow, ARROW_WIDTH, ARROW_HEIGHT, theta);

        old_x = car_x;
        old_y = car_y;
    }
}

void set_car_speed(double speed) {
    car_speed = speed;
}

void set_car_steering(double steering_angle) {
    car_steering = steering_angle;
}

void draw_rotated_bitmap(int x, int y, const uint16_t *bitmap, int width, int height, double angle) {
    double cos_angle = std::cos(angle);
    double sin_angle = std::sin(angle);

    int center_x = width / 2;
    int center_y = height / 2;
    int output_width = static_cast<int>(std::ceil(std::abs(width * cos_angle) + std::abs(height * sin_angle)));
    int output_height = static_cast<int>(std::ceil(std::abs(width * sin_angle) + std::abs(height * cos_angle)));
    int output_center_x = output_width / 2;
    int output_center_y = output_height / 2;

    for (int py = 0; py < output_height; py++) {
        for (int px = 0; px < output_width; px++) {
            int dx = px - output_center_x;
            int dy = py - output_center_y;

            int source_x = static_cast<int>(dx * cos_angle + dy * sin_angle) + center_x;
            int source_y = static_cast<int>(-dx * sin_angle + dy * cos_angle) + center_y;

            if (source_x < 0 || source_x >= width || source_y < 0 || source_y >= height) {
                continue;
            }

            uint16_t pixel = pgm_read_word(&bitmap[source_y * width + source_x]);

            if (pixel != BLACK) {
                gfx->drawPixel(x + dx, y + dy, pixel);
            }
        }
    }
}

void restore_background(int x, int y, int width, int height) {
    int diameter = static_cast<int>(std::ceil(std::sqrt(width * width + height * height)));
    int left = x - diameter / 2;
    int top = y - diameter / 2;

    for (int py = 0; py < diameter; py++) {
        for (int px = 0; px < diameter; px++) {
            uint16_t pixel = pgm_read_word(&Track[(top + py) * TRACK_WIDTH + (left + px)]);
            gfx->drawPixel(left + px, top + py, pixel);
        }
    }
}
