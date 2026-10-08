/**
 * Leitura do estado do carro no servidor (Flask, messaging/messaging_core.py).
 *
 * GET /api/vehicle_info -> { hud: { route, speed, servo, running, traffic_light_code,
 *   stop_active, right_detour_active, control_mode, ... }, command,
 *   telemetry: { speed, speed1..4, battery, left, f_left, f_right, right, ... }, _ts }
 *
 * `hud.route` espelha `nav.route` (core/navigation.py) como texto, ex.: "A → B → C".
 * Tudo aqui é tolerante: servidor fora, JSON vazio, campos ausentes ou _ts parado
 * viram estados explícitos, nunca exceções.
 *
 * URL: ?apiBase=http://host:5000/api  |  ?apiHost=..&apiPort=..  |  mesma origem (/api).
 */
import { parseRoute } from '../track/planner.js';

const POLL_MS = 200;          // rápido o bastante para o mapa parar junto com o carro
const OFFLINE_POLL_MS = 2000;
const TIMEOUT_MS = 1500;
const STALE_MS = 3000;

function param(name) {
  try {
    const value = new URLSearchParams(location.search).get(name);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export function apiBase() {
  const explicit = param('apiBase');
  if (explicit) return explicit.replace(/\/+$/, '');
  const host = param('apiHost');
  const port = param('apiPort');
  if (host || port) return `http://${host || location.hostname || '127.0.0.1'}:${port || '5000'}/api`;
  if (location.protocol.startsWith('http')) return `${location.origin}/api`;
  return 'http://127.0.0.1:5000/api';
}

const num = (value, fallback = null) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** Converte a resposta crua num estado plano; null se ainda não há dados. */
export function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const hud = raw.hud && typeof raw.hud === 'object' ? raw.hud : null;
  if (!hud) return null;
  const telemetry = raw.telemetry && typeof raw.telemetry === 'object' ? raw.telemetry : {};
  const command = raw.command && typeof raw.command === 'object' ? raw.command : {};
  // Aceita lista estruturada se o servidor passar a mandar (route_list), senão o texto
  const routeSource = Array.isArray(hud.route_list) ? hud.route_list : hud.route;
  return {
    ts: num(raw._ts),
    route: parseRoute(routeSource),
    routeText: typeof hud.route === 'string' ? hud.route : '',
    running: Boolean(command.run ?? hud.running),
    pwm: num(command.speed ?? hud.speed, 0),
    servo: num(command.servo ?? hud.servo, 90),
    speed: num(telemetry.speed, 0),           // m/s (car.telemetry.speed = média das rodas)
    wheels: [1, 2, 3, 4].map((i) => num(telemetry[`speed${i}`], 0)),
    battery: num(telemetry.battery),
    // Zonas dos ultrassônicos: 0 livre, 1 longe (~50 cm), 2 perto (~30 cm), 3 crítico (~8 cm)
    proximity: {
      left: num(telemetry.left, 0),
      frontLeft: num(telemetry.f_left, 0),
      frontRight: num(telemetry.f_right, 0),
      right: num(telemetry.right, 0),
    },
    trafficLight: num(hud.traffic_light_code, -1),
    stopActive: Boolean(hud.stop_active),
    rightDetour: Boolean(hud.right_detour_active),
    // main.py liga command.stop quando a IA vê uma pessoa
    pedestrian: Boolean(command.stop),
    controlMode: typeof hud.control_mode === 'string' ? hud.control_mode : '',
  };
}

export class CarLink {
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this.base = apiBase();
    this.status = 'connecting';   // connecting | live | waiting | stale | offline
    this.lastOkAt = 0;
    this.lastTs = null;
    this.lastTsChangeAt = 0;
    this.data = null;
    this.timer = null;
  }

  start() {
    const tick = async () => {
      await this.poll();
      // Sem servidor, tenta com menos frequência (reconecta sozinho quando ele voltar)
      this.timer = setTimeout(tick, this.status === 'offline' ? OFFLINE_POLL_MS : POLL_MS);
    };
    tick();
  }

  async poll() {
    const now = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(`${this.base}/vehicle_info`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = normalize(await response.json());
      this.lastOkAt = now;
      if (!data) {
        this.status = 'waiting';      // servidor no ar, main.py ainda não publicou
      } else {
        if (data.ts === null || data.ts !== this.lastTs) {
          this.lastTs = data.ts;
          this.lastTsChangeAt = now;
        }
        this.data = data;
        this.status = now - this.lastTsChangeAt > STALE_MS ? 'stale' : 'live';
      }
    } catch {
      this.status = now - this.lastOkAt > STALE_MS || !this.lastOkAt ? 'offline' : this.status;
    } finally {
      clearTimeout(timeout);
    }
    this.onUpdate?.(this.status, this.data);
  }
}
