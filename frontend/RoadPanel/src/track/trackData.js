/**
 * Geometria da pista. Os contornos foram medidos pixel a pixel na imagem de referência
 * (1128 x 582 px) e depois corrigidos para as medidas oficiais (ver toTrack abaixo).
 * Coordenadas exportadas em "px da pista" (1 px = 2 cm): x para a direita, y para baixo.
 * O mundo 3D usa x -> X e y -> Z, multiplicados por PX_TO_WORLD (1 unidade = 1 m).
 *
 * Circulação (confirmada pela equipe): a pista inteira é de MÃO ÚNICA, no sentido de
 * `from` -> `to` de cada trecho (volta horária; corredores descendo).
 */

export const PX_TO_WORLD = 0.02;
export const METERS_PER_PX = 0.02;

/**
 * Duas pistas: a oficial (ilha grande + 2 ilhas retangulares) e a de teste (a mesma ilha
 * grande, na mesma posição, + 1 ilha retangular). A escolha vem de ?pista=oficial|teste
 * ou da última usada (navegador); a página recarrega ao trocar.
 */
export const TRACKS = { oficial: 'Pista oficial', teste: 'Pista de teste' };
const TRACK_KEY = 'apex.roadpanel.track';
export const TRACK_ID = (() => {
  try {
    const asked = new URLSearchParams(location.search).get('pista');
    if (asked && TRACKS[asked]) {
      localStorage.setItem(TRACK_KEY, asked);
      return asked;
    }
    const saved = localStorage.getItem(TRACK_KEY);
    if (saved && TRACKS[saved]) return saved;
  } catch { /* fora do navegador ou sem armazenamento */ }
  return 'oficial';
})();
const IS_TEST = TRACK_ID === 'teste';

/** Troca de pista (recarrega a página com a outra geometria). */
export function switchTrack(id) {
  if (!TRACKS[id] || id === TRACK_ID) return;
  try { localStorage.setItem(TRACK_KEY, id); } catch { /* segue pela URL */ }
  const url = new URL(location.href);
  url.searchParams.set('pista', id);
  location.href = url.toString();
}

/**
 * Medidas oficiais (mm), entre os centros das linhas:
 * pista 20645,7 × 10858,3; faixa entre ilhas 1598,9; faixas retas das laterais 1599,5.
 * A imagem não tem a mesma proporção (e os corredores saíram mais largos nela), então cada
 * faixa e cada ilha é reescalada por partes: faixas com a largura oficial e as ilhas com o
 * que sobra, na proporção da imagem.
 */
const OFFICIAL = { w: 20.6457, h: 10.8583, corridor: 1.5989, side: 1.5995 };
// linhas: externo | ilha 1 | ilha 2 | ilha 3 | externo (teste: sem a ilha 3, faixa da direita logo após a ilha 2)
const IMG_X = IS_TEST ? [30, 114, 429, 524, 722, 808] : [30, 114, 429, 524, 722, 815, 1000, 1086];
const IMG_Y = [58, 141, 474, 557];                         // externo | ilhas | externo

function breakpoints(img, lanes, total) {
  const islands = [];
  for (let k = 1; k < img.length - 1; k += 2) islands.push(img[k + 1] - img[k]);
  const islandSpan = islands.reduce((a, b) => a + b, 0);
  const left = total - lanes.reduce((a, b) => a + b, 0);
  const meters = [0];
  for (let k = 0; k < lanes.length; k++) {
    meters.push(meters[meters.length - 1] + lanes[k]);
    if (k < islands.length) meters.push(meters[meters.length - 1] + (left * islands[k]) / islandSpan);
  }
  return meters.map((m) => img[0] + m / METERS_PER_PX);
}

// Metros por px de ilha, igual nas duas pistas (as ilhas mantêm o tamanho real)
const ISLAND_M_PER_PX = (OFFICIAL.w - 2 * OFFICIAL.side - 2 * OFFICIAL.corridor) / ((429 - 114) + (722 - 524) + (1000 - 815));
const OUT_X = IS_TEST
  ? breakpoints(IMG_X, [OFFICIAL.side, OFFICIAL.corridor, OFFICIAL.side],
    2 * OFFICIAL.side + OFFICIAL.corridor + ISLAND_M_PER_PX * ((429 - 114) + (722 - 524)))
  : breakpoints(IMG_X, [OFFICIAL.side, OFFICIAL.corridor, OFFICIAL.corridor, OFFICIAL.side], OFFICIAL.w);
