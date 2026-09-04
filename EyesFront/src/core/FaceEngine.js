import { Animator } from "./Animator.js";
import { createFaceElements } from "./Elements.js";
import { setStyles, createEl } from "../utils/dom.js";
import { animateBlink } from "../animations/blink.js";
import { animateLook } from "../animations/look.js";
import { animateBob } from "../animations/bob.js";
import { animateGlow } from "../animations/glow.js";
import { animateSurprise } from "../animations/surprise.js";
import { animateSquint } from "../animations/squint.js";
import { animateSearch } from "../animations/search.js";
import { animateFright } from "../animations/fright.js";
import { animateAccelerate } from "../animations/accelerate.js";
import { getAllEmotions, setEmotionFalse, getEmotion } from "../utils/api.js";

export class FaceEngine {
  constructor(root, config) {
    this.root = root;
    this.config = config;
    this.animator = new Animator();
    this.elements = createFaceElements();
    this.state = {
      blinkPhase: 0,
      lookPhase: 0,
      bobPhase: 0,
      glowPhase: 0,
      eyeX: 0,
      eyeY: 0,
      blinkScale: 1, // Escala do piscar
      surpriseScale: 1, // Escala da surpresa
      surpriseStartTime: null, // Timestamp de início da animação de surpresa
      surpriseEndTime: null, // Timestamp de fim da animação de surpresa
      postSurpriseBlinkTime: null, // Timestamp para piscar após surpresa
      leftEyeOffset: 0,
      rightEyeOffset: 0,
      leftEyeRotation: 0, // Rotação do olho esquerdo em graus
      rightEyeRotation: 0, // Rotação do olho direito em graus
      // Para detecção de tecla 's' três vezes (surpresa)
      sKeyPresses: [],
      sKeyTimeout: null,
      // Para detecção de tecla 'e' três vezes (squint)
      eKeyPresses: [],
      // Animação de squint (tentar enxergar)
      squintStartTime: null, // Timestamp de início da animação de squint
      squintX: 0, // Movimento horizontal dos olhos durante squint
      squintY: 0, // Movimento vertical dos olhos durante squint
      squintScale: 1, // Escala dos olhos durante squint (para parecer forçado)
      squintEntryStartTime: null, // Timestamp de início da animação de entrada dos óculos
      squintExitStartTime: null, // Timestamp de início da animação de saída dos óculos
      squintExitHorizontalDirection: null, // Direção horizontal aleatória para a saída (fixa durante a animação)
      // Para detecção de tecla 'p' três vezes (procurar)
      pKeyPresses: [],
      pKeyTimeout: null,
      // Animação de procurar (olhos olham para os lados)
      searchStartTime: null, // Timestamp de início da animação de procurar
      searchX: 0, // Movimento horizontal dos olhos durante procurar
      searchCycleCount: 0, // Contador de ciclos completos da animação de procurar
      searchBlinkRightTime: null, // Timestamp para piscar quando chegar na direita
      searchBlinkLeftTime: null, // Timestamp para piscar quando chegar na esquerda
      searchBlinkRightTriggered: false, // Flag para garantir que pisca apenas uma vez na direita
      searchBlinkLeftTriggered: false, // Flag para garantir que pisca apenas uma vez na esquerda
      lastIdleTime: null, // Timestamp do último momento de idle (sem animações especiais) - inicializado no start()
      lastAutoSearchTime: 0, // Timestamp da última animação automática de procurar
      // Para detecção de tecla 'f' três vezes (susto)
      fKeyPresses: [],
      fKeyTimeout: null,
      // Animação de susto
      frightStartTime: null, // Timestamp de início da animação de susto
      frightScale: 1, // Escala dos olhos durante susto
      frightBlinkScale: 1, // Escala do piscar durante susto (para controlar abertura/fechamento geral)
      frightBlinkScaleLeft: 1, // Escala do piscar do olho esquerdo durante susto
      frightBlinkScaleRight: 1, // Escala do piscar do olho direito durante susto
      frightPhase: null, // Fase atual da animação de susto
      frightTrembleX: 0, // Tremor horizontal durante susto
      frightTrembleY: 0, // Tremor vertical durante susto
      triggerSearchAfterFright: false, // Flag para disparar procurar após susto
      // Para detecção de tecla 'a' três vezes (acelerar)
      aKeyPresses: [],
      aKeyTimeout: null,
      // Animação de acelerar
      accelerateActive: false, // Flag para indicar se está ativo
      accelerateStartTime: null, // Timestamp de início da animação de acelerar
      accelerateEndTime: null, // Timestamp de fim da animação de acelerar
      accelerateBlinkScale: 1, // Escala do piscar durante acelerar (para deixar olhos meio fechados)
      accelerateTrembleX: 0, // Tremor horizontal durante acelerar
      accelerateTrembleY: 0, // Tremor vertical durante acelerar
      accelerateTrembleDirection: null, // Direção atual do tremor (0-7)
      accelerateTremblePreviousDirection: null, // Direção anterior do tremor (para transição suave)
      accelerateTrembleChangeTime: null, // Timestamp da última mudança de direção do tremor
      accelerateTrembleTransitionStartTime: null, // Timestamp de início da transição entre direções
      accelerateShouldAnimateLines: false, // Flag para controlar se deve criar/animar novas linhas
      accelerateCloseStartTime: null, // Timestamp para iniciar o fechamento dos olhos ao sair
      // Sistema de fila de animações da API
      animationQueue: [], // Fila de animações pendentes da API
      isExecutingAnimation: false, // Flag para indicar se está executando uma animação da fila
      lastApiCheck: 0, // Timestamp da última verificação da API
      apiCheckInterval: 300, // Intervalo entre verificações da API (0.3s)
      apiBackoffUntil: 0, // Timestamp até quando deve aguardar após erro 429 (0 = sem backoff)
      apiBackoffDuration: 30000, // Duração do backoff após erro 429 (30 segundos)
      pendingEmotions: new Set(), // Emoções que foram detectadas como true mas ainda não foram executadas
      completedEmotions: new Set(), // Emoções que já foram completadas e fizeram PUT (para evitar PUTs duplicados)
      isPageVisible: true, // Flag para indicar se a página está visível (otimização)
      // Sistema de FPS
      fps: 0, // FPS atual
      fpsFrameCount: 0, // Contador de frames
      fpsLastTime: 0, // Timestamp da última atualização de FPS
      fpsUpdateInterval: 1000, // Intervalo para atualizar FPS (1 segundo)
    };
  }

