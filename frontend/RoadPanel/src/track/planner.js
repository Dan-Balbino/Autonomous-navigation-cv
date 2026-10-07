/**
 * Rota (missão) -> trajetória esperada e eventos.
 *
 * A rota chega em tempo de execução (servidor: `hud.route`, que espelha `nav.route`
 * de core/navigation.py; ou o debug). Dois modos:
 * - 'car' (lógica do carro): reproduz as decisões do código real (ver carLogic.js);
 * - 'shortest' (menor caminho): visita os pontos na ordem pelo menor caminho (todas as
 *   faixas em mão dupla) e volta à largada.
 * Rota vazia = volta externa.
 */
import { walkCarLogic } from './carLogic.js';

const VALID_POINTS = new Set(['A', 'B', 'C']);
const NODE_TURN_EVENT_DEG = 30;

/**
 * Lê a rota em qualquer formato: "A → B → C", "A -> B", "A,B", ["A","B"], "Nenhum ponto", null.
 * Devolve só pontos válidos, em maiúsculas, na ordem.
 */
export function parseRoute(raw) {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim().toUpperCase()).filter((p) => VALID_POINTS.has(p));
  }
  if (typeof raw !== 'string') return [];
  return raw
    .split(/→|->|,|;|\||\s+/)
    .map((token) => token.trim().toUpperCase())
    .filter((token) => VALID_POINTS.has(token));
}

export function sameRoute(a, b) {
  return a.length === b.length && a.every((p, i) => p === b[i]);
}

const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

/**
 * Monta o plano a partir de `start` = { edgeId, s }.
 * Devolve { edges, line, ranges, events, length, targets, unreachable }.
 */
export function buildPlan(network, start, queue, { mode = 'shortest', detoursDone = 0 } = {}) {
  if (mode === 'car') {
    const walk = walkCarLogic(network, start, queue, detoursDone);
    return finishPlan(network, start, walk.edges, walk.targets, walk.unreachable, mode);
  }
  const edges = [network.edge(start.edgeId)];
  let current = edges[0];
  let currentS = start.s;
  const targets = [];          // { point, edgeIndex } na ordem da rota
  const unreachable = [];

  for (const point of queue) {
    const sign = network.pointSign(point);
    if (!sign) { unreachable.push(point); continue; }
    const onCurrent = current.base === sign.base && network.signS(sign, current) > currentS + 2;
    if (onCurrent) {
      targets.push({ point, edgeIndex: edges.length - 1 });
      currentS = network.signS(sign, current);
      continue;
    }
    const path = network.shortestPath(current, (edge) => edge.base === sign.base);
    if (!path) { unreachable.push(point); continue; }
    edges.push(...path);
    current = edges[edges.length - 1];
    currentS = network.signS(sign, current);
    targets.push({ point, edgeIndex: edges.length - 1 });
  }

  // Termina na largada: volta externa quando dá, senão menor caminho
  if (current.to !== 'S') {
    const loop = queue.length === 0 ? network.outerLoopFrom(current) : null;
    const back = loop || network.shortestPath(current, (edge) => edge.to === 'S') || [];
    edges.push(...back);
  }

  return finishPlan(network, start, edges, targets, unreachable, 'shortest');
}

function finishPlan(network, start, edges, targets, unreachable, mode) {
  const { line, ranges } = network.composePath(start, edges);
  const events = collectEvents(network, edges, line, ranges, targets);
  return { edges, line, ranges, events, length: line.length, targets, unreachable, mode };
}