const OUT_Y = breakpoints(IMG_Y, [OFFICIAL.side, OFFICIAL.side], OFFICIAL.h);

function piecewise(v, from, to) {
  let k = 0;
  while (k < from.length - 2 && v > from[k + 1]) k++;
  if (v < from[0]) return to[0] + (v - from[0]);
  if (v > from[from.length - 1]) return to[to.length - 1] + (v - from[from.length - 1]);
  return to[k] + ((v - from[k]) / (from[k + 1] - from[k])) * (to[k + 1] - to[k]);
}

/** Ponto da imagem de referência -> px da pista em medidas oficiais. */
export const toTrack = ([x, y]) => [piecewise(x, IMG_X, OUT_X), piecewise(y, IMG_Y, OUT_Y)];

export const IMAGE_SIZE = (() => {
  const [w, h] = toTrack([IS_TEST ? 870 : 1128, 582]);
  return { w: Math.round(w), h: Math.round(h) };
})();

// Largura das linhas pintadas na pista (px da imagem)
export const LINE_WIDTH_PX = 8;

/** Contornos da pista: listas de pontos (fechadas quando closed = true). */
const RAW_BOUNDARIES = [
  {
    id: 'externo',
    closed: true,
    points: [
      [160, 58], [556, 58], [990, 58], [1021, 76], [1043, 92], [1058, 108], [1069, 124], [1079, 148],
      [1086, 200], [1086, 432], [1083, 456], [1074, 480], [1061, 504], [1038, 528], [1020, 540], [991, 552],
      [960, 557], [380, 557], [341, 552], [311, 540], [294, 528], [280, 516], [270, 504], [263, 492],
      [257, 480], [252, 468], [249, 456], [247, 444], [245, 420], [243, 408], [239, 396], [234, 384],
      [225, 372], [213, 360], [194, 348], [160, 339], [130, 336], [100, 325], [80, 313], [64, 300],
      [54, 288], [46, 276], [39, 264], [34, 252], [31, 240], [30, 198], [33, 148], [36, 140], [43, 124],
      [49, 116], [55, 108], [61, 100], [70, 92], [79, 84], [92, 76], [108, 68], [130, 60],
    ],
  },
  {
    id: 'ilha-1',
    closed: true,
    points: [
      [160, 141], [380, 141], [406, 148], [422, 162], [429, 185], [429, 420], [425, 444], [417, 456],
      [400, 468], [380, 472], [364, 468], [347, 456], [340, 444], [336, 432], [335, 420], [334, 408],
      [331, 396], [328, 384], [324, 372], [319, 360], [312, 348], [305, 336], [295, 324], [284, 312],
      [271, 300], [254, 288], [232, 276], [194, 264], [150, 257], [130, 252], [118, 240], [112, 210],
      [114, 175], [120, 159], [133, 148],
    ],
  },
  {
    id: 'ilha-2',
    closed: true,
    points: [
      [540, 141], [680, 141], [699, 148], [714, 162], [722, 185], [722, 432], [719, 444], [712, 456],
      [698, 468], [680, 474], [540, 474], [519, 468], [522, 456], [524, 420], [524, 200], [523, 160], [519, 148],
    ],
  },
  {
    id: 'ilha-3',
    closed: true,
    points: [
      [830, 141], [960, 141], [978, 148], [990, 159], [998, 175], [1000, 200], [1000, 432], [998, 444],
      [991, 456], [977, 468], [960, 474], [830, 474], [809, 468], [812, 456], [815, 420], [815, 200], [813, 160], [809, 148],
    ],
  },
];

/** Linha de largada quadriculada (2 colunas x 4 linhas), na faixa do topo. */
const RAW_START = { x: 246, y: 62, w: 36, h: 78, cols: 2, rows: 4 };