  init() {
    this.root.innerHTML = "";
    this.root.appendChild(this.elements.stage);
    this.applyTheme();
    this.applySizing();
    this.applyEyeShape();
    this.registerAnimations();
  }

  start() {
    this.init();
    // Inicializa o timestamp de idle quando inicia
    this.state.lastIdleTime = performance.now();
    // Inicializa o sistema de FPS
    this.state.fpsLastTime = performance.now();
    this.animator.start();
    this.setupKeyboardListener();
    this.setupFullscreenButton();
    this.setupApiPolling(); // Inicia o polling da API
    this.setupFpsDisplay(); // Configura o display de FPS
    this.setupPageVisibility(); // Configura detecção de visibilidade da página
  }
  
  setupFullscreenButton() {
    // Cria o botão de tela cheia
    const button = createEl("button", "fullscreen-button");
    button.setAttribute("aria-label", "Alternar tela cheia");
    
    // Ícone SVG de tela cheia
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("class", "fullscreen-icon");
    icon.setAttribute("viewBox", "0 0 24 24");
    
    // Cria o caminho do ícone (tela cheia)
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3");
    
    icon.appendChild(path);
    button.appendChild(icon);
    
    // Adiciona o botão ao body
    document.body.appendChild(button);
    
    // Função para alternar tela cheia
    const toggleFullscreen = () => {
      if (!document.fullscreenElement) {
        // Entra em tela cheia
        document.documentElement.requestFullscreen().catch(err => {
          console.log(`Erro ao entrar em tela cheia: ${err.message}`);
        });
      } else {
        // Sai de tela cheia
        document.exitFullscreen().catch(err => {
          console.log(`Erro ao sair de tela cheia: ${err.message}`);
        });
      }
    };
    
    // Adiciona o evento de clique
    button.addEventListener("click", toggleFullscreen);
    
    // Atualiza o ícone quando o estado de tela cheia muda
    const updateIcon = () => {
      if (document.fullscreenElement) {
        // Ícone de sair de tela cheia
        path.setAttribute("d", "M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3");
        // Adiciona classe para tornar o botão totalmente transparente
        button.classList.add("fullscreen-active");
      } else {
        // Ícone de entrar em tela cheia
        path.setAttribute("d", "M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3");
        // Remove classe para restaurar opacidade normal
        button.classList.remove("fullscreen-active");
      }
    };
    
    // Escuta mudanças no estado de tela cheia
    document.addEventListener("fullscreenchange", updateIcon);
    document.addEventListener("webkitfullscreenchange", updateIcon); // Safari
    document.addEventListener("mozfullscreenchange", updateIcon); // Firefox
    document.addEventListener("MSFullscreenChange", updateIcon); // IE/Edge
    
    // Verifica o estado inicial
    updateIcon();
  }

  setupKeyboardListener() {
    // Listener para detectar 's' pressionado 3 vezes rapidamente (surpresa)
    // e 'e' pressionado 3 vezes rapidamente (squint)
    document.addEventListener("keydown", (e) => {
      const key = e.key.toLowerCase();
      
      if (key === "s" && !e.repeat) {
        const now = performance.now();
        this.state.sKeyPresses.push(now);
        
        // Remove pressionamentos muito antigos (mais de 500ms)
        this.state.sKeyPresses = this.state.sKeyPresses.filter(
          (time) => now - time < 500
        );
        
        // Se tiver 3 ou mais pressionamentos em 500ms, aciona a surpresa
        if (this.state.sKeyPresses.length >= 3) {
          this.triggerSurprise();
          this.state.sKeyPresses = []; // Limpa após acionar
        }
      }
      
      if (key === "e" && !e.repeat) {
        const now = performance.now();
        if (!this.state.eKeyPresses) {
          this.state.eKeyPresses = [];
        }
        this.state.eKeyPresses.push(now);
        
        // Remove pressionamentos muito antigos (mais de 500ms)
        this.state.eKeyPresses = this.state.eKeyPresses.filter(
          (time) => now - time < 500
        );
        
        // Se tiver 3 ou mais pressionamentos em 500ms, aciona o squint
        if (this.state.eKeyPresses.length >= 3) {
          this.triggerSquint();
          this.state.eKeyPresses = []; // Limpa após acionar
        }
      }
      
      if (key === "p" && !e.repeat) {
        const now = performance.now();
        if (!this.state.pKeyPresses) {
          this.state.pKeyPresses = [];
        }
        this.state.pKeyPresses.push(now);
        
        // Remove pressionamentos muito antigos (mais de 500ms)
        this.state.pKeyPresses = this.state.pKeyPresses.filter(
          (time) => now - time < 500
        );
        
        // Se tiver 3 ou mais pressionamentos em 500ms, aciona a animação de procurar
        if (this.state.pKeyPresses.length >= 3) {
          this.triggerSearch();
          this.state.pKeyPresses = []; // Limpa após acionar
        }
      }
      
      if (key === "f" && !e.repeat) {
        const now = performance.now();
        if (!this.state.fKeyPresses) {
          this.state.fKeyPresses = [];
        }
        this.state.fKeyPresses.push(now);
        
        // Remove pressionamentos muito antigos (mais de 500ms)
        this.state.fKeyPresses = this.state.fKeyPresses.filter(
          (time) => now - time < 500
        );
        
        // Se tiver 3 ou mais pressionamentos em 500ms, aciona a animação de susto
        if (this.state.fKeyPresses.length >= 3) {
          this.triggerFright();
          this.state.fKeyPresses = []; // Limpa após acionar
        }
      }
      
      if (key === "a" && !e.repeat) {
        const now = performance.now();
        if (!this.state.aKeyPresses) {
          this.state.aKeyPresses = [];
        }
        this.state.aKeyPresses.push(now);
        
        // Remove pressionamentos muito antigos (mais de 500ms)
        this.state.aKeyPresses = this.state.aKeyPresses.filter(
          (time) => now - time < 500
        );
        
        // Se tiver 3 ou mais pressionamentos em 500ms, alterna a animação de acelerar
        if (this.state.aKeyPresses.length >= 3) {
          this.triggerAccelerate();
          this.state.aKeyPresses = []; // Limpa após acionar
        }
      }
    });
  }

