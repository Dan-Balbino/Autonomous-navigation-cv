#include "SerialProtocol.h"
#include "CANProtocol.h"

// ---------- Buffers da Serial (PC) ----------
static char cmdBuf[160];
static uint8_t cmdIndex = 0;
static bool cmdOverflow = false;

// ---------- Buffers da Serial1 (bateria) ----------
static char serial1_buffer[48];
static uint8_t serial1_index = 0;
static bool serial1_overflow = false;

// ---------- Diagnóstico ----------
int freeRam() {
  extern int __heap_start, *__brkval;
  int v;
  return (int)&v - (__brkval == 0 ? (int)&__heap_start : (int)__brkval);
}

// ---------- Recepção de comandos ----------
bool receiveCommand(CarCommand &cmd) {
  while (Serial.available() > 0) {
    char c = Serial.read();

    if (c == '\r') continue;

    if (c == '\n') {
      bool ok = false;

      // só processa se a linha chegou inteira
      if (!cmdOverflow && cmdIndex > 0) {
        cmdBuf[cmdIndex] = '\0';

        static JsonDocument doc;
        doc.clear();

        if (!deserializeJson(doc, cmdBuf)) {
          cmd.run = doc["run"];
          cmd.lights = doc["lights"];
          cmd.stop = doc["stop"];
          cmd.servo = doc["servo"];
          cmd.speed = constrain((int)doc["speed"], 0, 255);
          if (cmd.speed < 30) {
            cmd.speed = 0;
          }
          cmd.reverse = doc["reverse"];
          cmd.mission_state = doc["mission_state"];
          ok = true;
        }
      }

      cmdIndex = 0;
      cmdOverflow = false;
      return ok;
    }

    if (cmdIndex < sizeof(cmdBuf) - 1) {
      cmdBuf[cmdIndex++] = c;
    } else {
      cmdOverflow = true;  // linha grande demais — descarta até o próximo '\n'
    }
  }

  return false;
}

// ---------- Envio pro CAN ----------
void processCommand(CarCommand &cmd) {
  // Envia o comando para o módulo de controle via CAN
  bool estado;
  if (cmd.run) {
    estado = cmd.vehicleState;
  } else {
    estado = true;
  }

  sendMotorCommand(MOTOR_COMMAND, (int16_t)(cmd.servo - 90), cmd.speed, cmd.reverse, cmd.stop, estado);
}

// ---------- Telemetria ----------
void sendTelemetry(const Telemetry &telemetry) {
  static JsonDocument doc;
  doc.clear();

  doc["bat"] = telemetry.battery_percentage;
  doc["bat_state"] = telemetry.battery_state;
  doc["run_btn"] = telemetry.run_button;
  doc["ram"] = freeRam();

  JsonObject speed = doc["speed"].to<JsonObject>();
  speed["speed1"] = telemetry.speed1;
  speed["speed2"] = telemetry.speed2;
  speed["speed3"] = telemetry.speed3;
  speed["speed4"] = telemetry.speed4;

  JsonObject ultrasonic = doc["ultrasonic"].to<JsonObject>();
  ultrasonic["left"]    = telemetry.left;
  ultrasonic["f_left"]  = telemetry.f_left;
  ultrasonic["f_right"] = telemetry.f_right;
  ultrasonic["right"]   = telemetry.right;

  JsonObject can = doc["can"].to<JsonObject>();
  for (int i = 0; i < NUM_CAN_MODULES; i++) {
    can[telemetry.canModules[i].name] = telemetry.canModules[i].status;
  }

  serializeJson(doc, Serial);
  Serial.println();
}

// ---------- Leitura da Serial1 ----------
bool readSerial1(uint8_t &battery, uint8_t &current, uint8_t &percentage, uint8_t &battery_state) {
  bool received = false;

  while (Serial1.available()) {
    char c = Serial1.read();

    if (c == '\r') continue;

    if (c == '\n') {
      // só processa se a linha chegou inteira
      if (!serial1_overflow && serial1_index > 0) {
        serial1_buffer[serial1_index] = '\0';

        int b, cur, pct, st;
        if (sscanf(serial1_buffer, "%d;%d;%d;%d", &b, &cur, &pct, &st) == 4) {
          battery       = constrain(b, 0, 255);
          current       = constrain(cur, 0, 255);
          percentage    = constrain(pct, 0, 100);
          battery_state = constrain(st, 0, 255);
          received = true;
        }
      }
      serial1_index = 0;
      serial1_overflow = false;
    }
    else if (serial1_index < sizeof(serial1_buffer) - 1) {
      serial1_buffer[serial1_index++] = c;
    }
    else {
      serial1_overflow = true;  // linha grande demais — descarta até o próximo '\n'
    }
  }

  return received;
}