/**
 * Editor de placas: janela com a pista em 2D (mesma geometria do 3D), as placas e a
 * partida do carro arrastáveis (mouse, toque ou setas do teclado). Enquanto arrasta, a faixa a que a
 * placa vai se ligar fica destacada. Salvar grava no navegador e recarrega a cena 3D;
 * Exportar baixa um JSON (para fixar no projeto em src/config/signs.json).
 */
import { BOUNDARIES, IMAGE_SIZE, toTrack, layoutTrack, finishCells, FINISH_STRETCH, TRACK_ID } from '../track/trackData.js';
import { smoothPolyline } from '../track/network.js';
import { drawSignFace } from '../scene/signs.js';

// v2: px da pista em medidas oficiais; v1 (px da imagem) é convertido na leitura
// Cada pista guarda as próprias posições (a oficial mantém as chaves antigas)
const SUFFIX = TRACK_ID === 'oficial' ? '' : `.${TRACK_ID}`;
const STORAGE_KEY = `apex.roadpanel.signs.v2${SUFFIX}`;
const LEGACY_KEY = TRACK_ID === 'oficial' ? 'apex.roadpanel.signs.v1' : `apex.roadpanel.none${SUFFIX}`;
const START_KEY = `apex.roadpanel.start.v1${SUFFIX}`;
export const START_ID = 'partida';
const FINISH_KEY = `apex.roadpanel.finish.v1${SUFFIX}`;
export const FINISH_ID = 'chegada';

/** Linha de largada/chegada: navegador > item "chegada" do signs.json > posição oficial. */
export function loadSavedFinish(projectList = null) {
  try {
    const local = JSON.parse(localStorage.getItem(FINISH_KEY) || 'null');
    if (local && validAt(local.at)) return [...local.at];
  } catch { /* segue para o projeto */ }
  const project = Array.isArray(projectList) ? projectList.find((item) => item?.id === FINISH_ID) : null;
  return project && validAt(project.at) ? [...project.at] : null;
}

function saveFinish(at) {
  try {
    if (at) localStorage.setItem(FINISH_KEY, JSON.stringify({ at }));
    else localStorage.removeItem(FINISH_KEY);
    return true;
  } catch {
    return false;
  }
}
const ICON = 58;
const SVG_NS = 'http://www.w3.org/2000/svg';

const validAt = (at) => Array.isArray(at) && at.length === 2 && at.every(Number.isFinite);
const toMap = (list) => new Map(Array.isArray(list) ? list.filter((item) => validAt(item?.at)).map((item) => [item.id, item.at]) : []);

/**
 * Posições das placas, nesta prioridade: edição salva no navegador > arquivo do
 * projeto (src/config/signs.json) > posição padrão. Ids desconhecidos e valores
 * inválidos são ignorados.
 */
export function loadSavedSigns(defaults, projectList = null) {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved) {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]');
      saved = Array.isArray(legacy) ? legacy.map((item) => ({ ...item, at: toTrack(item.at) })) : [];
    }
  } catch {
    saved = [];
  }
  const local = toMap(saved);
  const project = toMap(projectList);
  return defaults.map((def) => {
    const at = local.get(def.id) || project.get(def.id) || def.at;
    return { ...def, at: [...at] };
  });
}

/**
 * Partida do carro: { at, reverse } salva no navegador > item "partida" do signs.json > null
 * (null = na linha de largada, no sentido de referência).
 */
export function loadSavedStart(projectList = null) {
  const valid = (item) => item && validAt(item.at) ? { at: [...item.at], reverse: Boolean(item.reverse) } : null;
  try {
    const local = valid(JSON.parse(localStorage.getItem(START_KEY) || 'null'));
    if (local) return local;
  } catch { /* segue para o projeto */ }
  const project = Array.isArray(projectList) ? projectList.find((item) => item?.id === START_ID) : null;
  return valid(project);
}

function saveStart(start) {
  try {
    if (start) localStorage.setItem(START_KEY, JSON.stringify(start));
    else localStorage.removeItem(START_KEY);
    return true;
  } catch {
    return false;
  }
}

function saveSigns(defs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(defs.map(({ id, at }) => ({ id, at }))));
    return true;
  } catch {
    return false;
  }
}

