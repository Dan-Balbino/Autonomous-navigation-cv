import { lerp } from "../utils/dom.js";

/**
 * Função de easing elástico para efeito de slime/bounce
 * @param {number} t - Valor de 0 a 1
 * @returns {number} Valor com efeito elástico
 */
function elasticOut(t) {
  const p = 0.3;
  return Math.pow(2, -10 * t) * Math.sin((t - p / 4) * (2 * Math.PI) / p) + 1;
}

/**
 * Função de easing bounce para efeito de quicar
 * @param {number} t - Valor de 0 a 1
 * @returns {number} Valor com efeito bounce
 */
function bounceOut(t) {
  if (t < 1 / 2.75) {
    return 7.5625 * t * t;
  } else if (t < 2 / 2.75) {
    return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
  } else if (t < 2.5 / 2.75) {
    return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
  } else {
    return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
  }
}

/**
 * Animação de surpresa - olhos aumentam como slimes (esticando e quicando)
 * @param {Object} config - Configuração da animação surprise
 * @param {Object} state - Estado da animação (surpriseScale será atualizado)
 * @param {number} now - Timestamp atual
 */
export function animateSurprise(config, state, now) {
  const { maxScale, expandDuration, holdDuration, shrinkDuration } = config;
  
  // Se não há timestamp de início, olhos ficam normais
  if (!state.surpriseStartTime) {
    state.surpriseScale = 1;
    return;
  }
  
  const elapsed = now - state.surpriseStartTime;
  const totalDuration = expandDuration + holdDuration + shrinkDuration;
  
  let scale = 1;
  
  if (elapsed < expandDuration) {
    // Fase de expansão com efeito elástico/bounce (slime) - ainda mais suave
    const expandProgress = Math.min(1, elapsed / expandDuration);
    // Usa easing ainda mais suave - suaviza o bounce com interpolação
    const elastic = elasticOut(expandProgress);
    const bounce = bounceOut(expandProgress);
    // Suaviza ainda mais combinando com uma curva mais suave
    const smoothBounce = bounce * 0.5 + expandProgress * 0.5; // Mistura bounce com linear
    const slimeEffect = elastic * 0.2 + smoothBounce * 0.8;
    // Aplica interpolação suave adicional
    scale = lerp(1, maxScale, slimeEffect);
  } else if (elapsed < expandDuration + holdDuration) {
    // Fase de manter grande (2 segundos)
    scale = maxScale;
  } else if (elapsed < totalDuration) {
    // Fase de voltar ao normal com animação ainda mais suave
    const shrinkProgress = Math.min(1, (elapsed - expandDuration - holdDuration) / shrinkDuration);
    // Easing ainda mais suave - ease out quint com interpolação adicional
    const eased = 1 - Math.pow(1 - shrinkProgress, 5);
    // Adiciona interpolação suave extra
    const extraSmooth = eased * 0.8 + shrinkProgress * 0.2;
    scale = lerp(maxScale, 1, extraSmooth);
  } else {
    // Animação terminou - volta ao normal e marca o fim
    scale = 1;
    if (!state.surpriseEndTime) {
      state.surpriseEndTime = now;
      // Agenda piscar 2 segundos depois
      state.postSurpriseBlinkTime = now + 2000;
    }
    // Mantém o timestamp de início até o piscar acontecer (será limpo no blink)
  }
  
  // Remove arredondamento excessivo para movimento mais suave
  state.surpriseScale = scale;
}

