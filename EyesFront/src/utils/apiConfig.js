/**
 * Configuracao da conexao com o carro.
 *
 * Os olhos leem o estado do objeto `car` (car.command + car.telemetry) publicado
 * pelo servidor Flask de messaging/messaging_core.py em GET /api/vehicle_info.
 *
 * Prioridade para montar a URL:
 * 1) querystring (?apiBase=http://host:porta/api)
 * 2) querystring (?apiHost=127.0.0.1&apiPort=5000)
 * 3) host atual + porta 5000 (DASHBOARD_PORT do main.py)
 *
 * Flags extras:
 * - ?demo=1  -> usa um carro simulado (nao precisa do main.py rodando)
 * - ?debug=1 -> mostra o estado do carro junto do contador de FPS
 */

const DEFAULT_API_PORT = "5000";

function getParam(name) {
  try {
    const v = new URLSearchParams(window.location.search).get(name);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

function isEnabled(name) {
  const value = getParam(name);
  return value === "1" || value === "true";
}

function normalizeBase(url) {
  return url.replace(/\/+$/, "");
}

function buildApiBaseUrl() {
  const explicitBase = getParam("apiBase");
  if (explicitBase) {
    return normalizeBase(explicitBase);
  }

  const apiHost = getParam("apiHost") || window.location.hostname || "127.0.0.1";
  const apiPort = getParam("apiPort") || DEFAULT_API_PORT;
  return `http://${apiHost}:${apiPort}/api`;
}

export const API_BASE_URL = buildApiBaseUrl();
export const VEHICLE_INFO_URL = `${API_BASE_URL}/vehicle_info`;
export const DEMO_MODE = isEnabled("demo");
export const DEBUG_MODE = isEnabled("debug");
