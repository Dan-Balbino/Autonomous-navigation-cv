---
name: APEX RoadPanel
description: Mapa 3D diurno da pista no estilo dos painéis de navegação BYD/Tesla
colors:
  sky: "#f3f5f9"
  sky-horizon: "#e4e9f1"
  field: "#eef1f5"
  lane: "#d9dee6"
  island: "#fbfcfd"
  track-line: "#14181f"
  dot: "#2f7bff"
  ink: "#0e1726"
  ink-2: "#3d4b62"
  ink-3: "#5b6a82"
  route: "#2f7bff"
  route-edge: "#1546b8"
  route-strong: "#1f5fd8"
  route-strong-hover: "#2a6be6"
  live: "#0f8a52"
  sim: "#a85f00"
  stop: "#c4122f"
  panel: "rgba(255, 255, 255, 0.88)"
  panel-line: "rgba(14, 23, 38, 0.1)"
  live-dot: "#12b36a"
  lamp-red: "#e5132b"
  lamp-yellow: "#f2a100"
  lamp-green: "#0fae68"
  black: "#000"
typography:
  speed:
    fontFamily: "Saira, system-ui, sans-serif"
    fontSize: "clamp(40px, 5.2vw, 76px)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
  distance:
    fontFamily: "Saira, system-ui, sans-serif"
    fontSize: "clamp(26px, 2.2vw, 34px)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Saira, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.3
  clock:
    fontFamily: "Saira, system-ui, sans-serif"
    fontSize: "clamp(18px, 1.6vw, 24px)"
    fontWeight: 500
    lineHeight: 1
  metric:
    fontFamily: "Saira, system-ui, sans-serif"
    fontSize: "clamp(16px, 1.3vw, 20px)"
    fontWeight: 600
    lineHeight: 1.2
  unit:
    fontFamily: "Saira, system-ui, sans-serif"
    fontSize: "clamp(12px, 0.9vw, 14px)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.14em"
  heading:
    fontFamily: "Saira, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.2
  subheading:
    fontFamily: "Saira, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.2
  maneuver-compact:
    fontFamily: "Saira, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.05
  route-letter:
    fontFamily: "Saira, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1
  small:
    fontFamily: "Saira, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
  caption:
    fontFamily: "Saira, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.45
  micro:
    fontFamily: "Saira, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.06em"
  micro-compact:
    fontFamily: "Saira, system-ui, sans-serif"
    fontSize: "9px"
    fontWeight: 600
    lineHeight: 1.2
  label:
    fontFamily: "Saira, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.12em"
rounded:
  hairline: "2px"
  focus: "6px"
  tiny: "4px"
  segment: "7px"
  segmented: "10px"
  map: "12px"
  control: "8px"
  chip: "9px"
  panel: "14px"
  drawer: "16px"
  pill: "999px"
spacing:
  gutter: "clamp(14px, 2.4vw, 36px)"
  panel-x: "20px"
  panel-y: "18px"
  control-gap: "8px"
components:
  button-primary:
    backgroundColor: "{colors.route-strong}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  button-primary-hover:
    backgroundColor: "{colors.route-strong-hover}"
  route-point-current:
    backgroundColor: "{colors.route-strong}"
    textColor: "#ffffff"
    rounded: "{rounded.chip}"
    size: "36px"
  guide-panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
    padding: "18px 20px"
---

# Design System: APEX RoadPanel

## Overview

O painel é o mapa de condução de um BYD, em versão diurna, aplicado à pista do carro APEX: câmera de perseguição atrás e acima do carro, pista clara com linhas pretas e ilhas brancas, um campo branco/cinza com malha de pontos azuis "semi vivos" (faixas de luz passando) e uma única fita azul no asfalto, que é a missão (coleta → entrega) esperada. O HUD fica sobre a cena em tinta escura; o único painel sólido é o guia de manobra e missão, à esquerda.

A verdade do dado é uma regra visual: a origem (Ao vivo, Simulação, Sem sinal) está sempre no topo, a simulação usa âmbar e nunca verde, a missão mostra o texto recebido do código, e no modo ao vivo aparece o aviso de que a posição é estimada.

## Colors

### Primary
- **Route** `#2f7bff` com borda `#1546b8`: a fita da missão na cena 3D e os pontos da malha.
- **Route strong** `#1f5fd8`: controles preenchidos com texto branco (botão principal, seleção ativa, ponto atual). Dá 5,7:1 com branco.

