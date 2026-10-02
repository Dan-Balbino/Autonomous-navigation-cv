#pragma once

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "BatteryState.h"

static const uint8_t OLED_ADDRESS = 0x3C;

class OLEDDisplay {
    public:
        OLEDDisplay(int width, int height, int reset);
        void begin();
        void startup_acs_calibration();
        void calibration_info(float ACS_ZERO);
        void update_display(float percentualDisplay, float tensaoDisplay, float correnteDisplay, EstadoBateria estado);


    private:
        Adafruit_SSD1306 display;

        bool display_online;
};