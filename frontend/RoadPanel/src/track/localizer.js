/**
 * Posição do carro real na trajetória, sem GPS: odometria + marcos.
 *
 * - Odometria: integra a velocidade da telemetria (média das 4 rodas, car.telemetry.speed).
 *   Sem telemetria (0 com o carro andando), estima pelo PWM efetivo × fator do debug.
 * - Marcos: cada coisa que o carro detecta corrige a posição para o lugar da placa na pista:
 *   placa de desvio (hud.right_detour_active), semáforo à vista (hud.traffic_light_code),
 *   PARE (hud.stop_active) e ponto confirmado (a lista de nav.route encolhe).
 * - Portões: a estimativa não passa de uma placa de desvio nem do ponto-alvo antes de o
 *   carro confirmar; se ela "chegar antes", espera ali. Se o carro andar bem além disso
 *   sem detectar (placa perdida), o portão é liberado para não travar o mapa.
 *
 * Distâncias em px da imagem da pista (ver trackData.js).
 */

// Distância de detecção (px antes da placa) em que o marco costuma disparar
const LEAD = { detour: 40, 'traffic-light': 90, stop: 30 };
// Janela de busca do marco: pouco atrás (a estimativa pode ter passado) e bem à frente
const SEARCH_BACK = 160;
const SEARCH_AHEAD = 520;
const GATE_SLACK = 20;          // quanto a estimativa pode passar do portão
const GATE_RELEASE = 220;       // odometria além do portão para desistir de esperar

const REF_LABELS = {
  detour: 'placa de desvio',
  'traffic-light': 'semáforo',
  stop: 'placa PARE',
  point: 'ponto',
  start: 'largada',
};

export class Localizer {
  constructor() {
    this.prev = null;
    this.detours = 0;             // desvios vistos desde o último ponto (nav.action_counter)
    this.ref = null;
    this.reset();
  }

  /** Plano novo (s volta a 0 na largada ou no ponto de replanejamento). */
  reset() {
    this.gateFloor = -Infinity;   // portões até aqui já foram confirmados
    this.overflow = 0;
    this.waiting = null;          // portão em que a estimativa está esperando
    this.speedSource = 'none';
  }

  /** Velocidade estimada (m/s) e de onde veio. */
  speed(data, pwmToMs) {
    if (!data || !data.running) {
      this.speedSource = data ? 'parado' : 'none';
      return 0;
    }
    if (data.speed > 0.005) {
      this.speedSource = 'telemetria';
      return data.speed;
    }
    if (data.pwm > 0 && pwmToMs > 0) {
      this.speedSource = 'pwm';
      return data.pwm * pwmToMs;
    }
    this.speedSource = 'parado';
    return 0;
  }

  /**
   * Um quadro de localização. Devolve o novo s (px) da trajetória.
   * `routeShrank` = o servidor confirmou um ponto neste quadro (o PARE do ponto não é marco);
   * `hasRoute` = nav.route não está vazia (sem rota, update_lane não conta desvios).
   */
  step(plan, s, data, dt, speedMs, metersPerPx, now, { routeShrank = false, hasRoute = true } = {}) {
    // 1) Odometria
    let next = s + (speedMs / metersPerPx) * dt;

    // 2) Marcos: bordas de subida do que o carro detectou
    const prev = this.prev;
    if (data && prev) {
      if (data.rightDetour && !prev.rightDetour) {
        next = this.snap(plan, next, 'detour', now) ?? next;
        if (hasRoute) this.detours += 1;
      }
      if (data.trafficLight >= 0 && prev.trafficLight < 0) next = this.snap(plan, next, 'traffic-light', now) ?? next;
      if (data.stopActive && !prev.stopActive && !routeShrank) next = this.snap(plan, next, 'stop', now) ?? next;
    }
    this.prev = data ? { rightDetour: data.rightDetour, trafficLight: data.trafficLight, stopActive: data.stopActive } : null;

    // 3) Portão: não passa da próxima placa de desvio / ponto-alvo sem confirmação
    const gate = plan.events.find((e) => e.s > this.gateFloor + 1 &&
      (e.type === 'detour' || (e.type === 'point' && e.target)));
    if (gate && next > gate.s + GATE_SLACK) {
      this.overflow += next - Math.max(s, gate.s + GATE_SLACK);
      if (this.overflow > GATE_RELEASE) {
        this.gateFloor = gate.s;          // placa perdida: segue a estimativa
        this.overflow = 0;
        this.waiting = null;
      } else {
        next = Math.max(s, gate.s + GATE_SLACK);
        this.waiting = gate;
      }
    } else {
      this.waiting = null;
    }
    return next;
  }

  /** Corrige s para o marco `type` mais provável perto da estimativa. */
  snap(plan, s, type, now) {
    let best = null;
    for (const event of plan.events) {
      if (event.type !== type) continue;
      const d = event.s - s;
      if (d < -SEARCH_BACK || d > SEARCH_AHEAD) continue;
      // Prefere o primeiro à frente; atrás só se não houver nenhum à frente
      const score = d >= -LEAD[type] ? Math.abs(d) : Math.abs(d) + SEARCH_AHEAD;
      if (!best || score < best.score) best = { event, score };
    }
    if (!best) return null;
    const target = Math.max(0, best.event.s - LEAD[type]);
    if (type === 'detour') this.gateFloor = Math.max(this.gateFloor, best.event.s);
    this.overflow = 0;
    this.ref = { type, label: REF_LABELS[type], at: now };
    return target;
  }

  /** O servidor confirmou um ponto: o carro está na placa dele (nav zera o contador). */
  confirmPoint(now) {
    this.detours = 0;
    this.ref = { type: 'point', label: REF_LABELS.point, at: now };
  }

  /** Entrou no modo real: esquece contadores e referências da sessão anterior. */
  restart() {
    this.prev = null;
    this.detours = 0;
    this.ref = null;
    this.reset();
  }

  /** Volta fechada (passou pela largada). */
  lapStart(now) {
    this.reset();
    this.ref = { type: 'start', label: REF_LABELS.start, at: now };
  }

  /** Texto curto para o HUD. */
  describe(now) {
    if (this.waiting) {
      const what = this.waiting.type === 'detour' ? 'a placa de desvio' : `o ponto ${this.waiting.point}`;
      return `Aguardando o carro detectar ${what}`;
    }
    if (!this.ref) return 'Posição estimada pela velocidade; aguardando a primeira referência';
    const seconds = Math.max(0, Math.round((now - this.ref.at) / 1000));
    const ago = seconds < 2 ? 'agora' : `há ${seconds} s`;
    return `Posição estimada · última referência: ${this.ref.label} (${ago})`;
  }
}
