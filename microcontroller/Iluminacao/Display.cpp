#include "Display.h"

void draw_centered_text(const char *text, int y, uint8_t size, uint16_t color) {
  int16_t x1, y1;
  uint16_t w, h;

  gfx->setTextSize(size);
  gfx->getTextBounds(text, 0, y, &x1, &y1, &w, &h);

  int x = (gfx->width() - w) / 2;

  gfx->setCursor(x, y);
  gfx->setTextColor(color);
  gfx->println(text);
}

void start_display() {
  if (!gfx->begin()) {
    Serial.println("Falha ao iniciar TFT!");
    while (1);
  }

  gfx->invertDisplay(true);
  gfx->fillScreen(ROYALBLUE);

  int logo_x = (gfx->width() - LOGO_WIDTH) / 2;
  int logo_y = (gfx->height() - LOGO_HEIGHT) / 2;

  gfx->draw16bitRGBBitmap(logo_x, logo_y, StartLogo, LOGO_WIDTH, LOGO_HEIGHT);

  int line_y = logo_y + LOGO_HEIGHT - 75;

  gfx->drawLine(25, line_y, 455, line_y, WHITE);

  int loading_bar_x = 40;
  int loading_bar_y = line_y + 10;
  int loading_bar_w = 400;
  int loading_bar_h = 20;

  draw_centered_text("Iniciando", loading_bar_y + 40, 3, WHITE);

  gfx->drawRect(loading_bar_x, loading_bar_y, loading_bar_w, loading_bar_h, WHITE);

  for (int i = 0; i <= loading_bar_w - 4; i += 4) {
    gfx->fillRect(loading_bar_x + 2, loading_bar_y + 2, i, loading_bar_h - 4, WHITE);
    delay(45);
  }

  delay(500);

  gfx->fillScreen(BLACK);
}