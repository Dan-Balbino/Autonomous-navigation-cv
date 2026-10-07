/**
 * Editor de placas: janela com a pista em 2D (mesma geometria do 3D) e as placas
 * arrastáveis (mouse, toque ou setas do teclado). Enquanto arrasta, a faixa a que a
 * placa vai se ligar fica destacada. Salvar grava no navegador e recarrega a cena 3D;
 * Exportar baixa um JSON (para fixar no projeto em src/config/signs.json).
 */
import { BOUNDARIES, START_LINE, IMAGE_SIZE, SEGMENTS } from '../track/trackData.js';
import { smoothPolyline } from '../track/network.js';
import { drawSignFace } from '../scene/signs.js';

const STORAGE_KEY = 'apex.roadpanel.signs.v1';
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
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
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
  constructor({ network, getSigns, defaults, onSave }) {
    this.network = network;
    this.getSigns = getSigns;
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
      this.renderSigns();
      this.say('Posições padrão restauradas. Salve para aplicar.');
    });
    document.getElementById('signEditorExport').addEventListener('click', () => this.exportJson());
    document.getElementById('signEditorSave').addEventListener('click', () => {
      const stored = saveSigns(this.drafts);
      this.onSave(this.drafts.map((d) => ({ ...d, at: [...d.at] })));
      this.close();
      if (!stored) console.warn('Não foi possível salvar no navegador; as posições valem só nesta sessão.');
    });
  }

  isOpen() {
    return this.dialog.open;
  }

  open() {
    this.drafts = this.getSigns();
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
    const { x, y, w, h, cols, rows } = START_LINE;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if ((c + r) % 2) continue;
        svg.append(el('rect', { x: x + c * (w / cols), y: y + r * (h / rows), width: w / cols, height: h / rows, class: 'map-check' }));
      }
    }
    this.highlight = el('path', { class: 'map-attach', d: '' });
    svg.append(this.highlight);
    this.signLayer = el('g');
    svg.append(this.signLayer);
  }

  /** Trecho mais próximo de um ponto (o mesmo critério da rede). */
  attachment(point) {
    let best = null;
    for (const seg of SEGMENTS) {
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

  exportJson() {
    const data = JSON.stringify(this.drafts.map(({ id, at }) => ({ id, at })), null, 2);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    link.download = 'signs.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    this.say('Arquivo signs.json baixado.');
  }
}
