import threading
import cv2
import numpy as np
import serial
import json
from PID import PID
import time
from CtrlPanel import ControlPanel
import threading
from imageProcess import processLane


def getFrameDimensions(frame, prop):
    height, width = round(frame.shape[0] / prop), round(frame.shape[1] / prop)
    return height, width


def nothing(x):
    pass


def drawDots(img, points, labels):
    for i, p in enumerate(points):
        x, y = int(p[0]), int(p[1])
        cv2.circle(img, (x, y), 5, (0, 255, 255), -1)
        cv2.putText(img, labels[i], (x + 6, y - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)


def pidHub(erro, pid_straight, pid_curve, dt=0.2):
    if -panel.get("IMAGEM", "Erro de transição") < erro < panel.get("IMAGEM", "Erro de transição"):
        return pid_straight.update(erro, dt=dt)
    return pid_curve.update(erro, dt=dt)


def main_loop():
    cv2.namedWindow("Visao", cv2.WINDOW_NORMAL)
    cv2.resizeWindow("Visao", 960, 700)

    ser = serial.Serial(COM, 9600, timeout=1)
    time.sleep(2)

    error = 0
    angle = 0
    last_send = 0
    last_rx = "Stand by..."  # ← variável para armazenar a última mensagem recebida do Arduino

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        img = frame.copy()

        # ── Leitura dos controles ─────────────────────────────
        upper        = panel.get("ROI", "Linha superior")
        lower        = panel.get("ROI", "Linha inferior")
        y_top        = panel.get("ROI", "Altura sup")
        y_bot        = panel.get("ROI", "Altura inf")
        limiar_value = panel.get("IMAGEM", "Limiar")
        vel          = panel.get("PARÂMETROS DO CARRO", "Vel")

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

        error, limiar_bgr = processLane(ROI_H, ROI_W, limiar, limiar_bgr)

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
                "M1":        vel,
                "M2":        vel,
                "M3":        vel,
                "M4":        vel,
            }
        else:
            data = {
                "DEVIATION": False,
                "STOP":      False,
                "SG":        False,
                "SV":        False,
                "SERVO":     90,
                "M1":        0,
                "M2":        0,
                "M3":        0,
                "M4":        0,
            }
        
        msg = json.dumps(data) + '\n'
        ser.write(msg.encode('utf-8'))

        if ser.in_waiting:
            response = ser.readline().decode('utf-8', errors='ignore').strip()
            if response:
                last_rx = response  # ← atualiza a última mensagem recebida

        # ── Dashboard ──────────────────────────────────────
        img_view  = cv2.resize(img, (960, 540))
        bird_view = cv2.resize(limiar_bgr, (320, 180))

        img_view[10:190, 630:950] = bird_view
        cv2.rectangle(img_view, (630, 10), (950, 190), (0, 255, 255), 2)
        cv2.putText(img_view, "Bird Eye", (635, 205),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)

        info = np.zeros((140, 960, 3), dtype=np.uint8)

        # ── coluna 1 — erro e servo ──
        cv2.putText(info, f"Erro:  {error}",              (20, 40),  cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
        cv2.putText(info, f"Servo: {int(angle + 90)}",  (20, 80),  cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0),   2)
        cv2.putText(info, f"Vel:   {vel}",               (20, 120), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)

        # ── coluna 2 — PID reta ──
        cv2.putText(info, "PID RETA", (340, 25),  cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 1)
        cv2.putText(info, f"Kp: {kp_straight:.2f}", (340, 55),  cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 0), 2)
        cv2.putText(info, f"Ki: {ki_straight:.3f}", (340, 85),  cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 0), 2)
        cv2.putText(info, f"Kd: {kd_straight:.2f}", (340, 115), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 0), 2)

        # ── coluna 3 — PID curva ──
        cv2.putText(info, "PID CURVA", (580, 25),  cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 1)
        cv2.putText(info, f"Kp: {kp_curve:.2f}", (580, 55),  cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
        cv2.putText(info, f"Ki: {ki_curve:.3f}", (580, 85),  cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
        cv2.putText(info, f"Kd: {kd_curve:.2f}", (580, 115), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)

        # ── coluna 4 — RX Arduino ──
        cv2.putText(info, "RX ARDUINO", (790, 25),  cv2.FONT_HERSHEY_SIMPLEX, 0.6, (180, 180, 180), 1)
        cv2.putText(info, last_rx[:20], (790, 65),  cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 128),   2)
        cv2.putText(info, "STATUS ", (790, 105), cv2.FONT_HERSHEY_SIMPLEX,  0.6, (180, 180, 180), 1)
        cv2.putText(info, "RUNNING" if run else "STOPPED", (790, 130), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 128) if run else (0, 0, 255), 2)
        
        dashboard = np.vstack((img_view, info))
        cv2.imshow("Visao", dashboard)

        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    ser.close()
    cv2.destroyAllWindows()

cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

ret, frame = cap.read()

if not ret:
    print("Erro ao abrir câmera.")
    exit()

height, width = getFrameDimensions(frame, 1)

pid_straight  = PID(Kp=0, Ki=0, Kd=0, output_limit=90.0)
pid_curve = PID(Kp=0, Ki=0, Kd=0, output_limit=90.0)

ROI_W = 320
ROI_H = 240
COM = "COM20"

panel = ControlPanel()
t = threading.Thread(target=main_loop, daemon=True)
t.start()

panel.run()