  triggerSurprise() {
    // Inicia a animação de surpresa
    if (this.config.animations.surprise?.enabled) {
      this.state.surpriseStartTime = performance.now();
    }
  }
  
  triggerSquint() {
    // Alterna a animação de squint (tentar enxergar)
    if (this.config.animations.squint?.enabled) {
      // Se já está ativo (em qualquer fase), desativa iniciando a saída
      if (this.state.squintStartTime || this.state.squintEntryStartTime) {
        // Se está na fase de entrada, cancela e inicia saída
        if (this.state.squintEntryStartTime) {
          this.state.squintEntryStartTime = null;
        }
        // Se está na fase principal, inicia saída
        if (this.state.squintStartTime) {
          this.state.squintStartTime = null;
        }
        this.state.squintExitStartTime = performance.now();
      } else {
        // Se não está ativo, inicia a animação de entrada
        this.state.squintEntryStartTime = performance.now();
        // Reseta valores iniciais
        this.state.squintX = 0;
        this.state.squintY = 0;
        this.state.squintScale = 1;
      }
    }
  }
  
  triggerSearch() {
    // Inicia a animação de procurar
    if (this.config.animations.search?.enabled) {
      this.state.searchStartTime = performance.now();
      this.state.searchX = 0; // Reseta posição
      this.state.searchCycleCount = 0; // Reseta contador de ciclos
      // Reseta flags de piscadas
      this.state.searchBlinkRightTime = null;
      this.state.searchBlinkLeftTime = null;
      this.state.searchBlinkRightTriggered = false;
      this.state.searchBlinkLeftTriggered = false;
    }
  }
  
  triggerFright() {
    // Inicia a animação de susto
    if (this.config.animations.fright?.enabled) {
      this.state.frightStartTime = performance.now();
      this.state.frightScale = 1;
      this.state.frightBlinkScale = 1;
      this.state.frightBlinkScaleLeft = 1;
      this.state.frightBlinkScaleRight = 1;
      this.state.frightTrembleX = 0;
      this.state.frightTrembleY = 0;
      this.state.frightPhase = null;
      this.state.triggerSearchAfterFright = true; // Marca para disparar procurar após susto
    }
  }
  
  triggerAccelerate() {
    // Alterna a animação de acelerar (toggle)
    if (this.config.animations.accelerate?.enabled) {
      if (this.state.accelerateActive) {
        // Desativa - captura o valor atual do blinkScale antes de desativar
        // Garante que a transição de volta ao normal funcione corretamente
        if (this.state.accelerateBlinkScale === undefined) {
          this.state.accelerateBlinkScale = this.config.animations.accelerate?.blinkScale || 0.4;
        }
        this.state.accelerateActive = false;
        this.state.accelerateEndTime = performance.now();
        this.state.accelerateStartTime = null;
      } else {
        // Ativa
        this.state.accelerateActive = true;
        this.state.accelerateStartTime = performance.now();
        this.state.accelerateEndTime = null;
        // Garante que começa do valor normal (1)
        this.state.accelerateBlinkScale = 1;
      }
    }
  }

  applyTheme() {
    const { colors } = this.config;
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty("--bg", colors.background);
    rootStyle.setProperty("--face", colors.face);
    rootStyle.setProperty("--stroke", colors.stroke);
    rootStyle.setProperty("--stroke-soft", colors.strokeSoft);
    rootStyle.setProperty("--accent", colors.accent);
  }

  applySizing() {
    const { scale } = this.config;
    setStyles(this.elements.stage, {
      transform: `scale(${scale})`,
    });
  }

