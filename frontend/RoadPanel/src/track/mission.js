/**
 * Papéis dos pontos da missão, iguais aos de core/navigation.py:
 *
 * - `Navigation.add_point` alterna `mission_state` a cada ponto adicionado: o primeiro de uma
 *   lista vazia é coleta (1), o seguinte entrega (0), depois coleta de novo, e assim por diante.
 *   Ponto adicionado com a lista ainda cheia continua a alternância a partir do último.
 * - `main.py` manda `mission_state[0]` (papel do ponto atual) em `command.mission_state`
 *   (-1 sem rota ou em modo manual).
 * - O carro para em TODOS os pontos (point_stop_latched) e só sai com o botão RUN.
 */
export const ROLE = { pickup: 'pickup', delivery: 'delivery' };

const NAMES = { pickup: 'Coleta', delivery: 'Entrega' };
const AHEAD = { pickup: 'Ponto de coleta à frente', delivery: 'Ponto de entrega à frente' };

/** command.mission_state -> papel (null quando -1/desconhecido). */
export function roleFromMissionState(value) {
  if (value === 1) return ROLE.pickup;
  if (value === 0) return ROLE.delivery;
  return null;
}

const flip = (role) => (role === ROLE.pickup ? ROLE.delivery : ROLE.pickup);

/** `count` papéis alternados começando em `first` (espelho de add_point). */
export function alternateRoles(count, first = ROLE.pickup) {
  const roles = [];
  let role = first;
  for (let i = 0; i < count; i++) {
    roles.push(role);
    role = flip(role);
  }
  return roles;
}

/** Papéis de `count` pontos adicionados depois de uma lista que termina em `lastRole`. */
export function appendRoles(lastRole, count) {
  return alternateRoles(count, lastRole ? flip(lastRole) : ROLE.pickup);
}

export const roleName = (role) => NAMES[role] || 'Ponto';

/** "Ponto de coleta à frente" etc. */
export const roleAhead = (role) => AHEAD[role] || 'Ponto da missão à frente';
