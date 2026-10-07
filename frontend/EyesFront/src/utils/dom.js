export function createEl(tag, className, attrs = {}) {
  const el = document.createElement(tag);
  if (className) {
    el.className = className;
  }
  Object.entries(attrs).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      el.setAttribute(key, value);
    }
  });
  return el;
}

export function setStyles(el, styles) {
  Object.entries(styles).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      el.style[key] = value;
    }
  });
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Aproxima `current` de `target` com suavizacao exponencial independente de FPS.
 * @param {number} rate - velocidade em 1/s (maior = chega mais rapido)
 * @param {number} deltaMs - tempo do frame em milissegundos
 */
export function approach(current, target, rate, deltaMs) {
  const k = 1 - Math.exp(-rate * (deltaMs / 1000));
  return current + (target - current) * k;
}

/** Curva ease-in-out quadratica (0..1 -> 0..1). */
export function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

