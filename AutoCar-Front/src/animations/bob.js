import { setStyles } from "../utils/dom.js";

/**
 * Animação de flutuação (sobe e desce) com rotação opcional dos olhos
 * @param {Object} stage - Elemento stage
 * @param {Object} config - Configuração da animação bob
 * @param {number} scale - Escala geral do rosto
 * @param {Object} state - Estado da animação (leftEyeRotation, rightEyeRotation serão atualizados)
 * @param {number} now - Timestamp atual
 */
export function animateBob(stage, config, scale, state, now) {
  const { durationMs, y, rotate, directionLeft, directionRight } = config;
  const phase = (now / durationMs) % (Math.PI * 2);
  const offset = Math.sin(phase) * y;
  
  // Arredonda para evitar sub-pixels que podem causar travamentos
  const roundedOffset = Math.round(offset * 100) / 100;
  const roundedScale = Math.round(scale * 1000) / 1000;

  setStyles(stage, {
    transform: `translateY(${roundedOffset}px) scale(${roundedScale})`,
  });
  
  // Se rotate > 0, aplica rotação nos olhos durante o ciclo
  if (rotate > 0) {
    // Calcula a rotação baseada no ciclo (0 a 1, depois volta)
    // Usa seno para criar ciclo suave de rotação
    const rotationPhase = (Math.sin(phase) + 1) / 2; // Normaliza de 0 a 1
    
    // Calcula o ângulo de rotação baseado no phase e na direção
    // directionLeft: 0 = horário, 180 = anti-horário
    // directionRight: 0 = horário, 180 = anti-horário
    const leftRotation = directionLeft === 180 
      ? -rotate * rotationPhase  // Anti-horário (negativo)
      : rotate * rotationPhase;  // Horário (positivo)
    
    const rightRotation = directionRight === 180
      ? -rotate * rotationPhase  // Anti-horário (negativo)
      : rotate * rotationPhase;  // Horário (positivo)
    
    state.leftEyeRotation = leftRotation;
    state.rightEyeRotation = rightRotation;
  } else {
    // Se rotate = 0, não rotaciona
    state.leftEyeRotation = 0;
    state.rightEyeRotation = 0;
  }
}

