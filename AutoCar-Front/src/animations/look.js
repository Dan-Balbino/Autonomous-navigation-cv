import { lerp } from "../utils/dom.js";

/**
 * Animação de olhar ao redor
 * @param {Object} config - Configuração da animação look
 * @param {Object} state - Estado da animação (eyeX, eyeY serão atualizados)
 * @param {number} now - Timestamp atual
 * @param {number} delta - Delta time desde o último frame
 */
export function animateLook(config, state, now, delta) {
  const { durationMs, radius, smoothness } = config;
  const phase = (now / durationMs) % (Math.PI * 2);
  const targetX = Math.cos(phase) * radius;
  const targetY = Math.sin(phase * 0.7) * radius;
  
  // Interpolação mais suave baseada em tempo real
  // Usa uma função de easing exponencial para movimento mais natural
  // Garante que nunca haja teleportes ou travamentos
  const frameTime = Math.min(delta, 32) / 16; // Normaliza delta, limitando a 32ms
  const smoothFactor = smoothness * frameTime;
  const smooth = Math.min(0.3, smoothFactor); // Limita a velocidade máxima para evitar teleportes

  state.eyeX = lerp(state.eyeX, targetX, smooth);
  state.eyeY = lerp(state.eyeY, targetY, smooth);

  // Arredonda para evitar sub-pixels que podem causar travamentos visuais
  state.eyeX = Math.round(state.eyeX * 100) / 100;
  state.eyeY = Math.round(state.eyeY * 100) / 100;
}

