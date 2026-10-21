/**
 * RoadPanel — mapa 3D da pista no estilo dos painéis de navegação BYD/Tesla.
 *
 * Fontes de dado:
 * - live: servidor do carro (/api/vehicle_info). A missão vem de hud.route (nav.route) e a
 *   trajetória reproduz as decisões do código do carro (navigation.py + lane_detection.py).
 *   A posição é estimada pela telemetria (velocidade das rodas) e corrigida a cada
 *   detecção: placa de desvio, semáforo, PARE e ponto confirmado (ver track/localizer.js).
 * - sim:  simulação local para testar sem o carro (painel de debug).
 *
 * Fluidez/FPS: a trajetória e a fita são calculadas uma vez por missão; por quadro só
 * andam o carro, a câmera e alguns uniforms. A resolução se ajusta ao FPS medido.
 */
import * as THREE from 'three';
import { TrackNetwork } from './track/network.js';
import { buildPlan, sameRoute } from './track/planner.js';
import { Localizer } from './track/localizer.js';
import { roleName, ROLE, alternateRoles, appendRoles, roleFromMissionState } from './track/mission.js';
import { Voice } from './ui/voice.js';
import { PX_TO_WORLD, DEFAULT_SIGNS, METERS_PER_PX, layoutTrack, TRACK_ID, TRACKS, switchTrack } from './track/trackData.js';
import { buildTrack, CHARGE_WAVE_S } from './scene/trackMeshes.js';
import { ChargeSmoke } from './ui/chargeSmoke.js';
import { buildSigns } from './scene/signs.js';
import { Car } from './scene/car.js';
import { RouteRibbon } from './scene/routeRibbon.js';
import { Proximity } from './scene/proximity.js';
import { GpsPreview } from './scene/gpsPreview.js';
import { CameraRig } from './scene/cameraRig.js';
import { CarLink, apiBase } from './data/carLink.js';
import { Hud } from './ui/hud.js';
import { DebugPanel } from './ui/debugPanel.js';
import { SignEditor, loadSavedSigns, loadSavedStart, loadSavedFinish } from './ui/signEditor.js';
import { loader } from './ui/loader.js';

const LIGHT_BY_CODE = { 0: 'red', 1: 'yellow', 2: 'green' };
const STOP_HOLD_MS = 3000;   // igual a STOP_WAIT_SECONDS do detector de placas
// Linha de largada/chegada: fim de volta e de missão. A partida do carro é configurável.
const START = { edgeId: 'topo-1', s: 0 };
// Modelo do carro real (versão web de 3DModel/base_basic_pbr.glb, ver tools/optimize_car.py)
const CAR_MODEL_URL = 'models/car.glb';
const CAR_MODEL_YAW = Math.PI; // o .glb exportado do Blender olha para +Z

loader.step('Montando a pista', 0.35);

const state = {
  source: 'sim',               // 'live' | 'sim'
  linkStatus: 'connecting',
  liveData: null,
  metersPerPx: METERS_PER_PX,   // medidas oficiais da pista
  // 'shortest': caminho livre pelos pontos (desvio opcional, pode repetir trecho, sem retorno em U)
  // 'car': tabela fixa lane_guide_map do navigation.py (só vale com as placas na posição original)
  planMode: 'shortest',
  pwmToMs: 0.004,              // m/s por unidade de PWM quando a telemetria não traz velocidade
  pointConfirmed: false,
  cruiseMs: 0.4,
  liveSpeed: 0,                // velocidade exibida no modo real (suavizada)               // velocidade típica do carro real (para o tempo estimado)       // o servidor confirmou um ponto desde o último quadro
  // Trajetória atual
  plan: null,
  s: 0,                        // posição do carro na trajetória (px)
  planQueue: [],               // missão usada para montar o plano
  planConsumed: 0,             // pontos do plano já alcançados
  heading: null,               // direção suavizada do carro (rad)
  missionDone: false,
  // Simulação
  playing: true,
  simSpeed: 0.4,
  simRoute: ['A', 'C'],        // na prova vêm 2 dos 3 pontos: coleta no 1º, entrega no último
  pointHoldUntil: 0,           // parado no ponto (GPS até o próximo)
  // Visão real na simulação: placas vistas pela câmera do carro comandam o carro virtual
  cameraMode: false,
  cameraArmed: false,          // câmera viu desvio: entra à direita na próxima bifurcação
  cameraStop: false,           // câmera vendo PARE ou ponto (hud.stop_active)
  // Espelho do point_stop_latched do main.py: parado no ponto até o botão RUN do carro
  // { presses, sawStopped, at }
  awaitButton: null,
  pointArrival: null,
  simDone: 0,
  simLight: 'none',
  respectSignals: true,
  stopHoldUntil: 0,
  stoppedAt: null,
  freeDrive: false,
  free: { x: 0, y: 0, heading: 0, speed: 0 },
  keys: new Set(),
  // Servidor
  serverRoute: [],
  serverRoles: [],             // papel de cada ponto de serverRoute (nav.mission_state)
  serverRaw: '',
  liveDone: [],                // paradas já consumidas (saíram de nav.route)
  liveDoneRoles: [],
  localConsumed: 0,
  userPickedSource: false,
};

// ── Cena ─────────────────────────────────────────────────────────────────
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
let pixelRatio = Math.min(maxPixelRatio, 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const SKY = { top: '#f7f9fc', horizon: '#e4e9f1' };
scene.background = (() => {
  const sky = document.createElement('canvas');
  sky.width = 2;
  sky.height = 256;
  const ctx = sky.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, SKY.top);
  gradient.addColorStop(1, SKY.horizon);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 2, 256);
  const texture = new THREE.CanvasTexture(sky);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
})();
scene.fog = new THREE.Fog(SKY.horizon, 12, 40);

const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 400);
const rig = new CameraRig(camera, canvas);

