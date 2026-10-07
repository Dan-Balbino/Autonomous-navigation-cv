import { setStyles } from "../utils/dom.js";
import { lerp } from "../utils/dom.js";

/**
 * Animação de tentar enxergar - olhos forçados com óculos e movimento de leitura
 * @param {Object} config - Configuração da animação squint
 * @param {Object} state - Estado da animação (squintX, squintY, squintScale serão atualizados)
 * @param {Object} elements - Elementos DOM (glassesContainer, glassesLeft, glassesRight, glassesBridge)
 * @param {Object} eyeOffsets - Offsets dos olhos (leftEyeOffset, rightEyeOffset)
 * @param {number} now - Timestamp atual
 */
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

export function animateSquint(config, state, elements, eyeOffsets, now) {
  const { enabled, durationMs, horizontalAmplitude, verticalAmplitude, diagonalAmplitude, squintScale, movementSpeed, glassesBridgeNoseCoveragePx } = config;
  // Tempo mínimo com os óculos; enquanto state.squintHold estiver ativo (placa de PARE /
  // sinal vermelho vindos do carro) os óculos ficam até a condição sumir
  const squintDuration = config.minDurationMs ?? 5000;
  const entryDuration = 600; // Duração da animação de entrada (óculos caindo)
  const exitDuration = 500; // Duração da animação de saída (óculos jogados para cima)
  
  // Se não está habilitado, reseta tudo
  if (!enabled) {
    setStyles(elements.glassesContainer, { opacity: "0", visibility: "hidden" });
    state.squintX = 0;
    state.squintY = 0;
    state.squintScale = 1;
    state.squintStartTime = null;
    state.squintEntryStartTime = null;
    state.squintExitStartTime = null;
    return;
  }
  
  // ANIMAÇÃO DE ENTRADA (óculos caindo do céu)
  if (state.squintEntryStartTime && !state.squintExitStartTime) {
    const entryElapsed = now - state.squintEntryStartTime;
    const entryProgress = Math.min(1, entryElapsed / entryDuration);
    
    // Easing para queda com bounce
    const easedProgress = easeOutBounce(entryProgress);
    
    // Os óculos começam acima e caem apenas até o centro vertical do olho
    // O container precisa estar centralizado verticalmente no centro dos olhos
    // Começa pouco acima e cai até o centro (não muito longe)
    const startY = -20; // Começa apenas 20vmin acima do centro
    const endY = 0; // Termina no centro vertical do olho (sem offset adicional)
    const currentY = lerp(startY, endY, easedProgress);
    
    // Rotação diagonal durante a queda (cai com uma ponta primeiro)
    const startRotation = -25; // Rotação inicial (diagonal)
    const endRotation = 0; // Rotação final (normal)
    const currentRotation = lerp(startRotation, endRotation, easedProgress);
    
    // Os olhos se reduzem suavemente durante a entrada
    const eyeScaleStart = 1;
    const eyeScaleEnd = squintScale;
    state.squintScale = lerp(eyeScaleStart, eyeScaleEnd, easedProgress);
    
    // Opacidade aumenta durante a queda
    const opacity = entryProgress;
    
    // Posiciona os óculos (posições relativas fixas)
    const leftEyeX = eyeOffsets.leftEyeOffset || 0;
    const rightEyeX = eyeOffsets.rightEyeOffset || 0;
    const bridgeX = (leftEyeX + rightEyeX) / 2;
    
    // Aplica opacidade e visibilidade no container
    // O container é posicionado no centro vertical dos olhos usando top: 50% + translateY(-50%)
    // Depois aplica o movimento de queda (currentY) adicional
    // Usa transform-origin: center para que a rotação seja no centro
    const eyeCenterY = eyeOffsets.eyeCenterY || 50;
    setStyles(elements.glassesContainer, { 
      opacity: `${opacity}`, 
      visibility: opacity > 0.01 ? "visible" : "hidden",
      transform: `translateX(-50%) translateY(calc(-50% + ${currentY}vmin)) rotate(${currentRotation}deg)`,
      transformOrigin: "center center",
      left: "50%",
      top: `${eyeCenterY}vmin`, // Centro vertical dos olhos
    });
    
    // Elementos internos mantêm posições relativas fixas (não são animados individualmente)
    // Os elementos são posicionados relativamente ao container (que está em left: 50%)
    // Todos centralizados verticalmente (top: 50% + translateY(-50%))
    setStyles(elements.glassesLeft, {
      left: `calc(50% + ${leftEyeX}vmin)`,
      top: "50%",
      transform: `translateX(-50%) translateY(-50%)`,
    });
    setStyles(elements.glassesRight, {
      left: `calc(50% + ${rightEyeX}vmin)`,
      top: "50%",
      transform: `translateX(-50%) translateY(-50%)`,
    });
    setStyles(elements.glassesBridge, {
      left: `calc(50% + ${bridgeX}vmin)`,
      top: "50%",
      transform: `translateX(-50%) translateY(-50%)`,
    });
    // Curvatura do nariz no centro da ponte
    // A ponte tem height: 6px e está centralizada em top: 50% com translateY(-50%)
    // O topo da ponte está em 50% - 3px (metade da altura para cima)
    // A curvatura deve ficar ACIMA da linha, mas desce pixels extras para cobrir completamente a linha da ponte
    const bridgeHeightPx = 6;
    const bridgeTopOffset = -(bridgeHeightPx / 2); // Topo da ponte está 3px acima do centro (50% - 3px)
    const extraCoveragePx = glassesBridgeNoseCoveragePx || 2.5; // Pixels extras para cobrir completamente a linha da ponte
    const bottomOffset = Math.abs(bridgeTopOffset) - extraCoveragePx; // Desce pixels extras para cobrir a linha da ponte
    setStyles(elements.glassesBridgeNose, {
      left: `calc(50% + ${bridgeX}vmin)`,
      bottom: `calc(50% - ${bottomOffset}px)`, // Desce pixels extras para cobrir a linha da ponte
      transform: `translateX(-50%)`, // Centraliza horizontalmente apenas
    });
    
    // Quando a entrada termina, inicia a animação principal
    if (entryProgress >= 1) {
      state.squintEntryStartTime = null;
      state.squintStartTime = now;
    }
    
    return;
  }
  
  // ANIMAÇÃO DE SAÍDA (óculos jogados para cima de forma caótica)
  if (state.squintExitStartTime) {
    const exitElapsed = now - state.squintExitStartTime;
    const exitProgress = Math.min(1, exitElapsed / exitDuration);
    
    // Define a direção horizontal aleatória apenas uma vez no início da animação
    if (state.squintExitHorizontalDirection === null) {
      state.squintExitHorizontalDirection = Math.random() > 0.5 ? -8 : 8;
    }
    
    // Easing para lançamento (acelera para cima)
    const easedProgress = easeOutCubic(exitProgress);
    
    // Os óculos sobem e saem da tela
    // Começa no centro (0) e sobe para cima (-60vmin)
    const startY = 0; // Começa no centro
    const endY = -60; // Sobe 60vmin e sai da tela
    const currentY = lerp(startY, endY, easedProgress);
    
    // Rotação caótica - o componente inteiro gira de forma caótica
    const startRotation = 0;
    const endRotation = 45; // Rotação caótica ao subir
    const currentRotation = lerp(startRotation, endRotation, easedProgress);
    
    // Movimento horizontal caótico - o componente inteiro se move
    const leftEyeX = eyeOffsets.leftEyeOffset || 0;
    const rightEyeX = eyeOffsets.rightEyeOffset || 0;
    const centerX = (leftEyeX + rightEyeX) / 2;
    
    // Movimento horizontal aleatório (fixo durante toda a animação)
    const horizontalOffset = lerp(0, state.squintExitHorizontalDirection, easedProgress);
    
    // Os olhos voltam ao normal suavemente
    const eyeScaleStart = squintScale;
    const eyeScaleEnd = 1;
    state.squintScale = lerp(eyeScaleStart, eyeScaleEnd, easedProgress);
    
    // Opacidade diminui durante a saída
    const opacity = 1 - exitProgress;
    
    // Aplica transform de lançamento caótico no container (componente único)
    // O container está centralizado verticalmente, então aplica translateY(-50%) + currentY
    const eyeCenterY = eyeOffsets.eyeCenterY || 50;
    setStyles(elements.glassesContainer, { 
      opacity: `${opacity}`, 
      visibility: opacity > 0.01 ? "visible" : "hidden",
      transform: `translateX(calc(-50% + ${horizontalOffset}vmin)) translateY(calc(-50% + ${currentY}vmin)) rotate(${currentRotation}deg)`,
      transformOrigin: "center center",
      left: "50%",
      top: `${eyeCenterY}vmin`,
    });
    
    // Elementos internos mantêm posições relativas fixas
    // Os elementos são posicionados relativamente ao container (que está em left: 50%)
    // Todos centralizados verticalmente (top: 50% + translateY(-50%))
    setStyles(elements.glassesLeft, {
      left: `calc(50% + ${leftEyeX}vmin)`,
      top: "50%",
      transform: `translateX(-50%) translateY(-50%)`,
    });
    setStyles(elements.glassesRight, {
      left: `calc(50% + ${rightEyeX}vmin)`,
      top: "50%",
      transform: `translateX(-50%) translateY(-50%)`,
    });
    setStyles(elements.glassesBridge, {
      left: `calc(50% + ${centerX}vmin)`,
      top: "50%",
      transform: `translateX(-50%) translateY(-50%)`,
    });
    // Curvatura do nariz no centro da ponte
    // A ponte tem height: 6px e está centralizada em top: 50% com translateY(-50%)
    // O topo da ponte está em 50% - 3px (metade da altura para cima)
    // A curvatura deve ficar ACIMA da linha, mas desce pixels extras para cobrir completamente a linha da ponte
    const bridgeHeightPx = 6;
    const bridgeTopOffset = -(bridgeHeightPx / 2); // Topo da ponte está 3px acima do centro (50% - 3px)
    const extraCoveragePx = glassesBridgeNoseCoveragePx || 2.5; // Pixels extras para cobrir completamente a linha da ponte
    const bottomOffset = Math.abs(bridgeTopOffset) - extraCoveragePx; // Desce pixels extras para cobrir a linha da ponte
    setStyles(elements.glassesBridgeNose, {
      left: `calc(50% + ${centerX}vmin)`,
      bottom: `calc(50% - ${bottomOffset}px)`, // Desce pixels extras para cobrir a linha da ponte
      transform: `translateX(-50%)`, // Centraliza horizontalmente apenas
    });
    
    // Reseta movimento dos olhos durante saída
    state.squintX = lerp(state.squintX || 0, 0, 0.15);
    state.squintY = lerp(state.squintY || 0, 0, 0.15);
    
    // Quando a saída termina, reseta tudo
    if (exitProgress >= 1) {
      state.squintExitStartTime = null;
      state.squintStartTime = null;
      state.squintExitHorizontalDirection = null; // Reseta a direção aleatória
      state.squintX = 0;
      state.squintY = 0;
      state.squintScale = 1;
      setStyles(elements.glassesContainer, { opacity: "0", visibility: "hidden" });
    }
    
    return;
  }
  
  // Se não há timestamp de início, apenas oculta
  if (!state.squintStartTime) {
    setStyles(elements.glassesContainer, { opacity: "0", visibility: "hidden" });
    state.squintX = 0;
    state.squintY = 0;
    state.squintScale = 1;
    return;
  }
  
  const elapsed = now - state.squintStartTime;
  
  // Passou o tempo mínimo e o carro não segura mais o squint - inicia animação de saída
  if (elapsed >= squintDuration && !state.squintHold) {
    state.squintStartTime = null;
    state.squintExitStartTime = now;
    return;
  }
  
  // Aplica o multiplicador de velocidade ao progresso do ciclo
  const speedMultiplier = movementSpeed || 1.0;
  const cycleProgress = ((elapsed * speedMultiplier) % durationMs) / durationMs;
  
  // Mostra os óculos durante a animação
  setStyles(elements.glassesContainer, { opacity: "1", visibility: "visible" });
  
  // Movimento horizontal (como se estivesse lendo uma linha)
  // Vai da esquerda para a direita e volta
  const horizontalPhase = cycleProgress * Math.PI * 2;
  const horizontalX = Math.sin(horizontalPhase) * horizontalAmplitude;
  
  // Movimento vertical lento (para cima e para baixo)
  const verticalPhase = (cycleProgress * Math.PI * 2) * 0.3; // Mais lento que o horizontal
  const verticalY = Math.sin(verticalPhase) * verticalAmplitude;
  
  // Movimento diagonal lento
  const diagonalPhase = (cycleProgress * Math.PI * 2) * 0.5; // Velocidade intermediária
  const diagonalX = Math.cos(diagonalPhase) * diagonalAmplitude;
  const diagonalY = Math.sin(diagonalPhase) * diagonalAmplitude;
  
  // Combina todos os movimentos
  state.squintX = horizontalX + diagonalX;
  state.squintY = verticalY + diagonalY;
  
  // Aplica escala de "forçar" os olhos (olhos semicerrados)
  state.squintScale = squintScale;
  
  // ANIMAÇÃO PRINCIPAL (óculos no lugar, olhos se movendo)
  // Mostra os óculos durante a animação
  // O container fica fixo na posição correta (centro vertical dos olhos)
  const eyeCenterY = eyeOffsets.eyeCenterY || 50;
  setStyles(elements.glassesContainer, { 
    opacity: "1", 
    visibility: "visible",
    transform: `translateX(-50%) translateY(-50%)`, // Centralizado verticalmente
    transformOrigin: "center center",
    left: "50%",
    top: `${eyeCenterY}vmin`, // Centro vertical dos olhos
  });
  
  // Posiciona os óculos sobre os olhos (posições relativas fixas)
  const leftEyeX = eyeOffsets.leftEyeOffset || 0;
  const rightEyeX = eyeOffsets.rightEyeOffset || 0;
  const bridgeX = (leftEyeX + rightEyeX) / 2;
  
  // Elementos internos mantêm posições relativas fixas
  // Os elementos são posicionados relativamente ao container (que está em left: 50%)
  // Todos centralizados verticalmente (top: 50% + translateY(-50%))
  setStyles(elements.glassesLeft, {
    left: `calc(50% + ${leftEyeX}vmin)`,
    top: "50%",
    transform: `translateX(-50%) translateY(-50%)`,
  });
  setStyles(elements.glassesRight, {
    left: `calc(50% + ${rightEyeX}vmin)`,
    top: "50%",
    transform: `translateX(-50%) translateY(-50%)`,
  });
  setStyles(elements.glassesBridge, {
    left: `calc(50% + ${bridgeX}vmin)`,
    top: "50%",
    transform: `translateX(-50%) translateY(-50%)`,
  });
  // Curvatura do nariz no centro da ponte
  // A ponte tem height: 6px e está centralizada em top: 50% com translateY(-50%)
  // O topo da ponte está em 50% - 3px (metade da altura para cima)
  // A curvatura deve ficar ACIMA da linha, mas desce pixels extras para cobrir completamente a linha da ponte
  const bridgeHeightPx = 6;
  const bridgeTopOffset = -(bridgeHeightPx / 2); // Topo da ponte está 3px acima do centro (50% - 3px)
  const extraCoveragePx = glassesBridgeNoseCoveragePx || 2; // Pixels extras para cobrir completamente a linha da ponte
  const bottomOffset = Math.abs(bridgeTopOffset) - extraCoveragePx; // Desce pixels extras para cobrir a linha da ponte
  setStyles(elements.glassesBridgeNose, {
    left: `calc(50% + ${bridgeX}vmin)`,
    bottom: `calc(50% - ${bottomOffset}px)`, // Desce pixels extras para cobrir a linha da ponte
    transform: `translateX(-50%)`, // Centraliza horizontalmente apenas
  });
}

