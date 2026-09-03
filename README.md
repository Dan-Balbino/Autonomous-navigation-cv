# 🚗 Autonomous Navigation with Computer Vision

**Sistema completo de navegação autônoma com visão computacional** — detecção de faixas de rodovia, reconhecimento de sinais de trânsito (semáforos, placas STOP, pessoas) e controle preciso de veículos via Arduino Mega.

Inclui painel de controle Tkinter/PySide6 com ajuste em tempo real de parâmetros, calibração de câmera fisheye, dashboard web Flask, dual PID controller, e comunicação serial robusta.

---

## 📋 Estrutura do Projeto

```
Autonomous-navigation-cv\
│
├── main.py                          ← 🔴 PONTO DE ENTRADA (loop principal)
├── pid.py                           ← Controlador PID de esterçamento
├── ctrl_panel.py                    ← Interface gráfica (PySide6)
│
├── config/
│   ├── config.json                  ← Parâmetros persistentes (ROI, PID, velocidade, etc.)
│   └── setup.py                     ← Auto-detecção de hardware (câmeras, portas COM)
│
├── core/
│   ├── car.py                       ← Interface principal do veículo (CAR object)
│   ├── serial_protocol.py           ← Protocolo JSON serial @ 115200 baud
│   ├── command.py                   ← Estrutura de comando (run, servo, speed, etc.)
│   └── telemetry.py                 ← Estrutura de telemetria (sensores ultrassônicos, bateria, etc.)
│
├── vision/
│   ├── lane_detection.py            ← Detecção de faixas (sliding window, bird-eye view, erro lateral)
│   ├── object_detector.py           ← YOLOv11 para semáforos, STOP, pessoas
│   └── calibration.py               ← Correção de distorção fisheye
│
├── messaging/
│   └── messaging_core.py            ← Dashboard web Flask (localhost:5000)
│
├── calibration/
│   └── fisheye_calibration.npz      ← Parâmetros da câmera (gerado por calibration.py)
│
├── model/
│   ├── Modelo_3.pt                  ← YOLOv11 custom (semáforos, STOP, pessoas)
│   └── yolov8n.pt                   ← YOLOv8 nano (backup, pessoas)
│
├── microcontroller/
│   ├── arduino_mega/
│   │   ├── Apex.ino                 ← 🎮 Firmware principal (servo, motor, sensores ultrassônicos)
│   │   ├── SerialProtocol.cpp/h     ← Recepção/envio de comandos JSON
│   │   ├── CANProtocol.cpp/h        ← Comunicação CAN com módulos periféricos
│   │   ├── HBridgeController.cpp/h  ← Controle PWM do motor
│   │   ├── Types.h                  ← Definições de estruturas (CarCommand, Telemetry)
│   │   └── CANIds.h                 ← IDs de módulos CAN
│   │
│   └── atmega modules/
│       └── ultrassonic/
│           └── ultrassonic.ino      ← Firmware dos sensores ultrassônicos
│
├── tests/
│   ├── CtrlManual.py                ← Teste manual de controle
│   ├── testVison.py                 ← Teste isolado de visão
│   └── images/                      ← Imagens de teste
│
└── README.md                        ← Este arquivo

```

---

## 🎯 Funcionalidades Principais

| Funcionalidade | Descrição | Arquivo(s) |
|---|---|---|
| **🛣️ Detecção de Faixas** | Bird-eye view + binarização + sliding window (3 janelas) → erro lateral | `vision/lane_detection.py` |
| **🚦 Reconhecimento de Sinais** | YOLOv11 → semáforos (R/Y/G), STOP, pessoas, velocidade | `vision/object_detector.py` |
| **🎮 Controle PID Dual** | Dois PIDs: retas (Kp/Ki/Kd) e curvas, transição automática por threshold | `pid.py` + `main.py` |
| **📊 Painel de Controle** | PySide6: ajuste real-time de ROI, limiares, PIDs, velocidade, confiança | `ctrl_panel.py` |
| **🌐 Dashboard Web** | Flask em `localhost:5000`: sincronização de estado, digital twin | `messaging/messaging_core.py` |
| **🔧 Calibração Fisheye** | Corrige distorção (balance=0.4, offset_x=-86) usando arquivo NPZ | `vision/calibration.py` |
| **🔌 Auto-Detecção Hardware** | Detecta câmeras (índice 0/1) e portas COM (Arduino/CH340) com prompt | `config/setup.py` |
| **⚙️ Modo Teste** | Executa sem Arduino para desenvolvimento | `main.py:COM selection` |
| **📡 Protocolo Serial** | JSON @ 115200 baud, 200ms de período, completo com telemetria | `core/serial_protocol.py` |
| **🚗 Atuadores** | Servo (0-180°, esterçamento), motor PWM, luzes, buzzer | Arduino Mega + H-Bridge |
| **📍 Sensores** | Ultrassônicos (frente, esquerda, direita), bateria, encoder, câmera | Arduino + ATmega |
| **🔄 CAN Bus** | Comunicação com módulos periféricos (motor, luzes, ultrassônicos) | `CANProtocol` |