// Luz de dia: céu claro + sol, sem sombras dinâmicas (sombra de contato no carro)
scene.add(new THREE.HemisphereLight(0xffffff, 0xc9d1dc, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-6, 12, 4);
scene.add(sun);

// Posições fixadas no projeto (opcional) + edições salvas no navegador
const signsFile = TRACK_ID === 'oficial' ? 'src/config/signs.json' : `src/config/signs-${TRACK_ID}.json`;
const projectSigns = await fetch(signsFile, { cache: 'no-store' })
  .then((response) => (response.ok ? response.json() : null))
  .catch(() => null);
const savedSigns = loadSavedSigns(DEFAULT_SIGNS, projectSigns);
// Linha de largada/chegada (móvel no editor) define onde a volta começa e termina
let finishAt = loadSavedFinish(projectSigns);
let layout = layoutTrack(finishAt);
const network = new TrackNetwork(savedSigns, layout.segments);
// Partida do carro (editor de placas); null = na linha de largada
let startSpot = loadSavedStart(projectSigns);
// Partida padrão: em cima da linha de largada (acompanha a linha se ela for movida)
const DEFAULT_START = { edgeId: START.edgeId, s: 0 };
const carStart = () => (startSpot ? network.placeStart(startSpot.at, startSpot.reverse) : DEFAULT_START);
let track = buildTrack(layout.finish);
scene.add(track.group);

loader.step('Desenhando as placas', 0.55);
// As letras das placas são desenhadas em canvas: espera a Saira para não sair na fonte padrão
await document.fonts.load('700 64px Saira').catch(() => {});
let signs = buildSigns(network.signs);
scene.add(signs.group);
const car = new Car();
scene.add(car.root);
loader.step('Carregando o carro 3D', 0.65);
// Se o modelo falhar, o bloco provisório continua no lugar
await car.loadModel(CAR_MODEL_URL, { yaw: CAR_MODEL_YAW })
  .catch((error) => {
    console.warn('Modelo do carro indisponível:', error);
    document.getElementById('modelHint').textContent = 'Modelo do carro indisponível; usando o bloco provisório';
  });
const gps = new GpsPreview();
scene.add(gps.group);
const proximity = new Proximity();
car.root.add(proximity.group);
const ribbon = new RouteRibbon();
scene.add(ribbon.mesh);

const hud = new Hud();
const localizer = new Localizer();
// Pose exibida: segue a pose calculada e suaviza os saltos das correções
const shown = { x: 0, y: 0, ready: false };
const SNAP_DISTANCE_PX = 4;

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ── Missão efetiva ───────────────────────────────────────────────────────
function currentQueue() {
  if (state.source === 'live') return state.serverRoute.slice(state.localConsumed);
  return state.simRoute.slice(state.simDone);
}

function missionView() {
  if (state.source === 'live') {
    return {
      all: [...state.liveDone, ...state.serverRoute],
      roles: [...state.liveDoneRoles, ...state.serverRoles],
      doneCount: state.liveDone.length + state.localConsumed,
      raw: state.serverRaw,
      source: 'servidor',
    };
  }
  return {
    all: [...state.simRoute],
    roles: alternateRoles(state.simRoute.length),
    doneCount: state.simDone,
    raw: state.simRoute.join(' → '),
    source: 'simulação',
  };
}

/** Papel do próximo ponto `point` ainda não concluído da missão (null se não está nela). */
function pendingRole(mission, point) {
  const index = mission.all.indexOf(point, mission.doneCount);
  return index >= 0 ? mission.roles[index] : null;
}

/** Onde o carro está, em termos de aresta da rede (para replanejar dali). */
function currentLocation() {
  if (!state.plan) return carStart();
  const plan = state.plan;
  let index = plan.ranges.findIndex((range) => state.s >= range.s0 && state.s <= range.s1 + 0.5);
  if (index < 0) index = plan.edges.length - 1;
  const edge = plan.edges[index];
  const p = plan.line.sample(state.s);
  return { edgeId: edge.id, s: Math.min(edge.length - 1, edge.line.project([p.x, p.y]).s) };
}

function replan(reveal = true, from = null) {
  const queue = currentQueue();
  const start = from || currentLocation();
  const useCamera = state.cameraMode && state.source === 'sim';
  state.plan = buildPlan(network, start, queue, {
    mode: useCamera ? 'camera' : state.planMode,
    armed: useCamera && state.cameraArmed,
    detoursDone: state.source === 'live' ? localizer.detours : 0,
  });
  state.planQueue = queue;
  state.planConsumed = 0;
  state.s = 0;
  state.missionDone = false;
  localizer.reset();
  ribbon.setPlan(state.plan, reveal);
}

function planTargets() {
  return state.plan.events.filter((event) => event.type === 'point' && event.target);
}

/** Missão mudou por fora (servidor/debug) e não só porque o carro alcançou pontos? */
function needsReplan() {
  const expected = state.planQueue.slice(state.planConsumed);
  return !sameRoute(expected, currentQueue());
}

function consumePoint() {
  state.planConsumed += 1;
  if (state.source === 'live') state.localConsumed += 1;
  else {
    const role = alternateRoles(state.simRoute.length)[state.simDone];
    // Como o main.py, o carro trava em todo ponto até o botão RUN (na simulação, o do debug)
    arrivedAtPoint(state.simRoute[state.simDone], role, true);
    state.simDone += 1;
  }
}

// ── Servidor ─────────────────────────────────────────────────────────────
/**
 * Sincroniza com a lista que o servidor manda (nav.route). Quando ela encolhe, o carro
 * consumiu uma parada: no main.py a mesma detecção que tira o ponto da rota liga
 * point_stop_latched, então o carro está parado no ponto esperando o botão RUN. A posição
 * vai para a placa do ponto e a trajetória é refeita dali.
 *
 * Os papéis (coleta/entrega) seguem Navigation.add_point: pontos novos alternam a partir
 * do último da lista; `missionState` (command.mission_state) corrige o ponto atual.
 */
function applyServerRoute(next, raw, missionState = -1) {
  state.serverRaw = raw;
  const prev = state.serverRoute;
  if (sameRoute(prev, next)) {
    syncRoles(missionState);
    return;
  }
  let confirmed = 0;
  for (let k = 1; k <= prev.length; k++) {
    if (sameRoute(prev.slice(k), next)) { confirmed = k; break; }
  }
  state.serverRoute = next;
  if (confirmed > 0) {
    state.liveDone.push(...prev.slice(0, confirmed));
    state.liveDoneRoles.push(...state.serverRoles.slice(0, confirmed));
    state.serverRoles = state.serverRoles.slice(confirmed);
    if (state.source === 'live') {
      const index = state.liveDone.length - 1;
      const data = state.linkStatus === 'live' ? state.liveData : null;
      // Em modo manual o main.py não liga o latch (route_stop_requested é ignorado)
      const latched = !(data && data.controlMode === 'MANUAL');
      arrivedAtPoint(state.liveDone[index], state.liveDoneRoles[index], latched);
    }
    const target = state.plan && state.source === 'live' ? planTargets()[confirmed - 1] : null;
    if (target) state.s = Math.max(0, Math.min(state.plan.length, target.s + 1));
    localizer.confirmPoint(performance.now());
    state.pointConfirmed = true;
    state.localConsumed = 0;
    if (state.source === 'live' && state.plan) replan(false);
  } else if (!(next.length > prev.length && sameRoute(next.slice(0, prev.length), prev))) {
    // Rota trocada por fora (reset/nova missão): recomeça do zero, como uma lista nova
    state.liveDone = [];
    state.liveDoneRoles = [];
    state.serverRoles = alternateRoles(next.length);
    state.localConsumed = 0;
    state.missionDone = false;
  } else {
    // add_point: alterna a partir do último ponto ainda na lista (lista vazia = coleta)
    state.serverRoles.push(...appendRoles(state.serverRoles[state.serverRoles.length - 1], next.length - prev.length));
    state.missionDone = false;      // pontos novos depois de finalizar: novo percurso
  }
}

/**
 * command.mission_state é o papel real do ponto atual: se divergir, realinha a alternância.
 * Só com a rota estável: o main.py grava o comando antes de ler nav.route, então no quadro
 * em que a rota muda o mission_state ainda pode ser o do ponto anterior.
 */
function syncRoles(missionState) {
  const actual = roleFromMissionState(missionState);
  if (!actual || !state.serverRoute.length || state.serverRoles[0] === actual) return;
  state.serverRoles = alternateRoles(state.serverRoute.length, actual);
}

const link = new CarLink((status, data) => {
  state.linkStatus = status;
  state.liveData = data;
  if (!state.userPickedSource && status === 'live' && state.source !== 'live') setSource('live');
  if (data && state.source === 'live') applyServerRoute(data.route, data.routeText, data.missionState);
});

function setSource(source, byUser = false) {
  if (byUser) state.userPickedSource = true;
  if (state.source === source) return;
  state.source = source;
  state.freeDrive = false;
  releaseButtonWait();             // a espera no ponto é de uma fonte só
  if (source === 'live') {
    // Modo real: o carro só anda com o que chega do servidor; começa na largada
    state.serverRoute = [];
    state.serverRoles = [];
    state.liveDone = [];
    state.liveDoneRoles = [];
    state.localConsumed = 0;
    localizer.restart();
    if (state.liveData) applyServerRoute(state.liveData.route, state.liveData.routeText, state.liveData.missionState);
    replan(true, carStart());
  } else {
    replan(true);
  }
  debug.sync();
  syncControls();
}

// ── Controles do mapa: vista, tela cheia, simulação/real ─────────────────
const controls = {
  view: document.getElementById('viewToggle'),
  viewLabel: document.getElementById('viewToggleLabel'),
  fullscreen: document.getElementById('fullscreenToggle'),
  fullscreenLabel: document.getElementById('fullscreenLabel'),
  mode: document.getElementById('modeSwitch'),
  track: document.getElementById('trackToggle'),
  trackLabel: document.getElementById('trackLabel'),
  sound: document.getElementById('soundToggle'),
  soundLabel: document.getElementById('soundLabel'),
  voice: document.getElementById('voiceToggle'),
  voiceLabel: document.getElementById('voiceLabel'),
};
const root = document.documentElement;
const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
const canFullscreen = Boolean(root.requestFullscreen || root.webkitRequestFullscreen);

function setCamera(mode) {
  rig.setMode(mode);
  debug.sync();
  syncControls();
}

function toggleFullscreen() {
  if (fullscreenElement()) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    Promise.resolve(request.call(root, { navigationUI: 'hide' })).catch(() => {});
  }
}

