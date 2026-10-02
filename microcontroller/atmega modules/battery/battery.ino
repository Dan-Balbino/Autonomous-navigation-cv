/*
============================================================
 CONTROLE DE BATERIA + OLED 0.91"
 ATmega328P-PU STANDALONE / ARDUINO
 Cristal externo: 16 MHz

 OLED SSD1306
 128x32
 I2C: 0x3C

 PINAGEM
 -----------------------------------------------------------
 PB2 / D10 -> Detecção do cabo - saída
 PB3 / D11 -> Detecção do cabo - entrada
 PB5 / D13 -> Transistor NPN / relé

 PC0 / A0  -> Divisor de tensão
 PC1 / A1  -> ACS712-30A

 PC4 / A4  -> SDA OLED
 PC5 / A5  -> SCL OLED

 UART:
 PD0 -> RX
 PD1 -> TX

 SEM delay()
============================================================
*/

#include <Arduino.h>

#include "Config.h"
#include "OLEDDisplay.h"

OLEDDisplay oled(SCREEN_WIDTH, SCREEN_HEIGHT, OLED_RESET);

// SETUP
// ==========================================================
void setup() {
    Serial.begin(BAUD_RATE);
    Wire.begin();
    oled.begin();

  // CABO
  // ========================================================
  pinMode(PIN_CABO_OUT, OUTPUT);
  digitalWrite(PIN_CABO_OUT, LOW);
  pinMode(PIN_CABO_IN, INPUT_PULLUP);

  // RELÉ
  // ========================================================
  pinMode(PIN_RELE, OUTPUT);
  digitalWrite(PIN_RELE, LOW);

  // ADC
  // ========================================================
  pinMode(PIN_TENSAO, INPUT);
  pinMode(PIN_CORRENTE, INPUT);
  analogReference(DEFAULT);

  // CALIBRAÇÃO AUTOMÁTICA DO ACS712
  // ========================================================
  
  oled.startup_acs_calibration();
  unsigned long somaACS = 0;
  const int AMOSTRAS_ZERO = 200;

  for (int i = 0; i < AMOSTRAS_ZERO; i++) {
    somaACS += analogRead(PIN_CORRENTE);
  }

  float mediaACS = somaACS / (float)AMOSTRAS_ZERO;
  ACS_ZERO = mediaACS * VREF / ADC_MAX;

  oled.calibration_info(ACS_ZERO);
}


// LOOP
// ==========================================================

void loop()
{
  unsigned long now = millis();
  // CABO
  // ========================================================
  if (now - timerCabo >= INTERVALO_CABO) {
    timerCabo = now;
    verificarCabo();
  }

  // TENSÃO
  // ========================================================
  if (now - timerTensao >= INTERVALO_TENSAO) {
    timerTensao = now;
    medirTensao();
  }

  // CORRENTE
  // ========================================================
  if (now - timerCorrente >= INTERVALO_CORRENTE) {
    timerCorrente = now;
    medirCorrente();
  }

  // ESTADO
  // ========================================================
  if (now - timerEstado >= INTERVALO_ESTADO) {
    timerEstado = now;
    determinarEstado();
    atualizarPercentual();
  }

  // SERIAL
  // ========================================================
  if (now - timerSerial >= INTERVALO_SERIAL) {
    timerSerial = now;
    send_serial();
  }

  // DISPLAY
  // ========================================================
  if (now - timerDisplay >= INTERVALO_DISPLAY) {
    timerDisplay = now;
    calcularMediaDisplay();
  }
}

// DETECTAR CABO
// ==========================================================

void verificarCabo() {
  caboConectado = (digitalRead(PIN_CABO_IN) == LOW);

  if (caboConectado) {
    digitalWrite(PIN_RELE, HIGH);
  } else {
    digitalWrite(PIN_RELE, LOW);
  }

  // DETECTOU QUE O CABO ACABOU DE SER CONECTADO
  // ========================================================
  if (caboConectado && !caboAnterior) {
    /*
       Guarda o percentual que a bateria tinha
       ANTES de utilizar a corrente como referência.
    */

    percentualInicioCarga = calcularPercentualTensao(tensaoBateria);
  }

  // CABO FOI DESCONECTADO
  // ========================================================
  if (!caboConectado && caboAnterior) {
    percentualInicioCarga = 0.0;
  }
  caboAnterior = caboConectado;
}

// MEDIR TENSÃO
// ==========================================================
void medirTensao() {
  int adc = analogRead(PIN_TENSAO);

  tensaoA0 = adc * VREF / ADC_MAX;
  tensaoBateria = tensaoA0 * (R_SUPERIOR + R_INFERIOR) / R_INFERIOR;
}

// MEDIR CORRENTE
// ==========================================================
void medirCorrente() {
  int adc = analogRead(PIN_CORRENTE);

  float tensaoACS = adc * VREF / ADC_MAX;
  correnteInstantanea = (tensaoACS - ACS_ZERO) / ACS_SENSIBILIDADE;

  // FILTRO
  // ========================================================
  correnteFiltrada = correnteFiltrada * (1.0 - FILTRO_CORRENTE) + correnteInstantanea * FILTRO_CORRENTE;
  corrente = correnteFiltrada;

  // ZONA MORTA
  // ========================================================

  if ( corrente > -CORRENTE_ZERO && corrente < CORRENTE_ZERO ) {
    corrente = 0.0;
  }
}

