import { setStyles } from "../utils/dom.js";
import { lerp } from "../utils/dom.js";

/**
 * Função de easing para movimento rápido e suave
 */
function easeInOutCubic(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Animação de procurar - olhos olham para os lados rapidamente
 * @param {Object} config - Configuração da animação search
 * @param {Object} state - Estado da animação (searchX será atualizado)
 * @param {number} now - Timestamp atual
 */
export function animateSearch(config, state, now) {
  const { enabled, speed, distance, direction, movementDurationMs, pauseDurationMs } = config;
  
  // Se não está habilitado, reseta
  if (!enabled) {
    state.searchX = 0;
    state.searchStartTime = null;
    return;
  }
  
  // Se não há timestamp de início, apenas mantém olhos no centro
  if (!state.searchStartTime) {
    state.searchX = 0;
    return;
  }
  
  const elapsed = now - state.searchStartTime;
  const moveDuration = movementDurationMs || 400; // Duração de cada movimento (padrão: 400ms)
  const pauseDuration = pauseDurationMs || 1000; // Duração de cada pausa (padrão: 1000ms = 1 segundo)
  
  // Estrutura do ciclo: meio -> direita (movimento) -> pausa -> direita -> esquerda (movimento) -> pausa -> esquerda -> meio (movimento)
  // Fase 0: Meio -> Direita (0 a moveDuration)
  // Fase 1: Para na direita (moveDuration a moveDuration + pauseDuration)
  // Fase 2: Direita -> Esquerda (moveDuration + pauseDuration a 2*moveDuration + pauseDuration)
  // Fase 3: Para na esquerda (2*moveDuration + pauseDuration a 2*moveDuration + 2*pauseDuration)
  // Fase 4: Esquerda -> Meio (2*moveDuration + 2*pauseDuration a 3*moveDuration + 2*pauseDuration)
  
  const totalDuration = 3 * moveDuration + 2 * pauseDuration;
  
  // Se passou o tempo total, volta suavemente ao centro e reseta
  if (elapsed >= totalDuration) {
    // Interpola suavemente de volta ao centro
    const returnElapsed = elapsed - totalDuration;
    const returnProgress = Math.min(1, returnElapsed / 200); // 200ms para voltar ao centro
    state.searchX = lerp(state.searchX || 0, 0, 0.15);
    
    if (returnProgress >= 1) {
      state.searchX = 0;
      state.searchStartTime = null;
      state.searchCycleCount = 0; // Reseta contador
      // Reseta flags de piscadas
      state.searchBlinkRightTime = null;
      state.searchBlinkLeftTime = null;
      state.searchBlinkRightTriggered = false;
      state.searchBlinkLeftTriggered = false;
      
      // Se foi disparado após susto, reseta o flag para garantir que tudo volte ao normal
      if (state.triggerSearchAfterFright !== undefined) {
        state.triggerSearchAfterFright = false;
      }
    }
    return;
  }
  
  // Determina qual fase está executando
  let targetX;
  let phaseStart = 0;
  
  // Fase 0: Meio -> Direita
  if (elapsed < moveDuration) {
    const phaseProgress = elapsed / moveDuration;
    const easedProgress = easeInOutCubic(phaseProgress);
    targetX = direction * distance * speed * easedProgress;
  }
  // Fase 1: Para na direita
  else if (elapsed < moveDuration + pauseDuration) {
    targetX = direction * distance * speed; // Mantém na direita
    
    // Dispara piscada quando chega na direita (apenas uma vez)
    if (!state.searchBlinkRightTime && !state.searchBlinkRightTriggered) {
      state.searchBlinkRightTime = now;
      state.searchBlinkRightTriggered = true; // Marca que já piscou na direita
    }
  }
  // Fase 2: Direita -> Esquerda
  else if (elapsed < 2 * moveDuration + pauseDuration) {
    phaseStart = moveDuration + pauseDuration;
    const phaseElapsed = elapsed - phaseStart;
    const phaseProgress = Math.min(1, phaseElapsed / moveDuration);
    const easedProgress = easeInOutCubic(phaseProgress);
    // Interpola de direita para esquerda
    targetX = direction * distance * speed * (1 - easedProgress) + (-direction * distance * speed * easedProgress);
  }
  // Fase 3: Para na esquerda
  else if (elapsed < 2 * moveDuration + 2 * pauseDuration) {
    targetX = -direction * distance * speed; // Mantém na esquerda
    
    // Dispara piscada quando chega na esquerda (apenas uma vez)
    if (!state.searchBlinkLeftTime && !state.searchBlinkLeftTriggered) {
      state.searchBlinkLeftTime = now;
      state.searchBlinkLeftTriggered = true; // Marca que já piscou na esquerda
    }
  }
  // Fase 4: Esquerda -> Meio
  else {
    phaseStart = 2 * moveDuration + 2 * pauseDuration;
    const phaseElapsed = elapsed - phaseStart;
    const phaseProgress = Math.min(1, phaseElapsed / moveDuration);
    const easedProgress = easeInOutCubic(phaseProgress);
    // Interpola de esquerda para o centro
    targetX = -direction * distance * speed * (1 - easedProgress);
  }
  
  // Interpola suavemente entre a posição atual e a posição alvo para evitar teleportes
  // Usa um fator de interpolação alto (0.2) para movimento rápido mas suave
  state.searchX = lerp(state.searchX || 0, targetX, 0.2);
}