function toggleSound() {
  voice.setEnabled(!voice.enabled);
  syncControls();
}

/** Troca as falas do GPS pelas do Dilera (e volta). */
function toggleVoicePack() {
  voice.setPack(voice.pack === 'dilera' ? 'gps' : 'dilera');
  guide.lastCue = null;
  guide.dileraLastClip = null;
  syncControls();
}

function syncControls() {
  const top = rig.mode === 'top';
  controls.view.setAttribute('aria-pressed', String(top));
  controls.view.title = top ? 'Voltar à vista do carro (V)' : 'Vista de topo (V)';
  controls.viewLabel.textContent = top ? 'Carro' : 'Topo';
  const full = Boolean(fullscreenElement());
  controls.fullscreen.setAttribute('aria-pressed', String(full));
  controls.fullscreen.title = full ? 'Sair da tela cheia (F)' : 'Tela cheia (F)';
  controls.fullscreenLabel.textContent = full ? 'Sair' : 'Tela cheia';
  controls.sound.setAttribute('aria-pressed', String(voice.enabled));
  controls.sound.title = voice.enabled ? 'Desligar voz e avisos (M)' : 'Ligar voz e avisos (M)';
  controls.soundLabel.textContent = voice.enabled ? 'Som' : 'Mudo';
  const dilera = voice.pack === 'dilera';
  controls.voice.setAttribute('aria-pressed', String(dilera));
  controls.voice.title = dilera ? 'Voltar à voz do GPS (G)' : 'Trocar para a voz do Dilera (G)';
  controls.voiceLabel.textContent = voice.packLabel;
  controls.mode.querySelectorAll('button').forEach((button) => {
    button.setAttribute('aria-checked', String(button.dataset.mode === state.source));
  });
}

controls.view.addEventListener('click', () => setCamera(rig.mode === 'top' ? 'chase' : 'top'));
controls.sound.addEventListener('click', toggleSound);
controls.voice.addEventListener('click', toggleVoicePack);
// Pista real <-> pista de teste (recarrega com a outra geometria e as placas dela)
controls.track.addEventListener('click', () => switchTrack(TRACK_ID === 'teste' ? 'oficial' : 'teste'));
controls.track.setAttribute('aria-pressed', String(TRACK_ID === 'teste'));
controls.track.title = TRACK_ID === 'teste' ? 'Trocar para a pista oficial' : 'Trocar para a pista de teste';
controls.trackLabel.textContent = TRACK_ID === 'teste' ? 'Teste' : 'Oficial';
document.title = `${TRACKS[TRACK_ID]} · APEX`;
controls.fullscreen.hidden = !canFullscreen;   // iPhone não tem tela cheia para páginas
controls.fullscreen.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', syncControls);
document.addEventListener('webkitfullscreenchange', syncControls);
controls.mode.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-mode]');
  if (button) setSource(button.dataset.mode, true);
});

// ── Simulação ────────────────────────────────────────────────────────────
const nextEvent = (type, maxPx) => state.plan.events.find((e) => e.type === type && e.s - state.s >= -2 && e.s - state.s <= maxPx);

// ── Visão real na simulação ──────────────────────────────────────────────
// Só a câmera faz o carro virar (placa de desvio) e parar (PARE ou ponto A/B/C).
// Pessoas e semáforo vermelho não param o carro neste modo.
const CAMERA_POINT_PX = 200;   // ~4 m: PARE visto com um ponto da missão à frente = chegou no ponto
const vision = { prevStop: false, prevDetour: false };

