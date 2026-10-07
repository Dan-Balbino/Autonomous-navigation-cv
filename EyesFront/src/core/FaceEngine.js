import { Animator } from "./Animator.js";
import { createFaceElements } from "./Elements.js";
import { CarMood } from "./CarMood.js";
import { setStyles, createEl, approach, clamp } from "../utils/dom.js";
import { animateBlink } from "../animations/blink.js";
import { animateLook } from "../animations/look.js";
import { animateBob } from "../animations/bob.js";
import { animateSurprise } from "../animations/surprise.js";
import { animateSquint } from "../animations/squint.js";
import { animateSearch } from "../animations/search.js";
import { animateFright } from "../animations/fright.js";
import { animateAccelerate } from "../animations/accelerate.js";
import { fetchCarState, normalizeCarState } from "../utils/api.js";
import { createCarSimulator } from "../utils/carSimulator.js";
import { DEMO_MODE, DEBUG_MODE } from "../utils/apiConfig.js";

// Velocidades padrao de suavizacao (1/s). Sobrescritas por config.expressions.smoothing
const DEFAULT_SMOOTHING = {
  gaze: 9,    // olhar seguindo o volante / obstaculos
  mood: 3.5,  // transicao entre humores (foco, preocupacao, sono, alegria)
  lids: 7,    // palpebras
  scale: 22,  // tamanho (surpresa, susto, squint)
  blink: 45,  // abertura vertical (piscar, acelerar, susto)
  shock: 12,  // abre as palpebras durante surpresa/susto
  bob: 5,     // liga/desliga da flutuacao
};

// Atalhos de teclado: tecla pressionada 3x em 500ms
const KEY_TRIGGERS = {
  s: "triggerSurprise",
  e: "triggerSquint",
  p: "triggerSearch",
  f: "triggerFright",
  a: "triggerAccelerate",
};

export class FaceEngine {
  constructor(root, config) {
    this.root = root;
    this.config = config;
    this.animator = new Animator();
    this.elements = createFaceElements();
    // Nas curvas o olhar vai tão longe quanto na animação de procurar (idle)
    const search = config.animations?.search || {};
    const searchReach = (search.distance ?? 80) * (search.speed ?? 1.5);
    this.carMood = new CarMood({ steeringGazePx: searchReach, ...config.car });
    this.keyPresses = {};
    this.debugText = "";
    this.state = {
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
      // Animação de squint (tentar enxergar)
      squintStartTime: null,
      squintX: 0,
      squintY: 0,
      squintScale: 1,
      squintEntryStartTime: null,
      squintExitStartTime: null,
      squintExitHorizontalDirection: null,
      squintHold: false, // true enquanto o carro vê placa de PARE / sinal vermelho
      // Animação de procurar
      searchStartTime: null,
      searchX: 0,
      searchCycleCount: 0,
      searchBlinkRightTime: null,
      searchBlinkLeftTime: null,
      searchBlinkRightTriggered: false,
      searchBlinkLeftTriggered: false,
      lastIdleTime: null,
      lastAutoSearchTime: 0,
      // Animação de susto
      frightStartTime: null,
      frightScale: 1,
      frightBlinkScale: 1,
      frightBlinkScaleLeft: 1,
      frightBlinkScaleRight: 1,
      frightPhase: null,
      frightTrembleX: 0,
      frightTrembleY: 0,
      triggerSearchAfterFright: false,
      // Animação de acelerar
      accelerateActive: false,
      accelerateStartTime: null,
      accelerateEndTime: null,
      accelerateBlinkScale: 1,
      accelerateTrembleX: 0,
      accelerateTrembleY: 0,
      accelerateTrembleDirection: null,
      accelerateTremblePreviousDirection: null,
      accelerateTrembleChangeTime: null,
      accelerateTrembleTransitionStartTime: null,
      accelerateShouldAnimateLines: false,
      // Humor vindo do carro (suavizado a cada frame)
      carDriving: false,
      moodFocus: 0,
      moodWorry: 0,
      moodSleepy: 0,
      moodHappy: 0,
      gazeX: 0,
      gazeY: 0,
      shock: 0,
      bobWeight: 1,
      // Pálpebras (frações da altura do olho)
      lidTop: 0,
      lidTilt: 0, // > 0 = canto interno baixo (determinado), < 0 = canto externo baixo (preocupado)
      lidBottom: 0,
      // Valores renderizados (suavizados)
      renderScale: 1,
      renderBlinkLeft: 1,
      renderBlinkRight: 1,
      prevRenderX: 0,
      stretch: 0,
      // Sistema de FPS
      fps: 0,
      fpsFrameCount: 0,
      fpsLastTime: 0,
      fpsUpdateInterval: 1000,
    };
  }

