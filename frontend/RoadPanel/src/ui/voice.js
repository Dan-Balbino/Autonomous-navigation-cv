/**
 * Voz e avisos sonoros do mapa (arquivos em sounds/, cópia da pasta sound/ do projeto).
 *
 * - Uma fala por vez, em fila. Falas de manobra que esperaram demais são descartadas
 *   (o carro já passou); pedestre interrompe o que estiver tocando.
 * - Navegadores só liberam áudio depois de um toque/clique/tecla: o primeiro gesto
 *   destrava os sons. O botão "Som" liga e desliga (lembrado no navegador).
 */
const FILES = {
  right: 'curva-direita.mp3',
  left: 'curva-esquerda.mp3',
  straight: 'em-frente.mp3',
  pickup: 'coleta.mp3',
  delivery: 'entrega.mp3',
  delivered: 'mercado-livre-entrega.mp3',
  start: 'start-percurso.mp3',
  finish: 'end-percurso.mp3',
  pedestrian: 'pedestre-detectado.mp3',
};

// Falas que não perdem a validade na fila
const KEEP = new Set(['delivered', 'finish', 'start', 'pedestrian', 'pickup', 'delivery']);
const MAX_WAIT_MS = 2500;
const STORAGE_KEY = 'apex.roadpanel.sound';

export class Voice {
  constructor(base = 'sounds/') {
    this.clips = {};
    for (const [name, file] of Object.entries(FILES)) {
      const audio = new Audio(base + file);
      audio.preload = 'auto';
      audio.addEventListener('ended', () => this.next());
      audio.addEventListener('error', () => this.next());
      this.clips[name] = audio;
    }
    this.queue = [];
    this.playing = null;
    this.unlocked = false;
    try {
      this.enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
    } catch {
      this.enabled = true;
    }
    const unlock = () => {
      this.unlocked = true;
      // Toca e pausa um clipe em silêncio para o navegador liberar os demais
      const probe = this.clips.straight;
      probe.muted = true;
      probe.play().then(() => {
        probe.pause();
        probe.currentTime = 0;
        probe.muted = false;
      }).catch(() => { probe.muted = false; });
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  setEnabled(on) {
    this.enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch { /* sem armazenamento: vale só nesta sessão */ }
    if (!on) this.stop();
  }

  /** Enfileira uma fala; `interrupt` corta a atual (pedestre). */
  say(name, { interrupt = false } = {}) {
    if (!this.enabled || !this.clips[name]) return;
    if (interrupt) {
      this.stop();
      this.queue.unshift({ name, at: performance.now() });
    } else {
      if (this.queue.some((item) => item.name === name)) return;
      this.queue.push({ name, at: performance.now() });
    }
    if (!this.playing) this.next();
  }

  stop() {
    this.queue = [];
    if (this.playing) {
      this.playing.pause();
      this.playing.currentTime = 0;
      this.playing = null;
    }
  }

  next() {
    this.playing = null;
    const now = performance.now();
    while (this.queue.length) {
      const item = this.queue.shift();
      if (!KEEP.has(item.name) && now - item.at > MAX_WAIT_MS) continue;
      const audio = this.clips[item.name];
      this.playing = audio;
      audio.currentTime = 0;
      audio.play().catch(() => this.next());   // ainda bloqueado: segue a fila
      return;
    }
  }
}