function updateCamera() {
  const data = state.linkStatus === 'live' ? state.liveData : null;
  const stop = Boolean(data && data.stopActive);
  const detour = Boolean(data && data.rightDetour);
  if (detour && !vision.prevDetour) {
    state.cameraArmed = true;
    replan(false, currentLocation());
  }
  if (stop && !vision.prevStop) {
    const target = planTargets()[state.planConsumed];
    if (target && target.s - state.s < CAMERA_POINT_PX && target.s - state.s > -40) {
      state.s = Math.max(state.s, target.s);
      consumePoint();
    }
  }
  // Passou da bifurcação em que ia entrar: o desvio já foi usado
  const branch = state.plan.firstBranch >= 0 ? state.plan.ranges[state.plan.firstBranch] : null;
  if (state.cameraArmed && (!branch || state.s > branch.s0)) state.cameraArmed = false;
  vision.prevStop = stop;
  vision.prevDetour = detour;
  state.cameraStop = stop;
  updateAwaitButton(data, performance.now());
}

// Logo depois de chegar, command.speed ainda pode ser o de antes do latch (o main.py trava
// no laço seguinte ao que tirou o ponto da rota): PWM > 0 só conta como "saiu" depois disso
const LATCH_PWM_GRACE_MS = 600;

/**
 * Parado no ponto: espelho do point_stop_latched do main.py, que solta quando
 * 1. o botão RUN do carro é apertado (borda de subida de run_btn = contador novo);
 * 2. o run é desligado e ligado de novo (point_stop_saw_stopped);
 * 3. o controle remoto assume (modo manual).
 * Como o latch força PWM 0, o carro andando sozinho com PWM > 0 também prova que soltou
 * (cobre um aperto curto que o polling perdeu).
 */
function updateAwaitButton(data, now) {
  const wait = state.awaitButton;
  if (!wait || !data) return;
  if (data.controlMode === 'MANUAL') return releaseButtonWait();
  const presses = data.runPresses;
  if (presses === null) {
    // Servidor sem o contador: usa o próprio run_btn (pode perder um toque muito curto)
    if (data.runButton) return releaseButtonWait();
  } else if (wait.presses === null) {
    wait.presses = presses;   // sem sinal ao chegar: conta a partir de agora
  } else if (presses > wait.presses) {
    return releaseButtonWait();
  }
  if (!data.running) wait.sawStopped = true;
  else if (wait.sawStopped) return releaseButtonWait();
  if (data.running && data.pwm > 0 && now - wait.at > LATCH_PWM_GRACE_MS) releaseButtonWait();
}

function releaseButtonWait() {
  state.awaitButton = null;
  state.pointHoldUntil = 0;
}

function setCameraMode(on) {
  state.cameraMode = on;
  state.cameraArmed = false;
  releaseButtonWait();
  vision.prevStop = false;
  vision.prevDetour = false;
  if (on && state.source !== 'sim') {
    setSource('sim', true);              // a visão real é um modo da simulação
    return;
  }
  if (on) state.userPickedSource = true;   // fica na simulação mesmo com o servidor no ar
  if (state.source === 'sim') replan(true);
}

function simSpeedPx(now) {
  if (state.cameraMode) {
    const held = !state.playing || state.missionDone || state.cameraStop || now < state.pointHoldUntil;
    return held ? 0 : state.simSpeed / state.metersPerPx;
  }
  if (!state.playing || state.missionDone || now < state.stopHoldUntil || now < state.pointHoldUntil ||
    now < guide.simHazardUntil) return 0;
  const speedPx = state.simSpeed / state.metersPerPx;
  if (!state.respectSignals) return speedPx;
  if (state.simLight === 'red' && nextEvent('traffic-light', 26)) return 0;
  const stop = nextEvent('stop', 8);
  if (stop) {
    const key = `${state.plan.length.toFixed(0)}:${stop.s.toFixed(0)}`;
    if (state.stoppedAt !== key) {
      state.stoppedAt = key;
      state.stopHoldUntil = now + STOP_HOLD_MS;
      return 0;
    }
  }
  return speedPx;
}

function driveFree(dt) {
  const f = state.free;
  const k = state.keys;
  const throttle = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
  const steer = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
  const maxPx = 1.2 / state.metersPerPx;
  f.speed += throttle * maxPx * 1.6 * dt;
  f.speed *= Math.exp(-dt * (throttle ? 0.4 : 2.2));
  f.speed = Math.max(-maxPx * 0.4, Math.min(maxPx, f.speed));
  f.heading += steer * dt * 2.1 * Math.min(1, Math.abs(f.speed) / (maxPx * 0.25)) * Math.sign(f.speed || 1);
  f.x += Math.cos(f.heading) * f.speed * dt;
  f.y += Math.sin(f.heading) * f.speed * dt;
  return Math.abs(f.speed) * state.metersPerPx;
}

function setFreeDrive(enabled) {
  if (enabled === state.freeDrive) return;
  if (enabled) {
    const p = state.plan.line.sample(state.s);
    state.free = { x: p.x, y: p.y, heading: Math.atan2(p.dir[1], p.dir[0]), speed: 0 };
  } else {
    const nearest = network.nearest([state.free.x, state.free.y]);
    replan(true, { edgeId: nearest.edgeId, s: nearest.s });
  }
  state.freeDrive = enabled;
}

// ── Resolução adaptativa (FPS) ───────────────────────────────────────────
let fpsFrames = 0;
let fpsAt = performance.now();
let fps = 60;
function adaptQuality(now) {
  fpsFrames += 1;
  if (now - fpsAt < 1500) return;
  fps = Math.round((fpsFrames * 1000) / (now - fpsAt));
  fpsFrames = 0;
  fpsAt = now;
  let next = pixelRatio;
  if (fps < 45) next = Math.max(0.75, pixelRatio - 0.25);
  else if (fps > 57) next = Math.min(maxPixelRatio, pixelRatio + 0.125);
  if (next !== pixelRatio) {
    pixelRatio = next;
    renderer.setPixelRatio(pixelRatio);
    resize();
  }
}

// ── Modo GPS (PARE e pontos A/B/C) ───────────────────────────────────────
// Parado na PARE: caminho até a próxima placa. Chegou num ponto da missão (coleta/entrega):
// caminho até o próximo ponto da missão, ou até a linha de chegada depois da entrega.
const SIGN_EVENTS = new Set(['point', 'detour', 'traffic-light', 'stop']);
const POINT_HOLD_MS = 4000;
const gpsEl = {
  card: document.getElementById('gpsCard'),
  badge: document.getElementById('gpsBadge'),
  status: document.getElementById('gpsStatus'),
  label: document.getElementById('gpsLabel'),
  target: document.getElementById('gpsTarget'),
  distance: document.getElementById('gpsDistance'),
  eta: document.getElementById('gpsEta'),
};
const cargoEl = {
  box: document.getElementById('cargoTakeover'),
  title: document.getElementById('ctTitle'),
  kicker: document.getElementById('ctKicker'),
  hint: document.getElementById('ctHint'),
  simButton: document.getElementById('simRunButton'),
  key: '',
  closeTimer: 0,
};
const CARGO_EXIT_MS = 260;   // igual à transição de opacidade de .cargo-takeover
const gpsState = { reason: null, since: 0, until: 0, target: null };

