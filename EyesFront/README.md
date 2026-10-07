# AutoCar Front (Olhos)

Módulo visual dos "olhos" do carro. Lê o estado do objeto `car` (`car.command` + `car.telemetry`)
publicado pelo `main.py` e ajusta as expressões em tempo real.

## Como rodar

1. Rode o `main.py` normalmente (ele sobe o servidor Flask do `messaging/messaging_core.py` na porta 5000).
2. Abra `http://<ip-do-carro>:5000/eyes/`, ou clique em **Abrir EyesFront** no painel web
   (aba "Conexão e registros"). O próprio Flask serve esta pasta, e os olhos usam a API da mesma origem.

Alternativa sem o Flask servindo os arquivos:

   ```bash
   cd EyesFront
   python -m http.server 8010
   ```

3. Abra `http://127.0.0.1:8010/` (ou o IP do carro no lugar de `127.0.0.1`).

### Parâmetros da URL

| Parâmetro | Efeito |
| --- | --- |
| `?apiHost=192.168.0.10&apiPort=5000` | Servidor do carro (padrão: mesmo host da página, porta 5000) |
| `?apiBase=http://host:5000/api` | URL base completa da API |
| `?demo=1` | Carro simulado, percorrendo todas as reações (não precisa do `main.py`) |
| `?debug=1` | Mostra o estado do carro ao lado do FPS |

## De onde vêm os dados

`GET /api/vehicle_info` (lido a cada 150 ms):

- `command`: `car.command.to_dict()` (run, lights, stop, servo, speed, reverse). Tem prioridade sobre o `hud`;
  pessoa detectada vem do bit `0b100` de `lights`. Servo: 90 = reto, acima de 90 = direita, abaixo = esquerda
- `hud.stop_active`, `hud.traffic_light_code`, `hud.right_detour_active`: placa de PARE, semáforo e desvio
  (`hud.running/speed/servo` servem de reserva se `command` faltar)
- `telemetry.speed`, `telemetry.battery`, `telemetry.left/f_left/f_right/right`: `car.telemetry`
  (ultrassônicos em zonas: 0 livre, 1 longe, 2 perto, 3 crítico)

Se o `_ts` parar de mudar por 3 s (o `main.py` travou ou foi encerrado), os olhos ficam sonolentos
até o sinal voltar; ao reconectar eles "procuram" ao redor.

## Mapeamento carro -> expressão

| Situação do carro | Expressão |
| --- | --- |
| Servo virando (> 90 direita, < 90 esquerda) | Olhar vai para o lado da curva com a mesma amplitude do procurar |
| Obstáculo perto de um lado | Olhos espiam aquele lado e ficam preocupados |
| Sensor frontal entra em "perto", pessoa detectada ou PWM zera sem PARE/vermelho | `surprise` |
| Sensor sai de livre/longe direto para crítico | `fright` (depois `search`) |
| Placa de PARE ou semáforo vermelho | `squint` com óculos enquanto durar |
| PWM >= 100 (sai abaixo de 85) | `accelerate`, já no máximo |
| Velocidade de cruzeiro | Olhar focado (pálpebras determinadas), passeia menos |
| Partida / sinal verde depois de esperar | Olhar feliz |
| Desvio à direita | `search` |
| Ré (`command.reverse`) | Olhar levemente preocupado |
| Parado por muito tempo ou bateria <= 20% | Sono (pálpebras pesadas, piscadas lentas) |

Todos os limites ficam em `src/config/faceConfig.json`, no bloco `car`. Com `mirror: true` (tela na
frente do carro, voltada para fora) uma curva à direita move os olhos para a esquerda da tela, como
um rosto olhando para o próprio lado direito; use `mirror: false` se a tela estiver voltada para dentro.

## Fluidez

- Um único passo de renderização por frame, com suavização independente do FPS (`expressions.smoothing`)
- Pálpebras via `clip-path` misturam foco, preocupação, sono e alegria de forma contínua
- Olhar com sacadas naturais em vez de um círculo fixo, e squash & stretch em movimentos rápidos
- Piscadas com intervalo irregular, piscada dupla ocasional e abertura mais lenta que o fechamento

## Atalhos de teclado (tecla 3x rápido)

`s` surpresa · `e` squint · `p` procurar · `f` susto · `a` acelerar

## Arquivos principais

- `src/core/FaceEngine.js`: loop, gatilhos e renderização
- `src/core/CarMood.js`: estado do carro -> eventos e humor
- `src/utils/api.js`: leitura e normalização de `/api/vehicle_info`
- `src/utils/carSimulator.js`: carro simulado do modo demo
- `src/config/faceConfig.json`: aparência, animações e limites
