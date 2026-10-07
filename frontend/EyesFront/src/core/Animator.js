export class Animator {
  constructor() {
    this.animations = new Map();
    this.isRunning = false;
    this.lastTime = 0;
    this.tick = this.tick.bind(this);
  }

  add(key, fn) {
    this.animations.set(key, fn);
  }

  remove(key) {
    this.animations.delete(key);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  stop() {
    this.isRunning = false;
  }

  tick() {
    if (!this.isRunning) return;
    // Usa o mesmo relógio dos gatilhos (performance.now): o timestamp do rAF pode
    // ficar atrás deles e gerar tempos decorridos negativos nas animações
    const now = performance.now();
    const delta = Math.max(0, Math.min(64, now - this.lastTime));
    this.lastTime = now;
    this.animations.forEach((fn) => fn(now, delta));
    requestAnimationFrame(this.tick);
  }
}

