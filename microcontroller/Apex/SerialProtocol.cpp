#include <Arduino.h>
#include <ArduinoJson.h>
#include "SerialProtocol.h"
#include "CANProtocol.h"

String buffer = "";


bool receiveCommand(CarCommand &cmd) {
  while (Serial.available() > 0) {
    char c = Serial.read();

    if (c == '\n') {
      JsonDocument doc;

      if (deserializeJson(doc, buffer)) {
        buffer = "";
        return false;
      }

      int tl = doc["tl"];
      int ls = doc["lights"];

      cmd.run = doc["run"];
      cmd.trafficLight = (TrafficLights)tl;
      cmd.lights = (Lights)ls;
      cmd.stop = doc["stop"];
      cmd.servo = doc["servo"];
      cmd.speed = doc["speed"];

      buffer = ""; // limpa depois de processar
      return true;
    }

    buffer += c;
  }

  return false;
}


void processCommand(CarCommand &cmd) {
  sendMotorCommand(MOTOR_COMMAND, (cmd.servo - 90), cmd.speed);
}


void sendTelemetry(const Telemetry& telemetry) {
  StaticJsonDocument<256> doc;

  doc["bat"] = telemetry.battery;

  JsonObject speed = doc.createNestedObject("speed");
  speed["speed1"] = telemetry.speed1;
  speed["speed2"] = telemetry.speed2;
  speed["speed3"] = telemetry.speed3;
  speed["speed4"] = telemetry.speed4;

  JsonObject ultrasonic = doc.createNestedObject("ultrasonic");
  ultrasonic["front"] = telemetry.front;
  ultrasonic["left"]  = telemetry.left;
  ultrasonic["right"] = telemetry.right;

  JsonObject can = doc.createNestedObject("can");
  for (int i = 0; i < NUM_CAN_MODULES; i++) {
    can[telemetry.canModules[i].name] = telemetry.canModules[i].status;
  }

  serializeJson(doc, Serial);
  Serial.println();
}