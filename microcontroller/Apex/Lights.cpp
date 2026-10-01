

// ==================================================
// CONFIGURAÇÃO
// ==================================================

#define PIN 6
#define NUMPIXELS 42

#define LIGHTS_COMMAND   0x
#define LIGHTS_HEARTBEAT 0x

Adafruit_NeoPixel pixels(NUMPIXELS, PIN, NEO_GBR + NEO_KHZ800);

Bit 0 → seta esquerda
Bit 1 → seta direita
Bit 2 → alerta
Bit 3 → luz de freio
Bit 4 → farol
Bit 5 → luz de ré
Bit 6 → reservado
Bit 7 → reservado

bool alerta;
bool freio, re;
bool seta_esquerda, seta_direita;
bool logo;








// ==================================================
// ESTADOS - ESQUERDA
// ==================================================

bool lanternaLigadaE = false;
bool setaLigadaE = false;
bool reLigadaE = false;


// ==================================================
// ESTADOS - DIREITA
// ==================================================

bool lanternaLigadaD = false;
bool setaLigadaD = false;
bool reLigadaD = false;


// ==================================================
// CONTROLE DAS SETAS
// ==================================================

unsigned long tempoAnteriorD = 0;
unsigned long tempoAnteriorE = 0;

const unsigned long intervaloSetaD = 1000;
const unsigned long intervaloSetaE = 1000;

bool setaEstadoD = false;
bool setaEstadoE = false;


// ==================================================
// CONTROLE DO LOGO
// ==================================================

bool logoLigado = false;
bool logoRGB = false;

unsigned long tempoAnteriorLogo = 0;
const unsigned long intervaloLogo = 10;

int logoHue = 0;


// ==================================================
// SETUP
// ==================================================

void setup() {

  Serial.begin(9600);

  pixels.begin();
  pixels.clear();
  pixels.show();

  Serial.println("Sistema iniciado");
}


// ==================================================
// LOOP
// ==================================================

