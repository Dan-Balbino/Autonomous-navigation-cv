# Autonomous Navigation with Computer Vision

Sistema completo de navegação autônoma usando visão computacional para detecção de faixas, sinais de trânsito e controle de veículos via Arduino. Inclui painel de controle em tempo real, calibração de câmera fisheye e dashboard web.

---

## 📋 Arquitetura do Projeto

```
main.py                    ← Loop principal
├─ vision/                 ← Processamento de imagem
│  ├─ lane_detection.py    ← Bird-eye view, sliding window, cálculo de erro
│  ├─ signDetector.py      ← YOLOv11 para sinais de trânsito
│  └─ calibration.py       ← Correção de lentes fisheye
├─ core/                   ← Comunicação e controle
│  ├─ car.py              ← Interface de comando para o carro
│  ├─ serial_protocol.py  ← Protocolo JSON serial (115200 baud)
│  ├─ command.py          ← Estrutura de comandos
│  └─ telemetry.py        ← Leitura de telemetria
├─ messaging/              ← Dashboard web Flask
│  └─ messaging_core.py   ← Servidor da aplicação
├─ config/                 ← Configurações
│  ├─ config.json         ← Parâmetros persistentes (ROI, PID, etc.)
│  └─ setup.py            ← Auto-detecção de hardware
├─ ctrl_panel.py           ← Interface Tkinter (painel de controle)
├─ hud.py                  ← Exibição de informações na tela
├─ PID.py                  ← Controlador PID (reta e curva)
└─ calibration/            ← Arquivos de calibração
   └─ fisheye_calibration.npz ← Parâmetros da câmera fisheye
```

---

## 🎯 Funcionalidades Principais

| Módulo | Descrição |
|---|---|
| **Detecção de Faixas** | Transformação bird-eye view → binarização → sliding window (3 janelas) → cálculo de erro lateral |
| **Detecção de Sinais** | YOLOv11 rodando a cada 5 frames com confiança 0.4+ (semáforos e STOP) |
| **Controle PID Dual** | PID separado para retas (Kp/Ki/Kd) e curvas com transição automática baseada em threshold |
| **Painel de Controle** | Interface Tkinter com sliders em tempo real para ROI, limiar, PIDs e PWM |
| **Dashboard Web** | Flask em localhost:5000 com sincronização de estado (running, PWM, telemetria) |
| **Calibração Fisheye** | Corrige distorção de lentes com arquivo NPZ (balance=0.4, offset_x=-86) |
| **Auto-Detecção Hardware** | Câmeras (tenta índice 1 → fallback 0) e portas COM com prompt interativo |
| **Modo Teste** | Executa sem Arduino (útil para desenvolvimento e testes de visão) |
| **Comunicação Serial** | Protocolo JSON a 115200 baud, enviado a cada 200 ms quando em movimento |

---

## 📦 Instalação

### Dependências Python

```bash
pip install opencv-python numpy pyserial ultralytics==8.3.5 flask pillow
```

### Modelo de Detecção de Sinais

O projeto usa **YOLOv11** para detectar:
- **Semáforos**: Verde, Amarelo, Vermelho (com estados temporizados)
- **Placas de Trânsito**: STOP, Sinalizações de velocidade (20-120 km/h)

