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
em qualquer formato (`"A → B → C"`, `["A","B","C"]`, vazio). Na prova vêm 2 dos 3 pontos, na
ordem recebida: **coleta** no primeiro e **entrega** no último (ex.: A → C, sem passar por B).
Ao chegar em cada ponto, o mapa entra no **modo GPS** e traça a rota até o próximo ponto (ou
até a linha de chegada depois da entrega).

No ponto o carro fica parado e a tela inteira muda (sem voz): fundo desfocado azul (coleta) ou
verde (entrega), uma caixa 3D caindo na caçamba ou saindo dela, um dedo apertando o botão
vermelho e, em letras grandes no centro, **COLOQUE A CARGA** / **RETIRE A CARGA** + **E APERTE
O BOTÃO VERMELHO**. Com movimento reduzido no sistema a cena fica parada. Ele só segue quando:

- **Simulação:** o botão **Apertar botão RUN** do Debug (D) é tocado.
- **Modo real e visão real:** a telemetria mostra o botão RUN apertado (contador novo de
  `run_btn`). Como o `point_stop_latched` do `main.py`, também soltam: desligar e ligar o run,
  o controle remoto assumir (modo manual) ou o carro voltar a andar com PWM > 0.

## Voz e avisos

Sons em `sounds/` (cópia da pasta `sound/` do projeto; ao trocar um som lá, copie de novo).
A voz fala quase em cima de cada manobra (~0,9 s antes, no máximo ~1,2 m): curva suave à direita/esquerda, siga em frente,
ponto de coleta e ponto de entrega à frente. Também toca:

| Quando | Som |
|---|---|
| Carro começa a missão | `start-percurso` |
| Último ponto confirmado (encomenda entregue) | `mercado-livre-entrega` |
| Volta à linha de chegada depois da entrega ("Percurso finalizado") | `end-percurso` |
| Pessoa (`command.stop`) ou obstáculo crítico nos ultrassônicos da frente | `pedestre-detectado` + faixa vermelha |

O navegador só libera som depois do primeiro toque, clique ou tecla na página. Botão **Som**
(tecla M) liga e desliga. Na simulação, "Simular pedestre" no debug testa o aviso.

### Voz do Dilera

O botão **GPS / Dilera** (tecla G) troca as falas pelas de `sounds/dilera/`. A escolha fica
salva no navegador.

| Evento | Som |
| --- | --- |
| Carro começa a missão | `start_1` ou `start_2` (sorteado) |
| Chegou no ponto de coleta | `recalculando` |
| Entregou a carga | `cheguei` |
| Parou na PARE | `policia_1` ou `policia_2` (sorteado) |
| Parou no semáforo vermelho (vinha andando) | `radar_1` |
| Pedestre ou obstáculo crítico | `perigo_1` |
| Curva | `virar_dir` / `virar_esq`; logo depois da placa de desvio, `sair_dir` / `sair_esq` |
| Bifurcação em que segue reto | `mantem_esq` / `mantem_dir` (lado oposto ao da outra saída) |

Distâncias na escala da pista: **1 m de pista = 250 m de GPS** (1,5 km = 6 m, 400 m = 1,6 m,
200 m = 0,8 m). Cada manobra é falada **uma vez só**, no aviso mais distante cuja frase inteira
termina antes dela; se nenhum coube, fala só a manobra quase em cima dela. A voz nunca repete
a fala anterior: depois de "mantém à esquerda", a próxima "mantém à esquerda" seguida fica em
silêncio (o alerta de pedestre é a única exceção). Com a voz ocupada (ex.: "recalculando"), a frase seguinte entra emendada com `e_entao`,
e duas manobras a menos de 400 m (1,6 m) uma da outra viram "vire à direita e então vire à
esquerda".

Circulação: a pista inteira é de mão única, no sentido horário (faixa de cima para a direita,
corredores descendo, faixa de baixo para a esquerda, faixa da esquerda subindo). A trajetória
vai pelo menor caminho até cada ponto nesse sentido (dando mais voltas quando precisa) e
termina na linha de chegada. Rota vazia = volta externa.

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

**Trajetória "Caminho livre"** (padrão): o menor caminho que passa pelos pontos na ordem. O
carro não é obrigado a entrar em cada desvio e pode passar de novo pelo mesmo trecho, sempre no
sentido da pista (mão única). Funciona com as placas em qualquer posição.