  applyEyeShape() {
    const { eyes } = this.config;
    const ovality = eyes?.ovality || 0;
    
    // Tamanho base dos olhos em vmin (viewport minimum - mantém proporção)
    // vmin sempre usa o menor valor entre largura e altura, garantindo proporções
    // Usa valores do config ou padrões
    const baseWidthVmin = eyes?.width || 38;
    const baseHeightVmin = eyes?.height || 42;
    
    // Converte ovality (0-100) em border-radius
    // Para garantir curvas suaves sem partes retas, usa valores altos
    // 0 = 50% (círculo), 100 = muito ovalado verticalmente
    // Usa valores maiores para garantir que não fique reto no topo e base
    const baseRadius = 50;
    // Aumenta o vertical radius mais agressivamente para evitar partes retas
    // Quanto maior o valor, mais curvo fica (evita partes retas)
    const verticalRadius = Math.max(50, 50 + (ovality * 1.2));
    // Para garantir curvas suaves, sempre usa pelo menos 50% / 50%
    // Valores maiores = mais ovalado e mais curvo (sem partes retas)
    const borderRadius = ovality === 0 
      ? "50%" 
      : `${baseRadius}% / ${Math.max(verticalRadius, 60)}%`;
    
    // Calcula o fator de ajuste baseado na ovalidade
    // Quando mais ovalado verticalmente, precisa de mais espaço vertical
    // Aumenta o container proporcionalmente para evitar cortes nas bordas
    // Fatores maiores garantem que não fique reto nas bordas
    const widthFactor = 1 + (ovality / 100) * 0.15;
    const heightFactor = 1 + (ovality / 100) * 0.3;
    
    // Calcula tamanhos finais em vmin (proporcionais)
    const finalWidthVmin = baseWidthVmin * widthFactor;
    const finalHeightVmin = baseHeightVmin * heightFactor;
    
    // Posicionamento também em vmin para manter proporções
    // Usa o valor do config ou padrão de 40
    // Inverte a lógica: valores maiores = olhos mais altos (100 - position_y)
    const positionY = eyes?.position_y || 40;
    const topVmin = (100 - positionY) - (finalHeightVmin / 2);
    // Espaçamento ENTRE os olhos (em vmin)
    // Valores menores = olhos mais próximos
    const spacingBetweenEyes = eyes?.spacing || 18;
    
    // Trata os dois olhos como um componente único centralizado
    // Calcula a largura total do grupo (2 olhos + espaçamento entre eles)
    const totalGroupWidth = (2 * finalWidthVmin) + spacingBetweenEyes;
    const halfGroupWidth = totalGroupWidth / 2;
    const halfEyeWidth = finalWidthVmin / 2;
    
    // Centraliza o grupo na tela usando left: 50% e translateX
    // Calcula a distância do centro da tela até o centro de cada olho
    // Olho esquerdo: vai para a esquerda do centro
    // Olho direito: vai para a direita do centro
    const leftEyeOffset = -(halfGroupWidth - halfEyeWidth);
    const rightEyeOffset = halfGroupWidth - halfEyeWidth;
    
    // Armazena os offsets no state para uso nas animações
    this.state.leftEyeOffset = leftEyeOffset;
    this.state.rightEyeOffset = rightEyeOffset;
    
    setStyles(this.elements.eyeLeft, {
      borderRadius: borderRadius,
      overflow: "visible",
      width: `${finalWidthVmin}vmin`,
      height: `${finalHeightVmin}vmin`,
      top: `${topVmin}vmin`,
      left: "50%",
    });
    setStyles(this.elements.eyeRight, {
      borderRadius: borderRadius,
      overflow: "visible",
      width: `${finalWidthVmin}vmin`,
      height: `${finalHeightVmin}vmin`,
      top: `${topVmin}vmin`,
      left: "50%",
    });
    
    // Aplica os transforms iniciais
    this.applyEyeTransforms();
    // Aplica o tamanho dos óculos
    this.applyGlassesSize();
  }
  