**Modelo disponível:**
- `model/MOdelo_2.pt` (modelo customizado atual)
- `model/traffic_sign_detector.pt` (alternativa, ver [bhaskrr/traffic-sign-detection-using-yolov11](https://github.com/bhaskrr/traffic-sign-detection-using-yolov11))

### Calibração da Câmera

Se tiver uma lente fisheye, gere o arquivo de calibração:

```bash
python vision/calibration.py
```

Isso criará `calibration/fisheye_calibration.npz`.

---

## 🚀 Como Usar

### Inicializar o Sistema

```bash
python main.py
```

### Seleção de Hardware

Ao iniciar, o terminal oferece opções:

**Porta Serial (Arduino):**
```
[USB] Dispositivos detectados:
  Arduino   COM3  —  Arduino (COM3)
  Serial/USB COM5  —  CH340 USB Serial

[COM] Portas detectadas:
  [0] COM3  —  Arduino (COM3)
  [1] COM5  —  CH340 USB Serial
  [t] Modo teste (sem Arduino)
[COM] Escolha o número (0-1) ou 't': 
```

**Câmera:**
```
[USB] Dispositivos detectados:
  Camera   índice 1  —  câmera de vídeo
  Camera   índice 0  —  webcam integrada
```
A câmera de maior índice é selecionada automaticamente.

---

## 🎮 Painel de Controle (Tkinter)

A interface oferece controle em tempo real:

| Seção | Parâmetros |
|---|---|
| **ROI** | Linha superior, Linha inferior, Altura sup, Altura inf |
| **IMAGEM** | Limiar de binarização (0-255), Erro de transição (threshold reta/curva) |
| **RETA** | Kp × 100, Ki × 1000, Kd × 100 |
| **CURVA** | Kp × 100, Ki × 1000, Kd × 100 |
| **PARÂMETROS DO CARRO** | PWM base (0-255) |

**Botões:**
- **Iniciar**: Começa a processar visão e enviar comandos ao Arduino
- **Parar**: Para o movimento (PWM = 0, mantém visão ativa)
- **Resetar**: Restaura valores de `config/config.json`
- **Salvar**: Persiste configurações atuais em `config/config.json`

**HUD (Heads-Up Display):**
```
Erro:  45          |  PID RETA          |  PID CURVA        |  SINAIS    | STATUS
Servo: 125         |  Kp: 1.50          |  Kp: 2.30         |  STOP: ●   | RUNNING
PWM:   180         |  Ki: 0.002         |  Ki: 0.003        |  SG: ●     | Arduino ACK
                   |  Kd: 0.80          |  Kd: 1.20         |  SV: ○     | 
```

---

## 📡 Protocolo Serial (Arduino)

**Formato:** JSON via UART a **115200 baud**

**Enviado a cada 200 ms** (quando em movimento):

```json
{
  "servo": 90,
  "pwm": 150,
  "stop": false,
  "traffic_light": 1,
  "lights": 1
}
```

| Campo | Tipo | Intervalo | Significado |
|---|---|---|---|
| `servo` | int | 0–180 | Ângulo do servo (90 = frente) |
| `pwm` | int | 0–255 | Velocidade dos motores |
| `stop` | bool | — | Placa STOP detectada → PWM = 0 |
| `traffic_light` | int | -1, 0, 1, 2 | Semáforo (-1=nenhum, 0=vermelh, 1=amarel, 2=verde) |
| `lights` | int | 0, 1 | Iluminação (0=deslig, 1=ligada) |

**Telemetria esperada do Arduino (exemplo):**
```json
{ "battery": 11.8, "motor_current": 2.3, "servo_pos": 89 }
```

---

## 🔍 Detecção de Faixas (Lane Detection)

### Pipeline:

1. **Extração de ROI**: Transformação de perspectiva (bird-eye view) com 4 pontos de controle
2. **Binarização**: Threshold simples em escala de cinza
3. **Sliding Window Search**: 3 janelas verticais para robustez
4. **Cálculo de Erro**: Posição do centro da pista vs. centro da imagem (pixels)

### Estados da Pista:
- **"both"**: Ambas as faixas detectadas → erro = `(left + right) / 2 - center`
- **"left"**: Apenas esquerda → estima direita usando `track_size` histórico
- **"right"**: Apenas direita → estima esquerda usando `track_size` histórico
- **"none"**: Nenhuma faixa → mantém último erro válido

---

## 🚨 Detecção de Sinais (YOLO)

**Configuração:**
- **Intervalo**: Roda YOLOv11 a cada 5 frames (mais rápido)
- **Confiança mínima**: 0.4 (0.8 para STOP em alguns casos)
- **Classes**: Semáforos (3 cores) + Placas de velocidade + STOP
- **Timeout de semáforo**: 2 segundos sem detectar = estado `-1`

**Estados do Semáforo:**
```
-1: Nenhum detectado (timeout após 2s)
 0: Vermelho → stop com cooldown de 90 frames (~3s)
 1: Amarelo → parar e esperar (raramente usado)
 2: Verde → avançar com PWM total
```

**STOP:** Quando detectado, ativa `stop_timer = 90 frames`, depois cooldown de 90 frames antes de poder detectar novamente.

---

## ⚙️ Controle (PID)

### Lógica de Comutação (reta ↔ curva):

```python
threshold = panel.get("IMAGEM", "Erro de transição")

if -threshold < error < threshold:
    servo_angle = pid_straight.update(error, dt=0.2)
else:
    servo_angle = pid_curve.update(error, dt=0.2)
```

### Fórmula PID:

```
output = Kp·error + Ki·∫error·dt + Kd·derror/dt
output = clamp(output, -90, +90)  # Limita esterçamento
```

**Limites:** ±90 graus (esterçamento máximo)

---

## 💾 Configuração (`config.json`)

Exemplo de `config/config.json`:

```json
{
  "ROI": {
    "Linha superior": 120,
    "Linha inferior": 150,
    "Altura sup": 100,
    "Altura inf": 140
  },
  "IMAGEM": {
    "Limiar": 150,
    "Erro de transição": 30
  },
  "RETA": {
    "Kp": 150,
    "Ki": 2,
    "Kd": 80
  },
  "CURVA": {
    "Kp": 230,
    "Ki": 3,
    "Kd": 120
  },
  "PARÂMETROS DO CARRO": {
    "PWM": 180
  }
}
```

---

## 🔧 Threads Principais

1. **Main Loop** (`mainLoop()`): Visão, PID, controle (loop sincronizado)
2. **Dashboard** (Flask): Servidor web async (porta 5000)
3. **Painel de Controle** (Tkinter): Interface gráfica (bloqueante, mas responsiva)

---

## 📊 Debug e Troubleshooting

### Câmera não abre

- Certifique-se de que a câmera não está em uso por outro programa
- Teste com diferentes índices: `cv2.VideoCapture(0)` e `cv2.VideoCapture(1)`

### Arduino não responde

- Verifique a porta COM e baud rate (115200)
- Pressione o botão de reset do Arduino após conexão
- Teste com modo teste (`[t]` durante seleção de porta)

### Faixas não detectadas

- Ajuste o **limiar** de binarização no painel (maior = mais faixas brancas)
- Verifique a **ROI** — certifique-se que captura a pista
- Calibre a câmera fisheye se houver distorção

### Servo não responde corretamente

- Verifique se o ângulo está no intervalo 0–180
- Teste envio manual via terminal serial
- Ajuste o `offset_x` na calibração fisheye se houver descentralização

---

## 📝 Notas Adicionais

- **FPS**: ~30 FPS (depende da câmera e processamento)
- **Latência Serial**: ~200 ms entre comandos (ajustável em `main.py`)
- **Modo Teste**: Perfeito para testar visão sem hardware
- **Firewall**: Na primeira execução com dashboard, o Windows pode pedir permissão (requer admin)

---

## 🤝 Contribuições

Melhorias bem-vindas! Áreas de interesse:
- Otimização de detecção de placas
- Suporte a múltiplas câmeras
- Modo autônomo avançado com planejamento de caminho
- Logging de telemetria para análise pós-viagem
