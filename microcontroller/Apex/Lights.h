#ifndef LIGHTS_H
#define LIGHTS_H

#include <Arduino.h>
#include <Adafruit_NeoPixel.h>

// Byte de comando
#define LIGHTS_BIT_LEFT      0  // seta esquerda
#define LIGHTS_BIT_RIGHT     1  // seta direita
#define LIGHTS_BIT_HAZARD    2  // alerta
#define LIGHTS_BIT_BRAKE     3  // luz de freio
#define LIGHTS_BIT_HEADLIGHT 4  // farol
#define LIGHTS_BIT_REVERSE   5  // luz de ré
#define LIGHTS_BIT_CONTROL   6  // controle ativado
// bit 7 reservado

enum LogoMode : uint8_t {
  LOGO_OFF,
  LOGO_SOLID,
  LOGO_RAINBOW,
  LOGO_RANDOM   // padrão: cores aleatórias; azul fixo se o controle estiver ativado
};

class Lights {
  public:
    Lights(int pin, int numPixels);

    void begin();
    void update();  // chamar a cada loop()

    // Comunicação
    void handleCommand(uint8_t command, bool stopped, int percentage, uint8_t state);  // decodifica o byte de comando

    // Setters individuais
    void setLeftTurnSignal(bool on)  { left_turn_signal_on = on; }
    void setRightTurnSignal(bool on) { right_turn_signal_on = on; }
    void setHazardLights(bool on)    { hazard_lights_on = on; }
    void setBrakeLights(bool on)     { brake_lights_on = on; }
    void setReverseLights(bool on)   { reverse_lights_on = on; }
    void setHeadlight(bool on)       { headlight_on = on; }
    void setControlEnabled(bool on)  { control_enabled = on; }

    // Logo
    void setLogo(LogoMode mode, uint8_t r = 255, uint8_t g = 255, uint8_t b = 255);

    // Timeout do heartbeat em ms (0 desativa o failsafe)
    void setHeartbeatTimeout(unsigned long ms) { heartbeat_timeout = ms; }

    bool isControlEnabled() const { return control_enabled; }

  private:
    int PIN;
    int NUMPIXELS;
    Adafruit_NeoPixel pixels;

    bool hazard_lights_on;
    bool left_turn_signal_on;
    bool right_turn_signal_on;
    bool brake_lights_on;
    bool reverse_lights_on;
    bool headlight_on;
    bool control_enabled;
    
    bool stopped_state = false;
    int battery_percentage = 100;
    uint8_t battery_state = 0;

    // Pisca
    const unsigned long blink_interval = 500;
    unsigned long last_blink_update = 0;
    bool blink_state = true;

    // Logo
    LogoMode logo_mode = LOGO_RANDOM;
    uint8_t logo_r = 255, logo_g = 255, logo_b = 255;
    unsigned long last_logo_update = 0;
    const unsigned long logo_interval = 10;
    uint16_t logo_hue = 0;

    // Logo aleatório (6 LEDs: 34 a 39)
    static const uint8_t LOGO_LEDS = 6;
    const unsigned long logo_random_interval = 150;
    unsigned long last_logo_random_update = 0;
    uint32_t logo_random_colors[LOGO_LEDS] = {0};

    // Heartbeat / failsafe
    unsigned long heartbeat_timeout = 0;
    unsigned long last_heartbeat = 0;
    bool heartbeat_seen = false;
    bool failsafe_active = false;

    void updateBatteryPulse();
    uint32_t getBatteryColor();
    void updateBlink(bool any_signal);
    void updateLogo();
    void fill(int from, int to, uint32_t color);  // [from, to)
};

#endif