  applyGlassesSize() {
    const { eyes, animations } = this.config;
    const baseWidthVmin = eyes?.width || 38;
    const baseHeightVmin = eyes?.height || 42;
    const ovality = eyes?.ovality || 0;
    
    // Calcula os fatores de ajuste baseado na ovalidade (mesma lógica dos olhos)
    const widthFactor = 1 + (ovality / 100) * 0.15;
    const heightFactor = 1 + (ovality / 100) * 0.3;
    const finalWidthVmin = baseWidthVmin * widthFactor;
    const finalHeightVmin = baseHeightVmin * heightFactor;
    
    // Os óculos devem ser ligeiramente maiores que os olhos para cobri-los completamente
    const glassesSizeMultiplier = 1.15; // 15% maior que os olhos
    const glassesWidthVmin = finalWidthVmin * glassesSizeMultiplier;
    const glassesHeightVmin = finalHeightVmin * glassesSizeMultiplier;
    
    // Calcula o border-radius dos óculos (circular)
    const glassesBorderRadius = "50%";
    
    // Espessura da borda dos óculos (do config ou padrão)
    const glassesBorderWidth = animations?.squint?.glassesBorderWidth || 8;
    
    // Posiciona os óculos no mesmo centro vertical dos olhos
    // Os olhos usam: top = (100 - positionY) - (finalHeightVmin / 2)
    // O centro vertical dos olhos é: top + (finalHeightVmin / 2) = (100 - positionY)
    // Como os óculos usam transform: translateY(-50%), o top deve ser o centro vertical
    const positionY = eyes?.position_y || 40;
    const eyeCenterY = 100 - positionY; // Centro vertical dos olhos em vmin
    // Para os óculos com translateY(-50%), o top é o centro vertical
    const glassesTopVmin = eyeCenterY;
    
    // Calcula posições dos elementos internos (relativas ao container que está em left: 50%)
    const leftEyeX = this.state.leftEyeOffset || 0;
    const rightEyeX = this.state.rightEyeOffset || 0;
    const bridgeX = (leftEyeX + rightEyeX) / 2;
    
    // Aplica estilos aos óculos
    // Os elementos internos são posicionados relativamente ao container (que está em left: 50%)
    // Todos centralizados verticalmente (top: 50% + translateY(-50%))
    setStyles(this.elements.glassesLeft, {
      width: `${glassesWidthVmin}vmin`,
      height: `${glassesHeightVmin}vmin`,
      top: "50%", // Centralizado verticalmente no container
      left: `calc(50% + ${leftEyeX}vmin)`, // Posição relativa ao centro do container
      borderRadius: glassesBorderRadius,
      borderWidth: `${glassesBorderWidth}px`,
      transform: `translateX(-50%) translateY(-50%)`, // Centraliza o elemento
    });
    setStyles(this.elements.glassesRight, {
      width: `${glassesWidthVmin}vmin`,
      height: `${glassesHeightVmin}vmin`,
      top: "50%", // Centralizado verticalmente no container
      left: `calc(50% + ${rightEyeX}vmin)`, // Posição relativa ao centro do container
      borderRadius: glassesBorderRadius,
      borderWidth: `${glassesBorderWidth}px`,
      transform: `translateX(-50%) translateY(-50%)`, // Centraliza o elemento
    });
    
    // Largura base da ponte dos óculos (do config ou padrão)
    const baseBridgeWidthVmin = animations?.squint?.glassesBridgeWidth || 2;
    
    // A ponte mantém posição relativa ao container
    setStyles(this.elements.glassesBridge, {
      width: `${baseBridgeWidthVmin}vmin`,
      top: "50%", // Centralizado verticalmente no container
      left: `calc(50% + ${bridgeX}vmin)`, // Posição relativa ao centro do container
      transform: `translateX(-50%) translateY(-50%)`, // Centraliza o elemento
    });
    
    // Curvatura do nariz no centro da ponte
    const noseCurvatureWidth = animations?.squint?.glassesBridgeNoseSize || 8; // Largura da curvatura em vmin
    const noseCurvatureHeight = animations?.squint?.glassesBridgeNoseHeight || 3.5; // Altura da curvatura em vmin
    const ellipseHorizontal = animations?.squint?.glassesBridgeNoseEllipseHorizontal || 50; // Raio horizontal da elipse (%)
    const ellipseVertical = animations?.squint?.glassesBridgeNoseEllipseVertical || 100; // Raio vertical da elipse (%)
    const extraCoveragePx = animations?.squint?.glassesBridgeNoseCoveragePx || 2.5; // Pixels extras para cobrir a linha (valor intermediário)
    
    // A ponte tem height: 6px e está centralizada em top: 50% com translateY(-50%)
    // O topo da ponte está em 50% - 3px (metade da altura para cima)
    // A curvatura deve ficar ACIMA da linha, mas desce alguns pixels para cobrir completamente a linha da ponte
    const bridgeHeightPx = 6; // Altura da ponte em pixels
    const bridgeTopOffset = -(bridgeHeightPx / 2); // Topo da ponte está 3px acima do centro (50% - 3px)
    const bottomOffset = Math.abs(bridgeTopOffset) - extraCoveragePx; // Desce pixels extras para cobrir a linha da ponte
    
    setStyles(this.elements.glassesBridgeNose, {
      width: `${noseCurvatureWidth}vmin`,
      height: `${noseCurvatureHeight}vmin`,
      bottom: `calc(50% - ${bottomOffset}px)`, // Desce pixels extras para cobrir a linha da ponte
      left: `calc(50% + ${bridgeX}vmin)`, // Posição relativa ao centro do container (mesmo que a ponte)
      transform: `translateX(-50%)`, // Centraliza horizontalmente apenas
      borderWidth: `${glassesBorderWidth}px`, // Mesma espessura da borda dos óculos
      borderRadius: `${ellipseHorizontal}% / ${ellipseVertical}% ${ellipseVertical}% 0 0`, // Forma elíptica horizontal configurável
      background: this.config.colors.background, // Preenchimento na cor de fundo para cobrir a linha da ponte
      zIndex: 2, // Garante que fica acima da ponte (z-index maior)
    });
    
    // Armazena o tamanho base da ponte no state para uso na animação
    this.state.baseBridgeWidthVmin = baseBridgeWidthVmin;
    // Armazena o centro vertical dos olhos para posicionar os óculos
    this.state.eyeCenterY = eyeCenterY;
  }

  registerAnimations() {
    const { animations } = this.config;

    if (animations.blink?.enabled) {
      this.animator.add("blink", (now, delta) => {
        animateBlink(animations.blink, this.state, now);
        this.applyEyeTransforms();
      });
    }
    if (animations.look?.enabled) {
      this.animator.add("look", (now, delta) => {
        animateLook(animations.look, this.state, now, delta);
        this.applyEyeTransforms();
      });
    }
    if (animations.bob?.enabled) {
      this.animator.add("bob", (now, delta) => {
        // Desabilita a animação de flutuação durante o susto e durante acelerar
        if (!this.state.frightStartTime && !this.state.accelerateActive) {
          animateBob(this.elements.stage, animations.bob, this.config.scale, this.state, now);
        }
        this.applyEyeTransforms();
      });
    }
    if (animations.surprise?.enabled) {
      // Animação de surpresa roda continuamente para verificar se há animação ativa
      this.animator.add("surprise", (now, delta) => {
        animateSurprise(animations.surprise, this.state, now);
        this.applyEyeTransforms();
      });
    }
    if (animations.squint?.enabled) {
      // Animação de squint roda continuamente para verificar se há animação ativa
      this.animator.add("squint", (now, delta) => {
        animateSquint(
          animations.squint,
          this.state,
          this.elements,
          { 
            leftEyeOffset: this.state.leftEyeOffset, 
            rightEyeOffset: this.state.rightEyeOffset,
            eyeCenterY: this.state.eyeCenterY
          },
          now
        );
        this.applyEyeTransforms();
        this.applyGlassesSize();
      });
    }
    if (animations.search?.enabled) {
      // Animação de procurar roda continuamente para verificar se há animação ativa ou se deve disparar automaticamente
      this.animator.add("search", (now, delta) => {
        // Verifica se deve disparar automaticamente (apenas se não estiver em susto ou acelerar)
        if (!this.state.frightStartTime && !this.state.accelerateActive) {
          this.checkAutoSearch(now);
        }
        
        // Executa a animação de procurar apenas se não estiver em acelerar
        if (!this.state.accelerateActive) {
          animateSearch(animations.search, this.state, now);
        } else {
          // Se está em acelerar, reseta a animação de procurar
          this.state.searchX = 0;
          this.state.searchStartTime = null;
        }
        this.applyEyeTransforms();
      });
    }
    if (animations.fright?.enabled) {
      // Animação de susto roda continuamente para verificar se há animação ativa
      this.animator.add("fright", (now, delta) => {
        animateFright(animations.fright, this.state, now);
        this.applyEyeTransforms();
        
        // Se a animação de susto terminou e deve disparar procurar
        if (this.state.triggerSearchAfterFright && !this.state.frightStartTime) {
          this.state.triggerSearchAfterFright = false;
          this.triggerSearch();
        }
      });
    }
    if (animations.accelerate?.enabled) {
      // Animação de acelerar roda continuamente para verificar se está ativa
      this.animator.add("accelerate", (now, delta) => {
        animateAccelerate(animations.accelerate, this.state, this.elements, now);
        this.applyEyeTransforms();
      });
    }
    
    // Garante que os transforms sejam aplicados mesmo se nenhuma animação de olho estiver ativa
    if (!animations.blink?.enabled && !animations.look?.enabled && !animations.surprise?.enabled && !animations.squint?.enabled && !animations.search?.enabled && !animations.fright?.enabled && !animations.accelerate?.enabled) {
      this.animator.add("applyTransforms", () => this.applyEyeTransforms());
    }
  }
  
