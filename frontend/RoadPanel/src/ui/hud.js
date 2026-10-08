/**
 * HUD do painel: hora, velocidade, origem do dado, próxima manobra, missão e métricas.
 * Atualiza o DOM no máximo ~8x por segundo e só quando o texto muda.
 */
import { roleName, roleAhead } from '../track/mission.js';

const ICONS = {
  straight: '<path d="M24 41V9"/><path d="M13 20 24 9l11 11"/>',
  right: '<path d="M17 42v-9c0-9 5-15 15-18"/><path d="M24 10.5l8.5 4.3-4.6 8.3"/>',
  left: '<path d="M31 42v-9c0-9-5-15-15-18"/><path d="M24 10.5l-8.5 4.3 4.6 8.3"/>',
  stop: '<path d="M17.4 6h13.2L42 17.4v13.2L30.6 42H17.4L6 30.6V17.4z"/><path d="M15 24h18"/>',
  light: '<rect x="15" y="5" width="18" height="38" rx="7"/><circle cx="24" cy="14" r="3"/><circle cx="24" cy="24" r="3"/><circle cx="24" cy="34" r="3"/>',
  flag: '<path d="M12 43V7"/><path d="M12 9h24l-5 8 5 8H12"/>',
  done: '<circle cx="24" cy="24" r="17"/><path d="m16 24.5 5.5 5.5L33 18.5"/>',
  point: (letter) => `<path d="M24 5 40.5 14.5v19L24 43 7.5 33.5v-19z"/><text x="24" y="31" text-anchor="middle" font-size="19" font-weight="700" fill="currentColor" stroke="none" font-family="Saira, sans-serif">${letter}</text>`,
};

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

const SOURCE_TEXT = {
  sim: 'Simulação',
  live: 'Ao vivo',
  waiting: 'Aguardando o carro',
  stale: 'Dados parados',
  offline: 'Sem sinal do servidor',
  connecting: 'Conectando…',
};

export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '--';
  if (meters < 1) return `${Math.max(0, Math.round(meters * 100))} cm`;
  return `${meters.toFixed(1).replace('.', ',')} m`;
}

const roleOf = (index, total) => roleName(index, total);

/** Escolhe a próxima coisa que o motorista precisa saber, como nos mapas de carro. */
export function pickManeuver(plan, s, mission, missionDone) {
  if (missionDone) return { kind: 'done', icon: 'done', label: 'Percurso finalizado', distancePx: 0 };
  const next = plan.events.find((event) => event.s - s > 3 &&
    (event.type === 'turn' || event.type === 'stop' || event.type === 'traffic-light' || (event.type === 'point' && event.target)));
  if (!next) return { kind: 'flag', icon: 'flag', label: 'Volta à largada', distancePx: plan.length - s };
  const distancePx = next.s - s;
  if (next.type === 'turn') {
    const labels = { right: 'Curva suave à direita', left: 'Curva suave à esquerda', straight: 'Siga em frente' };
    return { kind: next.turn, icon: next.turn, label: labels[next.turn], distancePx };
  }
  if (next.type === 'stop') return { kind: 'stop', icon: 'stop', label: 'Placa PARE', distancePx };
  if (next.type === 'traffic-light') return { kind: 'light', icon: 'light', label: 'Semáforo', distancePx };
  const index = mission.all.indexOf(next.point, mission.doneCount);
  const label = index >= 0 ? roleAhead(index, mission.all.length) : `Ponto ${next.point} à frente`;
  return { kind: 'point', icon: 'point', point: next.point, label, distancePx };
}