void loop() {

  // ==================================================
  // RECEBE COMANDO DA SERIAL
  // ==================================================

  if (Serial.available()) {

    String comando = Serial.readStringUntil('\n');
    comando.trim();


    // ==================================================
    // ESQUERDA
    // ==================================================

    if (comando == "LIGAE") {

      lanternaLigadaE = true;
    }

    else if (comando == "DESLIGAE") {

      lanternaLigadaE = false;
    }

    else if (comando == "SETAE") {

      setaLigadaE = true;
    }

    else if (comando == "SETA_OFFE") {

      setaLigadaE = false;
      setaEstadoE = false;
    }

    else if (comando == "REE") {

      reLigadaE = true;
    }

    else if (comando == "RE_OFFE") {

      reLigadaE = false;
    }


    // ==================================================
    // DIREITA
    // ==================================================

    else if (comando == "LIGAD") {

      lanternaLigadaD = true;
    }

    else if (comando == "DESLIGAD") {

      lanternaLigadaD = false;
    }

    else if (comando == "SETAD") {

      setaLigadaD = true;
    }

    else if (comando == "SETA_OFFD") {

      setaLigadaD = false;
      setaEstadoD = false;
    }

    else if (comando == "RED") {

      reLigadaD = true;
    }

    else if (comando == "RE_OFFD") {

      reLigadaD = false;
    }


    // ==================================================
    // LOGO
    // ==================================================

    else if (comando == "LOGO_ON") {

      logoLigado = true;
      logoRGB = false;
    }

    else if (comando == "LOGO_OFF") {

      logoLigado = false;
      logoRGB = false;
    }

    else if (comando == "LOGO_RGB") {

      logoLigado = true;
      logoRGB = true;
    }

    else if (comando == "LOGO_RGB_OFF") {

      logoRGB = false;
    }

    // COR VERMELHA
    else if (comando == "LOGO_R") {

      logoLigado = true;
      logoRGB = false;

      for (int i = 34; i < 40; i++) {

        pixels.setPixelColor(
          i,
          pixels.Color(255, 0, 0)
        );
      }

      pixels.show();
    }

    // COR VERDE
    else if (comando == "LOGO_G") {

      logoLigado = true;
      logoRGB = false;

      for (int i = 34; i < 40; i++) {

        pixels.setPixelColor(
          i,
          pixels.Color(0, 255, 0)
        );
      }

      pixels.show();
    }

    // COR AZUL
    else if (comando == "LOGO_B") {

      logoLigado = true;
      logoRGB = false;

      for (int i = 34; i < 40; i++) {

        pixels.setPixelColor(
          i,
          pixels.Color(0, 0, 255)
        );
      }

      pixels.show();
    }
  }


  // ==================================================
  // PISCA-PISCA DIREITA
  // ==================================================

  if (setaLigadaD) {

    unsigned long agora = millis();

    if (agora - tempoAnteriorD >= intervaloSetaD) {

      tempoAnteriorD = agora;

      setaEstadoD = !setaEstadoD;
    }
  }


  // ==================================================
  // PISCA-PISCA ESQUERDA
  // ==================================================

  if (setaLigadaE) {

    unsigned long agora = millis();

    if (agora - tempoAnteriorE >= intervaloSetaE) {

      tempoAnteriorE = agora;

      setaEstadoE = !setaEstadoE;
    }
  }


  // ==================================================
  // EFEITO RGB DO LOGO
  // LEDs 35 até 40
  // Índices 34 até 39
  // ==================================================

  if (logoLigado && logoRGB) {

    unsigned long agora = millis();

    if (agora - tempoAnteriorLogo >= intervaloLogo) {

      tempoAnteriorLogo = agora;

      logoHue++;

      if (logoHue >= 256) {
        logoHue = 0;
      }

      uint32_t cor = pixels.ColorHSV(logoHue * 256);

      for (int i = 34; i < 40; i++) {

        pixels.setPixelColor(i, cor);
      }
    }
  }


  // ==================================================
  // LIMPA OS 42 LEDs
  // ==================================================

  pixels.clear();


  // ==================================================
  // LANTERNA ESQUERDA
  // LEDs 1 até 10
  // Índices 0 até 9
  // ==================================================

  if (lanternaLigadaE) {

    for (int i = 0; i < 10; i++) {

      pixels.setPixelColor(
        i,
        pixels.Color(0, 0, 255)
      );
    }
  }


  // ==================================================
  // SETA ESQUERDA
  // LEDs 11 até 14
  // Índices 10 até 13
  // ==================================================

  if (setaLigadaE && setaEstadoE) {

    for (int i = 10; i < 14; i++) {

      pixels.setPixelColor(
        i,
        pixels.Color(68, 0, 255)
      );
    }
  }


  // ==================================================
  // RÉ ESQUERDA
  // LEDs 15 e 16
  // Índices 14 até 15
  // ==================================================

  if (reLigadaE) {

    for (int i = 14; i < 16; i++) {

      pixels.setPixelColor(
        i,
        pixels.Color(0, 0, 255)
      );
    }
  }


  // ==================================================
  // LANTERNA DIREITA
  // LEDs 17 até 26
  // Índices 16 até 25
  // ==================================================

  if (lanternaLigadaD) {

    for (int i = 16; i < 26; i++) {

      pixels.setPixelColor(
        i,
        pixels.Color(0, 0, 255)
      );
    }
  }


  // ==================================================
  // SETA DIREITA
  // LEDs 27 até 30
  // Índices 26 até 29
  // ==================================================

  if (setaLigadaD && setaEstadoD) {

    for (int i = 26; i < 30; i++) {

      pixels.setPixelColor(
        i,
        pixels.Color(68, 0, 255)
      );
    }
  }


  // ==================================================
  // RÉ DIREITA
  // LEDs 31 e 32
  // Índices 30 até 31
  // ==================================================

  if (reLigadaD) {

    for (int i = 30; i < 32; i++) {

      pixels.setPixelColor(
        i,
        pixels.Color(0, 0, 255)
      );
    }
  }


  // ==================================================
  // LEDs 33 E 34
  // JUNTO COM SETA ESQUERDA
  // Índices 32 e 33
  // ==================================================

  if (setaLigadaE && setaEstadoE) {

    for (int i = 32; i < 34; i++) {

      pixels.setPixelColor(
        i,
        pixels.Color(68, 0, 255)
      );
    }
  }


  // ==================================================
  // LOGO
  // LEDs 35 até 40
  // Índices 34 até 39
  // ==================================================

  if (logoLigado) {

    if (logoRGB) {

      uint32_t cor = pixels.ColorHSV(logoHue * 256);

      for (int i = 34; i < 40; i++) {

        pixels.setPixelColor(i, cor);
      }

    }
  }


  // ==================================================
  // LEDs 41 E 42
  // JUNTO COM SETA DIREITA
  // Índices 40 e 41
  // ==================================================

  if (setaLigadaD && setaEstadoD) {

    for (int i = 40; i < 42; i++) {

      pixels.setPixelColor(
        i,
        pixels.Color(68, 0, 255)
      );
    }
  }


  // ==================================================
  // ENVIA PARA OS 42 LEDs
  // ==================================================

  pixels.show();
}
