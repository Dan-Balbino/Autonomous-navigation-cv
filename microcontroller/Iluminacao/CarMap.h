#pragma once

#include <Arduino_GFX_Library.h>
#include "Track.h"
#include "CarArrow.h"
#include "Colors.h"
#include "BicycleModel.h"

#include <cmath>
#include <numbers>

extern Arduino_GFX *gfx;

extern int car_x;
extern int car_y;

void init_car_map();
void update_car_map();
void set_car_speed(double speed);
void set_car_steering(double steering_angle);
void draw_rotated_bitmap(int x, int y, const uint16_t *bitmap, int width, int height, double angle);
void restore_background(int x, int y, int width, int height);