  checkAutoSearch(now) {
    const { animations } = this.config;
    const searchConfig = animations?.search;
    
    if (!searchConfig?.enabled) return;
    
    // Verifica se está em idle (sem animações especiais ativas, incluindo susto e acelerar)
    const isIdle = !this.state.surpriseStartTime && 
                   !this.state.squintStartTime && 
                   !this.state.squintEntryStartTime &&
                   !this.state.searchStartTime &&
                   !this.state.frightStartTime &&
                   !this.state.accelerateActive;
    
    if (isIdle) {
      // Atualiza o timestamp de idle
      if (!this.state.lastIdleTime) {
        this.state.lastIdleTime = now;
      }
      
      const idleElapsed = now - this.state.lastIdleTime;
      const autoAfterIdle = searchConfig.autoAfterIdleMs || 20000;
      const autoInterval = searchConfig.autoIntervalMs || 40000;
      
      // Verifica se passou o tempo mínimo após idle (20s)
      if (idleElapsed >= autoAfterIdle) {
        // Verifica se já passou o intervalo desde a última animação automática (40s)
        const lastAutoSearch = this.state.lastAutoSearchTime || 0;
        const timeSinceLastAuto = now - lastAutoSearch;
        
        if (timeSinceLastAuto >= autoInterval) {
          // Dispara a animação de procurar automaticamente
          this.triggerSearch();
          this.state.lastAutoSearchTime = now;
        }
      }
    } else {
      // Se não está em idle, reseta o timestamp
      this.state.lastIdleTime = null;
    }
  }

  applyEyeTransforms() {
    const { eyeX, eyeY, blinkScale, surpriseScale, squintX, squintY, squintScale, leftEyeOffset, rightEyeOffset, leftEyeRotation, rightEyeRotation, frightScale, frightBlinkScale, frightBlinkScaleLeft, frightBlinkScaleRight, frightTrembleX, frightTrembleY, accelerateBlinkScale, accelerateTrembleX, accelerateTrembleY } = this.state;
    const { eyes } = this.config;
    
    // Durante a surpresa ou susto, os olhos ficam mais circulares
    // Interpola entre o border-radius normal e 50% (círculo perfeito)
    const baseOvality = eyes?.ovality || 0;
    const currentScale = Math.max(surpriseScale || 1, frightScale || 1);
    const surpriseOvality = currentScale > 1 ? 0 : baseOvality; // Fica circular quando surpreso ou com susto
    const currentOvality = baseOvality + (surpriseOvality - baseOvality) * (currentScale - 1) / (1.8 - 1);
    const clampedOvality = Math.max(0, Math.min(100, currentOvality));
    
    // Calcula border-radius baseado na ovalidade atual
    const baseRadius = 50;
    const verticalRadius = Math.max(50, 50 + (clampedOvality * 1.2));
    const currentBorderRadius = clampedOvality === 0 
      ? "50%" 
      : `${baseRadius}% / ${Math.max(verticalRadius, 60)}%`;
    
    // Durante a surpresa ou susto, aumenta o espaçamento entre os olhos para não sobrepor
    // Multiplica o offset por um fator baseado no scale de surpresa ou susto
    const maxScale = Math.max(surpriseScale || 1, frightScale || 1);
    const spacingMultiplier = maxScale > 1 ? 1 + (maxScale - 1) * 0.4 : 1; // Aumenta até 40% do espaçamento extra
    const adjustedLeftOffset = (leftEyeOffset || 0) * spacingMultiplier;
    const adjustedRightOffset = (rightEyeOffset || 0) * spacingMultiplier;
    
    // Combina todos os transforms em uma única string
    // Ordem: translateX(-50%) para centralizar, translateX offset para posicionar, translate (movimento look + squint + search + tremor), rotate (flutuação), scale (surpresa + squint + susto), scaleY (piscar + susto)
    // Durante squint, combina o movimento de look com o movimento de squint
    // Durante search, adiciona movimento horizontal rápido
    // Durante susto, adiciona tremor (frightTrembleX, frightTrembleY)
    // Durante acelerar, adiciona tremor sincronizado (accelerateTrembleX, accelerateTrembleY)
    const combinedX = eyeX + (squintX || 0) + (this.state.searchX || 0) + (frightTrembleX || 0) + (accelerateTrembleX || 0);
    const combinedY = eyeY + (squintY || 0) + (frightTrembleY || 0) + (accelerateTrembleY || 0);
    const combinedScale = surpriseScale * (squintScale || 1) * (frightScale || 1);
    
    // Usa frightBlinkScale se estiver em susto, senão usa blinkScale normal
    // Durante susto, pode controlar cada olho separadamente
    // Durante acelerar, aplica o blinkScale de acelerar
    let leftBlinkScale, rightBlinkScale;
    if (this.state.frightStartTime && (frightBlinkScaleLeft !== undefined || frightBlinkScaleRight !== undefined)) {
      // Controla olhos separadamente durante susto
      leftBlinkScale = frightBlinkScaleLeft !== undefined ? frightBlinkScaleLeft : blinkScale;
      rightBlinkScale = frightBlinkScaleRight !== undefined ? frightBlinkScaleRight : blinkScale;
    } else if (this.state.frightStartTime && frightBlinkScale !== undefined) {
      // Usa blinkScale geral do susto
      leftBlinkScale = frightBlinkScale;
      rightBlinkScale = frightBlinkScale;
    } else if (this.state.accelerateActive && accelerateBlinkScale !== undefined) {
      // Usa blinkScale de acelerar (olhos meio fechados)
      leftBlinkScale = accelerateBlinkScale;
      rightBlinkScale = accelerateBlinkScale;
    } else {
      // Usa blinkScale normal
      leftBlinkScale = blinkScale;
      rightBlinkScale = blinkScale;
    }
    
    const leftTransform = `translateX(-50%) translateX(${adjustedLeftOffset}vmin) translate(${combinedX}px, ${combinedY}px) rotate(${leftEyeRotation || 0}deg) scale(${combinedScale}) scaleY(${leftBlinkScale})`;
    const rightTransform = `translateX(-50%) translateX(${adjustedRightOffset}vmin) translate(${combinedX}px, ${combinedY}px) rotate(${rightEyeRotation || 0}deg) scale(${combinedScale}) scaleY(${rightBlinkScale})`;
    
    setStyles(this.elements.eyeLeft, { 
      transform: leftTransform,
      borderRadius: currentBorderRadius
    });
    setStyles(this.elements.eyeRight, { 
      transform: rightTransform,
      borderRadius: currentBorderRadius
    });
  }