const pathFrom = (points, closed) =>
  points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('') + (closed ? 'Z' : '');

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function iconDataUrl(kind, label) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  drawSignFace(canvas.getContext('2d'), 128, kind, label);
  return canvas.toDataURL('image/png');
}

export class SignEditor {
  constructor({ network, getSigns, defaults, onSave, getStart, defaultStart, getFinish }) {
    this.network = network;
    this.getFinish = getFinish;
    this.finish = null;
    this.getSigns = getSigns;
    this.getStart = getStart;
    this.defaultStart = defaultStart;
    this.start = null;
    this.defaults = defaults;
    this.onSave = onSave;
    this.dialog = document.getElementById('signEditor');
    this.svg = document.getElementById('signEditorMap');
    this.status = document.getElementById('signEditorStatus');
    this.drafts = [];
    this.drawTrack();
    document.getElementById('editSigns').addEventListener('click', () => this.open());
    document.getElementById('signEditorCancel').addEventListener('click', () => this.close());
    document.getElementById('signEditorClose').addEventListener('click', () => this.close());
    document.getElementById('signEditorReset').addEventListener('click', () => {
      this.drafts = this.defaults.map((def) => ({ ...def, at: [...def.at] }));
      this.finish = null;
      const { finish } = layoutTrack(null);
      this.start = { at: [finish.at[0] + finish.dir[0] * 35, finish.at[1] + finish.dir[1] * 35], reverse: false, isDefault: true };
      this.renderSigns();
      this.say('Posições padrão restauradas. Salve para aplicar.');
    });
    document.getElementById('signEditorExport').addEventListener('click', () => this.exportJson());
    document.getElementById('signEditorSave').addEventListener('click', () => {
      const start = this.start.isDefault ? null : { at: this.start.at.map((v) => Math.round(v * 10) / 10), reverse: this.start.reverse };
      const finish = this.finish ? this.finish.map((v) => Math.round(v * 10) / 10) : null;
      const stored = saveSigns(this.drafts) && saveStart(start) && saveFinish(finish);
      this.onSave(this.drafts.map((d) => ({ ...d, at: [...d.at] })), start, finish);
      this.close();
      if (!stored) console.warn('Não foi possível salvar no navegador; as posições valem só nesta sessão.');
    });
  }

  isOpen() {
    return this.dialog.open;
  }

  open() {
    this.drafts = this.getSigns();
    const finish = this.getFinish();
    this.finish = finish ? [...finish] : null;
    const current = this.getStart();
    this.start = current
      ? { at: [...current.at], reverse: false, isDefault: false }
      : { ...this.defaultStart, at: [...this.defaultStart.at], isDefault: true };
    this.renderSigns();
    this.say('Arraste as placas. A faixa em azul é a que a placa controla.');
    this.dialog.showModal();
  }

  close() {
    this.dialog.close();
  }

  say(message) {
    this.status.textContent = message;
  }

  drawTrack() {
    const svg = this.svg;
    svg.setAttribute('viewBox', `0 0 ${IMAGE_SIZE.w} ${IMAGE_SIZE.h}`);
    svg.textContent = '';
    const smooth = Object.fromEntries(BOUNDARIES.map((b) => [b.id, smoothPolyline(b.points, b.closed)]));
    const islands = BOUNDARIES.filter((b) => b.id.startsWith('ilha'));
    const laneD = pathFrom(smooth.externo, true) + islands.map((b) => pathFrom(smooth[b.id], true)).join('');
    svg.append(el('path', { d: laneD, class: 'map-lane', 'fill-rule': 'evenodd' }));
    for (const island of islands) svg.append(el('path', { d: pathFrom(smooth[island.id], true), class: 'map-island' }));
    for (const boundary of BOUNDARIES) svg.append(el('path', { d: pathFrom(smooth[boundary.id], true), class: 'map-line' }));
    this.highlight = el('path', { class: 'map-attach', d: '' });
    svg.append(this.highlight);
    this.finishLayer = el('g');
    svg.append(this.finishLayer);
    this.signLayer = el('g');
    svg.append(this.signLayer);
    this.startLayer = el('g');
    svg.append(this.startLayer);
  }

