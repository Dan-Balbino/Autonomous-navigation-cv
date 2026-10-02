#include "OLEDDisplay.h"

OLEDDisplay::OLEDDisplay(int width, int height, int reset) {
    display = Adafruit_SSD1306(width, height, &Wire, reset);
}

void OLEDDisplay::begin() {
    if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS)) {
        display_online = false;
    } else {
        display_online = true;
        display.clearDisplay();
        display.setTextColor(SSD1306_WHITE);
    }
}

void OLEDDisplay::startup_acs_calibration() {
    if (!display_online) {
        return;
    }
    display.clearDisplay();

    display.setTextSize(1);

    display.setCursor(0, 0);
    display.println(F("Sistema iniciado"));

    display.setCursor(0, 10);
    display.println(F("ATmega328P"));

    display.setCursor(0, 20);
    display.println(F("Calibrando ACS..."));

    display.display();
}

void OLEDDisplay::calibration_info(float ACS_ZERO) {
    if (!display_online) {
        return;
    }

    display.clearDisplay();

    display.setTextSize(1);

    display.setCursor(0, 0);
    display.println(F("ACS CALIBRADO"));

    display.setCursor(0, 12);

    display.print(F("ZERO: "));
    display.print(ACS_ZERO, 3);
    display.print(F("V"));

    display.display();
}


void OLEDDisplay::update_display(float percentualDisplay, float tensaoDisplay, float correnteDisplay, EstadoBateria estado) {
    if (!display_online) {
        return;
    }

    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);

    // PORCENTAGEM
    // ========================================================
    display.setTextSize(2);
    display.setCursor(0, 0);
    display.print(percentualDisplay, 0);
    display.print(F("%"));

    // TENSÃO
    // ========================================================
    display.setTextSize(1);
    display.setCursor(68, 0);
    display.print(tensaoDisplay, 2);
    display.print(F("V"));

    // CORRENTE
    // ========================================================
    display.setCursor(68, 10);
    display.print(correnteDisplay, 2);
    display.print(F("A"));

    // ESTADO
    // ========================================================
    display.setCursor(0, 23);

    switch (estado)
    {
    case CARREGANDO:
        display.print(F("CARREGANDO"));
        break;

    case CARREGADA:
        display.print(F("CARREGADA"));
        break;

    case DESCARREGANDO:
        display.print(F("DESCARGA"));
        break;

    case BATERIA_BAIXA:
        display.print(F("BAT. BAIXA"));
        break;

    case SEM_CORRENTE:
        display.print(F("SEM CORRENTE"));
        break;
    }

    display.display();
}