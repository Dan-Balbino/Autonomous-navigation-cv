#pragma once

// OLED
// ==========================================================
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 32
#define OLED_RESET -1

#include "BatteryState.h"

// SERIAL
// ==========================================================
const unsigned long BAUD_RATE = 115200;


// PINOS
// ==========================================================
const byte PIN_CABO_OUT = 10;
const byte PIN_CABO_IN  = 11;
const byte PIN_RELE = 13;

const byte PIN_TENSAO = A0;
const byte PIN_CORRENTE = A1;


// TENSÃO
// ==========================================================
const int V_MAX = 12.60;
const int V_MIN = 10.40;


// DIVISOR DE TENSÃO
// ==========================================================
const float R_SUPERIOR = 10000.0;
const float R_INFERIOR = 3300.0;


// ADC
// ==========================================================
const float VREF = 4.93;
const float ADC_MAX = 1023.0;


// ACS712-30A
// ==========================================================
const float ACS_SENSIBILIDADE = 0.0680;
float ACS_ZERO = 2.465;


// BATERIA LI-ION 3S
// ==========================================================
const float TENSAO_MAXIMA = 12.60;
const float TENSAO_BAIXA = 10.00;


// LIMITES DE CORRENTE
// ==========================================================
const float CORRENTE_CARGA_MIN = 0.50;
const float CORRENTE_DESCARGA_MIN = -0.30;
const float CORRENTE_ZERO = 0.20;


// PERCENTUAL DURANTE A CARGA
// ==========================================================

/*
   Quando o cabo estiver conectado:

   Corrente >= 1.10 A -> início/faixa baixa da carga
   Corrente <= 0.20 A -> 100%

   Entre 1.10 A e 0.20 A:
   percentual aumenta progressivamente.

   IMPORTANTE:
   O percentual nunca será menor que o percentual
   existente no momento em que o carregador foi conectado.
*/
const float CORRENTE_CARGA_INICIO = 1.10;
const float CORRENTE_CARGA_COMPLETA = 0.20;
float percentualInicioCarga = 0.0;
bool caboAnterior = false;


// FILTRO DE CORRENTE
// ==========================================================
const float FILTRO_CORRENTE = 0.10;
float correnteFiltrada = 0.0;


// VARIÁVEIS PRINCIPAIS
// ==========================================================
bool caboConectado = false;

float tensaoA0 = 0.0;
float tensaoBateria = 0.0;

float correnteInstantanea = 0.0;
float corrente = 0.0;

float percentual = 0.0;


// MÉDIA PARA O DISPLAY
// ==========================================================
const byte NUM_AMOSTRAS_DISPLAY = 20;

float somaTensaoDisplay = 0.0;
float somaCorrenteDisplay = 0.0;

byte contadorDisplay = 0;

float tensaoDisplay = 0.0;
float correnteDisplay = 0.0;
float percentualDisplay = 0.0;


// ESTADOS
// ==========================================================
EstadoBateria estado = SEM_CORRENTE;


// TEMPORIZADORES
// ==========================================================
unsigned long timerCabo = 0;
unsigned long timerTensao = 0;
unsigned long timerCorrente = 0;
unsigned long timerEstado = 0;
unsigned long timerSerial = 0;
unsigned long timerDisplay = 0;


// INTERVALOS
// ==========================================================
const unsigned long INTERVALO_CABO = 20;
const unsigned long INTERVALO_TENSAO = 100;
const unsigned long INTERVALO_CORRENTE = 20;
const unsigned long INTERVALO_ESTADO = 100;
const unsigned long INTERVALO_SERIAL = 500;

const unsigned long INTERVALO_DISPLAY = 50;
