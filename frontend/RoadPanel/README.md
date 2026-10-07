# RoadPanel — mapa 3D da pista

Painel no estilo do mapa de navegação dos carros BYD/Tesla: a pista em 3D, o carro e a
trajetória da missão (coleta → entrega) em azul. Roda em celular, tablet e computador.

## Como abrir

- **Com o carro / servidor:** `http://<ip-do-carro>:5000/road/`, ou o botão **Abrir mapa da
  pista** no painel web (aba "Conexão e registros"). Lê `/api/vehicle_info` da mesma origem.
- **Sem o carro:** `python tests/simulate_dashboard.py` e abra `http://127.0.0.1:5000/road/`.
- **Só a pasta:** `python -m http.server 8020` dentro de `frontend/RoadPanel/` (fica em simulação;
  `?apiBase=http://host:5000/api` aponta para um servidor).

## Missão (rota)

Vem do código em tempo real: `hud.route` (espelho de `nav.route` em `core/navigation.py`),
em qualquer formato (`"A → C"`, `["A","C"]`, vazio). O 1º ponto é a **coleta**, o 2º a
**entrega**. O painel mostra o texto recebido e o progresso.

Circulação: todas as faixas são de mão dupla (não existe sentido único na pista). A trajetória
vai pelo menor caminho até cada ponto, sem retorno em U, e volta à largada pelo caminho mais
curto. Rota vazia = volta externa.

## Ligação com o carro (modo ao vivo)

Tudo vem de `/api/vehicle_info`, que o `main.py` já publica; nada fora desta pasta foi alterado.

| Dado | Origem no código | Uso no mapa |
|---|---|---|
| `hud.route` | `nav.route` (core/navigation.py) | missão; quando a lista encolhe, o ponto foi confirmado |
| `hud.right_detour_active` | detector de placas | marco de posição na placa de desvio + contador de desvios |
| `hud.traffic_light_code` | detector de placas | semáforo aceso na cena + marco de posição |
| `hud.stop_active` | detector de placas | marco de posição na placa PARE |
| `telemetry.speed` (média de `speed1..4`) | core/telemetry.py | odometria (anda a posição) |
| `command.speed` (PWM), `command.run` | core/car.py | odometria reserva (debug: m/s por PWM) e parado/andando |
| `telemetry.left/f_left/f_right/right` | ultrassônicos | setores no chão em volta do carro (azul, âmbar, vinho) |
| `command.servo`, bateria, modo | hud / telemetria | rodapé |

**Trajetória "Lógica do carro"** (padrão): reproduz as decisões do código real. Em cada placa
de desvio o carro usa `lane_guide_map` (A: direita; B: esquerda, direita; C: esquerda,
esquerda) e o contador zera quando o ponto é confirmado, como em `Navigation.update_lane()`.
Se mudar o `lane_guide_map` no Python, mude também `LANE_GUIDE_MAP` em `src/track/carLogic.js`.
"Menor caminho" fica no debug como referência.

**Posição** (`src/track/localizer.js`): não há GPS. A posição anda pela velocidade das rodas e
é corrigida em cada detecção (desvio, semáforo, PARE, ponto confirmado). Ela espera em cada
placa de desvio e no ponto-alvo até o carro detectar; se o carro passar sem detectar, libera
depois de ~1 m. O rodapé mostra a última referência usada. A escala (m por px) no debug
precisa bater com a pista real para a odometria ficar boa.

## Atalhos e ferramentas

| Tecla / botão | O que faz |
|---|---|
| **Simulação / Modo real** (topo, à direita) | No modo real o carro só anda com o que chega do servidor; começa na largada |
| **Topo / Carro** (V) | Alterna entre a vista de topo e a perseguição |
| **Tela cheia** (F) | Tela inteira (não aparece no iPhone, que não permite em páginas) |
| **Placas** (E) | Editor 2D: arraste placas e semáforo; salvar recarrega a cena 3D |
| **Debug** (D) | Fonte (servidor/simulação), missão simulada, velocidade, semáforo, câmera, .glb do carro, escala |
| 1 / 2 / 3 | Câmera: perseguição / de cima / livre |
| Espaço | Pausa a simulação |

Posições das placas: edição salva no navegador > `src/config/signs.json` > padrão em
`src/track/trackData.js`. O editor exporta o JSON para fixar no projeto.

## Arquivos

- `src/track/` — geometria medida da pista, rede (grafo com mão dupla) e planejador da missão
- `src/scene/` — pista e malha de pontos, placas, carro, fita, câmera
- `models/car.glb` — carro real usado na cena, gerado de `3DModel/base_basic_pbr.glb` por
  `python tools/optimize_car.py` (texturas 1024 px em JPEG: 10,1 MB → 1,9 MB). Ao trocar o
  modelo, rode o script de novo; se a frente sair invertida, ajuste `CAR_MODEL_YAW` em `src/main.js`.
  O debug ainda aceita outro `.glb` para teste.
- `src/ui/` — HUD, debug, editor de placas, tela de carregamento
- `src/data/carLink.js` — leitura tolerante do servidor
- `DESIGN.md` — sistema visual do painel