---

## 📦 Instalação

### 1️⃣ Dependências Python

```bash
pip install \
  opencv-python \
  numpy \
  pyserial \
  ultralytics==8.3.5 \
  flask \
  pillow \
  pyside6
```

### 2️⃣ Modelos YOLO

- **Detecção de Sinais**: `model/Modelo_3.pt` (treino customizado)
  - Classes: semáforo (vermelho, amarelo, verde), STOP, pessoas, placas de velocidade
  - Confiança mínima configurável em `config.json`
  
- **Fallback**: `model/yolov8n.pt` (YOLO padrão para pessoas)

### 3️⃣ Calibração da Câmera (Opcional)

Se usar lente fisheye, calibre:

```bash
cd vision
python calibration.py
```

Gera `calibration/fisheye_calibration.npz` com parâmetros de correção.

### 4️⃣ Arduino/Microcontrolador

1. Abra `microcontroller/arduino_mega/Apex.ino` no Arduino IDE
2. Instale bibliotecas (se necessário):
   - `MCP2515` (CAN bus)
   - `Servo`
3. Faça upload para Arduino Mega
4. Conecte via porta COM (COM3, COM5, etc.)

---

## 🚀 Como Usar

### 1️⃣ Inicializar o Sistema

```bash
python main.py
```

### 2️⃣ Seleção de Hardware (Automática)

Ao iniciar, exibe:

**Câmeras detectadas:**
```
[USB] Dispositivos detectados:
  Camera   índice 0  —  câmera de vídeo
  Camera   índice 1  —  câmera de vídeo
  Arduino   COM3  —  Arduino (COM3)
  Serial/USB COM5  —  CH340 USB Serial
```

**Porta Serial (Arduino):**
```
[COM] Portas detectadas:
  [0] COM3  —  Arduino (COM3)
  [1] COM5  —  CH340 USB Serial
  [t] Modo teste (sem Arduino)
```

- Digite `0`, `1`, etc. para escolher
- Digite `t` para **modo teste** (sem Arduino, só visão)

---

## 🎛️ Painel de Controle (Control Panel)

A interface gráfica (`ctrl_panel.py`) permite ajuste em tempo real de todos os parâmetros:

### Abas Principais

| Aba | Função |
|---|---|
| **ROI** | Define a região de interesse (Superior, Inferior, Altura sup, Altura inf) |
| **IMAGEM** | Limiar de binarização, erro de transição PID |
| **RETA** | Coeficientes PID para retas (Kp, Ki, Kd) |
| **CURVA** | Coeficientes PID para curvas |
| **PARÂMETROS DO CARRO** | Velocidade (m/s), velocidade no amarelo (%), ângulo máximo, período de comando |
| **PARE** | Confiança STOP, diagonal mínima, tempo de parada, cooldown |
| **SEMÁFORO** | Confiança semáforo, diagonal mínima, timeout, intervalo de detecção |
| **PESSOAS** | Confiança detecção de pessoas, diagonal mínima |

### Logs em Tempo Real

Exibe todas as transações:
- **[TX]** - Comando enviado para Arduino
- **[RX]** - Telemetria recebida
- **[SERIAL]** - Status de conexão
- **[CAM]** - Status da câmera
- **[info/ok/warn/error]** - Mensagens do sistema

### Dashboard Web

Acesse `http://localhost:5000` (IP local) para:
- Ver estado do veículo (RPM, velocidade, sensores)
- Visualizar feeds da câmera
- Integração com Digital Twin (se disponível)

---

## ⚙️ Configuração de Parâmetros

Todos os parâmetros são salvos em `config/config.json`:

