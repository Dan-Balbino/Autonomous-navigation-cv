/**
 * Configuracao da API de emocoes.
 * Prioridade:
 * 1) querystring (?apiBase=http://host:porta/api)
 * 2) querystring (?apiHost=127.0.0.1&apiPort=8000)
 * 3) host atual + porta 8000
 */

function getParam(name) {
  try {
    const v = new URLSearchParams(window.location.search).get(name);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

function normalizeBase(url) {
  return url.replace(/\/+$/, "");
}

function buildApiBaseUrl() {
  const explicitBase = getParam("apiBase");
  if (explicitBase) {
    return normalizeBase(explicitBase) + "/emotions";
  }

  const apiHost = getParam("apiHost") || window.location.hostname || "127.0.0.1";
  const apiPort = getParam("apiPort") || "8000";
  return `http://${apiHost}:${apiPort}/api/emotions`;
}

export const API_BASE_URL = buildApiBaseUrl();