// Centros das faixas (medidos entre as linhas)
const RAW_LANES = { TOP: 99.5, BOTTOM: 515.5, LEFT: 72, RIGHT: 1043, C1: 476.5, C2: 768.5 };
const { TOP, BOTTOM, LEFT, RIGHT, C1, C2 } = RAW_LANES;

/** Nós: cruzamentos da pista. */
const RAW_NODES = {
  S: [265, TOP],    // largada
  T1: [C1, TOP],    // topo do corredor 1
  T2: [C2, TOP],    // topo do corredor 2
  B1: [C1, BOTTOM], // base do corredor 1
  B2: [C2, BOTTOM], // base do corredor 2
};

/**
 * Trechos da pista. `twoWay` geraria o trecho contrário; hoje nenhum trecho é de mão dupla.
 * Os pontos internos ficam a ~55 px dos nós para as curvas dos cruzamentos
 * saírem com raio parecido com o da pista real.
 */
const RAW_SEGMENTS = [
  { id: 'topo-1', from: 'S', to: 'T1', points: [RAW_NODES.S, [340, TOP], [421, TOP], RAW_NODES.T1] },
  { id: 'topo-2', from: 'T1', to: 'T2', points: [RAW_NODES.T1, [531, TOP], [622, TOP], [713, TOP], RAW_NODES.T2] },
  {
    id: 'corredor-1', from: 'T1', to: 'B1',
    points: [RAW_NODES.T1, [C1, 155], [C1, 300], [C1, 460], RAW_NODES.B1],
  },
  {
    id: 'corredor-2', from: 'T2', to: 'B2',
    points: [RAW_NODES.T2, [C2, 155], [C2, 300], [C2, 460], RAW_NODES.B2],
  },
  {
    id: 'faixa-direita', from: 'T2', to: 'B2',
    points: [RAW_NODES.T2, [824, TOP], [985, TOP], [1013, 107], [1033, 125], [RIGHT, 160], [RIGHT, 300],
      [RIGHT, 440], [1033, 490], [1013, 508], [985, BOTTOM], [824, BOTTOM], RAW_NODES.B2],
  },
  {
    id: 'baixo', from: 'B2', to: 'B1',
    points: [RAW_NODES.B2, [713, BOTTOM], [622, BOTTOM], [531, BOTTOM], RAW_NODES.B1],
  },
  {
    id: 'esquerda', from: 'B1', to: 'S',
    points: [RAW_NODES.B1, [421, BOTTOM], [380, 515], [345, 505], [318, 485], [300, 455], [290, 425], [284, 395],
      [272, 365], [255, 340], [230, 322], [200, 309], [165, 300], [130, 292], [100, 280], [82, 262],
      [LEFT, 232], [LEFT, 190], [76, 150], [90, 125], [110, 108], [135, 101], [170, TOP], [210, TOP], RAW_NODES.S],
  },
];

/** Volta externa padrão (rota vazia): trechos seguidos a partir da largada. */
export const OUTER_LOOP = IS_TEST
  ? ['topo-1', 'faixa-direita', 'esquerda']
  : ['topo-1', 'topo-2', 'faixa-direita', 'baixo', 'esquerda'];

/**
 * Placas e sinais (posição padrão, medida na imagem). O editor de placas pode
 * mudar `at`; o trecho, a direção e a distância de cada uma são recalculados.
 */
const RAW_SIGNS = [
  { id: 'semaforo', kind: 'traffic-light', at: [147, 200], label: 'Semáforo' },
  { id: 'desvio-1', kind: 'detour', at: [383, 168], label: 'Desvio à direita' },
  { id: 'desvio-2', kind: 'detour', at: [677, 168], label: 'Desvio à direita' },
  { id: 'ponto-A', kind: 'point', point: 'A', at: [384, 306], label: 'Ponto A' },
  { id: 'ponto-B', kind: 'point', point: 'B', at: [681, 306], label: 'Ponto B' },
  { id: 'pare', kind: 'stop', at: [560, 462], label: 'PARE' },
  { id: 'ponto-C', kind: 'point', point: 'C', at: [957, 306], label: 'Ponto C' },
];