/** 'stop' (parado na PARE), 'point' (acabou de chegar num ponto da missão) ou null. */
function gpsReason(now) {
  if (state.freeDrive) return null;
  if (now < state.pointHoldUntil) return 'point';
  if (state.source === 'sim') {
    if (state.cameraMode) return state.cameraStop ? 'stop' : null;
    return now < state.stopHoldUntil ? 'stop' : null;
  }
  const data = state.linkStatus === 'live' ? state.liveData : null;
  return data && data.stopActive ? 'stop' : null;
}

/**
 * Chegou num ponto da missão: segura o carro (simulação) e abre o GPS. Com `waitButton`
 * fica parado até o botão RUN do carro real em vez de esperar POINT_HOLD_MS.
 */
function arrivedAtPoint(point, role, waitButton = false) {
  state.pointArrival = { point, role: roleName(role) };
  if (role === ROLE.delivery) voice.say('delivered');
  else if (role === ROLE.pickup) voice.say('recalc');   // Dilera: "recalculando" na coleta
  if (waitButton) {
    const data = state.linkStatus === 'live' ? state.liveData : null;
    state.awaitButton = {
      role,
      presses: data ? data.runPresses : null,
      sawStopped: Boolean(data && !data.running),
      at: performance.now(),
    };
    state.pointHoldUntil = Infinity;
    return;
  }
  state.pointHoldUntil = performance.now() + POINT_HOLD_MS;
}

function nextSign(reason) {
  const wanted = reason === 'point'
    ? (e) => e.type === 'point' && e.target
    : (e) => SIGN_EVENTS.has(e.type);
  const next = state.plan.events.find((e) => wanted(e) && e.s > state.s + 12);
  if (next) return next;
  return { type: 'start', s: state.plan.length };
}

function signName(event) {
  if (event.type === 'start') return 'Linha de chegada';
  if (event.type === 'point') {
    const role = event.target ? pendingRole(missionView(), event.point) : null;
    if (role) return `${roleName(role)} · ponto ${event.point}`;
    return `Ponto ${event.point}`;
  }
  return event.sign?.label || 'Placa';
}

