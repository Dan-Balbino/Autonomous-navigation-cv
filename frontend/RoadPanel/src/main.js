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
import { roleName, roleAt, ROLE } from './track/mission.js';
import { Voice } from './ui/voice.js';
import { PX_TO_WORLD, DEFAULT_SIGNS, METERS_PER_PX } from './track/trackData.js';
import { buildTrack } from './scene/trackMeshes.js';
import { buildSigns } from './scene/signs.js';
import { Car } from './scene/car.js';
import { RouteRibbon } from './scene/routeRibbon.js';
import { Proximity } from './scene/proximity.js';
import { GpsPreview } from './scene/gpsPreview.js';
import { CameraRig } from './scene/cameraRig.js';
import { CarLink, apiBase } from './data/carLink.js';
import { Hud } from './ui/hud.js';
import { DebugPanel } from './ui/debugPanel.js';
import { SignEditor, loadSavedSigns } from './ui/signEditor.js';
import { loader } from './ui/loader.js';

const LIGHT_BY_CODE = { 0: 'red', 1: 'yellow', 2: 'green' };
const STOP_HOLD_MS = 3000;   // igual a STOP_WAIT_SECONDS do detector de placas
const START = { edgeId: 'topo-1', s: 0 };
// Modelo do carro real (versão web de 3DModel/base_basic_pbr.glb, ver tools/optimize_car.py)
const CAR_MODEL_URL = 'models/car.glb';
const CAR_MODEL_YAW = Math.PI; // o .glb exportado do Blender olha para +Z

loader.step('Montando a pista', 0.35);

const state = {
  source: 'sim',               // 'live' | 'sim'
  linkStatus: 'connecting',
  liveData: null,
  metersPerPx: METERS_PER_PX,   // pista de 21 m × 10 m
  planMode: 'car',             // 'car' (lógica do carro) | 'shortest' (menor caminho)
  pwmToMs: 0.004,              // m/s por unidade de PWM quando a telemetria não traz velocidade
  pointConfirmed: false,
  cruiseMs: 0.4,               // velocidade típica do carro real (para o tempo estimado)       // o servidor confirmou um ponto desde o último quadro
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
  simRoute: ['A', 'B', 'C'],   // coleta no 1º, passagem no 2º, entrega no último
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
  serverRaw: '',
  liveDone: [],
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
const projectSigns = await fetch('src/config/signs.json', { cache: 'no-store' })
  .then((response) => (response.ok ? response.json() : null))
  .catch(() => null);
const savedSigns = loadSavedSigns(DEFAULT_SIGNS, projectSigns);
const network = new TrackNetwork(savedSigns);
const track = buildTrack();
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
      doneCount: state.liveDone.length + state.localConsumed,
      raw: state.serverRaw,
      source: 'servidor',
    };
  }
  return { all: [...state.simRoute], doneCount: state.simDone, raw: state.simRoute.join(' → '), source: 'simulação' };
}