  get smoothing() {
    return { ...DEFAULT_SMOOTHING, ...(this.config.expressions?.smoothing || {}) };
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
    this.state.lastIdleTime = performance.now();
    this.state.fpsLastTime = performance.now();
    this.animator.start();
    this.setupKeyboardListener();
    this.setupFullscreenButton();
    this.setupFpsDisplay();
    this.setupCarLink();
  }

  setupFullscreenButton() {
    const button = createEl("button", "fullscreen-button");
    button.setAttribute("aria-label", "Alternar tela cheia");

    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("class", "fullscreen-icon");
    icon.setAttribute("viewBox", "0 0 24 24");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const enterIcon = "M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3";
    const exitIcon = "M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3";
    path.setAttribute("d", enterIcon);

    icon.appendChild(path);
    button.appendChild(icon);
    document.body.appendChild(button);

    button.addEventListener("click", () => {
      const request = document.fullscreenElement
        ? document.exitFullscreen()
        : document.documentElement.requestFullscreen();
      request.catch(() => {});
    });

    const updateIcon = () => {
      const active = Boolean(document.fullscreenElement);
      path.setAttribute("d", active ? exitIcon : enterIcon);
      button.classList.toggle("fullscreen-active", active);
    };

    document.addEventListener("fullscreenchange", updateIcon);
    document.addEventListener("webkitfullscreenchange", updateIcon); // Safari
    updateIcon();
  }

  setupKeyboardListener() {
    document.addEventListener("keydown", (e) => {
      const key = e.key.toLowerCase();
      const method = KEY_TRIGGERS[key];
      if (!method || e.repeat) return;

      const now = performance.now();
      const presses = (this.keyPresses[key] || []).filter((time) => now - time < 500);
      presses.push(now);
      this.keyPresses[key] = presses;

      if (presses.length >= 3) {
        this[method]();
        this.keyPresses[key] = [];
      }
    });
  }

  // ── Link com o carro ──────────────────────────────────────────────────────

  /**
   * Faz polling de /api/vehicle_info (ou do simulador em ?demo=1) e repassa
   * cada leitura ao CarMood. Usa setTimeout encadeado para nunca sobrepor requisições.
   */
  setupCarLink() {
    const carConfig = this.config.car || {};
    const interval = carConfig.pollIntervalMs ?? 150;
    const timeout = carConfig.requestTimeoutMs ?? 1200;
    const simulator = DEMO_MODE ? createCarSimulator() : null;

    const poll = async () => {
      if (!document.hidden) {
        let result;
        if (simulator) {
          result = { ok: true, car: normalizeCarState(simulator.next(performance.now())) };
        } else {
          result = await fetchCarState(timeout);
        }
        const events = this.carMood.ingest(result.ok ? result.car : null, performance.now());
        events.forEach((event) => this.handleCarEvent(event));
      }
      setTimeout(poll, interval);
    };
    poll();
  }

