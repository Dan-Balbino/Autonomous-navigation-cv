/**
 * Trajetória que o carro REAL vai fazer, seguindo as mesmas regras do código Python:
 *
 * - core/navigation.py: `lane_guide_map` diz, para o ponto atual da rota, que faixa
 *   preferir a cada placa de desvio vista (A: direita; B: esquerda, direita; C: esquerda,
 *   esquerda). O contador zera quando o ponto é confirmado; sem rota (ou ponto
 *   desconhecido), a preferência é "left".
 * - vision/lane_detection.py: a preferência faz o carro seguir só a linha daquele lado
 *   na bifurcação seguinte ("right" = entra à direita; "left" = segue a linha da esquerda).
 * - Nas bifurcações sem placa de desvio o carro segue a pista no sentido de referência
 *   (volta horária), que é o que a linha contínua faz.
 *
 * Mantenha `LANE_GUIDE_MAP` igual ao de core/navigation.py.
 */
export const LANE_GUIDE_MAP = {
  A: ['right'],
  B: ['left', 'right'],
  C: ['left', 'left'],
};

const MAX_EDGES = 48;
// Uma volta por ponto + a volta parcial de quem parte no meio da pista + folga
const EXTRA_LAPS = 2;

const unit = (a, b) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
};

/** >0 vira à direita, <0 à esquerda (y para baixo), ~0 segue reto. */
function turnAmount(from, to) {
  const a = from.line.pts;
  const da = unit(a[a.length - 2], a[a.length - 1]);
  const db = unit(to.line.pts[0], to.line.pts[1]);
  return da[0] * db[1] - da[1] * db[0];
}

/** Espelho de Navigation.update_lane(). */
export function lanePreference(point, counter) {
  const lanes = point ? LANE_GUIDE_MAP[point] : null;
  if (!lanes || !lanes.length) return 'left';
  return lanes[Math.min(counter, lanes.length - 1)];
}

function chooseNext(network, edge, preference) {
  const options = network.successors(edge);
  if (options.length <= 1) return options[0] || null;
  const byTurn = [...options].sort((x, y) => turnAmount(edge, x) - turnAmount(edge, y));
  if (preference === 'right') return byTurn[byTurn.length - 1];
  if (preference === 'left') return byTurn[0];
  // Sem placa: segue a pista no sentido de referência, o mais reto possível
  const forward = options.filter((option) => !option.id.endsWith('~r'));
  const pool = forward.length ? forward : options;
  return pool.reduce((best, option) =>
    (Math.abs(turnAmount(edge, option)) < Math.abs(turnAmount(edge, best)) ? option : best));
}

/** A placa de desvio só vale para quem vê a frente dela. */
function seesFront(network, sign, edge) {
  const travel = edge.line.sample(network.signS(sign, edge)).dir;
  return travel[0] * sign.facing[0] + travel[1] * sign.facing[1] < -0.2;
}

/**
 * Percorre a pista como o carro faria, a partir de `start` = { edgeId, s }.
 * `detoursDone` = placas de desvio já vistas desde o último ponto confirmado.
 * Termina na largada depois do último ponto (ou após uma volta, se não há rota).
 */
export function walkCarLogic(network, start, queue, detoursDone = 0) {
  const edges = [];
  const targets = [];
  const pending = [...queue];
  let counter = detoursDone;
  let preference = null;      // definida por uma placa de desvio, usada na próxima bifurcação
  let edge = network.edge(start.edgeId);
  let fromS = start.s;
  let laps = 0;

  // Começando no meio de um trecho: um desvio já visto nele ainda vale para a próxima bifurcação
  if (edge) {
    const seen = network.signs.filter((sign) => sign.kind === 'detour' && sign.base === edge.base &&
      network.signS(sign, edge) <= fromS + 1 && seesFront(network, sign, edge));
    if (seen.length) preference = lanePreference(pending[0], Math.max(0, counter - 1));
  }

  while (edge && edges.length < MAX_EDGES) {
    edges.push(edge);
    // Placas desta aresta à frente do carro, na ordem em que aparecem
    const ahead = network.signs
      .filter((sign) => sign.base === edge.base && network.signS(sign, edge) > fromS + 1)
      .sort((a, b) => network.signS(a, edge) - network.signS(b, edge));
    for (const sign of ahead) {
      if (sign.kind === 'detour' && seesFront(network, sign, edge)) {
        preference = lanePreference(pending[0], counter);
        counter += 1;
      } else if (sign.kind === 'point' && pending.length && sign.point === pending[0]) {
        targets.push({ point: pending.shift(), edgeIndex: edges.length - 1 });
        counter = 0;
      }
    }
    if (edge.to === 'S') {
      laps += 1;
      // Volta fechada sem pontos pendentes: fim. Ponto que não aparece depois de uma volta por ponto (+2)
      // é inalcançável com a lógica atual (ex.: placa movida para fora do caminho).
      if (!pending.length || laps >= queue.length + EXTRA_LAPS) break;
    }
    const branching = network.successors(edge).length > 1;
    const next = chooseNext(network, edge, preference);
    if (branching) preference = null;
    edge = next;
    fromS = -1;
  }
  return { edges, targets, unreachable: pending };
}
