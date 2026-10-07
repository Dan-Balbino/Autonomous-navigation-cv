import { setStyles } from "../utils/dom.js";

/**
 * Animacao de flutuacao (sobe e desce) com rotacao opcional dos olhos.
 * `state.bobWeight` (0..1) atenua a flutuacao suavemente em vez de congela-la
 * no meio do movimento quando outra animacao assume.
 * @param {Object} stage - Elemento stage
 * @param {Object} config - Configuracao da animacao bob
 * @param {number} scale - Escala geral do rosto
 * @param {Object} state - Estado da animacao (leftEyeRotation, rightEyeRotation serao atualizados)
 * @param {number} now - Timestamp atual
 */
export function animateBob(stage, config, scale, state, now) {
  const { durationMs, y, rotate, directionLeft, directionRight } = config;
  const weight = state.bobWeight ?? 1;
  const phase = now / durationMs;
  const offset = Math.sin(phase) * y * weight;

  setStyles(stage, {
    transform: `translate3d(0, ${offset.toFixed(2)}px, 0) scale(${scale})`,
  });

  if (rotate > 0) {
    const rotationPhase = ((Math.sin(phase) + 1) / 2) * weight;
    // direction: 0 = horario, 180 = anti-horario
    state.leftEyeRotation = (directionLeft === 180 ? -rotate : rotate) * rotationPhase;
    state.rightEyeRotation = (directionRight === 180 ? -rotate : rotate) * rotationPhase;
  } else {
    state.leftEyeRotation = 0;
    state.rightEyeRotation = 0;
  }
}
