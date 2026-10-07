import { clamp } from "../utils/dom.js";
import { ZONE } from "../utils/api.js";

/**
 * Traduz o estado do carro (car.command + car.telemetry) em expressoes.
 *
 * Gera dois tipos de saida:
 * - eventos pontuais (ingest): "fright", "surprise", "search",
 *   "accelerateOn"/"accelerateOff", "squintOn"/"squintOff";
 * - humor continuo (mood): direcao do olhar, foco, preocupacao, sono e alegria,
 *   valores 0..1 que o FaceEngine suaviza a cada frame.
 */

const DEFAULTS = {
  staleAfterMs: 3000,
  mirror: true,
  steeringInvert: false,
  steeringRange: 45,
  steeringGazePx: 120,
  obstacleGlancePx: 14,
  acceleratePwmOn: 100,
  acceleratePwmOff: 85,
  focusPwmMin: 30,
  focusPwmMax: 100,
  sleepAfterIdleMs: 45000,
  sleepRampMs: 8000,
  sleepyGazeDownPx: 10,
  lowBatteryPercent: 20,
  disconnectedSleepy: 0.3,
  happyDurationMs: 1400,
  cooldownMs: {
    fright: 4000,
    surprise: 2500,
    search: 6000,
    happy: 3000,
  },
};

const SENSOR_KEYS = ["left", "frontLeft", "frontRight", "right"];
const FRONT_KEYS = ["frontLeft", "frontRight"];

// Preocupacao por zona do ultrassonico: [livre, longe, perto, critico]
const WORRY_FRONT = [0, 0.1, 0.55, 1];
const WORRY_SIDE = [0, 0, 0.3, 0.6];

const NEUTRAL_MOOD = {
  connected: false,
  driving: false,
  gazeX: 0,
  gazeY: 0,
  focus: 0,
  worry: 0,
  sleepy: 0,
  happy: 0,
};

export class CarMood {
  constructor(config = {}) {
    this.config = {
      ...DEFAULTS,
      ...config,
      cooldownMs: { ...DEFAULTS.cooldownMs, ...(config.cooldownMs || {}) },
    };
    this.car = null;
    this.prev = null;
    this.connected = false;
    this.lastOkAt = -Infinity;
    this.lastTs = null;
    this.lastTsChangeAt = -Infinity;
    this.lastEventAt = {};
    this.accelerate = false;
    this.squint = false;
    this.idleSince = null;
    this.happyUntil = 0;
  }

  /**
   * Recebe uma nova leitura (ou null se a requisicao falhou) e devolve os eventos disparados.
   */
  ingest(car, now) {
    const events = [];
    const cfg = this.config;

    if (car) {
      this.lastOkAt = now;
      // _ts parado = main.py travado/encerrado, mesmo com o Flask respondendo
      if (car.ts === null || car.ts !== this.lastTs) {
        this.lastTs = car.ts;
        this.lastTsChangeAt = now;
      }
    }

    const wasConnected = this.connected;
    this.connected =
      now - this.lastOkAt <= cfg.staleAfterMs &&
      now - this.lastTsChangeAt <= cfg.staleAfterMs;

    if (!this.connected) {
      if (wasConnected) {
        this.releaseHeldStates(events);
        this.car = null;
        this.prev = null;
        this.idleSince = null;
      }
      return events;
    }

    // Reconectou: olha em volta como quem acabou de acordar
    if (!wasConnected) {
      this.fire("search", now, events);
    }
    if (!car) {
      return events;
    }

    const prev = this.prev;
    this.prev = car;
    this.car = car;

    if (prev) {
      this.detectEdges(prev, car, now, events);
    }
    this.updateHeldStates(car, now, events);
    return events;
  }

  detectEdges(prev, car, now, events) {
    // Susto: um sensor saiu de livre/longe direto para critico
    const suddenCritical = SENSOR_KEYS.some(
      (k) => car.sensors[k] >= ZONE.CRITICAL && prev.sensors[k] <= ZONE.FAR
    );

    if (suddenCritical) {
      this.fire("fright", now, events);
    } else {
      const frontApproach = FRONT_KEYS.some(
        (k) => car.sensors[k] >= ZONE.NEAR && prev.sensors[k] <= ZONE.FAR
      );
      const personAppeared = car.personDetected && !prev.personDetected;
      const emergencyStop = car.stop && !prev.stop && car.running;
      // PWM zerado andando sem placa de pare nem sinal vermelho = freada inesperada (pessoa/obstaculo)
      const unexpectedStop =
        prev.running && car.running && prev.speed > 0 && car.speed === 0 &&
        !car.stopSign && car.trafficLight !== 0;

      if (frontApproach || personAppeared || emergencyStop || unexpectedStop) {
        this.fire("surprise", now, events);
      }
    }

    if (car.rightDetour && !prev.rightDetour) {
      this.fire("search", now, events);
    }

    const started = car.running && !prev.running;
    const greenAfterWait = car.trafficLight === 2 && (prev.trafficLight === 0 || prev.trafficLight === 1);
    if ((started || greenAfterWait) && this.fire("happy", now, events)) {
      this.happyUntil = now + this.config.happyDurationMs;
    }
  }

