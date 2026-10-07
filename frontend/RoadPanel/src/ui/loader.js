/**
 * Tela de carregamento (já desenhada no HTML, antes de qualquer JS pesado).
 * main.js avança as etapas; some com fade depois do primeiro quadro renderizado.
 */
const root = document.getElementById('loader');
const bar = document.getElementById('loaderBar');
const text = document.getElementById('loaderText');

export const loader = {
  step(message, progress) {
    if (!root) return;
    text.textContent = message;
    bar.style.transform = `scaleX(${Math.max(0.05, Math.min(1, progress))})`;
  },
  done() {
    if (!root) return;
    this.step('Pronto', 1);
    root.classList.add('is-done');
    root.addEventListener('transitionend', () => root.remove(), { once: true });
    setTimeout(() => root.remove(), 1200);
  },
  fail(message) {
    if (!root) return;
    root.classList.add('is-error');
    text.textContent = message;
  },
};

// Erros antes do primeiro quadro (ex.: WebGL indisponível) aparecem na tela de carregamento
window.addEventListener('error', (event) => {
  if (!document.getElementById('loader')) return;
  const webgl = /webgl|context/i.test(String(event.message));
  loader.fail(webgl
    ? 'Este aparelho não conseguiu iniciar o 3D (WebGL). Tente outro navegador ou ative a aceleração de hardware.'
    : `Não foi possível abrir o mapa: ${event.message}`);
});
