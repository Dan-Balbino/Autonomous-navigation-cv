import { FaceEngine } from "./core/FaceEngine.js";

async function loadConfig() {
  const primaryUrl = "./src/config/faceConfig.json";
  const fallbackUrl = "./config/faceConfig.json";
  let response = await fetch(primaryUrl);
  if (!response.ok) {
    response = await fetch(fallbackUrl);
  }
  if (!response.ok) {
    throw new Error("Falha ao carregar o config JSON.");
  }
  const text = await response.text();
  // Remove comentários de linha (//) e comentários de bloco (/* */)
  const cleaned = text
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove comentários de bloco
    .replace(/\/\/.*$/gm, ''); // Remove comentários de linha
  return JSON.parse(cleaned);
}

async function start() {
  const root = document.getElementById("app");
  try {
    const config = await loadConfig();
    const engine = new FaceEngine(root, config);
    engine.start();
  } catch (error) {
    if (root) {
      root.textContent = "Falha ao carregar configuração. Redirecionando...";
    }
    const redirectUrl = "/?build=required";
    setTimeout(() => {
      window.location.replace(redirectUrl);
    }, 500);
  }
}

start();

