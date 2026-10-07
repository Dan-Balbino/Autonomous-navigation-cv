/**
 * Rede de caminhos da pista (grafo dirigido, com trechos de mão dupla).
 *
 * - Cada trecho vira uma aresta; trechos `twoWay` ganham a aresta contrária ("<id>~r").
 * - Rotas são calculadas por menor caminho (Dijkstra), sem retorno em U.
 * - Uma sequência de arestas vira UMA trajetória contínua e suave (Catmull-Rom),
 *   com as curvas dos cruzamentos arredondadas; o carro anda em "s" por ela.
 * - Placas se ligam ao trecho mais próximo; o editor pode movê-las (setSigns).
 * Unidades: px da imagem de referência (ver trackData.js).
 */
import { SEGMENTS, NODES, DEFAULT_SIGNS, OUTER_LOOP } from './trackData.js';

const SAMPLES_PER_SPAN = 12;
const TURN_PENALTY = 40;        // px "extras" por curva, para preferir caminhos retos
const STRAIGHT_DEG = 25;        // abaixo disso a junção é reta e o nó fica na curva

/** Catmull-Rom centrípeta em 2D (sem laços nem pontas). */
export function catmullRom(points) {
  if (points.length < 3) return points.map((p) => [...p]);
  const pts = [points[0], ...points, points[points.length - 1]];
  const out = [];
  for (let i = 0; i < pts.length - 3; i++) {
    const [p0, p1, p2, p3] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
    const t0 = 0;
    const t1 = t0 + Math.pow(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1e-6, 0.5);
    const t2 = t1 + Math.pow(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1e-6, 0.5);
    const t3 = t2 + Math.pow(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]) || 1e-6, 0.5);
    for (let k = 0; k < SAMPLES_PER_SPAN; k++) {
      const t = t1 + ((t2 - t1) * k) / SAMPLES_PER_SPAN;
      const lerp = (a, b, ta, tb) => [
        ((tb - t) / (tb - ta)) * a[0] + ((t - ta) / (tb - ta)) * b[0],
        ((tb - t) / (tb - ta)) * a[1] + ((t - ta) / (tb - ta)) * b[1],
      ];
      const a1 = lerp(p0, p1, t0, t1);
      const a2 = lerp(p1, p2, t1, t2);
      const a3 = lerp(p2, p3, t2, t3);
      out.push(lerp(lerp(a1, a2, t0, t2), lerp(a2, a3, t1, t3), t1, t2));
    }
  }
  out.push([...points[points.length - 1]]);
  return out;
}

export function smoothPolyline(points, closed = false) {
  if (!closed) return catmullRom(points);
  const n = points.length;
  const wrapped = [points[n - 1], ...points, points[0], points[1]];
  return catmullRom(wrapped).slice(SAMPLES_PER_SPAN, SAMPLES_PER_SPAN * (n + 1) + 1);
}

/** Polilinha com comprimento acumulado, amostragem e projeção. */
export class Polyline {
  constructor(pts) {
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) {
      this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    this.length = this.cum[this.cum.length - 1];
  }

  sample(s) {
    const clamped = Math.max(0, Math.min(this.length, s));
    let lo = 0;
    let hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= clamped) lo = mid; else hi = mid;
    }
    const a = this.pts[lo];
    const b = this.pts[hi];
    const span = this.cum[hi] - this.cum[lo] || 1;
    const t = (clamped - this.cum[lo]) / span;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    return { x: a[0] + dx * t, y: a[1] + dy * t, dir: [dx / len, dy / len] };
  }

  /** Distância s mais próxima de um ponto, opcionalmente só entre s0 e s1. */
  project([px, py], s0 = 0, s1 = Infinity) {
    let best = { s: s0, d: Infinity };
    for (let i = 1; i < this.pts.length; i++) {
      if (this.cum[i] < s0 || this.cum[i - 1] > s1) continue;
      const [ax, ay] = this.pts[i - 1];
      const [bx, by] = this.pts[i];
      const vx = bx - ax;
      const vy = by - ay;
      const len2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
      const d = Math.hypot(ax + vx * t - px, ay + vy * t - py);
      const s = this.cum[i - 1] + t * Math.sqrt(len2);
      if (d < best.d && s >= s0 && s <= s1) best = { s, d };
    }
    return best;
  }
}

const angleBetween = (a, b) => {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]));
  return (Math.acos(dot) * 180) / Math.PI;
};
const unit = (a, b) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
};

export class TrackNetwork {
  constructor(signDefs = DEFAULT_SIGNS) {
    this.nodes = NODES;
    this.edges = new Map();
    for (const seg of SEGMENTS) {
      this.addEdge({ id: seg.id, base: seg.id, from: seg.from, to: seg.to, points: seg.points });
      if (seg.twoWay) {
        this.addEdge({ id: `${seg.id}~r`, base: seg.id, from: seg.to, to: seg.from, points: [...seg.points].reverse() });
      }
    }
    this.outgoing = new Map();
    for (const edge of this.edges.values()) {
      if (!this.outgoing.has(edge.from)) this.outgoing.set(edge.from, []);
      this.outgoing.get(edge.from).push(edge);
    }
    this.setSigns(signDefs);
  }

  addEdge(def) {
    const line = new Polyline(catmullRom(def.points));
    this.edges.set(def.id, { ...def, line, length: line.length });
  }

  edge(id) {
    return this.edges.get(id);
  }

