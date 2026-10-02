#include <Arduino.h>
#include <ArduinoJson.h>
#include "SerialProtocol.h"
#include "CANProtocol.h"

String buffer = "";
char serial1_buffer[32];
uint8_t serial1_index = 0;

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

      buffer = ""; // limpa depois de processar
      return true;
    }

    buffer += c;
  }

  return false;
}


void processCommand(CarCommand &cmd) {
  // Envia o comando para o módulo de controle via CAN
  sendMotorCommand(MOTOR_COMMAND, (int16_t)(cmd.servo - 90), cmd.speed, cmd.reverse, cmd.stop, cmd.vehicleState);
}


void sendTelemetry(const Telemetry& telemetry) {
  StaticJsonDocument<256> doc;

  doc["bat"] = telemetry.battery_percentage;
  doc["bat_state"] = telemetry.battery_state;

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


void readSerial1(int &battery, int &current, int &percentage, uint8_t &battery_state) {
  while (Serial1.available()) {
    char c = Serial1.read();

    if (c == '\n') {
      serial1_buffer[serial1_index] = '\0';
      serial1_index = 0;

      sscanf(
        serial1_buffer,
        "%d;%d;%d;%hhu",
        &battery,
        &current,
        &percentage,
        &battery_state
      );
    }
    else if (c != '\r' && serial1_index < sizeof(serial1_buffer) - 1) {
      serial1_buffer[serial1_index++] = c;
    }
  }
}