// ── Pista de teste: ilha grande igual, uma só ilha retangular ───────────
const TEST_RIGHT = 765;
const TEST_BOUNDARIES = [
  {
    id: 'externo',
    closed: true,
    points: [
      [160, 58], [556, 58], [712, 58], [743, 76], [765, 92], [780, 108], [791, 124], [801, 148],
      [808, 200], [808, 432], [805, 456], [796, 480], [783, 504], [760, 528], [742, 540], [713, 552],
      [682, 557], ...RAW_BOUNDARIES[0].points.slice(RAW_BOUNDARIES[0].points.findIndex(([x, y]) => x === 380 && y === 557)),
    ],
  },
  RAW_BOUNDARIES.find((b) => b.id === 'ilha-1'),
  RAW_BOUNDARIES.find((b) => b.id === 'ilha-2'),
];
const TEST_NODES = { S: RAW_NODES.S, T1: RAW_NODES.T1, B1: RAW_NODES.B1 };
const TEST_SEGMENTS = [
  RAW_SEGMENTS.find((seg) => seg.id === 'topo-1'),
  RAW_SEGMENTS.find((seg) => seg.id === 'corredor-1'),
  {
    id: 'faixa-direita', from: 'T1', to: 'B1',
    points: [RAW_NODES.T1, [531, TOP], [622, TOP], [707, TOP], [735, 107], [755, 125], [TEST_RIGHT, 160],
      [TEST_RIGHT, 300], [TEST_RIGHT, 440], [755, 490], [735, 508], [707, BOTTOM], [622, BOTTOM], [531, BOTTOM], RAW_NODES.B1],
  },
  RAW_SEGMENTS.find((seg) => seg.id === 'esquerda'),
];
const TEST_SIGNS = [
  { id: 'semaforo', kind: 'traffic-light', at: [204, 231], label: 'Semáforo' },
  { id: 'desvio-1', kind: 'detour', at: [403, 158], label: 'Desvio à direita' },
  { id: 'ponto-A', kind: 'point', point: 'A', at: [411, 361], label: 'Ponto A' },
  { id: 'pare', kind: 'stop', at: [558, 438], label: 'PARE' },
  { id: 'ponto-B', kind: 'point', point: 'B', at: [705, 290], label: 'Ponto B' },
  { id: 'ponto-C', kind: 'point', point: 'C', at: [338, 363], label: 'Ponto C' },
];

const BOUNDARY_SET = IS_TEST ? TEST_BOUNDARIES : RAW_BOUNDARIES;
const NODE_SET = IS_TEST ? TEST_NODES : RAW_NODES;
const SEGMENT_SET = IS_TEST ? TEST_SEGMENTS : RAW_SEGMENTS;
const SIGN_SET = IS_TEST ? TEST_SIGNS : RAW_SIGNS;

// ── Exportados já nas medidas oficiais ─────────────────────────────────
const mapPoints = (points) => points.map(toTrack);

export const BOUNDARIES = BOUNDARY_SET.map((b) => ({ ...b, points: mapPoints(b.points) }));

export const START_LINE = (() => {
  const [x0, y0] = toTrack([RAW_START.x, RAW_START.y]);
  const [x1, y1] = toTrack([RAW_START.x + RAW_START.w, RAW_START.y + RAW_START.h]);
  return { ...RAW_START, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
})();

export const LANES = {
  TOP: toTrack([0, TOP])[1],
  BOTTOM: toTrack([0, BOTTOM])[1],
  LEFT: toTrack([LEFT, 0])[0],
  RIGHT: toTrack([IS_TEST ? TEST_RIGHT : RIGHT, 0])[0],
  C1: toTrack([C1, 0])[0],
  C2: toTrack([C2, 0])[0],
};

export const NODES = Object.fromEntries(Object.entries(NODE_SET).map(([id, p]) => [id, toTrack(p)]));

export const SEGMENTS = SEGMENT_SET.map((seg) => ({ ...seg, points: mapPoints(seg.points) }));

export const DEFAULT_SIGNS = SIGN_SET.map((sign) => ({ ...sign, at: toTrack(sign.at) }));

// ── Linha de largada/chegada móvel ──────────────────────────────────────
/**
 * A linha só pode ficar no trecho por onde TODA volta passa: faixa da esquerda + começo da
 * faixa de cima (B1 → largada → T1). O nó S (largada) é recolocado onde a linha estiver e
 * os trechos "esquerda" e "topo-1" são recortados ali; o resto da rede não muda.
 */
const FINISH_MARGIN_PX = 70;   // distância mínima dos cruzamentos B1 e T1
const CHAIN = (() => {
  const left = SEGMENTS.find((seg) => seg.id === 'esquerda').points;
  const top = SEGMENTS.find((seg) => seg.id === 'topo-1').points;
  const pts = [...left, ...top.slice(1)];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, length: cum[cum.length - 1] };
})();

