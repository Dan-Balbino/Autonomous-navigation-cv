#include "Lights.h"

// Mapa dos LEDs (índices)
//  0–9    lanterna/farol esquerdo
// 10–13   seta esquerda (frente)
// 14–15   traseira esquerda (freio / ré)
// 16–25   lanterna/farol direito
// 26–29   seta direita (frente)
// 30–31   traseira direita (freio / ré)
// 32–33   seta esquerda (traseira)
// 34–39   logo
// 40–41   seta direita (traseira)

Lights::Lights(int pin, int numPixels)
  : PIN(pin),
    NUMPIXELS(numPixels),
    pixels(numPixels, pin, NEO_GBR + NEO_KHZ800) {

  hazard_lights_on = false;
  left_turn_signal_on = false;
  right_turn_signal_on = false;
  brake_lights_on = false;
  reverse_lights_on = false;
  headlight_on = false;
  control_enabled = false;

  stopped_state = false;
  battery_percentage = 0;
  battery_state = 0;

  failsafe_active = false;
  heartbeat_seen = false;
  blink_state = true;

  last_blink_update = 0;
  last_logo_update = 0;
  last_logo_random_update = 0;
  last_heartbeat = 0;
  logo_hue = 0;
}

void Lights::begin() {
  pixels.begin();
  pixels.clear();
  pixels.show();

  unsigned long now = millis();
  last_blink_update = now;
  last_logo_update = now;
  last_logo_random_update = now;
}

void Lights::fill(int from, int to, uint32_t color) {
  for (int i = from; i < to && i < NUMPIXELS; i++) {
    pixels.setPixelColor(i, color);
  }
}

// ==================================================
// COMUNICAÇÃO
// ==================================================

void Lights::handleCommand(uint8_t command, bool stopped, int percentage, uint8_t state) {
  left_turn_signal_on = command & (1 << LIGHTS_BIT_LEFT);
  right_turn_signal_on = command & (1 << LIGHTS_BIT_RIGHT);
  hazard_lights_on = command & (1 << LIGHTS_BIT_HAZARD);
  brake_lights_on = command & (1 << LIGHTS_BIT_BRAKE);
  headlight_on = command & (1 << LIGHTS_BIT_HEADLIGHT);
  reverse_lights_on = command & (1 << LIGHTS_BIT_REVERSE);
  control_enabled = command & (1 << LIGHTS_BIT_CONTROL);

  stopped_state = stopped;
  battery_percentage = percentage;
  battery_state = state;

  failsafe_active = false;
}

// ==================================================
// LOGO
// ==================================================

void Lights::setLogo(LogoMode mode, uint8_t r, uint8_t g, uint8_t b) {
  logo_mode = mode;
  logo_r = r;
  logo_g = g;
  logo_b = b;
}

uint32_t Lights::getBatteryColor() {
  int percentage = constrain(battery_percentage, 0, 100);
  uint8_t r;
  uint8_t g;

  if (percentage < 50) {
    r = 255;
    g = map(percentage, 0, 50, 100, 255);
  } else {
    r = map(percentage, 50, 100, 255, 0);
    g = 255;
  }

  return pixels.Color(r, g, 0);
}

void Lights::updateBatteryPulse() {
  unsigned long now = millis();
  const unsigned long pulse_period = 1200;
  unsigned long phase = now % pulse_period;
  uint8_t brightness;

  if (phase < pulse_period / 2) {
    brightness = map(phase, 0, pulse_period / 2, 40, 255);
  } else {
    brightness = map(phase, pulse_period / 2, pulse_period, 255, 40);
  }

  uint32_t color = getBatteryColor();

  uint8_t r = ((color >> 16) & 0xFF) * brightness / 255;
  uint8_t g = ((color >> 8) & 0xFF) * brightness / 255;
  uint8_t b = (color & 0xFF) * brightness / 255;

  fill(34, 40, pixels.Color(r, g, b));
}

void Lights::updateLogo() {
  if (battery_state == 1) {
    updateBatteryPulse();
    return;
  }

  if (stopped_state) {
    fill(34, 40, pixels.Color(255, 0, 0));
    return;
  }

  if (logo_mode == LOGO_OFF) return;

  if (control_enabled) {
    fill(34, 40, pixels.Color(0, 0, 255));
    return;
  }

  unsigned long now = millis();

  if (logo_mode == LOGO_RANDOM) {
    if (now - last_logo_random_update >= logo_random_interval) {
      last_logo_random_update = now;

      for (uint8_t i = 0; i < LOGO_LEDS; i++) {
        logo_random_colors[i] = pixels.ColorHSV(random(0, 65536));
      }
    }

    for (uint8_t i = 0; i < LOGO_LEDS; i++) {
      pixels.setPixelColor(34 + i, logo_random_colors[i]);
    }

    return;
  }

  if (logo_mode == LOGO_RAINBOW) {
    if (now - last_logo_update >= logo_interval) {
      last_logo_update = now;
      logo_hue += 256;
    }

    fill(34, 40, pixels.ColorHSV(logo_hue));
  } else {
    fill(34, 40, pixels.Color(logo_r, logo_g, logo_b));
  }
}

// ==================================================
// PISCA
// ==================================================

void Lights::updateBlink(bool any_signal) {
  unsigned long now = millis();

  if (!any_signal) {
    blink_state = true;
    last_blink_update = now;
    return;
  }

  if (now - last_blink_update >= blink_interval) {
    last_blink_update = now;
    blink_state = !blink_state;
  }
}

// ==================================================
// UPDATE
// ==================================================

void Lights::update() {
  unsigned long now = millis();

  // Failsafe: heartbeat perdido -> pisca-alerta
  if (heartbeat_timeout > 0 && heartbeat_seen && now - last_heartbeat > heartbeat_timeout) {
    if (!failsafe_active) {
      failsafe_active = true;
      left_turn_signal_on = false;
      right_turn_signal_on = false;
      brake_lights_on = true;
      reverse_lights_on = false;
      hazard_lights_on = true;
      control_enabled = false;
    }
  }

  bool hazard = hazard_lights_on || stopped_state;
  bool left = left_turn_signal_on || hazard;
  bool right = right_turn_signal_on || hazard;

  updateBlink(left || right);

  pixels.clear();

  const uint32_t turnColor = pixels.Color(68, 0, 255);
  const uint32_t whiteColor = pixels.Color(0, 0, 255);
  const uint32_t brakeColor = pixels.Color(255, 0, 0);

  // Farol / lanternas
  if (headlight_on) {
    fill(0, 10, whiteColor);
    fill(16, 26, whiteColor);
  }

  // Ré
  if (reverse_lights_on) {
    fill(14, 16, whiteColor);
    fill(30, 32, whiteColor);
  }

  // Freio sobrescreve a ré
  if (brake_lights_on) {
    fill(14, 16, brakeColor);
    fill(30, 32, brakeColor);
  }

  // Setas
  if (left && blink_state) {
    fill(10, 14, turnColor);
    fill(32, 34, turnColor);
  }

  if (right && blink_state) {
    fill(26, 30, turnColor);
    fill(40, 42, turnColor);
  }

  // Parado
  if (stopped_state) {
    const uint32_t stopColor = pixels.Color(255, 0, 0);
    fill(0, 10, stopColor);
    fill(16, 26, stopColor);
  }

  // Logo
  updateLogo();

  pixels.show();
}