  handleCarEvent(event) {
    const s = this.state;
    switch (event) {
      case "fright":
        if (!s.frightStartTime) this.triggerFright();
        break;
      case "surprise":
        if (!s.frightStartTime && !s.surpriseStartTime) this.triggerSurprise();
        break;
      case "search":
        if (!s.frightStartTime && !s.searchStartTime) this.triggerSearch();
        break;
      case "accelerateOn":
        this.setAccelerate(true);
        break;
      case "accelerateOff":
        this.setAccelerate(false);
        break;
      case "squintOn":
        s.squintHold = true;
        this.startSquint();
        break;
      case "squintOff":
        // Sai sozinho quando cumprir o tempo mínimo (animateSquint)
        s.squintHold = false;
        break;
      default:
        break;
    }
  }

  // ── Gatilhos das animações ───────────────────────────────────────────────

  triggerSurprise() {
    if (this.config.animations.surprise?.enabled) {
      this.state.surpriseStartTime = performance.now();
      this.state.surpriseEndTime = null;
      this.state.postSurpriseBlinkTime = null;
    }
  }

  /** Alterna o squint (atalho de teclado). */
  triggerSquint() {
    if (this.isSquintActive()) {
      this.stopSquint();
    } else {
      this.startSquint();
    }
  }

  isSquintActive() {
    return Boolean(this.state.squintStartTime || this.state.squintEntryStartTime);
  }

  startSquint() {
    if (!this.config.animations.squint?.enabled || this.isSquintActive()) return;
    const s = this.state;
    s.squintExitStartTime = null;
    s.squintExitHorizontalDirection = null;
    s.squintEntryStartTime = performance.now();
    s.squintX = 0;
    s.squintY = 0;
    s.squintScale = 1;
  }

  stopSquint() {
    if (!this.isSquintActive()) return;
    const s = this.state;
    s.squintEntryStartTime = null;
    s.squintStartTime = null;
    s.squintHold = false;
    s.squintExitStartTime = performance.now();
  }

  triggerSearch() {
    if (this.config.animations.search?.enabled) {
      const s = this.state;
      s.searchStartTime = performance.now();
      s.searchX = 0;
      s.searchCycleCount = 0;
      s.searchBlinkRightTime = null;
      s.searchBlinkLeftTime = null;
      s.searchBlinkRightTriggered = false;
      s.searchBlinkLeftTriggered = false;
    }
  }

  triggerFright() {
    if (this.config.animations.fright?.enabled) {
      const s = this.state;
      s.frightStartTime = performance.now();
      s.frightScale = 1;
      s.frightBlinkScale = 1;
      s.frightBlinkScaleLeft = 1;
      s.frightBlinkScaleRight = 1;
      s.frightTrembleX = 0;
      s.frightTrembleY = 0;
      s.frightPhase = null;
      s.triggerSearchAfterFright = true;
      // O susto substitui a surpresa em andamento
      s.surpriseStartTime = null;
      s.surpriseEndTime = null;
      s.postSurpriseBlinkTime = null;
    }
  }

  /** Alterna acelerar (atalho de teclado). */
  triggerAccelerate() {
    this.setAccelerate(!this.state.accelerateActive);
  }

  setAccelerate(active) {
    const s = this.state;
    if (!this.config.animations.accelerate?.enabled || s.accelerateActive === active) return;
    s.accelerateActive = active;
    if (active) {
      s.accelerateStartTime = performance.now();
      s.accelerateEndTime = null;
      s.accelerateBlinkScale = 1;
    } else {
      s.accelerateEndTime = performance.now();
      s.accelerateStartTime = null;
    }
  }