**"Tabela do carro"** (debug): copia a tabela fixa `lane_guide_map` de `core/navigation.py`
(A: direita; B: esquerda, direita; C: esquerda, esquerda). Ela só acerta com as placas na
posição original; movendo placas ou a partida, quase sempre deixa pontos sem alcançar.

**Posição** (`src/track/localizer.js`): não há GPS. A posição anda pela velocidade das rodas e
é corrigida em cada detecção (desvio, semáforo, PARE, ponto confirmado). Ela espera em cada
placa de desvio e no ponto-alvo até o carro detectar; se o carro passar sem detectar, libera
depois de ~1,5 m. O rodapé mostra a última referência usada. A geometria segue as medidas oficiais
(20 645,7 × 10 858,3 mm; faixas entre ilhas 1 598,9 mm; faixas laterais 1 599,5 mm, entre os
centros das linhas). Os contornos foram medidos na imagem e reescalados por partes em
`toTrack()` (`src/track/trackData.js`); 1 px da pista = 2 cm.

## Prévia GPS na placa PARE

Quando o carro para na PARE (simulação: 3 s, igual ao `STOP_WAIT_SECONDS` do detector; modo
real: enquanto `hud.stop_active` estiver ligado), a câmera sobe e o mapa traça, como um GPS, o
caminho até a próxima placa (ponto, desvio, semáforo ou PARE; sem placa à frente, a largada).
Um alfinete marca a placa e o cartão mostra nome, distância, tempo estimado e quanto falta para
o carro seguir. Quando ele volta a andar, a câmera retorna para trás do carro.

## Atalhos e ferramentas

| Tecla / botão | O que faz |
|---|---|
| **Simulação / Modo real** (topo, à direita) | No modo real o carro só anda com o que chega do servidor; começa na largada |
| **Twin** | Volta para o Digital Twin (`/`) |
| **Oficial / Teste** | Troca entre a pista oficial e a pista de teste (ilha grande + 1 ilha retangular); cada pista guarda as próprias placas, largada e partida. Também por `?pista=teste` |
| **Topo / Carro** (V) | Alterna entre a vista de topo e a perseguição |
| **Som / Mudo** (M) | Liga e desliga a voz e os avisos |
| **GPS / Dilera** (G) | Troca a voz do GPS pela do Dilera |
| **Tela cheia** (F) | Tela inteira (não aparece no iPhone, que não permite em páginas) |
| **Placas** (E) | Editor 2D: arraste placas, semáforo, a **linha de largada/chegada** e a **partida do carro** (marcador azul; sai sempre no sentido da pista); salvar recarrega a cena 3D |
| **Debug** (D) | Fonte (servidor/simulação), missão simulada, velocidade, semáforo, câmera, .glb do carro, escala |
| 1 / 2 / 3 | Câmera: perseguição / de cima / livre |
| Espaço | Pausa a simulação |

A linha de largada/chegada (quadriculada) pode ficar em qualquer ponto da faixa da esquerda
ou do começo da faixa de cima, o trecho por onde toda volta passa; é onde a volta e a missão
terminam. No `signs.json` exportado: `{ "id": "chegada", "at": [...] }`.

A partida do carro é onde ele começa (simulação, "Voltar à largada" e ao entrar no modo
real); por padrão ela fica em cima da linha de largada. No `signs.json` exportado ela
vem como `{ "id": "partida", "at": [...], "reverse": false }`. Atenção: o código do carro conta
as placas de desvio a partir da largada, então partir depois de um desvio pode fazer o carro
real (e o mapa) dar voltas sem chegar ao ponto; o mapa avisa os pontos inalcançáveis.

Posições das placas: edição salva no navegador > `src/config/signs.json` > padrão em
`src/track/trackData.js`. O editor exporta o JSON para fixar no projeto.

## Arquivos

- `src/track/` — geometria medida da pista, rede (grafo de mão única) e planejador da missão
- `src/scene/` — pista e malha de pontos, placas, carro, fita, câmera
- `models/car.glb` — carro real usado na cena, gerado de `3DModel/base_basic_pbr.glb` por
  `python tools/optimize_car.py` (texturas 1024 px em JPEG: 10,1 MB → 1,9 MB). Ao trocar o
  modelo, rode o script de novo; se a frente sair invertida, ajuste `CAR_MODEL_YAW` em `src/main.js`.
  O debug ainda aceita outro `.glb` para teste.
- `src/ui/` — HUD, debug, editor de placas, tela de carregamento
- `src/data/carLink.js` — leitura tolerante do servidor
- `DESIGN.md` — sistema visual do painel