  /** Trecho mais próximo de um ponto (o mesmo critério da rede). */
  attachment(point) {
    let best = null;
    for (const seg of this.network.segments) {
      const p = this.network.edge(seg.id).line.project(point);
      if (!best || p.d < best.d) best = { id: seg.id, d: p.d };
    }
    return best;
  }

  showAttachment(point) {
    const attach = this.attachment(point);
    const line = this.network.edge(attach.id).line;
    this.highlight.setAttribute('d', pathFrom(line.pts, false));
    this.say(`Ligada à faixa "${attach.id.replace('-', ' ')}" (${Math.round(attach.d)} px do centro da faixa).`);
  }

  toSvg(event) {
    const point = this.svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const p = point.matrixTransform(this.svg.getScreenCTM().inverse());
    return [Math.max(0, Math.min(IMAGE_SIZE.w, p.x)), Math.max(0, Math.min(IMAGE_SIZE.h, p.y))];
  }

  renderSigns() {
    this.signLayer.textContent = '';
    this.highlight.setAttribute('d', '');
    this.renderFinish();
    this.renderStart();
    for (const sign of this.drafts) {
      const g = el('g', { class: 'map-sign', tabindex: '0', role: 'button', 'aria-label': `${sign.label}: arraste ou use as setas` });
      const image = el('image', { href: iconDataUrl(sign.kind, sign.point || ''), width: ICON, height: ICON });
      g.append(image);
      const place = () => g.setAttribute('transform', `translate(${sign.at[0] - ICON / 2} ${sign.at[1] - ICON / 2})`);
      place();

      g.addEventListener('pointerdown', (event) => {
        g.setPointerCapture(event.pointerId);
        g.classList.add('is-dragging');
        this.showAttachment(sign.at);
        event.preventDefault();
      });
      g.addEventListener('pointermove', (event) => {
        if (!g.hasPointerCapture(event.pointerId)) return;
        sign.at = this.toSvg(event).map((v) => Math.round(v));
        place();
        this.showAttachment(sign.at);
      });
      const end = (event) => {
        if (g.hasPointerCapture(event.pointerId)) g.releasePointerCapture(event.pointerId);
        g.classList.remove('is-dragging');
      };
      g.addEventListener('pointerup', end);
      g.addEventListener('pointercancel', end);
      g.addEventListener('focus', () => this.showAttachment(sign.at));
      g.addEventListener('keydown', (event) => {
        const step = event.shiftKey ? 16 : 4;
        const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        const move = moves[event.key];
        if (!move) return;
        event.preventDefault();
        sign.at = [
          Math.max(0, Math.min(IMAGE_SIZE.w, sign.at[0] + move[0])),
          Math.max(0, Math.min(IMAGE_SIZE.h, sign.at[1] + move[1])),
        ];
        place();
        this.showAttachment(sign.at);
      });
      this.signLayer.append(g);
    }
  }

