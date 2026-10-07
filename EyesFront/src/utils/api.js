/**
 * Comunicacao com o carro.
 *
 * GET /api/vehicle_info devolve o snapshot montado no main.py:
 *   {
 *     hud: { running, speed (PWM efetivo), servo, stop_active,
 *            traffic_light_code, right_detour_active, control_mode, ... },
 *     telemetry: { speed, battery, left, f_left, f_right, right, can },
 *     command?: car.command.to_dict()   // opcional: { run, lights, stop, servo, speed, reverse }
 *     _ts: timestamp da ultima atualizacao
 *   }
 *
 * Se o servidor passar a publicar `command` (car.command.to_dict()), ele tem
 * prioridade sobre o hud e libera stop/reverse/pessoa detectada (bit 0b100 de lights).
 */

import { VEHICLE_INFO_URL } from "./apiConfig.js";

// Zonas dos ultrassonicos (microcontroller/Apex/Types.h -> UltrassonicZone)
export const ZONE = { FREE: 0, FAR: 1, NEAR: 2, CRITICAL: 3 };

const LIGHT_PERSON_BIT = 0b100;

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toZone(value) {
  const n = Math.round(toNumber(value, ZONE.FREE));
  return Math.max(ZONE.FREE, Math.min(ZONE.CRITICAL, n));
}

function asObject(value) {
  return value && typeof value === "object" ? value : null;
}

/**
 * Converte o JSON de /api/vehicle_info num estado plano e tipado.
 * Retorna null enquanto o main.py ainda nao publicou nada (objeto vazio).
 */
export function normalizeCarState(raw) {
  const data = asObject(raw);
  if (!data) return null;

  const hud = asObject(data.hud);
  const command = asObject(data.command);
  const telemetry = asObject(data.telemetry) || {};
  if (!hud && !command) return null;

  const lights = toNumber(command?.lights, 0);
  const speed = toNumber(command?.speed ?? hud?.speed, 0);
  const run = Boolean(command ? command.run : hud?.running);
  const battery = toNumber(telemetry.battery, null);

  return {
    ts: toNumber(data._ts, null),
    hasCommand: Boolean(command),
    running: run || speed > 0,
    speed,
    servo: toNumber(command?.servo ?? hud?.servo, 90),
    stop: Boolean(command?.stop),
    reverse: Boolean(command?.reverse),
    personDetected: Boolean(lights & LIGHT_PERSON_BIT),
    stopSign: Boolean(hud?.stop_active),
    trafficLight: toNumber(hud?.traffic_light_code, -1),
    rightDetour: Boolean(hud?.right_detour_active),
    manual: hud?.control_mode === "MANUAL",
    realSpeed: toNumber(telemetry.speed, 0),
    // 0 = BMS sem leitura; so valores positivos contam como nivel real
    battery: battery !== null && battery > 0 ? battery : null,
    sensors: {
      left: toZone(telemetry.left),
      frontLeft: toZone(telemetry.f_left),
      frontRight: toZone(telemetry.f_right),
      right: toZone(telemetry.right),
    },
  };
}

/**
 * Busca o estado atual do carro.
 * Sem header Content-Type para o GET continuar "simples" e nao exigir preflight CORS.
 * @returns {Promise<{ok: boolean, car: Object|null}>}
 */
export async function fetchCarState(timeoutMs = 1200) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(VEHICLE_INFO_URL, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, car: null };
    }
    return { ok: true, car: normalizeCarState(await response.json()) };
  } catch {
    return { ok: false, car: null };
  } finally {
    clearTimeout(timer);
  }
}
