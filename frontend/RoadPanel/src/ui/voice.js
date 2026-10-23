/**
 * Voz e avisos sonoros do mapa (arquivos em sounds/, cópia da pasta sound/ do projeto).
 *
 * - Dois pacotes de voz: o GPS padrão e o Dilera (sounds/dilera/). O botão "Voz" troca
 *   entre eles (lembrado no navegador). Uma fala que o pacote não tem é ignorada.
 * - Uma fala pode ser uma frase de vários clipes tocados em sequência
 *   (ex.: "400 metros" + "vire à direita" + "e então" + "vire à esquerda").
 * - Uma fala por vez, em fila. Falas de manobra que esperaram demais são descartadas
 *   (o carro já passou); pedestre interrompe o que estiver tocando.
 * - Navegadores só liberam áudio depois de um toque/clique/tecla: o primeiro gesto
 *   destrava os sons. O botão "Som" liga e desliga (lembrado no navegador).
 */
const PACKS = {
  gps: {
    label: 'GPS',
    base: 'sounds/',
    clips: {
      right: 'curva-direita.mp3',
      left: 'curva-esquerda.mp3',
      straight: 'em-frente.mp3',
      pickup: 'coleta.mp3',
      delivery: 'entrega.mp3',
      start: 'start-percurso.mp3',
      finish: 'end-percurso.mp3',
      pedestrian: 'pedestre-detectado.mp3',
    },
  },
  dilera: {
    label: 'Dilera',
    base: 'sounds/dilera/',
    // Uma lista sorteia uma das versões a cada fala
    clips: {
      right: 'virar_dir.mp3',
      left: 'virar_esq.mp3',
      'keep-right': 'mantem_dir.mp3',
      'keep-left': 'mantem_esq.mp3',
      'exit-right': 'sair_dir.mp3',
      'exit-left': 'sair_esq.mp3',
      start: ['start_1.mp3', 'start_2.mp3'],
      recalc: 'recalculando.mp3',             // chegou na coleta
      delivered: 'cheguei.mp3',               // entregou a carga
      'stop-sign': ['policia_1.mp3', 'policia_2.mp3'],
      'red-light': 'radar_1.mp3',
      pedestrian: 'perigo_1.mp3',
      d1500: '1_5km.mp3',
      d400: '400_m.mp3',
      d200: '200_m.mp3',
      then: 'e_entao.mp3',
    },
  },
};

// Falas que não perdem a validade na fila
const KEEP = new Set(['delivered', 'finish', 'start', 'pedestrian', 'pickup', 'delivery', 'recalc', 'stop-sign', 'red-light']);
const MAX_WAIT_MS = 2500;
const FALLBACK_DURATION_S = 1.5;   // antes de o navegador ler a duração do arquivo
const STORAGE_KEY = 'apex.roadpanel.sound';
const PACK_KEY = 'apex.roadpanel.voice';

const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

