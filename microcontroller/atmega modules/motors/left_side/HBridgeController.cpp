#include <Arduino.h>
#include "HBridgeController.h"

HBridgeController::HBridgeController(int rpwm, int lpwm, int enR, int enL) {
    _rpwm = rpwm;
    _lpwm = lpwm;
    _enR = enR;
    _enL = enL;

    _vel = 0;
    _targetVel = 0;

    _isAccelerationEnable = false;
    _accStep = 5; 
    _lastUpdate = 0;
}

void HBridgeController::applyPWM(int vel) {
    analogWrite(_rpwm, vel > 0 ? vel : 0);
    analogWrite(_lpwm, vel < 0 ? abs(vel) : 0);
}

void HBridgeController::begin() {
    pinMode(_rpwm, OUTPUT);
    pinMode(_lpwm, OUTPUT);

    if (_enR != 0 && _enL != 0) {
        pinMode(_enR, OUTPUT);
        pinMode(_enL, OUTPUT);

        digitalWrite(_enR, HIGH);
        digitalWrite(_enL, HIGH);
    }

    stop();
}

void HBridgeController::enableAcceleration(bool value) {
    _isAccelerationEnable = value;
}

void HBridgeController::setAcceleration(int step) {
    _accStep = step;
}

void HBridgeController::move(int vel) {
    _targetVel = constrain(vel, -255, 255);

    if (!_isAccelerationEnable) {
        _vel = _targetVel;
        applyPWM(_vel);
    }
}

void HBridgeController::update() {
    if (!_isAccelerationEnable) return;

    if (millis() - _lastUpdate < 10) return;
    _lastUpdate = millis();

    if (_vel < _targetVel) {
        _vel += _accStep;
        if (_vel > _targetVel) _vel = _targetVel;
    }
    else if (_vel > _targetVel) {
        _vel -= _accStep;
        if (_vel < _targetVel) _vel = _targetVel;
    }

    applyPWM(_vel);
}

void HBridgeController::stop() {
    _vel = 0;
    _targetVel = 0;
    applyPWM(0);
}

int HBridgeController::getSpeed() {
    return _vel;
}