  updateHeldStates(car, now, events) {
    const cfg = this.config;
    const driving = car.running && car.speed > 0;

    // Histerese evita liga/desliga quando o PWM oscila perto do limite
    const accelerate = this.accelerate
      ? driving && car.speed >= cfg.acceleratePwmOff
      : driving && car.speed >= cfg.acceleratePwmOn;
    if (accelerate !== this.accelerate) {
      this.accelerate = accelerate;
      events.push(accelerate ? "accelerateOn" : "accelerateOff");
    }

    // Placa de PARE ou semaforo vermelho: olhos "lendo" com oculos
    const squint = car.stopSign || car.trafficLight === 0;
    if (squint !== this.squint) {
      this.squint = squint;
      events.push(squint ? "squintOn" : "squintOff");
    }

    if (driving) {
      this.idleSince = null;
    } else if (this.idleSince === null) {
      this.idleSince = now;
    }
  }

  releaseHeldStates(events) {
    if (this.accelerate) {
      this.accelerate = false;
      events.push("accelerateOff");
    }
    if (this.squint) {
      this.squint = false;
      events.push("squintOff");
    }
  }

  fire(name, now, events) {
    const cooldown = this.config.cooldownMs[name] ?? 0;
    const last = this.lastEventAt[name] ?? -Infinity;
    if (now - last < cooldown) return false;
    this.lastEventAt[name] = now;
    events.push(name);
    return true;
  }

  /**
   * Converte uma direcao do carro (positivo = direita do carro) para a tela.
   * Com `mirror` (tela na frente do carro olhando para fora), a direita do carro
   * aparece a esquerda para quem esta de frente.
   */
  toScreen(direction) {
    return this.config.mirror ? -direction : direction;
  }

  /**
   * Humor continuo para o frame atual.
   */
  mood(now) {
    const cfg = this.config;
    const car = this.car;
    if (!this.connected || !car) {
      return { ...NEUTRAL_MOOD, sleepy: cfg.disconnectedSleepy };
    }

    const driving = car.running && car.speed > 0;

    // Olhar acompanha o servo (90 = reto)
    const steerSign = cfg.steeringInvert ? -1 : 1;
    const steer = clamp(((car.servo - 90) * steerSign) / cfg.steeringRange, -1, 1);
    let gazeX = this.toScreen(steer * cfg.steeringGazePx);

    // Espia o lado do obstaculo mais proximo
    const { left, frontLeft, frontRight, right } = car.sensors;
    const leftThreat = Math.max(left, frontLeft);
    const rightThreat = Math.max(right, frontRight);
    if (Math.max(leftThreat, rightThreat) >= ZONE.NEAR && leftThreat !== rightThreat) {
      const side = leftThreat > rightThreat ? -1 : 1;
      gazeX += this.toScreen(side * cfg.obstacleGlancePx);
    }

    let worry = Math.max(
      WORRY_FRONT[Math.max(frontLeft, frontRight)],
      WORRY_SIDE[Math.max(left, right)]
    );
    if (car.trafficLight === 1) worry = Math.max(worry, 0.35);
    if (car.reverse) worry = Math.max(worry, 0.25);

    const focus = driving
      ? clamp((car.speed - cfg.focusPwmMin) / (cfg.focusPwmMax - cfg.focusPwmMin), 0, 1)
      : 0;

    let sleepy = 0;
    if (this.idleSince !== null) {
      sleepy = 0.85 * clamp((now - this.idleSince - cfg.sleepAfterIdleMs) / cfg.sleepRampMs, 0, 1);
    }
    if (car.battery !== null && car.battery <= cfg.lowBatteryPercent) {
      sleepy = Math.max(sleepy, 0.45);
    }

    const happy = now < this.happyUntil ? 1 : 0;

    return {
      connected: true,
      driving,
      gazeX,
      gazeY: sleepy * cfg.sleepyGazeDownPx - happy * 4,
      focus,
      worry,
      sleepy,
      happy,
    };
  }

  /** Texto curto para o overlay de debug. */
  describe() {
    const car = this.car;
    if (!this.connected || !car) return "carro: sem sinal";
    const s = car.sensors;
    return [
      car.running ? "RUN" : "PARADO",
      `pwm ${car.speed}`,
      `servo ${car.servo}`,
      `us ${s.left}${s.frontLeft}${s.frontRight}${s.right}`,
      car.stopSign ? "PARE" : null,
      car.trafficLight >= 0 ? `sem ${car.trafficLight}` : null,
      car.battery !== null ? `bat ${car.battery}%` : null,
    ].filter(Boolean).join(" · ");
  }
}