### Neutral
- **Sky** `#f3f5f9` → **sky horizon** `#e4e9f1`: céu em gradiente; a névoa termina no horizonte.
- **Field** `#eef1f5` com pontos `dot`: campo em volta da pista (shader).
- **Lane** `#d9dee6`, **island** `#fbfcfd`, **track line** `#14181f`: faixas cinza claro, ilhas brancas elevadas, linhas pretas.
- **Ink** `#0e1726`, **ink-2** `#3d4b62`, **ink-3** `#5b6a82`: texto principal, secundário e rótulos (tinta azulada, não cinza puro).

### Named Rules
**Fonte do dado tem cor própria.** Verde `live` `#0f8a52` só para dado real do servidor; âmbar `sim` `#a85f00` para simulação e para o debug; vermelho `stop` para sem sinal. A simulação nunca usa verde.

**Placas usam as cores reais.** PARE em vermelho de placa, desvio em âmbar `#f2b705`, pontos A/B/C em branco; zonas dos sensores e semáforo usam as cores físicas do objeto.

## Typography

Uma família: **Saira** variável (peso 300–700, largura 75–100%), autohospedada em `fonts/`, com algarismos tabulares em toda a página.

### Hierarchy
- **Speed** (600, até 76px): a velocidade no topo central, o maior elemento do HUD.
- **Distance** (600, até 34px): distância até a próxima manobra.
- **Body** (400, 15px): rótulo da manobra e textos do debug.
- **Label** (600, 12px, largura 85%, caixa alta, tracking 0,12em): rótulos de métrica, títulos de seção do debug e origem do dado.

## Layout

A cena 3D ocupa a tela inteira. O HUD se ancora nas bordas com o gutter fluido: topo em grade de três colunas (hora, velocidade, estado), guia à esquerda, métricas centralizadas no rodapé e o botão de debug no canto inferior direito. Abaixo de 760px o guia vira uma faixa compacta (manobra + pontos da rota) logo abaixo da velocidade, para não cobrir o carro.

## Elevation & Depth

A profundidade vive na cena: perspectiva, névoa clara no horizonte, ilhas elevadas, o carro real (modelo PBR com as texturas próprias, azul-marinho) e sombra de contato (textura radial) sob ele; sem sombras dinâmicas nem luzes pontuais (FPS). No HUD, painéis brancos com borda `panel-line` e sombra azulada suave; editor e gaveta com sombra maior.

## Shapes

Painel do guia 14px, gaveta 16px, controles 8px, pontos da rota 9px, cápsulas (debug, semáforo) arredondadas por completo. As linhas dos sensores e da pista são traços contínuos; a fita da rota não tem cantos.

## Components

### Buttons
Primário em `route-strong` com texto branco; secundários transparentes com borda `panel-line` e preenchimento `control` no hover. Controles segmentados (fonte do dado, semáforo, câmera) com a opção ativa em `route-strong`.

### Guia de manobra e rota (signature)
Ícone SVG desenhado (traço 3,2, pontas redondas) + distância grande + rótulo. Abaixo, os pontos da rota como quadrados de 34px ligados por traços de 2px: concluídos com check verde, atual em `route-strong`, pendentes neutros. A troca de manobra anima de opacidade 0,6 para 1 em 0,45s com ease-out exponencial.

### Malha de pontos (signature)
Shader no chão: pontos azuis em grade de 0,46 unidade, base apagada (22%) e faixas de luz em três direções que acendem os pontos. Custo de uma malha só.

### Fita da rota (signature)
Geometria construída uma vez por missão; por quadro só o uniform da posição do carro anda (apaga atrás, esmaece à frente em 34 unidades). Corpo translúcido, bordas em `route-edge`, pulsos discretos e acendimento a partir do carro em 1,1 s quando a missão muda.

## Do's and Don'ts

### Do:
- Mostrar sempre a origem do dado e marcar a posição estimada no modo ao vivo.
- Ler a rota em qualquer formato que o servidor mande e tratar rota vazia como volta externa.
- Usar `route-strong` (não `route`) em qualquer fundo com texto branco.
- Manter ícones como SVG desenhado no mesmo traço.

### Don't:
- Não usar verde para a simulação nem para nada que não seja dado real.
- Não colocar halos coloridos (box-shadow de cor) no HUD; a luz pertence à cena 3D (malha de pontos).
- Não usar glifos Unicode ou emoji no lugar de ícones.
- Não cobrir o carro com o HUD em nenhuma largura de tela.
