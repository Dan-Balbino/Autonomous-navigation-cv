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
}

void Lights::begin() {
  pixels.begin();
  pixels.clear();
  pixels.show();
}

void Lights::fill(int from, int to, uint32_t color) {
  for (int i = from; i < to && i < NUMPIXELS; i++) {
    pixels.setPixelColor(i, color);
  }
}

// ==================================================
// COMUNICAÇÃO
// ==================================================

void Lights::handleCommand(uint8_t command) {
  left_turn_signal_on  = command & (1 << LIGHTS_BIT_LEFT);
  right_turn_signal_on = command & (1 << LIGHTS_BIT_RIGHT);
  hazard_lights_on     = command & (1 << LIGHTS_BIT_HAZARD);
  brake_lights_on      = command & (1 << LIGHTS_BIT_BRAKE);
  headlight_on         = command & (1 << LIGHTS_BIT_HEADLIGHT);
  reverse_lights_on    = command & (1 << LIGHTS_BIT_REVERSE);
  control_enabled      = command & (1 << LIGHTS_BIT_CONTROL);

  // um comando válido tira do failsafe
  failsafe_active = false;
}

void Lights::heartbeat() {
  last_heartbeat = millis();
  heartbeat_seen = true;
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

void Lights::updateLogo() {
  if (stopped_state) {
    fill(34, 40, pixels.Color(255, 0, 0));
    return;
  }

  if (logo_mode == LOGO_OFF) return;

  // Controle ativado: logo azul fixo, em qualquer modo
  if (control_enabled) {
    fill(34, 40, pixels.Color(0, 0, 255));
    return;
  }

  if (logo_mode == LOGO_RANDOM) {
    unsigned long now = millis();
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
    unsigned long now = millis();
    if (now - last_logo_update >= logo_interval) {
      last_logo_update = now;
      logo_hue = (logo_hue + 256) & 0xFFFF;  // avança 1/256 do ciclo, dá a volta sozinho
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
  if (!any_signal) {
    // sem seta ativa: reseta para acender assim que for ligada
    blink_state = true;
    last_blink_update = millis();
    return;
  }

  unsigned long now = millis();
  if (now - last_blink_update >= blink_interval) {
    last_blink_update = now;
    blink_state = !blink_state;
  }
}

// ==================================================
// UPDATE
// ==================================================

void Lights::update() {

  // Failsafe: heartbeat perdido -> pisca-alerta
  if (heartbeat_timeout > 0 && heartbeat_seen) {
    if (millis() - last_heartbeat > heartbeat_timeout) {
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
  }

  bool hazard = hazard_lights_on || stopped_state;
  bool left  = (left_turn_signal_on || hazard);
  bool right = (right_turn_signal_on || hazard);

  updateBlink(left || right);

  pixels.clear();

  const uint32_t turnColor  = pixels.Color(68, 0, 255);
  const uint32_t whiteColor = pixels.Color(0, 0, 255);  // mesma cor usada no sketch original
  const uint32_t brakeColor = pixels.Color(255, 0, 0);

  // Farol / lanternas
  if (headlight_on) {
    fill(0, 10, whiteColor);
    fill(16, 26, whiteColor);
  }

  // Ré (os LEDs traseiros são compartilhados com o freio)
  if (reverse_lights_on) {
    fill(14, 16, whiteColor);
    fill(30, 32, whiteColor);
  }

  // Freio sobrescreve a ré nos mesmos LEDs
  if (brake_lights_on) {
    fill(14, 16, brakeColor);
    fill(30, 32, brakeColor);
  }

  // Setas
  if (left && blink_state) {
    fill(10, 14, turnColor);   // frente
    fill(32, 34, turnColor);   // trás
  }

  if (right && blink_state) {
    fill(26, 30, turnColor);   // frente
    fill(40, 42, turnColor);   // trás
  }

  if (stopped_state) {
    const uint32_t stopColor = pixels.Color(255, 0, 0);
    fill(0, 10, stopColor);
    fill(16, 26, stopColor);
  }

  // Logo
  updateLogo();

  pixels.show();
}