  // ── Layout ───────────────────────────────────────────────────────────────

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
    setStyles(this.elements.stage, {
      transform: `scale(${this.config.scale})`,
    });
  }

  /** Tamanho final dos olhos em vmin, considerando a ovalidade. */
  getEyeSize() {
    const { eyes } = this.config;
    const ovality = eyes?.ovality || 0;
    return {
      ovality,
      width: (eyes?.width || 38) * (1 + (ovality / 100) * 0.15),
      height: (eyes?.height || 42) * (1 + (ovality / 100) * 0.3),
      positionY: eyes?.position_y || 40,
      spacing: eyes?.spacing ?? 18,
    };
  }

  borderRadiusFor(ovality) {
    if (ovality === 0) return "50%";
    const verticalRadius = Math.max(50, 50 + ovality * 1.2);
    return `50% / ${Math.max(verticalRadius, 60)}%`;
  }

  applyEyeShape() {
    const { ovality, width, height, positionY, spacing } = this.getEyeSize();
    const topVmin = (100 - positionY) - height / 2;

    // Os dois olhos formam um grupo centralizado na tela
    const halfGroupWidth = (2 * width + spacing) / 2;
    const halfEyeWidth = width / 2;
    this.state.leftEyeOffset = -(halfGroupWidth - halfEyeWidth);
    this.state.rightEyeOffset = halfGroupWidth - halfEyeWidth;

    const eyeStyles = {
      borderRadius: this.borderRadiusFor(ovality),
      width: `${width}vmin`,
      height: `${height}vmin`,
      top: `${topVmin}vmin`,
      left: "50%",
    };
    setStyles(this.elements.eyeLeft, eyeStyles);
    setStyles(this.elements.eyeRight, eyeStyles);

    this.applyEyeTransforms(16);
    this.applyGlassesSize();
  }

  applyGlassesSize() {
    const { animations } = this.config;
    const { width, height, positionY } = this.getEyeSize();

    // Os óculos são 15% maiores que os olhos para cobri-los
    const glassesWidthVmin = width * 1.15;
    const glassesHeightVmin = height * 1.15;
    const glassesBorderWidth = animations?.squint?.glassesBorderWidth || 8;
    const eyeCenterY = 100 - positionY;

    const leftEyeX = this.state.leftEyeOffset || 0;
    const rightEyeX = this.state.rightEyeOffset || 0;
    const bridgeX = (leftEyeX + rightEyeX) / 2;

    const frameStyles = {
      width: `${glassesWidthVmin}vmin`,
      height: `${glassesHeightVmin}vmin`,
      top: "50%",
      borderRadius: "50%",
      borderWidth: `${glassesBorderWidth}px`,
      transform: "translateX(-50%) translateY(-50%)",
    };
    setStyles(this.elements.glassesLeft, { ...frameStyles, left: `calc(50% + ${leftEyeX}vmin)` });
    setStyles(this.elements.glassesRight, { ...frameStyles, left: `calc(50% + ${rightEyeX}vmin)` });

    const baseBridgeWidthVmin = animations?.squint?.glassesBridgeWidth || 2;
    setStyles(this.elements.glassesBridge, {
      width: `${baseBridgeWidthVmin}vmin`,
      top: "50%",
      left: `calc(50% + ${bridgeX}vmin)`,
      transform: "translateX(-50%) translateY(-50%)",
    });

    // Curvatura do nariz no centro da ponte
    const squintCfg = animations?.squint || {};
    const noseCurvatureWidth = squintCfg.glassesBridgeNoseSize || 8;
    const noseCurvatureHeight = squintCfg.glassesBridgeNoseHeight || 3.5;
    const ellipseHorizontal = squintCfg.glassesBridgeNoseEllipseHorizontal || 50;
    const ellipseVertical = squintCfg.glassesBridgeNoseEllipseVertical || 100;
    const extraCoveragePx = squintCfg.glassesBridgeNoseCoveragePx || 2.5;

    // A ponte tem 6px de altura centralizada; a curvatura desce um pouco para cobrir a linha
    const bridgeHeightPx = 6;
    const bottomOffset = bridgeHeightPx / 2 - extraCoveragePx;

    setStyles(this.elements.glassesBridgeNose, {
      width: `${noseCurvatureWidth}vmin`,
      height: `${noseCurvatureHeight}vmin`,
      bottom: `calc(50% - ${bottomOffset}px)`,
      left: `calc(50% + ${bridgeX}vmin)`,
      transform: "translateX(-50%)",
      borderWidth: `${glassesBorderWidth}px`,
      borderRadius: `${ellipseHorizontal}% / ${ellipseVertical}% ${ellipseVertical}% 0 0`,
      background: this.config.colors.background,
      zIndex: 2,
    });

    this.state.baseBridgeWidthVmin = baseBridgeWidthVmin;
    this.state.eyeCenterY = eyeCenterY;
  }

  // ── Loop de animação ─────────────────────────────────────────────────────

  /**
   * Um único passo por frame: cada animação só atualiza o estado e, no final,
   * renderFace aplica tudo de uma vez (antes cada animação reaplicava os transforms).
   */
  registerAnimations() {
    const { animations } = this.config;
    const s = this.state;

    this.animator.add("face", (now, delta) => {
      if (animations.blink?.enabled) {
        animateBlink(animations.blink, s, now);
      }
      if (animations.look?.enabled) {
        animateLook(animations.look, s, now, delta);
      }
      if (animations.bob?.enabled) {
        const bobTarget = s.frightStartTime || s.accelerateActive ? 0 : 1;
        s.bobWeight = approach(s.bobWeight, bobTarget, this.smoothing.bob, delta);
        animateBob(this.elements.stage, animations.bob, this.config.scale, s, now);
      }
      if (animations.surprise?.enabled) {
        animateSurprise(animations.surprise, s, now);
      }
      if (animations.squint?.enabled) {
        animateSquint(
          animations.squint,
          s,
          this.elements,
          {
            leftEyeOffset: s.leftEyeOffset,
            rightEyeOffset: s.rightEyeOffset,
            eyeCenterY: s.eyeCenterY,
          },
          now
        );
      }
      if (animations.search?.enabled) {
        if (!s.frightStartTime && !s.accelerateActive) {
          this.checkAutoSearch(now);
        }
        if (!s.accelerateActive) {
          animateSearch(animations.search, s, now);
        } else {
          s.searchX = 0;
          s.searchStartTime = null;
        }
      }
      if (animations.fright?.enabled) {
        animateFright(animations.fright, s, now);
        if (s.triggerSearchAfterFright && !s.frightStartTime) {
          s.triggerSearchAfterFright = false;
          this.triggerSearch();
        }
      }
      if (animations.accelerate?.enabled) {
        animateAccelerate(animations.accelerate, s, this.elements, now);
      }

      this.renderFace(now, delta);
    });
  }

  checkAutoSearch(now) {
    const searchConfig = this.config.animations?.search;
    if (!searchConfig?.enabled) return;

    const s = this.state;
    // Com o carro andando os olhos ficam na pista
    const isIdle = !s.carDriving &&
                   !s.surpriseStartTime &&
                   !s.squintStartTime &&
                   !s.squintEntryStartTime &&
                   !s.searchStartTime &&
                   !s.frightStartTime &&
                   !s.accelerateActive;

    if (!isIdle) {
      s.lastIdleTime = null;
      return;
    }

    if (!s.lastIdleTime) {
      s.lastIdleTime = now;
    }

    const idleElapsed = now - s.lastIdleTime;
    const autoAfterIdle = searchConfig.autoAfterIdleMs || 20000;
    const autoInterval = searchConfig.autoIntervalMs || 40000;

    if (idleElapsed >= autoAfterIdle && now - (s.lastAutoSearchTime || 0) >= autoInterval) {
      this.triggerSearch();
      s.lastAutoSearchTime = now;
    }
  }

  /**
   * Mistura o humor do carro com as animações e desenha o frame.
   */
  renderFace(now, delta) {
    const s = this.state;
    const rates = this.smoothing;
    const mood = this.carMood.mood(now);

    s.carDriving = mood.driving;
    s.moodFocus = approach(s.moodFocus, mood.focus, rates.mood, delta);
    s.moodWorry = approach(s.moodWorry, mood.worry, rates.mood, delta);
    s.moodSleepy = approach(s.moodSleepy, mood.sleepy, rates.mood, delta);
    s.moodHappy = approach(s.moodHappy, mood.happy, rates.mood * 2, delta);
    // Enquanto procura, o próprio procurar comanda o olhar (evita somar os dois e sair da tela)
    s.gazeX = approach(s.gazeX, s.searchStartTime ? 0 : mood.gazeX, rates.gaze, delta);
    s.gazeY = approach(s.gazeY, mood.gazeY, rates.gaze, delta);

    // Surpresa/susto escancaram os olhos: as pálpebras se abrem
    const shocked = s.frightStartTime || (s.surpriseStartTime && !s.surpriseEndTime);
    s.shock = approach(s.shock, shocked ? 1 : 0, rates.shock, delta);

    const calm = 1 - s.shock;
    const squinting = this.isSquintActive() ? 1 : 0;
    const lidTop = calm * (0.34 * s.moodSleepy + 0.14 * s.moodFocus + 0.1 * squinting);
    const lidTilt = calm * (0.2 * s.moodFocus - 0.18 * s.moodWorry);
    const lidBottom = calm * (0.32 * s.moodHappy + 0.06 * s.moodFocus);
    s.lidTop = approach(s.lidTop, lidTop, rates.lids, delta);
    s.lidTilt = approach(s.lidTilt, lidTilt, rates.lids, delta);
    s.lidBottom = approach(s.lidBottom, lidBottom, rates.lids, delta);

    this.applyEyeTransforms(delta);
    this.updateDebugText();
  }

  /**
   * Recorte das pálpebras (clip-path) de um olho.
   * A linha de cima pode inclinar (determinado/preocupado) e a de baixo sobe
   * em arco, como bochechas num olhar feliz.
   */
  lidClipPath(isLeft) {
    const { lidTop, lidTilt, lidBottom } = this.state;
    if (lidTop < 0.003 && Math.abs(lidTilt) < 0.003 && lidBottom < 0.003) {
      return "none";
    }

    // Canto interno = lado do nariz (direita do olho esquerdo, esquerda do olho direito)
    const inner = clamp((lidTop + lidTilt) * 100, 0, 92);
    const outer = clamp((lidTop - lidTilt) * 100, 0, 92);
    const topAtLeftEdge = isLeft ? outer : inner;
    const topAtRightEdge = isLeft ? inner : outer;

    const points = [`0% ${topAtLeftEdge.toFixed(2)}%`, `100% ${topAtRightEdge.toFixed(2)}%`];
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const x = 100 - (i * 100) / steps;
      const arch = 0.35 + 0.65 * Math.sin((Math.PI * x) / 100);
      const y = 100 - lidBottom * 100 * arch;
      points.push(`${x.toFixed(2)}% ${y.toFixed(2)}%`);
    }
    return `polygon(${points.join(", ")})`;
  }

  applyEyeTransforms(delta = 16) {
    const s = this.state;
    const rates = this.smoothing;
    const { eyes } = this.config;

    // Durante surpresa/susto os olhos ficam mais circulares
    const baseOvality = eyes?.ovality || 0;
    const shockScale = Math.max(s.surpriseScale || 1, s.frightScale || 1);
    const currentOvality = shockScale > 1
      ? baseOvality - baseOvality * (shockScale - 1) / (1.8 - 1)
      : baseOvality;
    const borderRadius = this.borderRadiusFor(clamp(currentOvality, 0, 100));

    // Afasta os olhos quando crescem para não se sobreporem
    const spacingMultiplier = shockScale > 1 ? 1 + (shockScale - 1) * 0.4 : 1;
    const leftOffset = (s.leftEyeOffset || 0) * spacingMultiplier;
    const rightOffset = (s.rightEyeOffset || 0) * spacingMultiplier;

    // Posição: olhar (sacadas + volante do carro) + animações + tremores
    const x = s.eyeX + s.gazeX + (s.squintX || 0) + (s.searchX || 0) +
              (s.frightTrembleX || 0) + (s.accelerateTrembleX || 0);
    const y = s.eyeY + s.gazeY + (s.squintY || 0) +
              (s.frightTrembleY || 0) + (s.accelerateTrembleY || 0);

    // Tamanho: animações + olhos arregalados quando preocupado
    const targetScale = (s.surpriseScale || 1) * (s.squintScale || 1) * (s.frightScale || 1) *
                        (1 + 0.06 * s.moodWorry);
    s.renderScale = approach(s.renderScale, targetScale, rates.scale, delta);

    // Abertura vertical: o susto controla cada olho; nos outros casos piscar e acelerar se somam
    let leftBlink;
    let rightBlink;
    if (s.frightStartTime) {
      leftBlink = s.frightBlinkScaleLeft ?? s.frightBlinkScale ?? 1;
      rightBlink = s.frightBlinkScaleRight ?? s.frightBlinkScale ?? 1;
    } else {
      leftBlink = rightBlink = s.blinkScale * (s.accelerateBlinkScale ?? 1);
    }
    s.renderBlinkLeft = approach(s.renderBlinkLeft, leftBlink, rates.blink, delta);
    s.renderBlinkRight = approach(s.renderBlinkRight, rightBlink, rates.blink, delta);

    // Squash & stretch: estica na horizontal em movimentos rápidos
    const velocity = Math.abs(x - s.prevRenderX) / Math.max(delta, 1);
    s.prevRenderX = x;
    const stretchGain = this.config.expressions?.squashStretch ?? 0.25;
    s.stretch = approach(s.stretch, clamp(velocity * stretchGain, 0, 0.12), 20, delta);
    const stretchX = 1 + s.stretch;
    const stretchY = 1 - s.stretch * 0.6;

    const scaleX = (s.renderScale * stretchX).toFixed(4);
    const translate = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;

    setStyles(this.elements.eyeLeft, {
      transform: `translateX(-50%) translateX(${leftOffset}vmin) ${translate} rotate(${(s.leftEyeRotation || 0).toFixed(2)}deg) scale(${scaleX}, ${(s.renderScale * stretchY * s.renderBlinkLeft).toFixed(4)})`,
      borderRadius,
      clipPath: this.lidClipPath(true),
    });
    setStyles(this.elements.eyeRight, {
      transform: `translateX(-50%) translateX(${rightOffset}vmin) ${translate} rotate(${(s.rightEyeRotation || 0).toFixed(2)}deg) scale(${scaleX}, ${(s.renderScale * stretchY * s.renderBlinkRight).toFixed(4)})`,
      borderRadius,
      clipPath: this.lidClipPath(false),
    });
  }

  // ── FPS / debug ──────────────────────────────────────────────────────────

  updateDebugText() {
    if (DEBUG_MODE) {
      this.debugText = this.carMood.describe();
    }
  }

  setupFpsDisplay() {
    const fpsElement = createEl("div", "fps-display");
    fpsElement.textContent = "FPS: --";
    document.body.appendChild(fpsElement);

    this.animator.add("fps", (now) => {
      const s = this.state;
      s.fpsFrameCount++;

      const elapsed = now - s.fpsLastTime;
      if (elapsed >= s.fpsUpdateInterval) {
        s.fps = Math.round((s.fpsFrameCount * 1000) / elapsed);
        s.fpsFrameCount = 0;
        s.fpsLastTime = now;
        fpsElement.textContent = DEBUG_MODE
          ? `FPS: ${s.fps} · ${this.debugText}`
          : `FPS: ${s.fps}`;
      }
    });
  }
}
