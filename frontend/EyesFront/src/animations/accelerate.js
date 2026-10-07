import { lerp } from "../utils/dom.js";
import { createEl, setStyles } from "../utils/dom.js";

/**
 * Função de easing para ease in out
 */
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * Cria e inicializa as linhas de velocidade se ainda não existirem
 */
function initializeSpeedLines(container, lineCount) {
  // Se já existem linhas, não cria novamente
  if (container.children.length > 0) {
    return;
  }
  
  // Cria várias linhas
  for (let i = 0; i < lineCount; i++) {
    const line = createEl("div", "speed-line");
    container.appendChild(line);
  }
}

/**
 * Animação de acelerar - olhos ficam meio fechados como se estivesse enfrentando alta velocidade
 * @param {Object} config - Configuração da animação accelerate
 * @param {Object} state - Estado da animação (accelerateBlinkScale, accelerateTrembleX, accelerateTrembleY serão atualizados)
 * @param {Object} elements - Elementos DOM (speedLinesContainer)
 * @param {number} now - Timestamp atual
 */
export function animateAccelerate(config, state, elements, now) {
  const { enabled, blinkScale, transitionDuration, trembleIntensity, trembleChangeInterval, trembleTransitionDuration, speedLinesCount, speedLinesSpeed } = config;
  
  // Se não está habilitado, apenas reseta valores mas NÃO desativa se já estiver ativo
  // A animação só deve sair quando o comando for apertado ou a API retornar false
  if (!enabled) {
    // Não desativa a animação aqui - apenas reseta valores se não estiver ativo
    if (!state.accelerateActive) {
      state.accelerateBlinkScale = 1;
      state.accelerateTrembleX = 0;
      state.accelerateTrembleY = 0;
      state.accelerateStartTime = null;
      state.accelerateTrembleDirection = null;
      state.accelerateTremblePreviousDirection = null;
      state.accelerateTrembleChangeTime = null;
      state.accelerateTrembleTransitionStartTime = null;
      state.accelerateShouldAnimateLines = false;
      if (elements?.speedLinesContainer) {
        setStyles(elements.speedLinesContainer, { opacity: "0", visibility: "hidden" });
      }
    }
    // Se estiver ativo, continua a animação mesmo se enabled for false
    // A animação só sai quando accelerateActive for false (controlado pelo FaceEngine)
    if (!state.accelerateActive) {
      return;
    }
  }
  
  // Se não está ativo, mantém olhos normais
  if (!state.accelerateActive) {
    // Para de criar novas linhas, mas permite que as existentes continuem até sumirem
    state.accelerateShouldAnimateLines = false;
    
    // Se estava ativo antes, faz transição suave: fecha e depois abre
    if (state.accelerateEndTime) {
      const transitionTime = transitionDuration || 300;
      const closeTime = transitionTime * 0.4; // 40% do tempo para fechar
      const openTime = transitionTime * 0.6; // 60% do tempo para abrir
      
      const elapsed = now - state.accelerateEndTime;
      
      // Captura o valor inicial do blinkScale (meio fechado)
      const startScale = state.accelerateBlinkScale !== undefined ? state.accelerateBlinkScale : (blinkScale || 0.4);
      
      if (elapsed < closeTime) {
        // Fase 1: Fecha os olhos (de meio fechado para quase fechado)
        const closeProgress = elapsed / closeTime;
        const easedCloseProgress = easeInOut(closeProgress);
        const minCloseScale = 0.1; // Quase fechado
        state.accelerateBlinkScale = lerp(startScale, minCloseScale, easedCloseProgress);
      } else if (elapsed < transitionTime) {
        // Fase 2: Abre os olhos (de quase fechado para totalmente aberto)
        const openElapsed = elapsed - closeTime;
        const openProgress = openElapsed / openTime;
        const easedOpenProgress = easeInOut(openProgress);
        const minCloseScale = 0.1;
        state.accelerateBlinkScale = lerp(minCloseScale, 1, easedOpenProgress);
      } else {
        // Transição completa - olhos totalmente abertos
        state.accelerateBlinkScale = 1;
      }
      
      // Reduz tremor gradualmente durante toda a transição
      const progress = Math.min(1, elapsed / transitionTime);
      const easedProgress = easeInOut(progress);
      state.accelerateTrembleX = lerp(state.accelerateTrembleX || 0, 0, easedProgress);
      state.accelerateTrembleY = lerp(state.accelerateTrembleY || 0, 0, easedProgress);
      
      // Anima as linhas existentes até sumirem naturalmente
      if (elements?.speedLinesContainer && elements.speedLinesContainer.children.length > 0) {
        // Mantém o container visível para as linhas existentes continuarem animando
        setStyles(elements.speedLinesContainer, { 
          opacity: "1", 
          visibility: "visible" 
        });
        
        // Anima apenas as linhas existentes (não cria novas)
        const lines = elements.speedLinesContainer.children;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const centerX = viewportWidth / 2;
        const centerY = viewportHeight / 2;
        const lineSpeed = speedLinesSpeed || 1000;
        const seedMultiplier = 12345;
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const lineIndex = i;
          
          const seed = (lineIndex * seedMultiplier) % 10000;
          const random1 = (seed / 10000);
          const random2 = ((seed * 7) % 10000) / 10000;
          const random3 = ((seed * 13) % 10000) / 10000;
          
          const baseOffset = (lineIndex / lines.length) * lineSpeed;
          const randomOffset = random3 * lineSpeed * 0.3;
          const timeOffset = (baseOffset + randomOffset) % lineSpeed;
          const speedVariation = 0.7 + (random2 * 0.6);
          const individualLineSpeed = lineSpeed / speedVariation;
          const animationTime = (now + timeOffset) % individualLineSpeed;
          const progress = animationTime / individualLineSpeed;
          
          const borderIndex = lineIndex % 4;
          let startX, startY;
          const positionAlongEdge = random1;
          
          if (borderIndex === 0) {
            startX = positionAlongEdge * viewportWidth;
            startY = -100;
          } else if (borderIndex === 1) {
            startX = viewportWidth + 100;
            startY = positionAlongEdge * viewportHeight;
          } else if (borderIndex === 2) {
            startX = positionAlongEdge * viewportWidth;
            startY = viewportHeight + 100;
          } else {
            startX = -100;
            startY = positionAlongEdge * viewportHeight;
          }
          
          const dx = centerX - startX;
          const dy = centerY - startY;
          const angleRad = Math.atan2(dy, dx);
          const diagonalAngle = (angleRad * 180) / Math.PI;
          const endX = centerX;
          const endY = centerY;
          const currentX = lerp(startX, endX, progress);
          const currentY = lerp(startY, endY, progress);
          
          const opacityEase = progress < 0.5 
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;
          const opacity = lerp(1.0, 0.0, opacityEase);
          
          const currentDx = currentX - centerX;
          const currentDy = currentY - centerY;
          const currentDistanceFromCenter = Math.sqrt(currentDx * currentDx + currentDy * currentDy);
          const maxDistance = Math.max(viewportWidth, viewportHeight) / 2;
          const normalizedDistance = Math.min(1, currentDistanceFromCenter / maxDistance);
          const scale = lerp(1.5, 0.2, normalizedDistance);
          
          setStyles(line, {
            left: `${currentX}px`,
            top: `${currentY}px`,
            transform: `rotate(${diagonalAngle}deg) scale(${scale})`,
            opacity: `${opacity}`,
          });
        }
        
        // Se todas as linhas sumiram (opacidade muito baixa), esconde o container
        let allLinesGone = true;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const computedStyle = window.getComputedStyle(line);
          const lineOpacity = parseFloat(computedStyle.opacity);
          if (lineOpacity > 0.01) { // Ainda tem alguma opacidade
            allLinesGone = false;
            break;
          }
        }
        
        if (allLinesGone) {
          setStyles(elements.speedLinesContainer, { 
            opacity: "0", 
            visibility: "hidden" 
          });
        }
      } else {
        // Se não há linhas, esconde o container
        if (elements?.speedLinesContainer) {
          setStyles(elements.speedLinesContainer, { 
            opacity: "0", 
            visibility: "hidden" 
          });
        }
      }
      
      if (elapsed >= transitionTime) {
        // Transição completa - olhos totalmente abertos no tamanho normal
        state.accelerateBlinkScale = 1; // Garante que os olhos estão totalmente abertos
        state.accelerateTrembleX = 0;
        state.accelerateTrembleY = 0;
        state.accelerateEndTime = null;
        state.accelerateStartTime = null;
        state.accelerateTrembleDirection = null;
        state.accelerateTremblePreviousDirection = null;
        state.accelerateTrembleChangeTime = null;
        state.accelerateTrembleTransitionStartTime = null;
        state.accelerateCloseStartTime = null;
      }
    } else {
      // Não estava ativo - mantém olhos totalmente abertos no tamanho normal
      state.accelerateBlinkScale = 1; // Garante que os olhos estão totalmente abertos
      state.accelerateTrembleX = 0;
      state.accelerateTrembleY = 0;
      state.accelerateEndTime = null;
      state.accelerateStartTime = null;
      state.accelerateTrembleDirection = null;
      state.accelerateTremblePreviousDirection = null;
      state.accelerateTrembleChangeTime = null;
      state.accelerateTrembleTransitionStartTime = null;
      
      // Esconde linhas se não há nenhuma
      if (elements?.speedLinesContainer) {
        setStyles(elements.speedLinesContainer, { 
          opacity: "0", 
          visibility: "hidden" 
        });
      }
    }
    return; // Retorna antes de criar novas linhas
  }
  
  // Se está ativo mas não tem timestamp de início, inicia agora
  if (!state.accelerateStartTime) {
    state.accelerateStartTime = now;
    state.accelerateEndTime = null;
    state.accelerateTrembleChangeTime = now;
    // Inicia com direção aleatória
    state.accelerateTrembleDirection = Math.floor(Math.random() * 8); // 8 direções possíveis
    state.accelerateTremblePreviousDirection = state.accelerateTrembleDirection; // Inicia com mesma direção
    state.accelerateTrembleTransitionStartTime = now; // Inicia transição
    state.accelerateShouldAnimateLines = true; // Permite criar/animar novas linhas
  }
  
  // Garante que a flag está ativa durante toda a animação
  if (state.accelerateActive && !state.accelerateShouldAnimateLines) {
    state.accelerateShouldAnimateLines = true;
  }
  
  const elapsed = now - state.accelerateStartTime;
  const transitionTime = transitionDuration || 300;
  
  // Transição suave para olhos meio fechados
  if (elapsed < transitionTime) {
    const progress = elapsed / transitionTime;
    const easedProgress = easeInOut(progress);
    state.accelerateBlinkScale = lerp(1, blinkScale || 0.4, easedProgress);
  } else {
    // Mantém olhos meio fechados
    state.accelerateBlinkScale = blinkScale || 0.4;
  }
  
  // Tremor dos olhos - muda de direção periodicamente com transição suave
  const changeInterval = trembleChangeInterval || 2000; // Muda direção a cada 2 segundos (padrão)
  const intensity = trembleIntensity || 5; // Intensidade do tremor em pixels (aumentada)
  const trembleTransitionTime = trembleTransitionDuration || 500; // Duração da transição entre direções
  
  // Inicializa direção anterior se não existir
  if (state.accelerateTremblePreviousDirection === null || state.accelerateTremblePreviousDirection === undefined) {
    state.accelerateTremblePreviousDirection = state.accelerateTrembleDirection || 0;
  }
  
  // Verifica se precisa mudar a direção do tremor
  const timeSinceLastChange = state.accelerateTrembleChangeTime ? (now - state.accelerateTrembleChangeTime) : 0;
  if (!state.accelerateTrembleChangeTime || timeSinceLastChange >= changeInterval) {
    // Salva a direção anterior antes de mudar
    state.accelerateTremblePreviousDirection = state.accelerateTrembleDirection || 0;
    // Muda para uma nova direção aleatória
    state.accelerateTrembleDirection = Math.floor(Math.random() * 8);
    state.accelerateTrembleChangeTime = now;
    state.accelerateTrembleTransitionStartTime = now; // Inicia transição
  }
  
  // Calcula o progresso da transição entre direções
  const transitionStartTime = state.accelerateTrembleTransitionStartTime || now;
  const transitionElapsed = now - transitionStartTime;
  const transitionProgress = Math.min(1, transitionElapsed / trembleTransitionTime);
  const easedTransition = easeInOut(transitionProgress);
  
  // 8 direções: 0=Direita, 1=Direita-Cima, 2=Cima, 3=Esquerda-Cima, 4=Esquerda, 5=Esquerda-Baixo, 6=Baixo, 7=Direita-Baixo
  const previousDirection = state.accelerateTremblePreviousDirection;
  const currentDirection = state.accelerateTrembleDirection;
  
  // Converte direções em ângulos
  const previousAngle = (previousDirection * Math.PI * 2) / 8;
  const currentAngle = (currentDirection * Math.PI * 2) / 8;
  
  // Interpola suavemente entre o ângulo anterior e o atual
  const angle = lerp(previousAngle, currentAngle, easedTransition);
  
  // Tremor com variação suave (usando seno para movimento suave)
  const tremblePhase = (now - (state.accelerateTrembleChangeTime || now)) / 100; // Fase para suavizar
  const trembleVariation = Math.sin(tremblePhase) * 0.3; // Variação suave de 30%
  
  // Calcula o tremor baseado na direção interpolada e intensidade
  state.accelerateTrembleX = Math.cos(angle) * intensity * (1 + trembleVariation);
  state.accelerateTrembleY = Math.sin(angle) * intensity * (1 + trembleVariation);
  
          // ANIMAÇÃO DAS LINHAS DE VELOCIDADE
          // Só anima linhas se estiver ativo e permitido criar novas
          if (elements?.speedLinesContainer && state.accelerateShouldAnimateLines) {
            const lineCount = speedLinesCount || 60; // Número de linhas aumentado (padrão: 60)
            const lineSpeed = speedLinesSpeed || 1000; // Velocidade de movimento das linhas (ms para atravessar a tela e desaparecer - 1 segundo)
            
            // Inicializa as linhas se ainda não existirem
            initializeSpeedLines(elements.speedLinesContainer, lineCount);
            
            // Mostra o container
            setStyles(elements.speedLinesContainer, { 
              opacity: "1", 
              visibility: "visible" 
            });
            
            // Anima cada linha
            const lines = elements.speedLinesContainer.children;
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const centerX = viewportWidth / 2;
            const centerY = viewportHeight / 2;
            
            // Semente fixa para cada linha (baseada no índice) para manter consistência
            const seedMultiplier = 12345; // Número primo para melhor distribuição
            
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              const lineIndex = i;
              
              // Usa uma função pseudo-aleatória baseada no índice para manter consistência
              const seed = (lineIndex * seedMultiplier) % 10000;
              const random1 = (seed / 10000);
              const random2 = ((seed * 7) % 10000) / 10000;
              const random3 = ((seed * 13) % 10000) / 10000; // Terceiro valor aleatório para mais variação
              
              // Calcula offset de tempo único para cada linha baseado no índice e valores aleatórios
              // Distribui os offsets ao longo de todo o ciclo para que as linhas apareçam e desapareçam de forma escalonada
              // Combina distribuição uniforme com variação aleatória para efeito mais natural
              const baseOffset = (lineIndex / lineCount) * lineSpeed; // Offset base de 0 a lineSpeed
              const randomOffset = random3 * lineSpeed * 0.3; // Variação aleatória de até 30% do ciclo
              const timeOffset = (baseOffset + randomOffset) % lineSpeed; // Offset final com variação
              
              // Variação de velocidade individual para cada linha (0.7x a 1.3x da velocidade base)
              // Isso faz com que algumas linhas sejam mais rápidas e outras mais lentas
              const speedVariation = 0.7 + (random2 * 0.6); // Variação de 70% a 130% da velocidade
              const individualLineSpeed = lineSpeed / speedVariation; // Velocidade ajustada para esta linha
              
              // Calcula o tempo de animação com offset único e velocidade variada para cada linha
              // Usa módulo para criar ciclo contínuo
              const animationTime = (now + timeOffset) % individualLineSpeed; // Ciclo de 0 a individualLineSpeed
              const progress = animationTime / individualLineSpeed; // Progresso de 0 a 1
              
              // Determina qual borda a linha começa (distribui uniformemente entre as 4 bordas)
              const borderIndex = lineIndex % 4;
              
              // Posição inicial baseada na borda (distribui uniformemente ao longo da borda)
              let startX, startY;
              const positionAlongEdge = random1; // Posição ao longo da borda (0 a 1)
              
              if (borderIndex === 0) {
                // Topo - linha começa no topo
                startX = positionAlongEdge * viewportWidth;
                startY = -100;
              } else if (borderIndex === 1) {
                // Direita - linha começa na direita
                startX = viewportWidth + 100;
                startY = positionAlongEdge * viewportHeight;
              } else if (borderIndex === 2) {
                // Baixo - linha começa no baixo
                startX = positionAlongEdge * viewportWidth;
                startY = viewportHeight + 100;
              } else {
                // Esquerda - linha começa na esquerda
                startX = -100;
                startY = positionAlongEdge * viewportHeight;
              }
              
              // Calcula o ângulo da linha apontando para o centro
              const dx = centerX - startX;
              const dy = centerY - startY;
              const angleRad = Math.atan2(dy, dx);
              const diagonalAngle = (angleRad * 180) / Math.PI;
              
              // Distância da borda até o centro
              const distanceToCenter = Math.sqrt(dx * dx + dy * dy);
              
              // Posição final (centro da tela)
              const endX = centerX;
              const endY = centerY;
              
              // Interpola posição baseada no progresso (da borda para o centro)
              const currentX = lerp(startX, endX, progress);
              const currentY = lerp(startY, endY, progress);
              
              // Opacidade: começa sólida (1.0) e vai ficando transparente até desaparecer completamente (0.0)
              // Usa uma curva de easing para transição mais suave
              // progress vai de 0 (início, opaco) a 1 (fim, transparente)
              const opacityEase = progress < 0.5 
                ? 2 * progress * progress  // Acelera no início
                : 1 - Math.pow(-2 * progress + 2, 2) / 2; // Desacelera no fim
              const opacity = lerp(1.0, 0.0, opacityEase);
              
              // Escala baseada na distância do centro (efeito de perspectiva - maiores perto do centro)
              const currentDx = currentX - centerX;
              const currentDy = currentY - centerY;
              const currentDistanceFromCenter = Math.sqrt(currentDx * currentDx + currentDy * currentDy);
              const maxDistance = Math.max(viewportWidth, viewportHeight) / 2;
              const normalizedDistance = Math.min(1, currentDistanceFromCenter / maxDistance);
              const scale = lerp(1.5, 0.2, normalizedDistance);
              
              // Aplica estilos à linha
              setStyles(line, {
                left: `${currentX}px`,
                top: `${currentY}px`,
                transform: `rotate(${diagonalAngle}deg) scale(${scale})`,
                opacity: `${opacity}`,
              });
            }
          }
}