```json
{
  "ROI_Linha superior": 525,
  "ROI_Linha inferior": 385,
  "ROI_Altura sup": 192,
  "ROI_Altura inf": 286,
  "IMAGEM_Limiar": 217,
  "IMAGEM_Erro de transição": 12,
  "RETA_Kp": 150,
  "RETA_Ki": 0,
  "RETA_Kd": 0,
  "CURVA_Kp": 200,
  "CURVA_Ki": 0,
  "CURVA_Kd": 0,
  "PARÂMETROS DO CARRO_Velocidade (m/s)": 2.0,
  "PARÂMETROS DO CARRO_Velocidade no amarelo (%)": 50,
  "PARÂMETROS DO CARRO_Ângulo máximo": 90,
  "PARÂMETROS DO CARRO_Intervalo comando (ms)": 200,
  "PARE_Confiança (%)": 40,
  "PARE_Diagonal mínima da caixa (px)": 300,
  "PARE_Tempo de parada (s)": 3,
  "PARE_Cooldown (s)": 3,
  "SEMÁFORO_Confiança (%)": 80,
  "SEMÁFORO_Diagonal mínima da caixa (px)": 1000,
  "SEMÁFORO_Timeout (ms)": 2000,
  "SEMÁFORO_Intervalo IA (frames)": 3,
  "PESSOAS_Confiança (%)": 85,
  "PESSOAS_Diagonal mínima da caixa (px)": 546
}
```

### Parâmetros Críticos

- **ROI (Region of Interest)**: Ajuste para destacar a faixa de rodovia
- **Limiar**: Valor de binarização OpenCV (0-255). Ajuste para máximo contraste preto/branco
- **Erro de Transição**: Threshold para alternar entre PID reta e curva
- **PID Coeficientes**: 
  - **Kp** (Proporcional): Resposta ao erro imediato
  - **Ki** (Integral): Corrige acúmulo de erro
  - **Kd** (Derivativo): Amortecimento de oscilações
- **Velocidade**: Em m/s (recomendado 1.5-3.0 para início)
- **Confiança YOLO**: Valores mais altos = detecções mais precisas, mas menos frequentes

---

## 🔍 Fluxo de Dados (Data Flow)

```
┌─────────────────────────────────────────────────────────────────┐
│ CÂMERA (USB/índice 0 ou 1)                                      │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                      ┌────────▼────────┐
                      │ FRAME CAPTURE   │
                      │ (shared_frame)  │
                      └────────┬────────┘
                               │
                ┌──────────────┴───────────────┐
                │                              │
          ┌─────▼──────────┐            ┌─────▼──────────┐
          │ MAIN LOOP      │            │ SIGN THREAD    │
          │ Lane Detection │            │ Object Detect  │
          └─────┬──────────┘            └─────┬──────────┘
                │                             │
        ┌───────▼─────┐              ┌────────▼─────────┐
        │ Bird-eye    │              │ YOLO v11 Inference
        │ + Threshold │              │ (every N frames)
        │ + Sliding   │              └────────┬─────────┘
        │   Window    │                        │
        └───────┬─────┘              ┌────────▼─────────┐
                │                   │ Flags            │
                │                   │ flag_stop (bool) │
          ┌─────▼──────────┐        │ flag_tl (0/1/2)  │
          │ Error & Lane   │        └──────────────────┘
          │ State          │
          └─────┬──────────┘
                │
          ┌─────▼──────────────┐
          │ PID CONTROL        │
          │ (Dual: reta/curva) │
          └─────┬──────────────┘
                │
          ┌─────▼──────────────┐
          │ CarCommand         │
          │ (servo, speed, tl) │
          └─────┬──────────────┘
                │
         ┌──────▼────────┐
         │ SERIAL PORT   │
         │ @ 115200 baud │
         │ (JSON)        │
         └──────┬────────┘
                │
         ┌──────▼──────────────┐
         │ ARDUINO MEGA        │
         │ CAN Bus → Modules   │
         └─────────────────────┘
```

---

## 🔌 Protocolo de Comunicação Serial

### Comando (PC → Arduino)

**Formato JSON:**
```json
{
  "run": true,
  "tl": 2,
  "lights": 1,
  "stop": false,
  "servo": 90,
  "speed": 2.0
}
```

- `run`: Sistema ativo (true/false)
- `tl`: Semáforo (0=vermelho, 1=amarelo, 2=verde)
- `lights`: Luzes frontal (0/1)
- `stop`: Comando de parada de emergência
- `servo`: Ângulo servo (0-180°, 90 = centro)
- `speed`: Velocidade em m/s (0.0-10.0)