  /**
   * Configura o polling da API para verificar emoções automaticamente
   */
  setupApiPolling() {
    // Inicializa o timestamp de última verificação para começar imediatamente
    // Usa um valor negativo para garantir que a primeira verificação aconteça imediatamente
    this.state.lastApiCheck = -this.state.apiCheckInterval;
    
    // Adiciona uma animação que verifica a API periodicamente
    this.animator.add("apiPolling", (now, delta) => {
      // Só faz requisições se a página estiver visível (otimização)
      if (!this.state.isPageVisible) {
        return; // Não faz requisições quando a página está oculta
      }
      
      // Verifica a API a cada intervalo configurado (0.3s = 5000ms)
      const timeSinceLastCheck = now - this.state.lastApiCheck;
      if (timeSinceLastCheck >= this.state.apiCheckInterval) {
        this.checkApiEmotions(now);
        this.state.lastApiCheck = now;
      }
      
      // Processa a fila de animações
      this.processAnimationQueue(now);
      
      // Verifica se animações terminaram para fazer PUT
      this.checkAnimationCompletion(now);
    });
  }

  /**
   * Configura a detecção de visibilidade da página para otimizar requisições
   * Quando a página está oculta, pausa as requisições para economizar recursos
   */
  setupPageVisibility() {
    // Função para atualizar o estado de visibilidade
    const updateVisibility = () => {
      const isVisible = !document.hidden;
      const wasVisible = this.state.isPageVisible;
      this.state.isPageVisible = isVisible;
      
      if (isVisible && !wasVisible) {
        // Página voltou a ficar visível - reseta o timestamp para fazer requisição imediatamente
        this.state.lastApiCheck = -this.state.apiCheckInterval;
      }
    };
    
    // Verifica o estado inicial
    updateVisibility();
    
    // Escuta mudanças na visibilidade da página
    document.addEventListener("visibilitychange", updateVisibility);
    
    // Também escuta quando a janela perde/ganha foco (para compatibilidade)
    window.addEventListener("blur", () => {
      if (this.state.isPageVisible) {
        this.state.isPageVisible = false;
      }
    });
    
    window.addEventListener("focus", () => {
      if (!this.state.isPageVisible) {
        this.state.isPageVisible = true;
        this.state.lastApiCheck = -this.state.apiCheckInterval;
      }
    });
  }

  /**
   * Verifica as emoções na API e adiciona à fila se necessário
   */
  async checkApiEmotions(now) {
    // Se está em período de backoff (após erro 429), aguarda
    if (this.state.apiBackoffUntil > 0 && now < this.state.apiBackoffUntil) {
      return; // Não faz requisição durante o backoff
    }
    
    // Se passou o período de backoff, reseta
    if (this.state.apiBackoffUntil > 0 && now >= this.state.apiBackoffUntil) {
      this.state.apiBackoffUntil = 0;
    }
    
    try {
      const result = await getAllEmotions();
      
      // Se recebeu erro 429, ativa o backoff
      if (result.error === "429") {
        this.state.apiBackoffUntil = now + this.state.apiBackoffDuration;
        return; // Não processa emoções durante o backoff
      }
      
      const emotions = result.data;
      
      // Verifica cada emoção
      const emotionMap = {
        surprise: "surprise",
        squint: "squint",
        search: "search",
        fright: "fright",
        accelerate: "accelerate"
      };
      
      for (const [key, emotion] of Object.entries(emotionMap)) {
        const isActive = emotions[key] === true;
        
        // Para accelerate, apenas verifica se deve ativar/desativar (não faz PUT)
        if (emotion === "accelerate") {
          if (isActive && !this.state.accelerateActive) {
            // Ativa accelerate se estiver true na API e não estiver ativo
            this.triggerAccelerate();
          } else if (!isActive && this.state.accelerateActive) {
            // Desativa accelerate se estiver false na API e estiver ativo
            this.triggerAccelerate();
          }
          continue;
        }
        
        // Para outras animações, verifica se está true e não está na fila nem executando
        if (isActive && !this.state.pendingEmotions.has(emotion)) {
          // Verifica se a animação não está atualmente em execução
          const isCurrentlyRunning = this.isAnimationRunning(emotion);
          
          if (!isCurrentlyRunning) {
            // Adiciona à fila se não estiver executando
            this.addToQueue(emotion);
            this.state.pendingEmotions.add(emotion);
          }
        }
      }
    } catch (error) {
      console.error("Erro ao verificar emoções da API:", error);
    }
  }

