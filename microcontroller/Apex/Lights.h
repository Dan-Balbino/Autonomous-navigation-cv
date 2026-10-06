#ifndef LIGHTS_H
#define LIGHTS_H

#include <Arduino.h>
#include <Adafruit_NeoPixel.h>

class Lights {
public:
  enum LogoMode {
    LOGO_OFF,
    LOGO_FIXED,
    LOGO_RANDOM,
    LOGO_RAINBOW
  };

  Lights(int pin, int numPixels);

  void begin();
  void update();

  void handleCommand(uint8_t command, bool stopped, int percentage, uint8_t state);
  void setLogo(LogoMode mode, uint8_t r = 0, uint8_t g = 0, uint8_t b = 0);

  void setHeartbeat(unsigned long timestamp) {
    last_heartbeat = timestamp;
    heartbeat_seen = true;
  }

  void setHeartbeatTimeout(unsigned long timeout) {
    heartbeat_timeout = timeout;
  }

  void setBlinkInterval(unsigned long interval) {
    blink_interval = interval;
  }

  void setLogoInterval(unsigned long interval) {
    logo_interval = interval;
  }

  void setLogoRandomInterval(unsigned long interval) {
    logo_random_interval = interval;
  }

private: // G B R
  const uint32_t turnColor = pixels.Color(68, 0, 255);
  const uint32_t whiteColor = pixels.Color(255, 255, 255);
  const uint32_t brakeColor = pixels.Color(0, 0, 255); 

  const int PIN;
  const int NUMPIXELS;
  Adafruit_NeoPixel pixels;

  bool hazard_lights_on;
  bool left_turn_signal_on;
  bool right_turn_signal_on;
  bool brake_lights_on;
  bool reverse_lights_on;
  bool headlight_on;
  bool control_enabled;

  bool stopped_state;
  int battery_percentage;
  uint8_t battery_state;

  bool failsafe_active;
  bool heartbeat_seen;
  unsigned long last_heartbeat;
  unsigned long heartbeat_timeout = 3000;

  bool blink_state;
  unsigned long last_blink_update;
  unsigned long blink_interval = 500;

  LogoMode logo_mode = LOGO_RAINBOW;
  uint8_t logo_r = 0;
  uint8_t logo_g = 0;
  uint8_t logo_b = 0;

  static const uint8_t LOGO_LEDS = 6;
  uint32_t logo_random_colors[LOGO_LEDS];

  uint16_t logo_hue = 0;
  unsigned long last_logo_update;
  unsigned long last_logo_random_update;

  unsigned long logo_interval = 20;
  unsigned long logo_random_interval = 250;

  void fill(int from, int to, uint32_t color);
  void updateBlink(bool any_signal);
  void updateLogo();
  void updateBatteryPulse();
  uint32_t getBatteryColor();
};

#ifndef LIGHTS_BIT_LEFT
#define LIGHTS_BIT_LEFT 0
#endif

#ifndef LIGHTS_BIT_RIGHT
#define LIGHTS_BIT_RIGHT 1
#endif

#ifndef LIGHTS_BIT_HAZARD
#define LIGHTS_BIT_HAZARD 2
#endif

#ifndef LIGHTS_BIT_BRAKE
#define LIGHTS_BIT_BRAKE 3
#endif

#ifndef LIGHTS_BIT_HEADLIGHT
#define LIGHTS_BIT_HEADLIGHT 4
#endif

#ifndef LIGHTS_BIT_REVERSE
#define LIGHTS_BIT_REVERSE 5
#endif

#ifndef LIGHTS_BIT_CONTROL
#define LIGHTS_BIT_CONTROL 6
#endif

#endif