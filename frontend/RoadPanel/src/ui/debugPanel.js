/**
 * Gaveta de debug: troca a fonte (servidor/simulação), monta a rota simulada,
 * controla o movimento, o semáforo, a câmera, a escala e permite testar o .glb do carro.
 * Abre e fecha no botão "Debug" ou na tecla D.
 */

export class DebugPanel {
  constructor(api) {
    this.api = api;
    this.state = api.state;
    const $ = (id) => document.getElementById(id);
    this.panel = $('debugPanel');
    this.toggleButton = $('debugToggle');
    this.el = {
      apiHint: $('apiHint'),
      simRouteText: $('simRouteText'),
      play: $('playToggle'),
      speed: $('simSpeed'),
      speedOut: $('simSpeedOut'),
      respect: $('respectSignals'),
      freeDrive: $('freeDrive'),
      scale: $('scale'),
      scaleOut: $('scaleOut'),
      modelFile: $('modelFile'),
      modelHint: $('modelHint'),
      readEdge: $('readEdge'),
      readS: $('readS'),
      readFps: $('readFps'),
      readSpeedSource: $('readSpeedSource'),
      readDetours: $('readDetours'),
      planModeHint: $('planModeHint'),
      pwmToMs: $('pwmToMs'),
      pwmToMsOut: $('pwmToMsOut'),
    };
    this.lastReadout = 0;
    this.bind();
  }

  bind() {
    const { el, state, api } = this;
    this.toggleButton.addEventListener('click', () => this.toggle());
    document.getElementById('debugClose').addEventListener('click', () => this.toggle(false));

    this.panel.querySelectorAll('.segmented').forEach((group) => {
      group.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-value]');
        if (!button) return;
        const value = button.dataset.value;
        const control = group.dataset.control;
        if (control === 'source') api.setSource(value);
        if (control === 'light') state.simLight = value;
        if (control === 'camera') api.setCamera(value);
        if (control === 'planMode' && value !== state.planMode) api.setPlanMode(value);
        this.sync();
      });
    });

    this.panel.querySelectorAll('[data-add-point]').forEach((button) => {
      button.addEventListener('click', () => {
        state.simRoute.push(button.dataset.addPoint);
        api.routeChanged?.();
        this.sync();
      });
    });
    document.getElementById('routeUndo').addEventListener('click', () => {
      state.simRoute.pop();
      state.simDone = Math.min(state.simDone, state.simRoute.length);
      api.routeChanged?.();
      this.sync();
    });
    document.getElementById('routeClear').addEventListener('click', () => {
      state.simRoute = [];
      state.simDone = 0;
      api.routeChanged?.();
      this.sync();
    });

    el.play.addEventListener('click', () => {
      state.playing = !state.playing;
      this.sync();
    });
    document.getElementById('resetPosition').addEventListener('click', () => {
      api.resetPosition();
      this.sync();
    });
    document.getElementById('skipEvent').addEventListener('click', () => api.skipEvent());

    el.speed.addEventListener('input', () => {
      state.simSpeed = Number(el.speed.value);
      this.sync();
    });
    el.respect.addEventListener('change', () => { state.respectSignals = el.respect.checked; });
    el.freeDrive.addEventListener('change', () => {
      api.setFreeDrive(el.freeDrive.checked);
      el.freeDrive.blur();
      this.sync();
    });
    el.pwmToMs.addEventListener('input', () => {
      state.pwmToMs = Number(el.pwmToMs.value);
      this.sync();
    });
    el.scale.addEventListener('input', () => {
      state.metersPerPx = Number(el.scale.value);
      this.sync();
    });
    el.modelFile.addEventListener('change', async () => {
      const file = el.modelFile.files?.[0];
      if (!file) return;
      el.modelHint.textContent = `Carregando ${file.name}…`;
      el.modelHint.textContent = await api.loadModel(file);
    });
  }

  toggle(force) {
    const open = force ?? this.panel.hidden;
    this.panel.hidden = !open;
    this.toggleButton.setAttribute('aria-expanded', String(open));
    this.toggleButton.hidden = open;
    if (open) this.sync();
  }

  sync() {
    const { el, state, api } = this;
    this.panel.dataset.source = state.source;
    const values = { source: state.source, light: state.simLight, camera: api.getCamera(), planMode: state.planMode };
    this.panel.querySelectorAll('.segmented').forEach((group) => {
      const current = values[group.dataset.control];
      group.querySelectorAll('button').forEach((button) => {
        button.setAttribute('aria-checked', String(button.dataset.value === current));
      });
    });
    el.apiHint.textContent = state.source === 'live'
      ? `Lendo ${api.apiBase}/vehicle_info a cada 0,4 s. A rota vem de hud.route (nav.route).`
      : 'Dados simulados. Nada aqui é lido do carro.';
    el.simRouteText.textContent = state.simRoute.length
      ? state.simRoute.map((p, i) => (i < state.simDone ? `${p} (feito)` : p)).join('  ›  ')
      : 'Sem pontos: o carro faz a volta externa';
    if (state.simRoute.length) {
      el.simRouteText.textContent = `Coleta ${state.simRoute[0]}` + (state.simRoute[1] ? ` · Entrega ${state.simRoute[1]}` : '') +
        (state.simRoute.length > 2 ? ` · +${state.simRoute.length - 2}` : '') + ` (feitos: ${state.simDone})`;
    }
    el.planModeHint.textContent = state.planMode === 'car'
      ? 'Igual ao código: lane_guide_map do navigation.py decide a faixa em cada placa de desvio.'
      : 'Menor caminho pelos pontos, em qualquer sentido (referência; o carro não planeja assim).';
    el.pwmToMs.value = String(state.pwmToMs);
    el.pwmToMsOut.textContent = state.pwmToMs.toFixed(4).replace('.', ',');
    el.play.textContent = state.playing ? 'Pausar' : 'Andar';
    el.speed.value = String(state.simSpeed);
    el.speedOut.textContent = `${state.simSpeed.toFixed(2).replace('.', ',')} m/s`;
    el.respect.checked = state.respectSignals;
    el.freeDrive.checked = state.freeDrive;
    el.scale.value = String(state.metersPerPx);
    el.scaleOut.textContent = state.metersPerPx.toFixed(4).replace('.', ',');
  }

  readout({ edge, s, fps, pixelRatio, speedSource, detours }) {
    if (this.panel.hidden) return;
    const now = performance.now();
    if (now - this.lastReadout < 250) return;
    this.lastReadout = now;
    this.el.readEdge.textContent = edge;
    this.el.readS.textContent = `${s.toFixed(2).replace('.', ',')} m`;
    this.el.readFps.textContent = `${fps} · ${pixelRatio.toFixed(2).replace('.', ',')}x`;
    this.el.readSpeedSource.textContent = speedSource;
    this.el.readDetours.textContent = String(detours);
  }
}
