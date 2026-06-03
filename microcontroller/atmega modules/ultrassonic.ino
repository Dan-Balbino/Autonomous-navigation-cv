#include <NewPing.h>

#define SONAR_NUM 3
#define FRONT_MAX_DISTANCE 200
#define LATERAL_MAX_DISTANCE 100
#define PING_INTERVAL 33  // ms entre cada ping (mínimo ~29ms)

#define FRONT_SAFE_DISTANCE 40
#define LATERAL_SAFE_DISTANCE 25


unsigned long pingTimer[SONAR_NUM]; // Quando cada sensor deve disparar
unsigned int cm[SONAR_NUM];         // Última leitura de cada sensor
uint8_t currentSensor = 0;          // Qual sensor está ativo agora

NewPing sonar[SONAR_NUM] = {
  NewPing(2, 3, FRONT_MAX_DISTANCE),  // Meio
  NewPing(4, 5, LATERAL_MAX_DISTANCE), // Esquerda 
  NewPing(6, 7, LATERAL_MAX_DISTANCE)  // Direita
};

void setup() {
  Serial.begin(9600);
  pingTimer[0] = millis() + 75; // Primeiro ping após 75ms
  for (uint8_t i = 1; i < SONAR_NUM; i++) {
    pingTimer[i] = pingTimer[i - 1] + PING_INTERVAL; // Escalonados
  }
}

void loop() {
  for (uint8_t i = 0; i < SONAR_NUM; i++) {
    if (millis() >= pingTimer[i]) {
      pingTimer[i] += PING_INTERVAL * SONAR_NUM; // Agenda próximo ciclo
      
      if (i == 0 && currentSensor == SONAR_NUM - 1) {
        // Todos os sensores leram — processa aqui!
        processarLeituras();
      }

      sonar[currentSensor].timer_stop();         // Para o timer anterior
      currentSensor = i;
      cm[currentSensor] = 0;                     // Reseta antes de pingar
      sonar[currentSensor].ping_timer(echoCheck); // Dispara sem bloquear
    }
  }
}

// Chamada por interrupção quando o echo retorna
void echoCheck() {
  if (sonar[currentSensor].check_timer()) {
    cm[currentSensor] = sonar[currentSensor].convert_cm(sonar[currentSensor].ping_result);
  } else {
    cm[currentSensor] = 0; // Sem leitura → força 0 explicitamente
  }
}

void processarLeituras() {
  bool front = cm[0] > 0 && cm[0] <= FRONT_SAFE_DISTANCE;
  bool esq = cm[1] > 0 && cm[1] <= LATERAL_SAFE_DISTANCE;
  bool dir = cm[2] > 0 && cm[2] <= LATERAL_SAFE_DISTANCE;

  if(front || esq || dir) {
    Serial.println("PARE");
  } else {
    Serial.println("PROSSIGA");
  }
  // LOG
  // Serial.print("Frontal: ");
  // Serial.print(cm[0] == 0 ? "LIVRE" : String(cm[0]) + "cm");
  // Serial.print(" | Esq: ");
  // Serial.print(cm[1] == 0 ? "LIVRE" : String(cm[1]) + "cm");
  // Serial.print(" | Dir: ");
  // Serial.println(cm[2] == 0 ? "LIVRE" : String(cm[2]) + "cm");
}


// Sistema de leitura não-bloqueante para 3 sensores ultrassônicos (NewPing).
// Os sensores são disparados de forma escalonada a cada 33ms usando ping_timer(),
// sem travar o loop com delay(). O echo retorna via interrupção (echoCheck),
// e a decisão só é tomada quando os 3 sensores completam um ciclo.
// Valor 0 em cm[] significa sem obstáculo detectado no alcance configurado.