const formatMeters = (m) => (m < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(1).replace('.', ',')} m`);

function openGps(reason, now) {
  gpsState.reason = reason;
  gpsState.since = now;
  gpsState.until = reason === 'point' ? state.pointHoldUntil : now + STOP_HOLD_MS;
  gpsState.target = nextSign(reason);
  gps.show(state.plan, state.s, gpsState.target, now);
  if (reason === 'point') {
    const { point, role } = state.pointArrival || {};
    gpsEl.badge.textContent = `${role || 'Ponto'} ${point || ''}`.trim();
    gpsEl.badge.dataset.kind = 'point';
    gpsEl.label.textContent = gpsState.target.type === 'start' ? 'Próximo destino' : 'Próximo ponto';
  } else {
    gpsEl.badge.textContent = 'PARE';
    gpsEl.badge.dataset.kind = 'stop';
    gpsEl.label.textContent = 'Próxima placa';
  }
  gpsEl.target.textContent = signName(gpsState.target);
  // Saindo de um ponto com o GPS mostrando o próximo: "indo ao local de entrega/coleta"
  if (reason === 'point' && gpsState.target.type === 'point' && gpsState.target.target) {
    const next = pendingRole(missionView(), gpsState.target.point);
    if (next === ROLE.delivery) voice.say('delivery');
    else if (next === ROLE.pickup) voice.say('pickup');
  }
  gpsEl.card.hidden = false;
}

function closeGps(now) {
  gps.hide(now);
  gpsEl.card.hidden = true;
  gpsState.reason = null;
}

function updateGps(now) {
  const reason = gpsReason(now);
  if (reason === 'stop' && gpsState.reason !== 'stop') voice.say('stop-sign');   // Dilera: polícia na PARE
  if (reason &&(reason !== gpsState.reason || (gps.active && gps.plan !== state.plan))) openGps(reason, now);
  else if (!reason && gpsState.reason) closeGps(now);
  rig.setFocus(gps.active ? gps.focus() : null);
  if (!gps.active) return;

  const meters = Math.max(0, gpsState.target.s - state.s) * state.metersPerPx;
  const speed = state.source === 'sim' ? state.simSpeed : state.cruiseMs;
  const left = Math.max(0, Math.ceil((gpsState.until - now) / 1000 - 0.05));
  const where = gpsState.reason === 'point' ? 'No ponto' : 'Parado na placa';
  gpsEl.distance.textContent = formatMeters(meters);
  gpsEl.eta.textContent = speed > 0.02 ? `~${Math.max(1, Math.round(meters / speed))} s` : '--';
  gpsEl.status.textContent = state.awaitButton
    ? `${where} · aguardando o botão RUN`
    : left > 0 && state.source === 'sim' ? `${where} · segue em ${left} s` : where;
}

/**
 * Parado no ponto esperando o botão RUN: a tela inteira pede para colocar (coleta) ou
 * retirar (entrega) a carga e apertar o botão vermelho. Na simulação o botão é o "Apertar
 * botão RUN" do debug; no modo real (e na visão real) vale o run_btn da telemetria.
 */
function updateCargoPrompt() {
  const wait = gpsState.reason === 'point' ? state.awaitButton : null;
  const role = wait && (wait.role === ROLE.delivery ? 'delivery' : 'pickup');
  const simulated = state.source === 'sim' && !(state.cameraMode && state.linkStatus === 'live');
  const point = state.pointArrival?.point || '';
  const key = wait ? `${role}:${simulated}:${point}` : '';
  cargoEl.simButton.disabled = !(state.source === 'sim' && state.awaitButton);
  if (cargoEl.key === key) return;
  cargoEl.key = key;
  const box = cargoEl.box;
  clearTimeout(cargoEl.closeTimer);
  if (!wait) {
    // Sai pelo mesmo caminho por onde entrou (opacidade + leve escala) e então some
    box.dataset.state = 'closing';
    cargoEl.closeTimer = setTimeout(() => { box.hidden = true; }, CARGO_EXIT_MS);
    return;
  }
  box.dataset.role = role;
  cargoEl.title.textContent = role === 'delivery' ? 'Retire a carga' : 'Coloque a carga';
  cargoEl.kicker.textContent = `${role === 'delivery' ? 'Entrega' : 'Coleta'}${point ? ` · ponto ${point}` : ''}`;
  cargoEl.hint.hidden = !simulated;
  if (box.hidden) {
    box.hidden = false;
    void box.offsetWidth;   // aplica o estado inicial antes de abrir, para a transição rodar
  }
  box.dataset.state = 'open';
}

// ── Onda de carga da bateria ─────────────────────────────────────────────
// Bateria passou a carregar (battery_state 1): a malha de pontos fica verde e solta anéis
// a partir do carro, em loop por CHARGE_WAVE_S. Abrir a página já carregando não dispara.
const BATTERY_CHARGING = 1;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const charge = { prev: undefined, wave: null, pending: false };   // prev undefined = sem resposta ainda
// Fumaça verde nas bordas da tela (2 s); reinicia se a carga recomeçar
const chargeSmoke = new ChargeSmoke(document.getElementById('chargeSmoke'));
const puffChargeSmoke = () => { if (!reducedMotion.matches) chargeSmoke.puff(); };

function updateChargeWave(now, wx, wz) {
  const time = now / 1000;
  if (charge.pending) {
    // Debug: mesma onda de um carregador conectado agora
    charge.pending = false;
    charge.wave = { start: time, x: wx, z: wz, motion: !reducedMotion.matches, simulated: true };
    puffChargeSmoke();
  }
  if (state.linkStatus === 'live' && state.liveData) {
    const current = state.liveData.batteryState;
    if (current === BATTERY_CHARGING && charge.prev !== undefined && charge.prev !== BATTERY_CHARGING) {
      charge.wave = { start: time, x: wx, z: wz, motion: !reducedMotion.matches };
      puffChargeSmoke();
    }
    charge.prev = current;
  }
  if (charge.wave && time - charge.wave.start > CHARGE_WAVE_S) charge.wave = null;
}

// ── Voz e avisos ─────────────────────────────────────────────────────────
const voice = new Voice();
const HAZARD_COOLDOWN_MS = 4000;
const SIM_HAZARD_MS = 3000;
const guide = {
  plan: null,
  announced: new Set(),
  wasMoving: false,
  startedMission: null,
  lastCue: null,               // última manobra falada
  dilera: new Map(),           // manobra -> já falada na voz do Dilera
  dileraLastClip: null,        // última fala de manobra do Dilera (não repete seguida)
  redStop: false,              // parado no semáforo vermelho (já avisou)
  movingAt: -1e9,              // último instante em movimento
  hazard: false,
  hazardAt: -1e9,
  simHazardUntil: 0,
};
const hazardEl = document.getElementById('hazardBanner');
const hazardText = document.getElementById('hazardText');

function finishMission() {
  if (state.missionDone) return;
  state.missionDone = true;
  guide.startedMission = null;
  guide.wasMoving = false;
  voice.say('finish');
}

// Antecedência da fala: o áudio leva ~1 s até dizer a direção, então ele começa um pouco
// antes e termina com o carro já entrando na curva
const CUE_LEAD_S = 0.9;
const CUE_MIN_PX = 20;
const CUE_MAX_PX = 60;        // ~1,2 m

/** Fala a manobra quase em cima dela (curva, siga em frente, coleta, entrega). */
function updateGuide(now, speedMs) {
  if (guide.plan !== state.plan) {
    guide.plan = state.plan;
    guide.announced = new Set();
    guide.dilera = new Map();
  }
  const mission = missionView();
  const moving = speedMs > 0.02 && !state.freeDrive;
  if (moving && !guide.wasMoving && mission.all.length && mission.doneCount === 0 && !state.missionDone) {
    const key = `${state.source}:${mission.all.join('')}`;
    if (guide.startedMission !== key) {
      guide.startedMission = key;
      voice.say('start');
      voice.say('pickup');          // "indo ao local de coleta"
    }
  }
  guide.wasMoving = moving;
  if (moving) guide.movingAt = now;
  updateRedLight(now, speedMs);
  if (!moving || state.missionDone) return;

  const lead = Math.min(CUE_MAX_PX, Math.max(CUE_MIN_PX, (speedMs / state.metersPerPx) * CUE_LEAD_S));
  if (voice.pack === 'dilera') {
    updateDileraGuide(speedMs, lead);
    return;
  }
  for (const event of state.plan.events) {
    const ahead = event.s - state.s;
    if (ahead < 0) continue;
    if (ahead > lead) break;
    // Coleta e entrega são faladas no início do percurso e no GPS ao sair de cada ponto, não aqui
    const cue = event.type === 'turn' ? event.turn : null;
    const key = `${event.type}@${Math.round(event.s)}`;
    if (!cue || guide.announced.has(key)) continue;
    guide.announced.add(key);
    // Nunca repete a mesma fala seguida (ex.: dois "siga em frente" em cruzamentos seguidos)
    if (cue === guide.lastCue) continue;
    guide.lastCue = cue;
    voice.say(cue);
  }
}

// ── Voz do Dilera: distâncias na escala da pista ─────────────────────────
// 1 m de pista vale 250 m de GPS: "1,5 km" a 6 m da manobra, "400 m" a 1,6 m e
// "200 m" a 0,8 m. Cada aviso só sai se a frase inteira cabe antes da manobra.
const DILERA_GPS_M_PER_M = 250;
const DILERA_HEADS_M = 1500;
const DILERA_CHAIN_M = 400;     // manobra seguinte até 400 m depois: "... e então vire à esquerda"
const DILERA_EXIT_PX = 50;      // curva até 1 m depois da placa de desvio: "saia à direita"

/** Fala da manobra no pacote do Dilera (null = não fala). */
function dileraManeuver(event) {
  if (event.turn === 'straight') return event.keep ? `keep-${event.keep}` : null;
  const exit = state.plan.events.some((e) => e.type === 'detour' && event.s >= e.s && event.s - e.s < DILERA_EXIT_PX);
  return exit ? `exit-${event.turn}` : event.turn;
}

const dileraKey = (event) => `turn@${Math.round(event.s)}`;

/**
 * Uma fala por manobra, no aviso mais distante que couber: "1,5 km", "400 m" ou "200 m" +
 * manobra, ou só a manobra quase em cima. Nunca repete a manobra anterior: depois de
 * "mantém à esquerda", outra "mantém à esquerda" seguida fica em silêncio. Com a voz ocupada
 * a frase entra emendada com "e então" ("recalculando... e então, 400 m, vire à direita").
 */
function updateDileraGuide(speedMs, lead) {
  const toGpsM = (px) => px * state.metersPerPx * DILERA_GPS_M_PER_M;
  const maneuvers = state.plan.events.filter((e) => e.type === 'turn' && e.s >= state.s && dileraManeuver(e));
  const next = maneuvers[0];
  if (!next) return;
  const key = dileraKey(next);
  if (guide.dilera.get(key)) return;
  const clip = dileraManeuver(next);
  if (clip === guide.dileraLastClip) {
    guide.dilera.set(key, true);   // mesma fala da manobra anterior: não repete
    return;
  }

  const aheadPx = next.s - state.s;
  const gpsM = toGpsM(aheadPx);
  const seconds = (aheadPx * state.metersPerPx) / speedMs;
  // Manobra seguinte logo depois (e diferente): "vire à direita e então vire à esquerda"
  const after = maneuvers[1];
  const afterClip = after && toGpsM(after.s - next.s) <= DILERA_CHAIN_M ? dileraManeuver(after) : null;
  const turn = afterClip && afterClip !== clip ? [clip, 'then', afterClip] : [clip];

  const done = (phrase) => {
    voice.say(phrase);
    guide.dilera.set(key, true);
    if (turn.length > 1) guide.dilera.set(dileraKey(after), true);
    guide.dileraLastClip = turn[turn.length - 1];
  };

  if (aheadPx <= lead) {
    done(turn);   // quase em cima e nada coube antes: só a manobra
    return;
  }
  const stage = gpsM <= 200 ? 'd200' : gpsM <= 400 ? 'd400' : gpsM <= DILERA_HEADS_M ? 'd1500' : null;
  if (!stage) return;
  const phrase = voice.busy ? ['then', stage, ...turn] : [stage, ...turn];
  if (seconds >= voice.busyFor() + voice.duration(phrase)) done(phrase);
}

/** Parou no semáforo vermelho (Dilera: "radar"). Só conta se vinha andando. */
function updateRedLight(now, speedMs) {
  let red = false;
  if (!state.freeDrive && speedMs <= 0.02 && now - guide.movingAt < 3000) {
    if (state.source === 'sim' && !state.cameraMode) {
      red = state.playing && state.respectSignals && state.simLight === 'red' && Boolean(nextEvent('traffic-light', 26));
    } else {
      const data = state.linkStatus === 'live' ? state.liveData : null;
      red = Boolean(data && LIGHT_BY_CODE[data.trafficLight] === 'red' && !data.stopActive && !state.awaitButton);
    }
  }
  if (red && !guide.redStop) voice.say('red-light');
  // Continua "parado no vermelho" até o sinal abrir ou o carro andar
  guide.redStop = red || (guide.redStop && speedMs <= 0.02 && redStillOn());
}

function redStillOn() {
  if (state.source === 'sim' && !state.cameraMode) return state.simLight === 'red';
  return LIGHT_BY_CODE[state.liveData?.trafficLight] === 'red';
}

/** Pedestre (o carro trava com command.stop) ou obstáculo crítico nos ultrassônicos da frente. */
function updateHazard(now) {
  let kind = null;
  if (state.source === 'sim') {
    if (now < guide.simHazardUntil) kind = 'person';
  } else if (state.linkStatus === 'live' && state.liveData) {
    const data = state.liveData;
    if (data.pedestrian) kind = 'person';
    else if (data.proximity.frontLeft >= 3 || data.proximity.frontRight >= 3) kind = 'obstacle';
  }
  const active = Boolean(kind);
  if (active && !guide.hazard && now - guide.hazardAt > HAZARD_COOLDOWN_MS) {
    guide.hazardAt = now;
    voice.say('pedestrian', { interrupt: true });
  }
  if (active) hazardText.textContent = kind === 'person' ? 'Pedestre detectado' : 'Obstáculo à frente';
  hazardEl.hidden = !active;
  guide.hazard = active;
}

// ── Loop ─────────────────────────────────────────────────────────────────
let last = performance.now();
let firstFrame = true;
const angleLerp = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (needsReplan()) replan(true);

  let speedMs = 0;
  let pose;
  if (state.source === 'sim' && state.freeDrive) {
    speedMs = driveFree(dt);
    const f = state.free;
    pose = { x: f.x, y: f.y, yaw: f.heading };
  } else {
    let speedPx = 0;
    if (state.source === 'live') {
      // Carro real: telemetria + marcos detectados (o ponto só conta quando o servidor confirma)
      const data = state.linkStatus === 'live' ? state.liveData : null;
      // Acompanha a velocidade real: freia e acelera junto (~0,25 s), sem dar saltos
      updateAwaitButton(data, now);
      // Travado no ponto o main.py força PWM 0: o mapa para junto, sem esperar a roda zerar
      const measured = localizer.speed(data, state.pwmToMs);
      const target = state.awaitButton ? 0 : measured;
      state.liveSpeed += (target - state.liveSpeed) * (1 - Math.exp(-dt * 8));
      if (target === 0 && state.liveSpeed < 0.01) state.liveSpeed = 0;
      speedMs = state.liveSpeed;
      state.s = localizer.step(state.plan, state.s, data, dt, speedMs, state.metersPerPx, now, {
        routeShrank: state.pointConfirmed,
        hasRoute: state.serverRoute.length > 0,
      });
      state.pointConfirmed = false;
      if (state.s >= state.plan.length) {
        replan(false, START);
        localizer.lapStart(now);
        // Volta fechada depois do último ponto: percurso finalizado na linha de chegada
        if (state.serverRoute.length === 0 && state.liveDone.length > 0) finishMission();
      }
    } else {
      if (state.cameraMode) updateCamera();
      speedPx = simSpeedPx(now);
      speedMs = speedPx * state.metersPerPx;
      if (speedPx > 0) {
        state.s += speedPx * dt;
        const targets = planTargets();
        // No modo câmera o ponto só conta quando a câmera o vê (updateCamera)
        while (!state.cameraMode && state.planConsumed < targets.length && state.s >= targets[state.planConsumed].s) consumePoint();
        if (state.s >= state.plan.length) {
          // Volta completa: missão cumprida para na largada; sem missão, segue em voltas
          const hadMission = state.planQueue.length > 0;
          replan(false, START);
          if (hadMission && currentQueue().length === 0) finishMission();
        }
      }
    }
    const p = state.plan.line.sample(state.s);
    const ahead = state.plan.line.sample(state.s + 6);
    pose = { x: p.x, y: p.y, yaw: Math.atan2(ahead.y - p.y, ahead.x - p.x) };
  }

  // Direção suavizada: sem "quinas" de amostragem na trajetória
  state.heading = state.heading === null ? pose.yaw : angleLerp(state.heading, pose.yaw, 1 - Math.exp(-dt * 14));
  const dirX = Math.cos(state.heading);
  const dirZ = Math.sin(state.heading);
  // Posição: acompanha direto; saltos de correção deslizam em ~0,3 s
  const jump = shown.ready ? Math.hypot(pose.x - shown.x, pose.y - shown.y) : 0;
  const follow = jump > SNAP_DISTANCE_PX ? 1 - Math.exp(-dt * 9) : 1;
  shown.x += (pose.x - shown.x) * (shown.ready ? follow : 1);
  shown.y += (pose.y - shown.y) * (shown.ready ? follow : 1);
  shown.ready = true;
  const wx = shown.x * PX_TO_WORLD;
  const wz = shown.y * PX_TO_WORLD;
  car.place(wx, wz, dirX, dirZ);
  ribbon.tick(now, state.freeDrive ? 0 : state.s);
  if (state.source === 'live' && speedMs > 0.05) state.cruiseMs += (speedMs - state.cruiseMs) * Math.min(1, dt * 0.5);
  updateGps(now);
  updateCargoPrompt();
  updateGuide(now, speedMs);
  updateHazard(now);
  gps.tick(now);
  proximity.update(state.source === 'live' && state.linkStatus === 'live' ? state.liveData?.proximity : null, dt);
  updateChargeWave(now, wx, wz);
  track.tick(now / 1000, charge.wave);

  const light = state.source === 'live'
    ? LIGHT_BY_CODE[state.liveData?.trafficLight] || null
    : state.cameraMode
      ? LIGHT_BY_CODE[state.liveData?.trafficLight] || null
      : (state.simLight === 'none' ? null : state.simLight);
  signs.setLight(light);

  const chase = rig.mode === 'chase';
  const framing = chase && gps.active;
  scene.fog.near = chase && !framing ? 12 : 300;
  scene.fog.far = chase && !framing ? 40 : 400;
  rig.update({ x: wx, z: wz, dirX, dirZ }, dt);
  renderer.render(scene, camera);
  adaptQuality(now);

  if (firstFrame) {
    firstFrame = false;
    loader.done();
  }

  hud.update(now, {
    source: state.source,
    linkStatus: state.linkStatus,
    speedMs,
    light,
    plan: state.plan,
    s: state.s,
    metersPerPx: state.metersPerPx,
    mission: missionView(),
    missionDone: state.missionDone,
    waitingButton: Boolean(state.awaitButton),
    data: state.liveData,
    simCharging: Boolean(charge.wave?.simulated),
    locator: state.source === 'live' ? localizer.describe(now) : '',
    sim: {
      camera: state.cameraMode,
      cameraLink: state.linkStatus === 'live',
      playing: state.playing,
      freeDrive: state.freeDrive,
      held: now < state.stopHoldUntil,
    },
  });
  debug.readout({
    edge: currentLocation().edgeId,
    s: state.s * state.metersPerPx,
    fps,
    pixelRatio,
    speedSource: state.source === 'live' ? localizer.speedSource : 'simulação',
    detours: localizer.detours,
  });

  requestAnimationFrame(frame);
}

// ── Editor de placas ─────────────────────────────────────────────────────
const editor = new SignEditor({
  network,
  getSigns: () => network.signs.map(({ id, kind, point, label, at }) => ({ id, kind, point, label, at: [...at] })),
  defaults: DEFAULT_SIGNS,
  getStart: () => startSpot,
  getFinish: () => finishAt,
  defaultStart: (() => {
    const p = network.edge(START.edgeId).line.sample(DEFAULT_START.s);
    return { at: [p.x, p.y], reverse: false };
  })(),
  onSave: (defs, start, finish) => {
    const finishChanged = JSON.stringify(finish) !== JSON.stringify(finishAt);
    const startChanged = finishChanged || JSON.stringify(start) !== JSON.stringify(startSpot);
    startSpot = start;
    if (finishChanged) {
      finishAt = finish;
      layout = layoutTrack(finishAt);
      network.setSegments(layout.segments);
      scene.remove(track.group);
      track = buildTrack(layout.finish);
      scene.add(track.group);
    }
    network.setSigns(defs);
    scene.remove(signs.group);
    signs = buildSigns(network.signs);
    scene.add(signs.group);
    if (startChanged) {
      // Nova partida: o carro volta para ela e a missão recomeça
      state.simDone = 0;
      state.missionDone = false;
      state.stoppedAt = null;
      state.stopHoldUntil = 0;
      replan(true, carStart());
    } else {
      replan(true);
    }
  },
});

// ── Debug ────────────────────────────────────────────────────────────────
const debug = new DebugPanel({
  state,
  apiBase: apiBase(),
  setSource: (source) => setSource(source, true),
  setCamera,
  getCamera: () => rig.mode,
  setFreeDrive,
  routeChanged: () => { state.missionDone = false; },
  setCameraMode,
  setPlanMode: (mode) => {
    state.planMode = mode;
    replan(true);
  },
  simulateCharge: () => { charge.pending = true; },
  simulatePedestrian: () => {
    if (state.source === 'sim') guide.simHazardUntil = performance.now() + SIM_HAZARD_MS;
  },
  // Carga colocada/retirada: o carro sai do ponto (só na simulação; no real vale o run_btn)
  simulateRunButton: () => {
    if (state.source === 'sim' && state.awaitButton) releaseButtonWait();
  },
  resetPosition: () => {
    guide.startedMission = null;
    guide.wasMoving = false;
    state.freeDrive = false;
    state.simDone = 0;
    state.stoppedAt = null;
    state.stopHoldUntil = 0;
    releaseButtonWait();
    replan(true, carStart());
  },
  skipEvent: () => {
    const next = state.plan.events.find((event) => event.s - state.s > 4);
    if (next) state.s = next.s - 2;
  },
  loadModel: async (file) => {
    const url = URL.createObjectURL(file);
    try {
      await car.loadModel(url, { yaw: CAR_MODEL_YAW }); // exportações do Blender olham para +Z
      return `Modelo carregado: ${file.name}`;
    } catch (error) {
      return `Não foi possível abrir ${file.name}: ${error.message || error}`;
    }
  },
});

window.addEventListener('keydown', (event) => {
  if (editor.isOpen()) return;
  const target = event.target;
  if (target instanceof HTMLInputElement && target.type !== 'checkbox' && target.type !== 'range') return;
  const key = event.key.toLowerCase();
  if (state.freeDrive && ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
    state.keys.add(key);
    event.preventDefault();
    return;
  }
  if (key === 'd' && !event.ctrlKey && !event.metaKey) debug.toggle();
  if (key === 'e' && !event.ctrlKey && !event.metaKey) editor.open();
  if (key === ' ' && state.source === 'sim') {
    state.playing = !state.playing;
    debug.sync();
    event.preventDefault();
  }
  if (key === '1') setCamera('chase');
  if (key === '2') setCamera('top');
  if (key === '3') setCamera('free');
  if (key === 'v') setCamera(rig.mode === 'top' ? 'chase' : 'top');
  if (key === 'm' && !event.ctrlKey && !event.metaKey) toggleSound();
  if (key === 'g' && !event.ctrlKey && !event.metaKey) toggleVoicePack();
  if (key === 'f' && canFullscreen && !event.ctrlKey && !event.metaKey) toggleFullscreen();
});
window.addEventListener('keyup', (event) => state.keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => state.keys.clear());

loader.step('Conectando ao carro', 0.8);
replan(false, carStart());
link.start();
debug.sync();
syncControls();
requestAnimationFrame(frame);