export class Hud {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      clock: $('clock'),
      speed: $('speedValue'),
      source: $('source'),
      sourceText: $('sourceText'),
      traffic: $('trafficLight'),
      maneuver: $('maneuver'),
      icon: $('maneuverIcon'),
      distance: $('maneuverDistance'),
      label: $('maneuverLabel'),
      missionSource: $('missionSource'),
      missionRaw: $('missionRaw'),
      missionPoints: $('missionPoints'),
      missionEmpty: $('missionEmpty'),
      pwm: $('pwmValue'),
      servo: $('servoValue'),
      battery: $('batteryValue'),
      mode: $('modeValue'),
      estimate: $('estimateNote'),
      warning: $('missionWarning'),
    };
    this.last = 0;
    this.cache = new Map();
    this.maneuverKey = '';
  }

  set(key, element, value, prop = 'textContent') {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    element[prop] = value;
  }

  update(now, view) {
    if (now - this.last < 120) return;
    this.last = now;
    const { el } = this;
    const date = new Date();
    this.set('clock', el.clock, `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`);
    this.set('speed', el.speed, view.speedMs.toFixed(2).replace('.', ','));

    // Origem do dado: a simulação nunca se passa por dado real
    const sourceState = view.source === 'sim' ? 'sim' : view.linkStatus;
    if (this.cache.get('sourceState') !== sourceState) {
      this.cache.set('sourceState', sourceState);
      el.source.dataset.state = sourceState;
      el.sourceText.textContent = SOURCE_TEXT[sourceState] || sourceState;
    }

    const light = view.light || 'none';
    if (this.cache.get('light') !== light) {
      this.cache.set('light', light);
      el.traffic.dataset.state = light;
      const names = { red: 'vermelho', yellow: 'amarelo', green: 'verde', none: 'nenhum' };
      el.traffic.setAttribute('aria-label', `Semáforo: ${names[light]}`);
    }

    // Próxima manobra
    const m = pickManeuver(view.plan, view.s, view.mission, view.missionDone);
    const key = `${m.kind}|${m.label}`;
    if (key !== this.maneuverKey) {
      this.maneuverKey = key;
      el.maneuver.dataset.kind = m.kind;
      el.icon.innerHTML = m.icon === 'point' ? ICONS.point(m.point) : ICONS[m.icon];
      el.label.textContent = m.label;
      el.maneuver.classList.remove('is-changing');
      void el.maneuver.offsetWidth;
      el.maneuver.classList.add('is-changing');
    }
    this.set('distance', el.distance, m.kind === 'done' ? 'Fim' : formatDistance(m.distancePx * view.metersPerPx));

    // Missão: o que veio do código + papel de cada ponto
    const { all, doneCount, raw, source } = view.mission;
    this.set('missionSource', el.missionSource, source);
    this.set('missionRaw', el.missionRaw, raw && all.length ? `Recebido: ${raw}` : 'Nenhuma missão recebida');
    const missionKey = `${all.join('')}|${doneCount}`;
    if (this.cache.get('mission') !== missionKey) {
      this.cache.set('mission', missionKey);
      el.missionPoints.innerHTML = all.map((p, i) => {
        const done = i < doneCount;
        const current = i === doneCount;
        const cls = done ? 'is-done' : current ? 'is-current' : '';
        const state = done ? 'concluído' : current ? 'próximo' : 'pendente';
        return `<li class="${cls}" aria-label="${roleOf(i, all.length)} no ponto ${p}, ${state}">
          <span class="route-point">${done ? CHECK : p}</span>
          <span class="route-role">${roleOf(i, all.length)}${done ? ` ${p}` : ''}</span>
        </li>`;
      }).join('');
      el.missionEmpty.hidden = all.length > 0;
    }

    // Métricas
    const data = view.source === 'live' ? view.data : null;
    this.set('pwm', el.pwm, data ? String(Math.round(data.pwm)) : '--');
    this.set('servo', el.servo, data ? `${Math.round(data.servo)}°` : '--');
    this.set('battery', el.battery, data && data.battery ? `${Math.round(data.battery)}%` : '--');
    let mode = '--';
    if (view.source === 'sim') {
      if (view.missionDone) mode = 'Percurso finalizado';
      else if (view.sim.freeDrive) mode = 'Direção livre';
      else if (view.sim.held) mode = 'Parado na placa';
      else mode = view.sim.playing ? 'Simulando' : 'Pausado';
    } else if (data) {
      mode = data.controlMode ? data.controlMode.charAt(0) + data.controlMode.slice(1).toLowerCase() : (data.running ? 'Em movimento' : 'Parado');
    }
    this.set('mode', el.mode, mode);
    const unreachable = view.plan?.unreachable || [];
    this.set('warning', el.warning, unreachable.length
      ? (view.plan.mode === 'car'
        ? `A tabela lane_guide_map não leva a ${unreachable.join(', ')} com as placas nestas posições. Use "Caminho livre" no debug.`
        : `Não há caminho até ${unreachable.join(', ')} a partir desta partida.`)
      : '');
    this.set('warningHidden', el.warning, unreachable.length === 0, 'hidden');
    this.set('estimate', el.estimate, view.source !== 'live' || view.linkStatus !== 'live', 'hidden');
    if (view.locator) this.set('estimateText', el.estimate, view.locator);
  }
}
