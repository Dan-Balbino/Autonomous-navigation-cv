#include <Arduino_GFX_Library.h>

#include "Display.h"
#include "CarMap.h"

#define TFT_CS 5
#define TFT_DC 2
#define TFT_RST 4
#define TFT_SCLK 18
#define TFT_MOSI 23
#define TFT_MISO 19

Arduino_DataBus *bus = new Arduino_ESP32SPI(TFT_DC, TFT_CS, TFT_SCLK, TFT_MOSI, TFT_MISO);
Arduino_GFX *gfx = new Arduino_ST7796(bus, TFT_RST, 1, true, 320, 480);

void read_serial() {
    if (Serial.available()) {
        String data = Serial.readStringUntil('\n');
        data.trim();

        int separator = data.indexOf(',');

        if (separator != -1) {
            double speed = data.substring(0, separator).toDouble();
            double steering = data.substring(separator + 1).toDouble();

            set_car_speed(speed);
            set_car_steering(steering);
        }
    }
}

void setup() {
    Serial.begin(115200);

    start_display();
    init_car_map();
}

void loop() {
    read_serial();
    update_car_map();
}