  /**
   * Verifica se uma animação está atualmente em execução
   */
  isAnimationRunning(emotion) {
    switch (emotion) {
      case "surprise":
        return this.state.surpriseStartTime !== null;
      case "squint":
        return this.state.squintStartTime !== null || this.state.squintEntryStartTime !== null;
      case "search":
        return this.state.searchStartTime !== null;
      case "fright":
        return this.state.frightStartTime !== null;
      default:
        return false;
    }
  }

  /**
   * Adiciona uma animação à fila
   */
  addToQueue(emotion) {
    // Evita duplicatas na fila
    if (!this.state.animationQueue.includes(emotion)) {
      this.state.animationQueue.push(emotion);
    }
  }

  /**
   * Processa a fila de animações, executando uma por vez
   */
  async processAnimationQueue(now) {
    // Se já está executando uma animação, não processa a fila
    if (this.state.isExecutingAnimation) {
      return;
    }
    
    // Se a fila está vazia, não há nada para processar
    if (this.state.animationQueue.length === 0) {
      return;
    }
    
    // Pega a primeira animação da fila
    const emotion = this.state.animationQueue[0];
    
    // Marca que está executando
    this.state.isExecutingAnimation = true;
    
    // Remove da fila
    this.state.animationQueue.shift();
    
    // Executa a animação
    this.executeAnimationFromApi(emotion);
  }

  /**
   * Executa uma animação vinda da API
   */
  executeAnimationFromApi(emotion) {
    // Remove da lista de completadas para permitir nova execução
    this.state.completedEmotions.delete(emotion);
    
    switch (emotion) {
      case "surprise":
        this.triggerSurprise();
        break;
      case "squint":
        this.triggerSquint();
        break;
      case "search":
        this.triggerSearch();
        break;
      case "fright":
        this.triggerFright();
        break;
      default:
        console.warn(`Emoção desconhecida: ${emotion}`);
        this.state.isExecutingAnimation = false;
    }
  }

  /**
   * Verifica se as animações terminaram e faz PUT para marcar como false
   */
  async checkAnimationCompletion(now) {
    // Verifica surprise
    if (this.state.pendingEmotions.has("surprise") && !this.state.completedEmotions.has("surprise")) {
      // Surprise termina quando postSurpriseBlinkTime é null (após o piscar)
      if (this.state.surpriseStartTime === null && this.state.postSurpriseBlinkTime === null) {
        await setEmotionFalse("surprise");
        this.state.pendingEmotions.delete("surprise");
        this.state.completedEmotions.add("surprise");
        this.state.isExecutingAnimation = false;
      }
    }
    
    // Verifica squint (termina quando squintStartTime e squintEntryStartTime são null e saída terminou)
    if (this.state.pendingEmotions.has("squint") && !this.state.completedEmotions.has("squint")) {
      if (this.state.squintStartTime === null && this.state.squintEntryStartTime === null) {
        // Se não há animação de saída ativa, a animação terminou
        if (this.state.squintExitStartTime === null) {
          await setEmotionFalse("squint");
          this.state.pendingEmotions.delete("squint");
          this.state.completedEmotions.add("squint");
          this.state.isExecutingAnimation = false;
        } else {
          // Verifica se a animação de saída terminou (duração estimada de 500ms)
          const exitElapsed = now - this.state.squintExitStartTime;
          if (exitElapsed > 600) { // 600ms para garantir que terminou
            await setEmotionFalse("squint");
            this.state.pendingEmotions.delete("squint");
            this.state.completedEmotions.add("squint");
            this.state.isExecutingAnimation = false;
            this.state.squintExitStartTime = null;
          }
        }
      }
    }
    
    // Verifica search (termina quando searchStartTime é null)
    if (this.state.pendingEmotions.has("search") && !this.state.completedEmotions.has("search")) {
      if (this.state.searchStartTime === null) {
        await setEmotionFalse("search");
        this.state.pendingEmotions.delete("search");
        this.state.completedEmotions.add("search");
        this.state.isExecutingAnimation = false;
      }
    }
    
    // Verifica fright (termina quando frightStartTime é null)
    if (this.state.pendingEmotions.has("fright") && !this.state.completedEmotions.has("fright")) {
      if (this.state.frightStartTime === null) {
        await setEmotionFalse("fright");
        this.state.pendingEmotions.delete("fright");
        this.state.completedEmotions.add("fright");
        this.state.isExecutingAnimation = false;
      }
    }
  }

  /**
   * Configura o display de FPS no canto da tela
   */
  setupFpsDisplay() {
    // Cria o elemento de FPS
    const fpsElement = createEl("div", "fps-display");
    fpsElement.textContent = "FPS: --";
    document.body.appendChild(fpsElement);
    
    // Adiciona uma animação que atualiza os FPS
    this.animator.add("fps", (now, delta) => {
      this.state.fpsFrameCount++;
      
      // Atualiza os FPS a cada segundo
      const elapsed = now - this.state.fpsLastTime;
      if (elapsed >= this.state.fpsUpdateInterval) {
        // Calcula FPS: frames / tempo em segundos
        this.state.fps = Math.round((this.state.fpsFrameCount * 1000) / elapsed);
        this.state.fpsFrameCount = 0;
        this.state.fpsLastTime = now;
        
        // Atualiza o elemento
        fpsElement.textContent = `FPS: ${this.state.fps}`;
      }
    });
  }
}

