import { lerp } from "../utils/dom.js";

/**
 * Função de easing para bounce (quicar)
 */
function easeOutBounce(t) {
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
 * Função de easing para ease out cubic
 */
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Função de easing para ease in out
 */
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * Animação de susto - olhos aumentam, diminuem, tremem e se abrem gradualmente
 * @param {Object} config - Configuração da animação fright
 * @param {Object} state - Estado da animação (frightScale, frightBlinkScale serão atualizados)
 * @param {number} now - Timestamp atual
 */
export function animateFright(config, state, now) {
  const { enabled, maxScale, expandDuration, shrinkDuration, trembleDuration, eyeOpenDuration, eyeCloseDuration, eyeOpenFullDuration } = config;
  
  // Se não está habilitado, reseta
  if (!enabled) {
    state.frightScale = 1;
    state.frightBlinkScale = 1;
    state.frightStartTime = null;
    state.frightPhase = null;
    state.frightTrembleX = 0;
    state.frightTrembleY = 0;
    return;
  }
  
  // Se não há timestamp de início, apenas mantém valores normais
  if (!state.frightStartTime) {
    state.frightScale = 1;
    state.frightBlinkScale = 1;
    state.frightTrembleX = 0;
    state.frightTrembleY = 0;
    return;
  }
  
  const elapsed = now - state.frightStartTime;
  
  // Fase 1: Expansão (olhos aumentam como surpresa)
  const phase1End = expandDuration || 300;
  if (elapsed < phase1End) {
    state.frightPhase = "expand";
    const progress = elapsed / phase1End;
    const easedProgress = easeOutBounce(progress);
    state.frightScale = lerp(1, maxScale || 1.4, easedProgress);
    state.frightBlinkScaleLeft = 1; // Olhos abertos
    state.frightBlinkScaleRight = 1; // Olhos abertos
    state.frightTrembleX = 0;
    state.frightTrembleY = 0;
    return;
  }
  
  // Fase 2: Diminuição e fechamento (olhos diminuem e fecham)
  const phase2Start = phase1End;
  const phase2Duration = shrinkDuration || 200;
  const phase2End = phase2Start + phase2Duration;
  if (elapsed < phase2End) {
    state.frightPhase = "shrink";
    const progress = (elapsed - phase2Start) / phase2Duration;
    const easedProgress = easeOutCubic(progress);
    state.frightScale = lerp(maxScale || 1.4, 1, easedProgress);
    // Fecha os olhos durante a diminuição (ambos os olhos)
    const blinkProgress = Math.min(1, progress * 1.5); // Fecha mais rápido
    state.frightBlinkScaleLeft = lerp(1, 0.1, blinkProgress);
    state.frightBlinkScaleRight = lerp(1, 0.1, blinkProgress);
    state.frightTrembleX = 0;
    state.frightTrembleY = 0;
    return;
  }
  
  // Fase 3: Tremor (olhos fechados e tremendo)
  const phase3Start = phase2End;
  const phase3Duration = trembleDuration || 800;
  const phase3End = phase3Start + phase3Duration;
  if (elapsed < phase3End) {
    state.frightPhase = "tremble";
    state.frightScale = 1;
    state.frightBlinkScaleLeft = 0.1; // Olhos fechados
    state.frightBlinkScaleRight = 0.1; // Olhos fechados
    // Tremor aleatório mas suave
    const trembleIntensity = 2; // Intensidade do tremor em pixels
    state.frightTrembleX = (Math.random() - 0.5) * trembleIntensity;
    state.frightTrembleY = (Math.random() - 0.5) * trembleIntensity;
    return;
  }
  
  // Fase 4: Um olho (esquerdo) se abre devagar (mais suspense)
  const phase4Start = phase3End;
  const phase4Duration = (eyeOpenDuration || 600) * 2.5; // 2.5x mais lento para mais suspense
  const phase4End = phase4Start + phase4Duration;
  if (elapsed < phase4End) {
    state.frightPhase = "eyeOpenSlow";
    state.frightScale = 1;
    const progress = (elapsed - phase4Start) / phase4Duration;
    // Usa easing mais lento no início para mais dramaticidade
    const easedProgress = progress < 0.5 
      ? 2 * progress * progress 
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    // Apenas o olho esquerdo se abre devagar
    state.frightBlinkScaleLeft = lerp(0.1, 1, easedProgress);
    state.frightBlinkScaleRight = 0.1; // Olho direito permanece fechado
    state.frightTrembleX = 0;
    state.frightTrembleY = 0;
    return;
  }
  
  // Fase 5: Fecha novamente (apenas o esquerdo)
  const phase5Start = phase4End;
  const phase5Duration = eyeCloseDuration || 300;
  const phase5End = phase5Start + phase5Duration;
  if (elapsed < phase5End) {
    state.frightPhase = "eyeClose";
    state.frightScale = 1;
    const progress = (elapsed - phase5Start) / phase5Duration;
    const easedProgress = easeInOut(progress);
    state.frightBlinkScaleLeft = lerp(1, 0.1, easedProgress);
    state.frightBlinkScaleRight = 0.1; // Olho direito permanece fechado
    state.frightTrembleX = 0;
    state.frightTrembleY = 0;
    return;
  }
  
  // Fase 6: Abre completamente (apenas o esquerdo) - mais lento para suspense
  const phase6Start = phase5End;
  const phase6Duration = (eyeOpenFullDuration || 400) * 2; // 2x mais lento para mais suspense
  const phase6End = phase6Start + phase6Duration;
  if (elapsed < phase6End) {
    state.frightPhase = "eyeOpenFull";
    state.frightScale = 1;
    const progress = (elapsed - phase6Start) / phase6Duration;
    // Usa easing mais lento no início para mais dramaticidade
    const easedProgress = progress < 0.5 
      ? 2 * progress * progress 
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    state.frightBlinkScaleLeft = lerp(0.1, 1, easedProgress);
    state.frightBlinkScaleRight = 0.1; // Olho direito permanece fechado
    state.frightTrembleX = 0;
    state.frightTrembleY = 0;
    return;
  }
  
  // Fase 7: Segundo olho (direito) se abre - velocidade normal (mais rápido que o primeiro)
  const phase7Start = phase6End;
  // Duração normal para o segundo olho (não tão devagar quanto o primeiro)
  const phase7Duration = eyeOpenFullDuration || 400; // Velocidade normal
  const phase7End = phase7Start + phase7Duration;
  if (elapsed < phase7End) {
    state.frightPhase = "eyeOpenSecond";
    state.frightScale = 1;
    const progress = (elapsed - phase7Start) / phase7Duration;
    const easedProgress = easeInOut(progress);
    state.frightBlinkScaleLeft = 1; // Olho esquerdo já está aberto
    state.frightBlinkScaleRight = lerp(0.1, 1, easedProgress); // Olho direito se abre na velocidade normal
    state.frightTrembleX = 0;
    state.frightTrembleY = 0;
    return;
  }
  
  // Animação terminou - ambos os olhos estão abertos, dispara animação de procurar
  state.frightScale = 1;
  state.frightBlinkScale = 1;
  state.frightBlinkScaleLeft = 1;
  state.frightBlinkScaleRight = 1;
  state.frightTrembleX = 0;
  state.frightTrembleY = 0;
  state.frightStartTime = null;
  state.frightPhase = null;
  
  // Dispara animação de procurar de forma forçada
  // O flag triggerSearchAfterFright será verificado pelo FaceEngine
  if (state.triggerSearchAfterFright) {
    // Mantém o flag ativo para o FaceEngine disparar
    // Não reseta aqui, o FaceEngine vai resetar após disparar
  }
}