/** Onde o carro está, em termos de aresta da rede (para replanejar dali). */
function currentLocation() {
  if (!state.plan) return START;
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
  state.plan = buildPlan(network, start, queue, {
    mode: state.planMode,
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
    state.simDone += 1;
    if (state.simRoute.length > 1 && state.simDone === state.simRoute.length) voice.say('delivered');
  }
}

// ── Servidor ─────────────────────────────────────────────────────────────
/**
 * Sincroniza com a lista que o servidor manda (nav.route). Quando ela encolhe, o carro
 * confirmou um ponto: a posição vai para a placa do ponto e a trajetória é refeita dali.
 */
function applyServerRoute(next, raw) {
  state.serverRaw = raw;
  const prev = state.serverRoute;
  if (sameRoute(prev, next)) return;
  let confirmed = 0;
  for (let k = 1; k <= prev.length; k++) {
    if (sameRoute(prev.slice(k), next)) { confirmed = k; break; }
  }
  state.serverRoute = next;
  if (confirmed > 0) {
    state.liveDone.push(...prev.slice(0, confirmed));
    // Último ponto confirmado = encomenda entregue
    if (next.length === 0 && state.liveDone.length > 1 && state.source === 'live') voice.say('delivered');
    const target = state.plan && state.source === 'live' ? planTargets()[confirmed - 1] : null;
    if (target) state.s = Math.max(0, Math.min(state.plan.length, target.s + 1));
    localizer.confirmPoint(performance.now());
    state.pointConfirmed = true;
    state.localConsumed = 0;
    if (state.source === 'live' && state.plan) replan(false);
  } else if (!(next.length > prev.length && sameRoute(next.slice(0, prev.length), prev))) {
    state.liveDone = [];
    state.localConsumed = 0;
    state.missionDone = false;
  } else {
    state.missionDone = false;      // pontos novos depois de finalizar: novo percurso
  }
}

const link = new CarLink((status, data) => {
  state.linkStatus = status;
  state.liveData = data;
  if (!state.userPickedSource && status === 'live' && state.source !== 'live') setSource('live');
  if (data && state.source === 'live') applyServerRoute(data.route, data.routeText);
});

function setSource(source, byUser = false) {
  if (byUser) state.userPickedSource = true;
  if (state.source === source) return;
  state.source = source;
  state.freeDrive = false;
  if (source === 'live') {
    // Modo real: o carro só anda com o que chega do servidor; começa na largada
    state.serverRoute = [];
    state.liveDone = [];
    state.localConsumed = 0;
    localizer.restart();
    if (state.liveData) applyServerRoute(state.liveData.route, state.liveData.routeText);
    replan(true, START);
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
  sound: document.getElementById('soundToggle'),
  soundLabel: document.getElementById('soundLabel'),
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
  controls.mode.querySelectorAll('button').forEach((button) => {
    button.setAttribute('aria-checked', String(button.dataset.mode === state.source));
  });
}

controls.view.addEventListener('click', () => setCamera(rig.mode === 'top' ? 'chase' : 'top'));
controls.sound.addEventListener('click', toggleSound);
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

function simSpeedPx(now) {
  if (!state.playing || state.missionDone || now < state.stopHoldUntil || now < guide.simHazardUntil) return 0;
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

// ── Prévia GPS na PARE ───────────────────────────────────────────────────
// Parado na placa PARE: mostra o caminho até a próxima placa, com distância e tempo.
const SIGN_EVENTS = new Set(['point', 'detour', 'traffic-light', 'stop']);
const gpsEl = {
  card: document.getElementById('gpsCard'),
  status: document.getElementById('gpsStatus'),
  target: document.getElementById('gpsTarget'),
  distance: document.getElementById('gpsDistance'),
  eta: document.getElementById('gpsEta'),
};
const gpsState = { stopped: false, since: 0, target: null };

function stoppedAtStop(now) {
  if (state.freeDrive) return false;
  if (state.source === 'sim') return now < state.stopHoldUntil;
  const data = state.linkStatus === 'live' ? state.liveData : null;
  return Boolean(data && data.stopActive);
}

function nextSign() {
  const next = state.plan.events.find((e) => SIGN_EVENTS.has(e.type) && e.s > state.s + 12);
  if (next) return next;
  return { type: 'start', s: state.plan.length };
}

function signName(event) {
  if (event.type === 'start') return 'Largada';
  if (event.type === 'point') {
    const mission = missionView();
    const index = mission.all.indexOf(event.point, mission.doneCount);
    if (event.target && index >= 0) return `${roleName(index, mission.all.length)} · ponto ${event.point}`;
    return `Ponto ${event.point}`;
  }
  return event.sign?.label || 'Placa';
}

const formatMeters = (m) => (m < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(1).replace('.', ',')} m`);

function updateGps(now) {
  const stopped = stoppedAtStop(now);
  if (stopped && !gpsState.stopped) {
    gpsState.since = now;
    gpsState.target = nextSign();
    gps.show(state.plan, state.s, gpsState.target, now);
    gpsEl.target.textContent = signName(gpsState.target);
    gpsEl.card.hidden = false;
  } else if (!stopped && gpsState.stopped) {
    gps.hide(now);
    gpsEl.card.hidden = true;
  }
  gpsState.stopped = stopped;
  if (gps.active && gps.plan !== state.plan) {
    gps.hide(now);
    gpsEl.card.hidden = true;
  }
  rig.setFocus(gps.active ? gps.focus() : null);
  if (!gps.active) return;

  const meters = Math.max(0, gpsState.target.s - state.s) * state.metersPerPx;
  const speed = state.source === 'sim' ? state.simSpeed : state.cruiseMs;
  const left = Math.max(0, Math.ceil((gpsState.since + STOP_HOLD_MS - now) / 1000));
  gpsEl.distance.textContent = formatMeters(meters);
  gpsEl.eta.textContent = speed > 0.02 ? `~${Math.max(1, Math.round(meters / speed))} s` : '--';
  gpsEl.status.textContent = left > 0 ? `Parado na placa · segue em ${left} s` : 'Parado na placa';
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
  }
  const mission = missionView();
  const moving = speedMs > 0.02 && !state.freeDrive;
  if (moving && !guide.wasMoving && mission.all.length && mission.doneCount === 0 && !state.missionDone) {
    const key = `${state.source}:${mission.all.join('')}`;
    if (guide.startedMission !== key) {
      guide.startedMission = key;
      voice.say('start');
    }
  }
  guide.wasMoving = moving;
  if (!moving || state.missionDone) return;

  const lead = Math.min(CUE_MAX_PX, Math.max(CUE_MIN_PX, (speedMs / state.metersPerPx) * CUE_LEAD_S));
  for (const event of state.plan.events) {
    const ahead = event.s - state.s;
    if (ahead < 0) continue;
    if (ahead > lead) break;
    let cue = null;
    if (event.type === 'turn') cue = event.turn;
    else if (event.type === 'point' && event.target) {
      const index = mission.all.indexOf(event.point, mission.doneCount);
      const role = index >= 0 ? roleAt(index, mission.all.length) : null;
      cue = role === ROLE.pickup ? 'pickup' : role === ROLE.delivery ? 'delivery' : null;
    }
    const key = `${event.type}@${Math.round(event.s)}`;
    if (!cue || guide.announced.has(key)) continue;
    guide.announced.add(key);
    voice.say(cue);
  }
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
      speedMs = localizer.speed(data, state.pwmToMs);
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
      speedPx = simSpeedPx(now);
      speedMs = speedPx * state.metersPerPx;
      if (speedPx > 0) {
        state.s += speedPx * dt;
        const targets = planTargets();
        while (state.planConsumed < targets.length && state.s >= targets[state.planConsumed].s) consumePoint();
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
  updateGuide(now, speedMs);
  updateHazard(now);
  gps.tick(now);
  proximity.update(state.source === 'live' && state.linkStatus === 'live' ? state.liveData?.proximity : null, dt);
  track.tick(now / 1000);

  const light = state.source === 'live'
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
    data: state.liveData,
    locator: state.source === 'live' ? localizer.describe(now) : '',
    sim: { playing: state.playing, freeDrive: state.freeDrive, held: now < state.stopHoldUntil },
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
  onSave: (defs) => {
    network.setSigns(defs);
    scene.remove(signs.group);
    signs = buildSigns(network.signs);
    scene.add(signs.group);
    replan(true);
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
  setPlanMode: (mode) => {
    state.planMode = mode;
    replan(true);
  },
  simulatePedestrian: () => {
    if (state.source === 'sim') guide.simHazardUntil = performance.now() + SIM_HAZARD_MS;
  },
  resetPosition: () => {
    guide.startedMission = null;
    guide.wasMoving = false;
    state.freeDrive = false;
    state.simDone = 0;
    state.stoppedAt = null;
    state.stopHoldUntil = 0;
    replan(true, START);
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
  if (key === 'f' && canFullscreen && !event.ctrlKey && !event.metaKey) toggleFullscreen();
});
window.addEventListener('keyup', (event) => state.keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => state.keys.clear());

loader.step('Conectando ao carro', 0.8);
replan(false, START);
link.start();
debug.sync();
syncControls();
requestAnimationFrame(frame);