/** Trecho permitido para a linha (para o editor destacar). */
export const FINISH_STRETCH = CHAIN.pts;

function chainAt(d) {
  let i = 1;
  while (i < CHAIN.pts.length - 1 && CHAIN.cum[i] < d) i++;
  const a = CHAIN.pts[i - 1];
  const b = CHAIN.pts[i];
  const t = (d - CHAIN.cum[i - 1]) / (CHAIN.cum[i] - CHAIN.cum[i - 1] || 1);
  return { i, point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] };
}

function chainProject(at) {
  let best = null;
  for (let i = 1; i < CHAIN.pts.length; i++) {
    const a = CHAIN.pts[i - 1];
    const b = CHAIN.pts[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((at[0] - a[0]) * dx + (at[1] - a[1]) * dy) / len2));
    const d2 = (a[0] + dx * t - at[0]) ** 2 + (a[1] + dy * t - at[1]) ** 2;
    if (!best || d2 < best.d2) best = { d2, along: CHAIN.cum[i - 1] + t * Math.sqrt(len2) };
  }
  return Math.max(FINISH_MARGIN_PX, Math.min(CHAIN.length - FINISH_MARGIN_PX, best.along));
}

/**
 * Monta a pista com a linha de largada/chegada perto de `at` (px da pista; null = posição
 * oficial). Devolve os trechos da rede e a linha: centro, direção de quem passa, tamanho.
 */
export function layoutTrack(at = null) {
  const along = at ? chainProject(at) : chainProject(NODES.S);
  const { i, point } = chainAt(along);
  const before = CHAIN.pts.slice(0, i).filter((p) => Math.hypot(p[0] - point[0], p[1] - point[1]) > 1);
  const after = CHAIN.pts.slice(i).filter((p) => Math.hypot(p[0] - point[0], p[1] - point[1]) > 1);
  const segments = SEGMENTS.map((seg) => {
    if (seg.id === 'esquerda') return { ...seg, points: [...before, point] };
    if (seg.id === 'topo-1') return { ...seg, points: [point, ...after] };
    return seg;
  });
  const p0 = chainAt(Math.max(0, along - 12)).point;
  const p1 = chainAt(Math.min(CHAIN.length, along + 12)).point;
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
  const finish = {
    at: point,
    dir: [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len],
    along: START_LINE.w,       // espessura da faixa quadriculada (no sentido da pista)
    across: START_LINE.h,      // de uma linha da pista à outra
    cols: START_LINE.cols,
    rows: START_LINE.rows,
    moved: Boolean(at),
  };
  return { segments, finish };
}

/** Quadrados pretos da linha quadriculada, cada um com seus 4 cantos (px da pista). */
export function finishCells(finish) {
  const { at, dir, along, across, cols, rows } = finish;
  const n = [-dir[1], dir[0]];
  const corner = (u, v) => [at[0] + dir[0] * u + n[0] * v, at[1] + dir[1] * u + n[1] * v];
  const cells = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if ((c + r) % 2) continue;
      const u0 = -along / 2 + (c * along) / cols;
      const u1 = u0 + along / cols;
      const v0 = -across / 2 + (r * across) / rows;
      const v1 = v0 + across / rows;
      cells.push([corner(u0, v0), corner(u1, v0), corner(u1, v1), corner(u0, v1)]);
    }
  }
  return cells;
}

