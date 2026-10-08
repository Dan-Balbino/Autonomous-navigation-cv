/**
 * Papéis dos pontos da missão (na ordem recebida): coleta no primeiro, entrega no último.
 * Na prova vêm só 2 dos 3 pontos (ex.: A → C, sem passar por B); se vierem mais, os do
 * meio são passagem.
 */
export const ROLE = { pickup: 'pickup', pass: 'pass', delivery: 'delivery' };

const NAMES = { pickup: 'Coleta', pass: 'Passagem', delivery: 'Entrega' };

/** Papel do ponto `index` numa missão de `total` pontos. */
export function roleAt(index, total) {
  if (index <= 0) return ROLE.pickup;
  if (index >= total - 1) return ROLE.delivery;
  return ROLE.pass;
}

export const roleName = (index, total) => NAMES[roleAt(index, total)];

/** "Ponto de coleta à frente" etc. */
export function roleAhead(index, total) {
  const role = roleAt(index, total);
  if (role === ROLE.pickup) return 'Ponto de coleta à frente';
  if (role === ROLE.delivery) return 'Ponto de entrega à frente';
  return 'Ponto de passagem à frente';
}
