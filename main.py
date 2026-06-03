import time
import threading
import json

import cv2
import numpy as np
import serial

from pid import PID
from ctrl_panel import ControlPanel
from vision.lane_detection import lane_detection_pipeline, get_frame_dimensions
from hud import drawDots, addInfo
from vision.calibration import FisheyeCorrector


def pidHub(erro, pid_straight, pid_curve, dt=0.2):
    if -panel.get("IMAGEM", "Erro de transição") < erro < panel.get("IMAGEM", "Erro de transição"):
        return pid_straight.update(erro, dt=dt)
    return pid_curve.update(erro, dt=dt)


def mainLoop():
    cv2.namedWindow("Visão", cv2.WINDOW_NORMAL)
    cv2.resizeWindow("Visão", 960, 700)

    ser = serial.Serial(COM, 9600, timeout=1)
    time.sleep(2)

    error = 0
    angle = 0
    last_send = 0
    last_rx = "Stand by..."  # ← variável para armazenar a última mensagem recebida do Arduino
    last_run = None
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame = corrector.correct(frame)
        img = frame.copy()

        # ── Leitura dos controles ─────────────────────────────
        upper        = panel.get("ROI", "Linha superior")
        lower        = panel.get("ROI", "Linha inferior")
        y_top        = panel.get("ROI", "Altura sup")
        y_bot        = panel.get("ROI", "Altura inf")
        limiar_value = panel.get("IMAGEM", "Limiar")
        pwm          = panel.get("PARÂMETROS DO CARRO", "PWM")

        kp_straight = panel.get("RETA", "Kp") / 100.0
        ki_straight = panel.get("RETA", "Ki") / 1000.0
        kd_straight = panel.get("RETA", "Kd") / 100.0
        pid_straight.setValues(kp_straight, ki_straight, kd_straight)

        kp_curve = panel.get("CURVA", "Kp") / 100.0
        ki_curve = panel.get("CURVA", "Ki") / 1000.0
        kd_curve = panel.get("CURVA", "Kd") / 100.0
        pid_curve.setValues(kp_curve, ki_curve, kd_curve)
        
        run = panel._IsRunning()

        # ── Definição dos pontos de perspectiva ─────────────────────────────
        cx = width // 2

        pts_origin = np.float32([
            [cx - upper // 2, y_top],
            [cx + upper // 2, y_top],
            [cx + lower // 2, y_bot],
            [cx - lower // 2, y_bot],
        ])

        pts_destiny = np.float32([
            [0,     0    ],
            [ROI_W, 0    ],
            [ROI_W, ROI_H],
            [0,     ROI_H],
        ])

        # ── Visualização dos pontos e ROI ─────────────────────────────
        pts_poly = pts_origin.astype(np.int32).reshape((-1, 1, 2))
        overlay  = img.copy()
        cv2.fillPoly(overlay, [pts_poly], color=(255, 0, 0))
        cv2.addWeighted(overlay, 0.3, img, 0.7, 0, img)
        cv2.polylines(img, [pts_poly], isClosed=True, color=(255, 0, 0), thickness=2)
        drawDots(img, pts_origin, ["P1", "P2", "P3", "P4"])

        M   = cv2.getPerspectiveTransform(pts_origin, pts_destiny)
        roi = cv2.warpPerspective(frame, M, (ROI_W, ROI_H))

        # ── Processamento da ROI ─────────────────────────────
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        _, limiar = cv2.threshold(gray, limiar_value, 255, cv2.THRESH_BINARY)
        limiar_bgr = cv2.cvtColor(limiar, cv2.COLOR_GRAY2BGR)

        error, limiar_bgr, lane_state = lane_detection_pipeline(ROI_H, ROI_W, limiar, limiar_bgr, last_error=error)

        # ── Envio de dados para o Arduino ─────────────────────────────
        if run:
            now = time.time() * 1000
            if now - last_send >= 200:
                last_send = now
                angle = pidHub(error, pid_straight, pid_curve, dt=0.2)

                data = {
                    "DEVIATION": False,
                    "STOP":      False,
                    "SG":        False,
                    "SV":        False,
                    "SERVO":     int(angle + 90),
                    "PWM":       pwm,
                }

                msg = json.dumps(data) + '\n'
                ser.write(msg.encode('utf-8'))
                panel.log(f"TX → {msg.strip()}", "tx")

        else:
            if last_run != False:  # só envia uma vez ao parar
                data = {
                    "DEVIATION": False,
                    "STOP":      True,
                    "SG":        False,
                    "SV":        False,
                    "SERVO":     int(angle + 90),
                    "PWM":       0,
                }
                msg = json.dumps(data) + '\n'
                ser.write(msg.encode('utf-8'))
                panel.log(f"TX → {msg.strip()}", "tx")
                panel.log("[CONTROLE MANUAL] veículo parado pelo painel de controle", "warn")

        last_run = run

        if ser.in_waiting:
            response = ser.readline().decode('utf-8', errors='ignore').strip()
            if response:
                last_rx = response  # ← atualiza a última mensagem recebida
                panel.log(f"RX ← {response}", "rx")

        # ── Dashboard ──────────────────────────────────────
        img_view  = cv2.resize(img, (960, 540))
        bird_view = cv2.resize(limiar_bgr, (320, 180))

        img_view[10:190, 630:950] = bird_view
        cv2.rectangle(img_view, (630, 10), (950, 190), (0, 255, 255), 2)
        cv2.putText(img_view, "Bird Eye", (635, 205),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)

        info = addInfo(error, angle, pwm, kp_straight, ki_straight, kd_straight, kp_curve, ki_curve, kd_curve, last_rx, run)

        dashboard = np.vstack((img_view, info))
        cv2.imshow("Visão", dashboard)

        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    ser.close()
    cv2.destroyAllWindows()

cap = cv2.VideoCapture(1, cv2.CAP_DSHOW)

ret, frame = cap.read()

if not ret:
    print("[ERRO] Erro ao abrir câmera.")
    exit()

height, width = get_frame_dimensions(frame, 1)

pid_straight  = PID(Kp=0, Ki=0, Kd=0, output_limit=90.0)
pid_curve = PID(Kp=0, Ki=0, Kd=0, output_limit=90.0)

ROI_W = 320
ROI_H = 240
COM = "COM3"

corrector = FisheyeCorrector("calibration/fisheye_calibration.npz", width, height, balance=0.5)

panel = ControlPanel(width, height)
t = threading.Thread(target=mainLoop, daemon=True)
t.start()

panel.run()
