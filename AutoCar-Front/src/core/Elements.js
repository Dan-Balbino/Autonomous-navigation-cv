import { createEl } from "../utils/dom.js";

export function createFaceElements() {
  const stage = createEl("section", "stage");
  const eyeLeft = createEl("div", "eye eye-left");
  const eyeRight = createEl("div", "eye eye-right");
  
  // Elementos dos óculos (aparecem apenas durante a animação de squint)
  const glassesContainer = createEl("div", "glasses-container");
  const glassesLeft = createEl("div", "glasses-frame glasses-left");
  const glassesRight = createEl("div", "glasses-frame glasses-right");
  const glassesBridge = createEl("div", "glasses-bridge");
  const glassesBridgeNose = createEl("div", "glasses-bridge-nose"); // Curvatura do nariz no centro
  
  glassesContainer.appendChild(glassesLeft);
  glassesContainer.appendChild(glassesBridge);
  glassesContainer.appendChild(glassesBridgeNose);
  glassesContainer.appendChild(glassesRight);

  // Container para linhas de velocidade (aparecem apenas durante animação de acelerar)
  const speedLinesContainer = createEl("div", "speed-lines-container");
  
  stage.appendChild(eyeLeft);
  stage.appendChild(eyeRight);
  stage.appendChild(glassesContainer);
  stage.appendChild(speedLinesContainer);

  return {
    stage,
    eyeLeft,
    eyeRight,
    glassesContainer,
    glassesLeft,
    glassesRight,
    glassesBridge,
    glassesBridgeNose,
    speedLinesContainer,
  };
}

