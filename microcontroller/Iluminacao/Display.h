#pragma once

#include <Arduino_GFX_Library.h>
#include "StartLogo.h"
#include "Colors.h"

extern Arduino_GFX *gfx;

void draw_centered_text(const char *text, int y, uint8_t size, uint16_t color);
void start_display();