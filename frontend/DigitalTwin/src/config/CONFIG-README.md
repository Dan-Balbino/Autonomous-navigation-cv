# Configurações do Digital Twin (`proximity-config.json`)

O arquivo aceita comentários `//` (o Digital Twin remove antes de ler).

## Escala

No modo horizontal, as distâncias e comprimentos dos sensores são **pixels para o carro
com altura `alturaReferenciaCarro`** (a altura natural de `assets/AutoCar Model.png`).
Quando a tela é menor e o carro encolhe, tudo escala junto, mantendo a posição relativa.

> Trocou a imagem do carro? Atualize `alturaReferenciaCarro` para a altura da imagem nova e
> reajuste as distâncias dos sensores, porque o formato da frente muda.

No modo vertical as ondas dos sensores ficam ocultas; as chaves `*Vertical` não têm efeito hoje.

## Gerais

| Chave | O que faz |
|---|---|
| `espessuraLinhas` | Espessura de cada linha (LED) dos sensores, em px |
| `alturaReferenciaCarro` | Altura do carro (px) em que os valores dos sensores valem |
| `ajusteCentroVertical` | Desloca os três sensores na vertical quando o carro não está centralizado no PNG (fração da altura do carro; negativo = para cima) |
| `distanciaTravarVermelho` | Abaixo desta distância só a primeira linha acende, fixa em vermelho |
| `velocimetroRangeMax` / `velocimetroVelocidadeInicial` | Escala do velocímetro |
| `velocimetroSuavizacaoPorSegundo` | Suavização do ponteiro do velocímetro |
| `diametro_roda`, `relacao_reducao`, `motor_rpm_max` | Conversões de velocidade/RPM |
| `rodasVelocidadeMax` | Velocidade (m/s) que enche a barra da telemetria das rodas |

## Sensores frontais

Há três sensores: `SFPS_` (ponta superior), `SFCI_` (centro) e `SFPI_` (ponta inferior).
As pontas ficam a ±36% da altura do carro a partir do centro; o centro fica na altura do centro.

| Sufixo | O que faz |
|---|---|
| `_quantidade` | Número de linhas (camadas) do sensor |
| `_distancia` | Distância do **centro do carro** até a primeira linha (px). Aumente para afastar do carro |
| `_espacamento` | Distância entre uma linha e a próxima (px) |
| `_comprimento` | Comprimento da primeira linha (px) |
| `_crescimento` | Quanto cada linha seguinte fica mais longa (px por linha) |
| `_curvatura` | Curvatura do arco: 0 = reta, 100 = curva forte |
| `_rotacao` | Inclinação do sensor em graus (as pontas giram para contornar os cantos) |
| `_alcance` | Alcance de detecção (px); define quantas linhas acendem por distância |

Cores ao detectar: azul `#2f78d4` (longe), âmbar `#ffa41b` (médio) e vermelho vinho `#861a36` (perto).
Elas ficam em `getSensorZoneColor()` de `proximityWaves.js`; a telemetria das rodas usa os mesmos tons
(`.wheel-seg.seg-*` em `styles.css`).

## Como ajustar a posição

1. Rode `python tests/simulate_dashboard.py --sem-sensores` e abra `http://127.0.0.1:5000/`.
2. Edite o JSON e recarregue a página (o arquivo é lido sem cache).
3. Sensor em cima do carro: aumente `_distancia`. Pontas encostando no centro: diminua
   `SFCI_comprimento` ou aumente `_rotacao` das pontas. Linhas coladas: aumente `_espacamento`.

## Adicionando uma chave nova

O Digital Twin só lê as chaves que existem em `getDefaultConfig()` de
`src/js/modules/proximityWaves.js`; as demais são ignoradas em silêncio. Ao criar uma
configuração nova, registre também um valor padrão lá.

## Seção legado

As chaves `ST_` (sensor traseiro) não são usadas pelo Digital Twin atual.
