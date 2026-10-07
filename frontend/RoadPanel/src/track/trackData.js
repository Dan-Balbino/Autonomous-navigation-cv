/**
 * Geometria da pista, medida pixel a pixel na imagem de referência (1128 x 582 px).
 * Coordenadas em "px da imagem": x para a direita, y para baixo. O mundo 3D usa
 * x -> X e y -> Z, multiplicados por PX_TO_WORLD.
 *
 * Circulação (confirmada pela equipe): não há mão única; todas as faixas permitem ida e
 * volta. `from`/`to` de cada trecho só definem o sentido de referência (volta horária).
 */

export const IMAGE_SIZE = { w: 1128, h: 582 };
export const PX_TO_WORLD = 0.02;

/**
 * Escala real da pista: 21 m × 10 m, faixa de 1,5 m. Na imagem o contorno externo mede
 * 1056 × 499 px e a faixa 75 px entre as linhas, ou seja 0,02 m por px nas três medidas
 * (1 unidade do mundo 3D = 1 m).
 */
export const METERS_PER_PX = 0.02;

// Largura das linhas pintadas na pista (px da imagem)
export const LINE_WIDTH_PX = 8;

/** Contornos da pista: listas de pontos (fechadas quando closed = true). */
export const BOUNDARIES = [
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
export const START_LINE = { x: 246, y: 62, w: 36, h: 78, cols: 2, rows: 4 };

// Centros das faixas (medidos entre as linhas)
export const LANES = { TOP: 99.5, BOTTOM: 515.5, LEFT: 72, RIGHT: 1043, C1: 476.5, C2: 768.5 };
const { TOP, BOTTOM, LEFT, RIGHT, C1, C2 } = LANES;

/** Nós: cruzamentos da pista. */
export const NODES = {
  S: [265, TOP],    // largada
  T1: [C1, TOP],    // topo do corredor 1
  T2: [C2, TOP],    // topo do corredor 2
  B1: [C1, BOTTOM], // base do corredor 1
  B2: [C2, BOTTOM], // base do corredor 2
};

/**
 * Trechos da pista. `twoWay` gera também o trecho no sentido contrário (hoje, todos).
 * Os pontos internos ficam a ~55 px dos nós para as curvas dos cruzamentos
 * saírem com raio parecido com o da pista real.
 */
export const SEGMENTS = [
  { id: 'topo-1', from: 'S', to: 'T1', twoWay: true, points: [NODES.S, [340, TOP], [421, TOP], NODES.T1] },
  { id: 'topo-2', from: 'T1', to: 'T2', twoWay: true, points: [NODES.T1, [531, TOP], [622, TOP], [713, TOP], NODES.T2] },
  {
    id: 'corredor-1', from: 'T1', to: 'B1', twoWay: true,
    points: [NODES.T1, [C1, 155], [C1, 300], [C1, 460], NODES.B1],
  },
  {
    id: 'corredor-2', from: 'T2', to: 'B2', twoWay: true,
    points: [NODES.T2, [C2, 155], [C2, 300], [C2, 460], NODES.B2],
  },
  {
    id: 'faixa-direita', from: 'T2', to: 'B2', twoWay: true,
    points: [NODES.T2, [824, TOP], [985, TOP], [1013, 107], [1033, 125], [RIGHT, 160], [RIGHT, 300],
      [RIGHT, 440], [1033, 490], [1013, 508], [985, BOTTOM], [824, BOTTOM], NODES.B2],
  },
  {
    id: 'baixo', from: 'B2', to: 'B1', twoWay: true,
    points: [NODES.B2, [713, BOTTOM], [622, BOTTOM], [531, BOTTOM], NODES.B1],
  },
  {
    id: 'esquerda', from: 'B1', to: 'S', twoWay: true,
    points: [NODES.B1, [421, BOTTOM], [380, 515], [345, 505], [318, 485], [300, 455], [290, 425], [284, 395],
      [272, 365], [255, 340], [230, 322], [200, 309], [165, 300], [130, 292], [100, 280], [82, 262],
      [LEFT, 232], [LEFT, 190], [76, 150], [90, 125], [110, 108], [135, 101], [170, TOP], [210, TOP], NODES.S],
  },
];

/** Volta externa padrão (rota vazia): trechos seguidos a partir da largada. */
export const OUTER_LOOP = ['topo-1', 'topo-2', 'faixa-direita', 'baixo', 'esquerda'];

/**
 * Placas e sinais (posição padrão, medida na imagem). O editor de placas pode
 * mudar `at`; o trecho, a direção e a distância de cada uma são recalculados.
 */
export const DEFAULT_SIGNS = [
  { id: 'semaforo', kind: 'traffic-light', at: [147, 200], label: 'Semáforo' },
  { id: 'desvio-1', kind: 'detour', at: [383, 186], label: 'Desvio à direita' },
  { id: 'desvio-2', kind: 'detour', at: [677, 186], label: 'Desvio à direita' },
  { id: 'ponto-A', kind: 'point', point: 'A', at: [384, 306], label: 'Ponto A' },
  { id: 'ponto-B', kind: 'point', point: 'B', at: [681, 306], label: 'Ponto B' },
  { id: 'pare', kind: 'stop', at: [700, 420], label: 'PARE' },
  { id: 'ponto-C', kind: 'point', point: 'C', at: [957, 306], label: 'Ponto C' },
];