function collectEvents(network, edges, line, ranges, targets) {
  const events = [];

  // Placas: cada passagem por um trecho com placa vira um evento
  edges.forEach((edge, index) => {
    const range = ranges[index];
    for (const sign of network.signs) {
      if (sign.base !== edge.base) continue;
      const hit = line.project(sign.at, range.s0, range.s1 + 1);
      if (!Number.isFinite(hit.d)) continue;
      const travel = line.sample(hit.s).dir;
      const approaching = dot(travel, sign.facing) < -0.2;   // vê a frente da placa
      if (sign.kind === 'point') {
        const target = targets.find((t) => t.edgeIndex === index && t.point === sign.point && !t.used);
        if (target) target.used = true;
        events.push({ type: 'point', point: sign.point, target: Boolean(target), s: hit.s, sign });
      } else if (sign.kind === 'stop' || sign.kind === 'traffic-light' || sign.kind === 'detour') {
        if (approaching) events.push({ type: sign.kind, s: hit.s, sign });
      }
    }
  });

  // Curvas da trajetória inteira (cruzamentos e curvas da pista), lidas da geometria
  const curves = curveEvents(line);
  events.push(...curves);

  // Cruzamento em que o carro segue reto: "Siga em frente" (se não houver curva ali)
  for (let i = 1; i < edges.length; i++) {
    const node = edges[i].from;
    const options = network.successors(edges[i - 1]);
    if (options.length < 2) continue;
    const a = edges[i - 1].line.pts;
    const before = [a[a.length - 1][0] - a[a.length - 2][0], a[a.length - 1][1] - a[a.length - 2][1]];
    const b = edges[i].line.pts;
    const after = [b[1][0] - b[0][0], b[1][1] - b[0][1]];
    const nb = Math.hypot(...before) || 1;
    const na = Math.hypot(...after) || 1;
    const angle = (Math.acos(Math.max(-1, Math.min(1, dot(before, after) / (nb * na)))) * 180) / Math.PI;
    if (angle > NODE_TURN_EVENT_DEG) continue;
    const s = Math.max(0, ranges[i].s0 - 20);
    if (curves.some((curve) => Math.abs(curve.s - s) < 60)) continue;
    events.push({ type: 'turn', turn: 'straight', node, s });
  }

  return events.sort((x, y) => x.s - y.s);
}

const CURVE_STEP_PX = 8;
const CURVE_WINDOW_PX = 48;
const CURVE_MIN_DEG = 20;

/**
 * Curvas suaves ao longo da trajetória: onde a direção muda mais de CURVE_MIN_DEG numa
 * janela curta. Cada curva vira um evento 'turn' (right/left) um pouco antes do início.
 */
function curveEvents(line) {
  const heading = (s) => {
    const d = line.sample(s).dir;
    return Math.atan2(d[1], d[0]);
  };
  const delta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
  const events = [];
  let start = -1;
  let sign = 0;
  let total = 0;
  for (let s = 0; s + CURVE_WINDOW_PX <= line.length; s += CURVE_STEP_PX) {
    const deg = (delta(heading(s), heading(s + CURVE_WINDOW_PX)) * 180) / Math.PI;
    if (start < 0) {
      if (Math.abs(deg) > CURVE_MIN_DEG) {
        start = s;
        sign = Math.sign(deg);
        total = 0;
      }
    } else if (Math.abs(deg) < CURVE_MIN_DEG * 0.5 || Math.sign(deg) !== sign) {
      total = (delta(heading(start), heading(s + CURVE_WINDOW_PX * 0.5)) * 180) / Math.PI;
      // y para baixo: ângulo positivo = sentido horário = direita
      events.push({ type: 'turn', turn: sign > 0 ? 'right' : 'left', smooth: true, angle: Math.abs(total), s: start + CURVE_WINDOW_PX * 0.25 });
      start = -1;
    }
  }
  if (start >= 0) events.push({ type: 'turn', turn: sign > 0 ? 'right' : 'left', smooth: true, angle: 0, s: start + CURVE_WINDOW_PX * 0.25 });
  return events;
}

/** Pontos-alvo ainda à frente de `s` (na ordem). */
export function targetEventsAhead(plan, s) {
  return plan.events.filter((event) => event.type === 'point' && event.target && event.s > s);
}