**Período**: 200 ms (configurável em `PARÂMETROS DO CARRO > Intervalo comando (ms)`)

### Telemetria (Arduino → PC)

**Formato JSON:**
```json
{
  "spd": 2.5,
  "bat": 95,
  "ultrassonic": {
    "front": 45,
    "left": 120,
    "right": 110
  },
  "can": {
    "motor": true,
    "encoder": true,
    "lighting": true
  }
}
```

- `spd`: Velocidade atual (m/s)
- `bat`: Bateria (%)
- `ultrassonic`: Distâncias (cm)
- `can`: Status dos módulos CAN

---

## 🔧 Troubleshooting

| Problema | Solução |
|---|---|
| **Câmera não detecta** | 1. Verificar índice (0 ou 1) em `config/setup.py` |
| | 2. Testar com: `python -c "import cv2; cap = cv2.VideoCapture(0); print(cap.read())"` |
| | 3. Instalar DirectShow se no Windows: `pip install opencv-python-headless` |
| **Arduino não conecta** | 1. Verificar porta COM (ex: COM3) |
| | 2. Testar com PuTTY @ 115200 baud |
| | 3. Reinstalar driver CH340 ou Arduino |
| **Faixa não detecta** | 1. Ajustar ROI (Superior/Inferior/Altura) |
| | 2. Aumentar/diminuir limiar (0-255) |
| | 3. Adicionar iluminação na pista |
| **Semáforo não detecta** | 1. Aumentar confiança mínima em SEMÁFORO |
| | 2. Verificar tamanho da caixa (diagonal mínima) |
| | 3. Reajustar modelo: treinar novo em [Roboflow](https://roboflow.com) |
| **Veículo desvia muito** | 1. Aumentar Kd (amortecimento) |
| | 2. Diminuir Kp (sensibilidade) |
| | 3. Aumentar "Erro de transição" |
| **Painel não abre** | 1. Instalar PySide6: `pip install pyside6` |
| | 2. Se erro Qt, executar: `pip install --upgrade pyside6` |
| **Dashboard não abre (localhost:5000)** | 1. Verificar firewall (porta 5000 deve estar aberta) |
| | 2. Script tenta adicionar regra automaticamente |
| | 3. Verificar IP local com: `ipconfig` (Windows) ou `ifconfig` (Linux) |

---

## 📊 Estrutura de Dados Principais

### CarCommand (core/command.py)

```python
@dataclass
class CarCommand:
    run: bool = False              # Sistema ativo
    traffic_light: int = 0         # 0=vermelho, 1=amarelo, 2=verde
    lights: int = 0                # 0=off, 1=on
    stop: bool = False             # Parada de emergência
    servo: int = 90                # Ângulo servo (0-180)
    speed: int = 0                 # Velocidade (m/s)
```

### CarTelemetry (core/telemetry.py)

```python
@dataclass
class CarTelemetry:
    speed: float = 0.0             # Velocidade atual
    battery: int = 0               # Porcentagem bateria
    front: int = 0                 # Ultrassônico frontal (cm)
    left: int = 0                  # Ultrassônico esquerda (cm)
    right: int = 0                 # Ultrassônico direita (cm)
    can: dict = field()            # Status de módulos CAN
```

### Lane Detection Result

```python
error: float                       # Erro lateral (px)
limiar_bgr: np.ndarray            # Imagem binarizada com marcações
lane_state: str                   # "both", "left", "right", "none"
track_center: int                 # Centro detectado da faixa
track_size: int                   # Largura da faixa
```

---

## 🏗️ Arquitetura de Threads

| Thread | Função | Período |
|---|---|---|
| **Main Loop** | Frame capture, lane detection, PID, serial TX | ~30 FPS (câmera) |
| **Sign Thread** | YOLO inference, detecção de sinais | Configurável (cada N frames) |
| **Flask Server** | Dashboard web, sincronização estado | On-demand (HTTP) |
| **Serial RX** | Lê telemetria do Arduino | Non-blocking buffer |

### Sincronização de Dados

- `frame_lock`: Protege `shared_frame` entre threads
- `sign_lock`: Protege `flag_stop` e `flag_tl`
- Global `_config`: Atualizada via painel em tempo real

---

## 🤖 Detalhes da Detecção de Faixas (Lane Detection)

### Algoritmo

1. **Bird-Eye View**: Transforma frame para vista de cima
2. **Binarização**: Threshold OpenCV (valor configurável)
3. **Sliding Window**: Busca por 3 janelas horizontais
4. **Detecção de Faixas**: 
   - Conta pixels brancos por coluna
   - Identifica picos (faixas esquerda/direita)
5. **Cálculo de Erro**:
   - `error = track_center - (roi_w / 2)`
   - Positivo = desvia para direita
   - Negativo = desvia para esquerda

### Estados da Pista

- `"both"`: Ambas as faixas detectadas (confiança máxima)
- `"left"`: Apenas faixa esquerda
- `"right"`: Apenas faixa direita
- `"none"`: Nenhuma faixa (usa último erro válido)

---

## 🎓 Detecção de Sinais (Object Detection)

### YOLOv11 Customizado

- **Modelo**: `model/Modelo_3.pt`
- **Classes**: Semáforo (R/Y/G), STOP, Pessoas, Placas de velocidade
- **Inference**: A cada N frames (configurável)
- **Confiança**: Ajustável por sinal em tempo real

### Estados de Semáforo

- `flag_tl = 0`: Vermelho (parar)
- `flag_tl = 1`: Amarelo (desacelerar)
- `flag_tl = 2`: Verde (acelerar)
- `flag_tl = -1`: Não detectado (usar último estado)

### Detecção STOP

- Ativa `flag_stop = True`
- Veículo para por X segundos (configurável)
- Cooldown de Y segundos (evita re-detecção)

---

## 📈 Tuning do PID

### Para Retas (RETA)

1. Defina Ki=0, Kd=0
2. Aumente Kp até o veículo oscilar
3. Diminua Kp em ~10-20%
4. Aumente Kd para amortecimento
5. Use Ki se houver erro persistente

**Valores típicos**: Kp=150, Ki=0, Kd=0

### Para Curvas (CURVA)

1. Aumente Kp (mais responsivo)
2. Aumente Kd (mais amortecido)
3. Teste com curvas em diferentes velocidades

**Valores típicos**: Kp=200, Ki=0, Kd=0

### Diagrama de Resposta

```
        Kp         ↑
       /  \        │  Resposta
      /    \       │   rápida
     /      \      │  ╱╱╱╱
    /        \     │ ╱  
───┴──────────┴───►│╱────────►
    Muito baixo    Muito alto  (tempo)
    (subresponde)  (oscila)
```

---

## 💾 Salvando Alterações

Todos os ajustes feitos no painel são **automaticamente salvos** em `config/config.json`:

1. Modificar slider/valor no painel
2. Sistema salva em JSON
3. Próxima inicialização carrega os mesmos valores

### Resetar para Defaults

1. Editar `config/config.json` manualmente
2. Ou deletar arquivo (sistema regenera)

---

## 🎬 Exemplos de Uso

### Teste Rápido (Modo Teste)

```bash
python main.py
# Escolher [t] para teste sem Arduino
# Sistema abre painel com câmera
# Testar detecção de faixas em tempo real
```

### Teste com Arduino

```bash
python main.py
# Escolher [0] para Arduino em COM3
# Sistema conecta serial @ 115200 baud
# Painel exibe telemetria e logs
```

### Teste Isolado de Visão

```bash
cd tests
python testVision.py
# Testa detector de sinais isoladamente
```

### Teste de Controle Manual

```bash
cd tests
python CtrlManual.py
# Interface simplificada para testar controles
```

---

## 📚 Referências & Documentação

| Tópico | Link |
|---|---|
| **OpenCV** | https://docs.opencv.org/ |
| **YOLO** | https://docs.ultralytics.com/ |
| **Arduino** | https://www.arduino.cc/reference/en/ |
| **PID Control** | https://en.wikipedia.org/wiki/Proportional%E2%80%93integral%E2%80%93derivative_controller |
| **Serial Comm** | https://pyserial.readthedocs.io/ |
| **Flask** | https://flask.palletsprojects.com/ |

---

## 👥 Contribuições

Este projeto é de código aberto. Contribuições são bem-vindas!

### Como Contribuir

1. Fork o repositório
2. Crie branch: `git checkout -b feature/sua-feature`
3. Commit: `git commit -m "Descrição da mudança"`
4. Push: `git push origin feature/sua-feature`
5. Abra Pull Request
