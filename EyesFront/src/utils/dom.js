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