  /**
   * Liga cada placa ao trecho mais próximo e calcula para onde ela olha.
   * Placas de trânsito olham para quem chega no sentido principal; pontos A/B/C
   * olham para a faixa (lidos nos dois sentidos).
   */
  setSigns(defs) {
    this.signs = defs.map((def) => {
      let best = null;
      for (const seg of SEGMENTS) {
        const edge = this.edges.get(seg.id);
        const p = edge.line.project(def.at);
        if (!best || p.d < best.d) best = { base: seg.id, s: p.s, d: p.d };
      }
      const forward = this.edges.get(best.base);
      const lane = forward.line.sample(best.s);
      const toLane = unit(def.at, [lane.x, lane.y]);
      const facing = def.kind === 'point' ? toLane : [-lane.dir[0], -lane.dir[1]];
      return { ...def, base: best.base, sBase: best.s, laneDistance: best.d, facing, lane: [lane.x, lane.y] };
    });
  }

  pointSign(point) {
    return this.signs.find((sign) => sign.kind === 'point' && sign.point === point) || null;
  }

  /** s da placa medido ao longo de uma aresta (as contrárias medem de trás para frente). */
  signS(sign, edge) {
    return edge.id === sign.base ? sign.sBase : edge.length - sign.sBase;
  }

  successors(edge) {
    return (this.outgoing.get(edge.to) || []).filter((next) => next.base !== edge.base);
  }

  turnCost(a, b) {
    const ai = a.line.pts;
    const da = unit(ai[ai.length - 2], ai[ai.length - 1]);
    const db = unit(b.line.pts[0], b.line.pts[1]);
    return angleBetween(da, db) > STRAIGHT_DEG ? TURN_PENALTY : 0;
  }

  /**
   * Menor caminho de arestas saindo do fim de `fromEdge` até uma aresta que
   * satisfaça `isGoal`. Devolve a lista de arestas (sem incluir fromEdge) ou null.
   */
  shortestPath(fromEdge, isGoal) {
    const dist = new Map();
    const prev = new Map();
    const queue = [];
    for (const next of this.successors(fromEdge)) {
      const cost = next.length + this.turnCost(fromEdge, next);
      dist.set(next.id, cost);
      prev.set(next.id, null);
      queue.push(next.id);
    }
    const done = new Set();
    while (queue.length) {
      queue.sort((a, b) => dist.get(a) - dist.get(b));
      const id = queue.shift();
      if (done.has(id)) continue;
      done.add(id);
      const edge = this.edges.get(id);
      if (isGoal(edge)) {
        const path = [];
        for (let cur = id; cur; cur = prev.get(cur)) path.unshift(this.edges.get(cur));
        return path;
      }
      for (const next of this.successors(edge)) {
        const cost = dist.get(id) + next.length + this.turnCost(edge, next);
        if (!dist.has(next.id) || cost < dist.get(next.id)) {
          dist.set(next.id, cost);
          prev.set(next.id, id);
          queue.push(next.id);
        }
      }
    }
    return null;
  }

  /** Aresta e s mais próximos de um ponto livre (direção livre / replanejamento). */
  nearest(point, preferEdgeId = null) {
    let best = null;
    for (const edge of this.edges.values()) {
      const p = edge.line.project(point);
      const bonus = edge.id === preferEdgeId ? -4 : 0;
      if (!best || p.d + bonus < best.d) best = { edgeId: edge.id, s: p.s, d: p.d + bonus };
    }
    return best;
  }

  /**
   * Junta arestas numa trajetória contínua. `start` = { edgeId, s } é onde o carro está.
   * Nas junções com curva o ponto do nó sai da lista, então a curva fica arredondada.
   * Devolve a polilinha e, para cada aresta, a faixa de s que ela ocupa na trajetória.
   */
  composePath(start, edges) {
    const controls = [];
    const owner = [];             // a que aresta (índice) pertence cada ponto de controle
    const first = edges[0];
    const startPoint = first.line.sample(start.s);
    controls.push([startPoint.x, startPoint.y]);
    owner.push(0);
    // pontos de controle da 1ª aresta que ainda estão à frente do carro
    for (const p of first.points.slice(1)) {
      const ps = first.line.project(p).s;
      if (ps > start.s + 12) { controls.push(p); owner.push(0); }
    }
    for (let i = 1; i < edges.length; i++) {
      const a = edges[i - 1];
      const b = edges[i];
      const ap = a.points;
      const turning = angleBetween(unit(ap[ap.length - 2], ap[ap.length - 1]), unit(b.points[0], b.points[1])) > STRAIGHT_DEG;
      if (turning && controls.length > 1) {
        controls.pop();          // tira o nó (último ponto da aresta anterior)
        owner.pop();
      }
      for (const p of b.points.slice(1)) { controls.push(p); owner.push(i); }
    }
    if (controls.length === 1) controls.push([startPoint.x + startPoint.dir[0], startPoint.y + startPoint.dir[1]]);

    const pts = catmullRom(controls);
    const line = new Polyline(pts);
    // faixa de s de cada aresta: do 1º ao último ponto de controle que ela possui
    const ranges = edges.map(() => ({ s0: Infinity, s1: -Infinity }));
    owner.forEach((edgeIndex, k) => {
      const s = line.cum[Math.min(k * SAMPLES_PER_SPAN, line.cum.length - 1)];
      ranges[edgeIndex].s0 = Math.min(ranges[edgeIndex].s0, s);
      ranges[edgeIndex].s1 = Math.max(ranges[edgeIndex].s1, s);
    });
    // cada aresta começa onde a anterior termina (cobre a curva da junção)
    for (let i = 1; i < ranges.length; i++) ranges[i].s0 = Math.min(ranges[i].s0, ranges[i - 1].s1);
    ranges[0].s0 = 0;
    return { line, ranges };
  }

  outerLoopFrom(edge) {
    const index = OUTER_LOOP.indexOf(edge.id);
    if (index < 0) return null;
    return OUTER_LOOP.slice(index + 1).map((id) => this.edges.get(id));
  }
}
