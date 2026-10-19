#include "SerialProtocol.h"
#include "CANProtocol.h"

String buffer = "";

char serial1_buffer[48];
uint8_t serial1_index = 0;
bool serial1_overflow = false;

bool receiveCommand(CarCommand &cmd) {
  while (Serial.available() > 0) {
    char c = Serial.read();

    if (c == '\n') {
      JsonDocument doc;

      if (deserializeJson(doc, buffer)) {
        buffer = "";
        return false;
      }
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

      buffer = ""; // limpa depois de processar
      return true;
    }

    buffer += c;
  }

  return false;
}


void processCommand(CarCommand &cmd) {
  // Envia o comando para o módulo de controle via CAN
  bool parar;
  if (cmd.run) {
    parar = cmd.stop;
  } else {
    parar = false;
  }

  // Mantive cmd.stop como estava. Se a intenção for usar o `parar`, troque aqui.
  sendMotorCommand(MOTOR_COMMAND, (int16_t)(cmd.servo - 90), cmd.speed, cmd.reverse, cmd.stop, cmd.vehicleState);
}


void sendTelemetry(const Telemetry& telemetry) {
  StaticJsonDocument<256> doc;

  doc["bat"] = telemetry.battery_percentage;
  doc["bat_state"] = telemetry.battery_state;
  doc["run_btn"] = telemetry.run_button;

  JsonObject speed = doc.createNestedObject("speed");
  speed["speed1"] = telemetry.speed1;
  speed["speed2"] = telemetry.speed2;
  speed["speed3"] = telemetry.speed3;
  speed["speed4"] = telemetry.speed4;

  JsonObject ultrasonic = doc.createNestedObject("ultrasonic");
  ultrasonic["left"]  = telemetry.left;
  ultrasonic["f_left"] = telemetry.f_left;
  ultrasonic["f_right"]  = telemetry.f_right;
  ultrasonic["right"] = telemetry.right;

  JsonObject can = doc.createNestedObject("can");
  for (int i = 0; i < NUM_CAN_MODULES; i++) {
    can[telemetry.canModules[i].name] = telemetry.canModules[i].status;
  }

  serializeJson(doc, Serial);
  Serial.println();
}


void readSerial1(uint8_t &battery, uint8_t &current, uint8_t &percentage, uint8_t &battery_state) {
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
        }
      }
      serial1_index = 0;
      serial1_overflow = false;
    }
    else if (serial1_index < sizeof(serial1_buffer) - 1) {
      serial1_buffer[serial1_index++] = c;
    }
    else {
      serial1_overflow = true;   // linha grande demais — descarta até o próximo '\n'
    }
  }
}