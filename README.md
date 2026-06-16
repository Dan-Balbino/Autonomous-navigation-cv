# Autonomous Navigation

Sistema de visão computacional para veículos autônomos com detecção de faixas, sinais de trânsito e controle PID — comunicação com Arduino via serial.

---

## Funcionalidades

| Módulo | Descrição |
|---|---|
| Detector de faixas | Bird-eye view, sliding window, erro lateral → PID dual reta/curva |
| Detector de sinais | YOLOv11 — semáforo (verde/vermelho/amarelo) e placa STOP |
| Tomada de decisão | Flags STOP/SG/SV controlam PWM enviado ao Arduino |
| Painel de controle | Interface Tkinter com sliders de ROI, PID e log em tempo real |
| Auto-detecção serial | Lista portas COM disponíveis e pede escolha no terminal |
| Auto-detecção câmera | Tenta índice 1, fallback para 0 automaticamente |

---

## Instalação

```bash
pip install opencv-python numpy pyserial ultralytics==8.3.5
```

### Modelo de sinais de trânsito

Baixe `traffic_sign_detector.pt` em:
[bhaskrr/traffic-sign-detection-using-yolov11](https://github.com/bhaskrr/traffic-sign-detection-using-yolov11)

Coloque em `model/traffic_sign_detector.pt`.

---

## Como usar

```bash
python main.py
```

Ao iniciar, o terminal pergunta qual porta COM usar:

```
[COM] Portas disponíveis:
  [0] COM3
  [1] COM5
[COM] Escolha o número (0-1):
```

Se só houver uma porta, ela é usada automaticamente. Se nenhuma for encontrada, o terminal pede para digitar manualmente.

A câmera é aberta automaticamente — tenta índice 1 (câmera externa) e, se falhar, usa índice 0 (webcam integrada).

---

## Painel de controle

| Seção | Parâmetros |
|---|---|
| ROI | Linha superior, Linha inferior, Altura sup, Altura inf |
| Imagem | Limiar de binarização, Erro de transição reta/curva |
| Reta | Kp, Ki, Kd do PID em linha reta |
| Curva | Kp, Ki, Kd do PID em curva |
| Parâmetros do carro | PWM base dos motores |

**Botões:** Iniciar · Parar · Resetar (restaura `config.json`) · Salvar

---

## Protocolo serial (JSON → Arduino)

Enviado a cada 200 ms enquanto o painel estiver em **Iniciar**:

```json
{ "DEVIATION": false, "STOP": false, "SG": true, "SV": false, "SERVO": 90, "PWM": 30 }
```

| Campo | Significado |
|---|---|
| `STOP` | Placa STOP detectada — PWM = 0 |
| `SG` | Semáforo verde — PWM normal |
| `SV` | Semáforo vermelho/amarelo — PWM = 0 |
| `SERVO` | Ângulo do servo (90 = frente) |
| `PWM` | Velocidade efetiva dos motores |

---

## Classes detectadas

`traffic_sign_detector.pt`:
Semáforo verde · vermelho · amarelo · Placa STOP · Velocidade 20/30/40/50/60/70/80/100/120 km/h