// ATUALIZAR PERCENTUAL
// ==========================================================

void atualizarPercentual()
{
  // SEM CARREGADOR
  // USA TENSÃO
  // ========================================================

  if (!caboConectado) {
    percentual = calcularPercentualTensao(tensaoBateria);
    return;
  }

  // COM CARREGADOR
  // USA CORRENTE
  // ========================================================
  percentual = calcularPercentualCarga(corrente);
}

// PERCENTUAL DURANTE A CARGA
// ==========================================================

float calcularPercentualCarga(float I) {
  // Trabalha com o módulo da corrente

  float correnteCarga = I;

  if (correnteCarga < 0.0) {
    correnteCarga = -correnteCarga;
  }

  // CORRENTE MUITO BAIXA = CARREGADA
  // ========================================================

  if (correnteCarga <= CORRENTE_CARGA_COMPLETA) {
    return 100.0;
  }

  // CORRENTE ALTA
  // MANTÉM PERCENTUAL QUE TINHA AO CONECTAR
  // ========================================================

  if (correnteCarga >= CORRENTE_CARGA_INICIO) {
    return percentualInicioCarga;
  }

  // CONVERTER CORRENTE PARA 0...1
  //
  // 1.10 A -> 0
  // 0.20 A -> 1
  // ========================================================

  float progresso = (CORRENTE_CARGA_INICIO - correnteCarga) / (CORRENTE_CARGA_INICIO - CORRENTE_CARGA_COMPLETA);

  if (progresso < 0.0) {
    progresso = 0.0;
  }

  if (progresso > 1.0) {
    progresso = 1.0;
  }

  // INTERPOLAR DO SOC INICIAL ATÉ 100%
  // ========================================================
  float soc = percentualInicioCarga + progresso * (100.0 - percentualInicioCarga);

  if (soc < percentualInicioCarga) {
    soc = percentualInicioCarga;
  }

  if (soc > 100.0) {
    soc = 100.0;
  }

  return soc;
}

// MÉDIA PARA DISPLAY
// ==========================================================
void calcularMediaDisplay() {
  somaTensaoDisplay += tensaoBateria;
  somaCorrenteDisplay += corrente;
  contadorDisplay++;


  if (contadorDisplay >= NUM_AMOSTRAS_DISPLAY) {
    tensaoDisplay = somaTensaoDisplay / NUM_AMOSTRAS_DISPLAY;

    correnteDisplay = somaCorrenteDisplay / NUM_AMOSTRAS_DISPLAY;

    if ( correnteDisplay > -CORRENTE_ZERO && correnteDisplay < CORRENTE_ZERO ) {
      correnteDisplay = 0.0;
    }

    // PERCENTUAL DO DISPLAY
    // ======================================================
    if (caboConectado) {
      percentualDisplay = calcularPercentualCarga(correnteDisplay);
    } else {
      percentualDisplay = calcularPercentualTensao(tensaoDisplay);
    }

    oled.update_display(percentualDisplay, tensaoDisplay, correnteDisplay, estado);

    somaTensaoDisplay = 0.0;
    somaCorrenteDisplay = 0.0;
    contadorDisplay = 0;
  }
}

// ==========================================================
// DETERMINAR ESTADO
// ==========================================================
void determinarEstado() {
  if (!caboConectado && tensaoBateria <= TENSAO_BAIXA) {
    estado = BATERIA_BAIXA;
    return;
  }

  if (caboConectado) {
    if (corrente <= CORRENTE_CARGA_COMPLETA && corrente >= -CORRENTE_CARGA_COMPLETA) {
      estado = CARREGADA;
      return;
    }

    estado = CARREGANDO;
    return;
  }

  if (corrente < CORRENTE_DESCARGA_MIN) {
    estado = DESCARREGANDO;
    return;
  }

  estado = SEM_CORRENTE;
}

// PERCENTUAL PELA TENSÃO
// ==========================================================
float calcularPercentualTensao(float V) {
  return round( (40.909 * V) - 415.45 );
}

// SERIAL
// ==========================================================
// Quadro: tensao em decimos de V; corrente assinada em decimos de A;
// percentual entre 0 e 100; estado numerico. Campos separados por ';'.
void send_serial() {
    int16_t tensaoDecimos = (int16_t)round(tensaoBateria * 10.0);
    int16_t correnteDecimos = (int16_t)round(corrente * 10.0);
    int percentualSerial = (int)round(percentual);

    if (percentualSerial < 0) {
      percentualSerial = 0;
    } else if (percentualSerial > 100) {
      percentualSerial = 100;
    }

    Serial.print(tensaoDecimos);
    Serial.print(";");
    Serial.print(correnteDecimos);
    Serial.print(";");
    Serial.print(percentualSerial);
    Serial.print(";");
    Serial.print((uint8_t)estado);
    Serial.println();
}