import { lerp } from "../utils/dom.js";

/**
 * Animacao de olhar ao redor.
 * Em vez de um circulo constante, faz sacadas: escolhe um ponto, vai ate ele
 * rapido e com desaceleracao, fica um tempo e escolhe outro. Uma leve deriva
 * mantem o olhar vivo entre as sacadas. Quanto mais focado (velocidade alta),
 * menos o olhar passeia.
 * @param {Object} config - Configuracao da animacao look
 * @param {Object} state - Estado da animacao (eyeX, eyeY serao atualizados)
 * @param {number} now - Timestamp atual
 * @param {number} delta - Delta time desde o ultimo frame
 */
export function animateLook(config, state, now, delta) {
  const { durationMs = 4200, radius = 8, smoothness = 0.18 } = config;
  const focus = state.moodFocus || 0;
  const reach = radius * (1 - 0.7 * focus);

  if (state.nextSaccadeAt === undefined || now >= state.nextSaccadeAt) {
    // 30% das vezes volta ao centro, o resto escolhe um ponto no disco
    if (Math.random() < 0.3) {
      state.lookTargetX = 0;
      state.lookTargetY = 0;
    } else {
      const angle = Math.random() * Math.PI * 2;
      const dist = reach * Math.sqrt(Math.random());
      state.lookTargetX = Math.cos(angle) * dist;
      state.lookTargetY = Math.sin(angle) * dist * 0.6;
    }
    const minGap = durationMs * 0.25;
    state.nextSaccadeAt = now + minGap + Math.random() * (durationMs - minGap);
  }

  const driftX = Math.sin(now / 1300) * 0.6;
  const driftY = Math.cos(now / 1700) * 0.4;

  // smoothness vira uma taxa por ms, independente do FPS
  const k = 1 - Math.exp(-delta * smoothness * 0.1);
  state.eyeX = lerp(state.eyeX, (state.lookTargetX || 0) + driftX, k);
  state.eyeY = lerp(state.eyeY, (state.lookTargetY || 0) + driftY, k);
}
