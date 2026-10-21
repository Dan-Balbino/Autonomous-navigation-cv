/**
 * Fumaça verde nas bordas da tela quando a bateria começa a carregar (2 s).
 *
 * Desempenho: o ruído, a máscara das bordas e o desfoque são "assados" UMA vez numa imagem
 * pequena (canvas de baixa resolução esticado = desfoque grátis). A animação mexe só em
 * transform/opacity das duas camadas, que o compositor faz sem repintar nem refiltrar.
 */
const W = 192;
const H = 108;
const GREEN = [18, 217, 122];   // COLORS.charge

function hash(x, y, seed) {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function valueNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let fx = x - xi;
  let fy = y - yi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Imagem da fumaça: ruído fractal verde, só nas bordas, com brilho na moldura. */
function bake(seed) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Distância elíptica ao centro (0 no meio, ~1 nos cantos das bordas)
      const ex = (x / (W - 1)) * 2 - 1;
      const ey = (y / (H - 1)) * 2 - 1;
      const r = Math.hypot(ex / 0.92, ey / 0.88);
      const edge = Math.min(1, Math.max(0, (r - 0.5) / 0.5));
      if (edge <= 0) continue;
      let n = 0;
      let amp = 0.55;
      let freq = 0.045;
      for (let o = 0; o < 3; o++) {
        n += valueNoise(x * freq, y * freq, seed + o) * amp;
        amp *= 0.5;
        freq *= 2.1;
      }
      const smoke = Math.min(1, Math.max(0, (n - 0.28) * 1.9));
      const rim = edge * edge;                    // brilho contínuo colado na borda
      const alpha = Math.min(1, edge * edge * (0.25 + smoke * 0.75) + rim * 0.25);
      const i = (y * W + x) * 4;
      image.data[i] = GREEN[0];
      image.data[i + 1] = GREEN[1];
      image.data[i + 2] = GREEN[2];
      image.data[i + 3] = Math.round(alpha * 190);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

export class ChargeSmoke {
  constructor(element) {
    this.el = element;
    this.layers = element.querySelectorAll('.charge-smoke-layer');
    this.ready = false;
    element.addEventListener('animationend', (event) => {
      if (event.target === element) element.classList.remove('is-on');
    });
    // Assa fora do caminho crítico, para o primeiro disparo já estar pronto
    const prepare = () => this.prepare();
    if ('requestIdleCallback' in window) requestIdleCallback(prepare, { timeout: 3000 });
    else setTimeout(prepare, 1500);
  }

  prepare() {
    if (this.ready) return;
    this.ready = true;
    this.layers.forEach((layer, k) => { layer.style.backgroundImage = `url(${bake(11 + k * 29)})`; });
  }

  puff() {
    this.prepare();
    const { el } = this;
    el.classList.remove('is-on');
    void el.offsetWidth;
    el.classList.add('is-on');
  }
}
