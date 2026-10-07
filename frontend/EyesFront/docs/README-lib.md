# FaceEngine — documentação da lib

Biblioteca local (sem dependências) para renderizar um rosto animado em HTML/CSS
com controle por JSON.

## Instalação
Não requer instalação. Basta servir o projeto em um servidor local e importar o
`FaceEngine` em `src/main.js`.

## Uso básico
```js
import { FaceEngine } from "./core/FaceEngine.js";

async function start() {
  const root = document.getElementById("app");
  const response = await fetch("./src/config/faceConfig.json");
  const config = await response.json();
  const engine = new FaceEngine(root, config);
  engine.start();
}

start();
```

## API principal
### `new FaceEngine(root, config)`
Cria a instância do motor do rosto.

Parâmetros:
- `root`: elemento DOM onde o rosto será inserido.
- `config`: objeto com cores e animações.

### `engine.start()`
Inicia a renderização e o loop de animação.

## Formato do JSON
Arquivo recomendado: `src/config/faceConfig.json`.

```json
{
  "scale": 1.2,
  "colors": {
    "background": "#ffffff",
    "face": "#ffffff",
    "stroke": "#0f0f0f",
    "strokeSoft": "#1a1a1a",
    "accent": "#0a0a0a"
  },
  "eyes": {
    "ovality": 5,
    "width": 38,
    "height": 42,
    "spacing": 28,
    "position_y": 55
  },
  "animations": {
    "blink": {
      "enabled": true,
      "intervalMs": 10000,
      "minScale": 0.08
    },
    "look": {
      "enabled": true,
      "durationMs": 4200,
      "radius": 3,
      "smoothness": 0.18
    },
    "bob": {
      "enabled": true,
      "durationMs": 400,
      "y": 5,
      "rotate": 3,
      "directionLeft": 180,
      "directionRight": 0
    },
    "surprise": {
      "enabled": true,
      "maxScale": 1.4,
      "expandDuration": 600,
      "holdDuration": 2000,
      "shrinkDuration": 400
    },
    "squint": {
      "enabled": true,
      "durationMs": 8000,
      "horizontalAmplitude": 8,
      "verticalAmplitude": 4,
      "diagonalAmplitude": 3,
      "squintScale": 0.85
    },
    "search": {
      "enabled": true,
      "speed": 1.5,
      "distance": 70,
      "direction": 1,
      "movementDurationMs": 400,
      "pauseDurationMs": 1000,
      "autoIntervalMs": 40000,
      "autoAfterIdleMs": 20000
    },
    "fright": {
      "enabled": true,
      "maxScale": 1.4,
      "expandDuration": 300,
      "shrinkDuration": 200,
      "trembleDuration": 800,
      "eyeOpenDuration": 600,
      "eyeCloseDuration": 300,
      "eyeOpenFullDuration": 400
    }
  }
}
```

## Módulos internos
- `src/core/Animator.js`: loop de animação via `requestAnimationFrame`.
- `src/core/Elements.js`: cria o DOM do rosto.
- `src/core/FaceEngine.js`: motor principal que gerencia animações e estado.
- `src/utils/dom.js`: utilitários `createEl`, `setStyles`, `lerp`, `clamp`.
- `src/animations/`: módulos de animação individuais:
  - `blink.js`: animação de piscar
  - `look.js`: animação de olhar ao redor
  - `bob.js`: animação de flutuação (sobe e desce)
  - `surprise.js`: animação de surpresa (olhos aumentam)
  - `squint.js`: animação de tentar enxergar (com óculos)

## Comandos de Teclado

O FaceEngine suporta comandos de teclado para acionar animações especiais:

- **`s` (3x rapidamente)**: Aciona a animação de **surpresa** (olhos aumentam como slimes)
  - Pressione a tecla 's' três vezes em menos de 500ms para ativar
  - A animação executa automaticamente e retorna ao normal

- **`e` (3x rapidamente)**: Aciona/desativa a animação de **tentar enxergar** (squint)
  - Pressione a tecla 'e' três vezes em menos de 500ms para ativar
  - Pressione 'e' três vezes novamente para desativar
  - Durante a animação, os olhos aparecem com óculos e fazem movimentos de leitura

- **`p` (3x rapidamente)**: Aciona a animação de **procurar** (search)
  - Pressione a tecla 'p' três vezes em menos de 500ms para ativar manualmente
  - Os olhos olham rapidamente para os lados (primeiro um lado, depois o outro)
  - Também é acionada automaticamente:
    - Após 20 segundos de idle (olhos apenas flutuando e piscando)
    - A cada 40 segundos durante o idle

- **`f` (3x rapidamente)**: Aciona a animação de **susto** (fright)
  - Pressione a tecla 'f' três vezes em menos de 500ms para ativar
  - Os olhos aumentam rapidamente (como surpresa), diminuem e fecham
  - Os olhos tremem com medo (olhos fechados)
  - Um olho (esquerdo) se abre devagar, fecha novamente, e abre completamente
  - O outro olho (direito) se abre em seguida
  - Após terminar, a animação de procurar é reproduzida automaticamente
  - Durante o susto, as piscadas normais e a animação de procurar automática são desabilitadas

- **`a` (3x rapidamente)**: Ativa/desativa a animação de **acelerar** (accelerate)
  - Pressione a tecla 'a' três vezes em menos de 500ms para ativar
  - Pressione 'a' três vezes novamente para desativar
  - Os olhos ficam meio fechados como se o rosto estivesse enfrentando alta velocidade
  - A transição de ativação/desativação é suave

## Personalização
Sugestões:
- Aumentar `radius` para olhar mais expressivo.
- Ajustar `minScale` no `blink` para fechar mais os olhos.
- Alterar `strokeSoft` para reduzir/acentuar detalhes.
- Ajustar `squintScale` para controlar o quanto os olhos ficam semicerrados durante a animação de enxergar.


