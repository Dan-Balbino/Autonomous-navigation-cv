import { lerp } from "../utils/dom.js";

/**
 * Animação de piscar dos olhos
 * @param {Object} config - Configuração da animação blink
 * @param {Object} state - Estado da animação (blinkScale será atualizado)
 * @param {number} now - Timestamp atual
 */
export function animateBlink(config, state, now) {
  const { intervalMs, minScale } = config;
  
  // Verifica se deve piscar após surpresa
  if (state.postSurpriseBlinkTime && now >= state.postSurpriseBlinkTime) {
    const postBlinkElapsed = now - state.postSurpriseBlinkTime;
    const postBlinkDuration = 200; // 200ms de duração do piscar
    
    if (postBlinkElapsed < postBlinkDuration) {
      // Executa o piscar após surpresa
      const blinkProgress = postBlinkElapsed / postBlinkDuration;
      const blinkWave = Math.max(0, Math.sin(blinkProgress * Math.PI));
      const easedWave = blinkWave < 0.5 
        ? 2 * blinkWave * blinkWave 
        : 1 - Math.pow(-2 * blinkWave + 2, 2) / 2;
      
      const scale = lerp(1, minScale, easedWave);
      state.blinkScale = scale;
      return;
    } else {
      // Piscar após surpresa terminou - limpa todos os estados relacionados
      state.postSurpriseBlinkTime = null;
      state.surpriseEndTime = null;
      state.surpriseStartTime = null;
    }
  }
  
  // Verifica se deve piscar durante animação de procurar (na direita ou esquerda)
  if (state.searchBlinkRightTime && now >= state.searchBlinkRightTime) {
    const blinkElapsed = now - state.searchBlinkRightTime;
    const blinkDuration = 200; // 200ms de duração do piscar
    
    if (blinkElapsed < blinkDuration) {
      // Executa o piscar na direita
      const blinkProgress = blinkElapsed / blinkDuration;
      const blinkWave = Math.max(0, Math.sin(blinkProgress * Math.PI));
      const easedWave = blinkWave < 0.5 
        ? 2 * blinkWave * blinkWave 
        : 1 - Math.pow(-2 * blinkWave + 2, 2) / 2;
      
      const scale = lerp(1, minScale, easedWave);
      state.blinkScale = scale;
      return;
    } else {
      // Piscar na direita terminou
      state.searchBlinkRightTime = null;
    }
  }
  
  if (state.searchBlinkLeftTime && now >= state.searchBlinkLeftTime) {
    const blinkElapsed = now - state.searchBlinkLeftTime;
    const blinkDuration = 200; // 200ms de duração do piscar
    
    if (blinkElapsed < blinkDuration) {
      // Executa o piscar na esquerda
      const blinkProgress = blinkElapsed / blinkDuration;
      const blinkWave = Math.max(0, Math.sin(blinkProgress * Math.PI));
      const easedWave = blinkWave < 0.5 
        ? 2 * blinkWave * blinkWave 
        : 1 - Math.pow(-2 * blinkWave + 2, 2) / 2;
      
      const scale = lerp(1, minScale, easedWave);
      state.blinkScale = scale;
      return;
    } else {
      // Piscar na esquerda terminou
      state.searchBlinkLeftTime = null;
    }
  }
  
  // Se está em animação de procurar, desabilita piscadas normais
  if (state.searchStartTime) {
    // Mantém olhos abertos durante a animação de procurar (exceto nas piscadas específicas acima)
    state.blinkScale = 1;
    return;
  }
  
  // Se está em animação de susto, desabilita piscadas normais (o susto controla o blinkScale)
  if (state.frightStartTime) {
    // O blinkScale é controlado pela animação de susto (frightBlinkScale)
    // Não faz nada aqui, deixa o susto controlar
    return;
  }
  
  // Se está em animação de acelerar, desabilita piscadas normais (o acelerar controla o blinkScale)
  if (state.accelerateActive) {
    // O blinkScale é controlado pela animação de acelerar (accelerateBlinkScale)
    // Não faz nada aqui, deixa o acelerar controlar
    return;
  }
  
  // Animação normal de piscar (apenas quando não está em animação de procurar, susto ou acelerar)
  const period = intervalMs;
  const phase = (now % period) / period;
  
  // Duração rápida do piscar (200ms de duração total)
  const blinkDuration = 200; // milissegundos
  const blinkPhase = (now % period) / blinkDuration;
  
  // Se está dentro do período de piscar (primeiros 200ms de cada ciclo)
  if (blinkPhase < 1) {
    // Usa uma função de easing mais suave para o piscar
    // Cria uma curva mais natural de abertura/fechamento
    const blinkWave = Math.max(0, Math.sin(blinkPhase * Math.PI));
    // Aplica easing para movimento mais suave
    const easedWave = blinkWave < 0.5 
      ? 2 * blinkWave * blinkWave 
      : 1 - Math.pow(-2 * blinkWave + 2, 2) / 2;
    
    const scale = lerp(1, minScale, easedWave);
    state.blinkScale = scale;
  } else {
    // Fora do período de piscar - olhos ficam abertos
    state.blinkScale = 1;
  }
}