  /** Linha quadriculada arrastável ao longo da faixa da esquerda / começo da faixa de cima. */
  renderFinish() {
    this.finishLayer.textContent = '';
    const g = el('g', { class: 'map-finish', tabindex: '0', role: 'button', 'aria-label': 'Linha de largada e chegada: arraste ou use as setas' });
    this.finishLayer.append(g);
    const draw = () => {
      g.textContent = '';
      const { finish } = layoutTrack(this.finish);
      const n = [-finish.dir[1], finish.dir[0]];
      const half = finish.across / 2 + 6;
      const pad = finish.along / 2 + 6;
      const corner = (u, v) => `${finish.at[0] + finish.dir[0] * u + n[0] * v},${finish.at[1] + finish.dir[1] * u + n[1] * v}`;
      // Área de toque (maior que a linha) + quadrados
      g.append(el('polygon', { class: 'map-finish-hit', points: [corner(-pad, -half), corner(pad, -half), corner(pad, half), corner(-pad, half)].join(' ') }));
      for (const quad of finishCells(finish)) {
        g.append(el('polygon', { class: 'map-check', points: quad.map((p) => p.join(',')).join(' ') }));
      }
      return finish;
    };
    const describe = () => {
      draw();
      this.highlight.setAttribute('d', pathFrom(FINISH_STRETCH, false));
      this.say('Linha de largada e chegada: pode ficar em qualquer ponto da faixa destacada (por onde toda volta passa).');
    };
    const moveTo = (at) => {
      this.finish = at;
      describe();
      // A partida padrão acompanha a linha
      if (this.start.isDefault) {
        const { finish } = layoutTrack(this.finish);
        this.start.at = [finish.at[0] + finish.dir[0] * 35, finish.at[1] + finish.dir[1] * 35];
        this.placeStartMarker();
      }
    };
    g.addEventListener('pointerdown', (event) => {
      g.setPointerCapture(event.pointerId);
      g.classList.add('is-dragging');
      describe();
      event.preventDefault();
    });
    g.addEventListener('pointermove', (event) => {
      if (g.hasPointerCapture(event.pointerId)) moveTo(this.toSvg(event).map((v) => Math.round(v)));
    });
    const end = (event) => {
      if (g.hasPointerCapture(event.pointerId)) g.releasePointerCapture(event.pointerId);
      g.classList.remove('is-dragging');
    };
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', end);
    g.addEventListener('focus', describe);
    g.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 16 : 4;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      const current = layoutTrack(this.finish).finish.at;
      moveTo([current[0] + move[0], current[1] + move[1]]);
    });
    draw();
  }

  /** Marcador da partida: fica sobre o centro da faixa e aponta para onde o carro sai. */
  placeStartMarker() {
    const spot = this.network.placeStart(this.start.at, this.start.reverse);
    const p = this.network.edge(spot.edgeId).line.sample(spot.s);
    const angle = (Math.atan2(p.dir[1], p.dir[0]) * 180) / Math.PI;
    this.startMarker.setAttribute('transform', `translate(${p.x} ${p.y}) rotate(${angle})`);
    return spot;
  }

  renderStart() {
    this.startLayer.textContent = '';
    const g = el('g', { class: 'map-start', tabindex: '0', role: 'button', 'aria-label': 'Partida do carro: arraste ou use as setas' });
    g.append(
      el('circle', { r: 30, class: 'map-start-ring' }),
      el('circle', { r: 22, class: 'map-start-dot' }),
      el('path', { d: 'M-8 -11 L12 0 L-8 11 L-3 0 Z', class: 'map-start-arrow' }),
    );
    this.startMarker = g;
    const describe = () => {
      const spot = this.placeStartMarker();
      const base = spot.edgeId.replace('~r', '');
      this.highlight.setAttribute('d', pathFrom(this.network.edge(base).line.pts, false));
      this.say(`Partida na faixa "${base.replace('-', ' ')}" (mão única: o carro sai no sentido da pista).`);
    };
    const moveTo = (at) => {
      this.start.at = at;
      this.start.isDefault = false;
      describe();
    };
    g.addEventListener('pointerdown', (event) => {
      g.setPointerCapture(event.pointerId);
      g.classList.add('is-dragging');
      describe();
      event.preventDefault();
    });
    g.addEventListener('pointermove', (event) => {
      if (g.hasPointerCapture(event.pointerId)) moveTo(this.toSvg(event).map((v) => Math.round(v)));
    });
    const end = (event) => {
      if (g.hasPointerCapture(event.pointerId)) g.releasePointerCapture(event.pointerId);
      g.classList.remove('is-dragging');
    };
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', end);
    g.addEventListener('focus', describe);
    g.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 16 : 4;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      moveTo([this.start.at[0] + move[0], this.start.at[1] + move[1]]);
    });
    this.startLayer.append(g);
    this.placeStartMarker();
  }

  exportJson() {
    const list = this.drafts.map(({ id, at }) => ({ id, at }));
    if (this.finish) list.push({ id: FINISH_ID, at: this.finish });
    if (!this.start.isDefault) list.push({ id: START_ID, at: this.start.at, reverse: this.start.reverse });
    const data = JSON.stringify(list, null, 2);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    link.download = TRACK_ID === 'oficial' ? 'signs.json' : `signs-${TRACK_ID}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    this.say('Arquivo signs.json baixado.');
  }
}