export class Voice {
  constructor() {
    this.audio = {};   // pacote -> arquivo -> <audio>
    for (const [id, pack] of Object.entries(PACKS)) {
      this.audio[id] = {};
      for (const files of Object.values(pack.clips)) {
        for (const file of [].concat(files)) {
          const audio = new Audio(pack.base + file);
          audio.preload = 'auto';
          audio.addEventListener('ended', () => this.advance(audio));
          audio.addEventListener('error', () => this.advance(audio));
          this.audio[id][file] = audio;
        }
      }
    }
    this.queue = [];
    this.current = null;   // { audios, index }
    this.lastKey = null;   // última frase tocada: a mesma nunca toca duas vezes seguidas
    this.unlocked = false;
    try {
      this.enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
      const saved = localStorage.getItem(PACK_KEY);
      this.pack = PACKS[saved] ? saved : 'gps';
    } catch {
      this.enabled = true;
      this.pack = 'gps';
    }
    const unlock = () => {
      this.unlocked = true;
      // Toca e pausa um clipe em silêncio para o navegador liberar os demais
      const probe = this.audio.gps[PACKS.gps.clips.straight];
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

  get packLabel() {
    return PACKS[this.pack].label;
  }

  setEnabled(on) {
    this.enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch { /* sem armazenamento: vale só nesta sessão */ }
    if (!on) this.stop();
  }

  /** Troca o pacote de voz (gps <-> dilera) e corta o que estiver tocando no outro. */
  setPack(id) {
    if (!PACKS[id] || id === this.pack) return;
    this.stop();
    this.pack = id;
    this.lastKey = null;
    try {
      localStorage.setItem(PACK_KEY, id);
    } catch { /* sem armazenamento: vale só nesta sessão */ }
  }

  /** O pacote atual tem esta fala? */
  has(name) {
    return Boolean(PACKS[this.pack].clips[name]);
  }

  /** Duração (s) de uma frase no pacote atual; versões sorteadas contam pela mais longa. */
  duration(names) {
    let total = 0;
    for (const name of [].concat(names)) {
      const files = PACKS[this.pack].clips[name];
      if (!files) continue;
      total += Math.max(...[].concat(files).map((file) => {
        const d = this.audio[this.pack][file].duration;
        return Number.isFinite(d) && d > 0 ? d : FALLBACK_DURATION_S;
      }));
    }
    return total;
  }

  /** Segundos até a voz ficar livre (o que falta da fala atual + a fila). */
  busyFor() {
    let total = 0;
    if (this.current) {
      const { audios, index } = this.current;
      const now = audios[index];
      if (now && Number.isFinite(now.duration)) total += Math.max(0, now.duration - now.currentTime);
      for (const audio of audios.slice(index + 1)) {
        total += Number.isFinite(audio.duration) ? audio.duration : FALLBACK_DURATION_S;
      }
    }
    for (const item of this.queue) total += this.duration(item.names);
    return total;
  }

  get busy() {
    return Boolean(this.current) || this.queue.length > 0;
  }

  /**
   * Enfileira uma fala: um nome ou uma frase (lista de nomes tocados em sequência).
   * `interrupt` corta a atual (pedestre).
   */
  say(names, { interrupt = false } = {}) {
    if (!this.enabled) return;
    const list = [].concat(names).filter((name) => this.has(name));
    if (!list.length) return;
    const key = list.join('+');
    const item = { names: list, key, at: performance.now(), keep: list.some((name) => KEEP.has(name)) };
    if (interrupt) {
      this.stop();
      this.queue.unshift(item);
    } else {
      if (this.queue.some((queued) => queued.key === key)) return;
      this.queue.push(item);
    }
    if (!this.current) this.next();
  }

  stop() {
    this.queue = [];
    if (this.current) {
      const audio = this.current.audios[this.current.index];
      this.current = null;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    }
  }

  /** Um clipe terminou (ou falhou): segue a frase atual ou passa para a próxima fala. */
  advance(audio) {
    const current = this.current;
    if (!current || current.audios[current.index] !== audio) return;
    current.index += 1;
    if (current.index < current.audios.length) this.playCurrent();
    else this.next();
  }

  playCurrent() {
    const audio = this.current.audios[this.current.index];
    audio.currentTime = 0;
    audio.play().catch(() => this.advance(audio));   // ainda bloqueado: segue
  }

  next() {
    this.current = null;
    const now = performance.now();
    while (this.queue.length) {
      const item = this.queue.shift();
      if (!item.keep && now - item.at > MAX_WAIT_MS) continue;
      // Nunca a mesma frase duas vezes seguidas (o alerta de pedestre é a exceção)
      const phrase = item.names.filter((name) => name !== 'then').join('+');
      if (phrase === this.lastKey && !item.names.includes('pedestrian')) continue;
      this.lastKey = phrase;
      const clips = PACKS[this.pack].clips;
      const audios = item.names.map((name) => {
        const files = clips[name];
        return this.audio[this.pack][Array.isArray(files) ? pickOne(files) : files];
      });
      this.current = { audios, index: 0 };
      this.playCurrent();
      return;
    }
  }
}
