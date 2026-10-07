import { lerp, easeInOut } from "../utils/dom.js";

const SPECIAL_BLINK_MS = 220;
const CLOSE_SHARE = 0.35; // a palpebra fecha rapido e abre mais devagar

/**
 * Curva de uma piscada: 0..1 de progresso -> escala vertical do olho.
 */
function blinkCurve(progress, minScale) {
  let closed;
  if (progress < CLOSE_SHARE) {
    const t = progress / CLOSE_SHARE;
    closed = t * t;
  } else {
    const t = (progress - CLOSE_SHARE) / (1 - CLOSE_SHARE);
    closed = 1 - easeInOut(t);
  }
  return lerp(1, minScale, closed);
}

/**
 * Executa uma piscada agendada (apos surpresa, durante procurar).
 * Retorna true enquanto ela estiver em andamento.
 */
function runSpecialBlink(state, key, now, minScale) {
  const startedAt = state[key];
  if (!startedAt || now < startedAt) return false;
  const progress = (now - startedAt) / SPECIAL_BLINK_MS;
  if (progress < 1) {
    state.blinkScale = blinkCurve(progress, minScale);
    return true;
  }
  state[key] = null;
  return false;
}

function scheduleNextBlink(state, now, intervalMs, sleepy) {
  // Intervalo irregular (55%..145% da media) para nao parecer mecanico
  const jitter = 0.55 + Math.random() * 0.9;
  state.nextBlinkAt = now + intervalMs * jitter * (1 - sleepy * 0.3);
}

/**
 * Animacao de piscar dos olhos
 * @param {Object} config - Configuracao da animacao blink
 * @param {Object} state - Estado da animacao (blinkScale sera atualizado)
 * @param {number} now - Timestamp atual
 */
export function animateBlink(config, state, now) {
  const { intervalMs = 5000, minScale = 0.08, durationMs = 220, doubleBlinkChance = 0.2 } = config;
  const sleepy = state.moodSleepy || 0;

  // Piscar depois da surpresa encerra o ciclo da surpresa
  if (state.postSurpriseBlinkTime && now >= state.postSurpriseBlinkTime) {
    if (runSpecialBlink(state, "postSurpriseBlinkTime", now, minScale)) return;
    state.surpriseEndTime = null;
    state.surpriseStartTime = null;
  }

  if (runSpecialBlink(state, "searchBlinkRightTime", now, minScale)) return;
  if (runSpecialBlink(state, "searchBlinkLeftTime", now, minScale)) return;

  // Durante procurar os olhos ficam abertos (exceto nas piscadas acima)
  if (state.searchStartTime) {
    state.blinkScale = 1;
    return;
  }

  // O susto controla a abertura dos olhos sozinho
  if (state.frightStartTime) {
    return;
  }

  if (state.nextBlinkAt === undefined) {
    scheduleNextBlink(state, now, intervalMs, sleepy);
  }

  if (state.blinkStartAt == null && now >= state.nextBlinkAt) {
    state.blinkStartAt = now;
    // Com sono a piscada fica lenta e pesada
    state.blinkDurationMs = durationMs * (1 + sleepy * 1.5);
  }

  if (state.blinkStartAt != null) {
    const progress = (now - state.blinkStartAt) / state.blinkDurationMs;
    if (progress < 1) {
      state.blinkScale = blinkCurve(progress, minScale);
      return;
    }
    state.blinkStartAt = null;
    if (!state.blinkIsDouble && Math.random() < doubleBlinkChance) {
      state.blinkIsDouble = true;
      state.nextBlinkAt = now + 110;
    } else {
      state.blinkIsDouble = false;
      scheduleNextBlink(state, now, intervalMs, sleepy);
    }
  }

  state.blinkScale = 1;
}
