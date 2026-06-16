import time
import threading
import json
import logging
import ctypes
import os

import cv2
import numpy as np
import serial

from PID import PID
from ctrl_panel import ControlPanel
from vision.lane_detection import lane_detection_pipeline, get_frame_dimensions
from hud import drawDots, addInfo
from signDetector import SignDetector
from messaging.messaging_core import (
    app as dashboard_app, get_local_ip, update_state, load_config_from_file,
)
from vision.calibration import FisheyeCorrector


def pidHub(erro, pid_straight, pid_curve, dt=0.2):
    if -panel.get("IMAGEM", "Erro de transição") < erro < panel.get("IMAGEM", "Erro de transição"):
        return pid_straight.update(erro, dt=dt)
    return pid_curve.update(erro, dt=dt)


def mainLoop():
    global cap

    cv2.namedWindow("AutoCar", cv2.WINDOW_NORMAL)
    cv2.resizeWindow("AutoCar", 960, 700)

    try:
        ser = serial.Serial(COM, 9600, timeout=1) if COM else None
        if ser:
            time.sleep(2)
    except serial.SerialException as e:
        panel.log(f"[SERIAL] Não foi possível abrir {COM}: {e}", "error")
        ser = None

    error = 0
    angle = 0
    last_send = 0
    last_rx   = "Stand by..."
    last_run  = None
    prev_flags = (False, False, False)

    while True:
        # ── Reconexão dinâmica (solicitada pelo painel) ───────────────
        req = panel.get_connection()
        if req:
            new_com, new_cam_idx = req
            if ser is not None:
                try:
                    ser.close()
                except Exception:
                    pass
            if new_com is not None:
                try:
                    ser = serial.Serial(new_com, 9600, timeout=1)
                    time.sleep(2)
                    panel.log(f"[SERIAL] Reconectado: {new_com}", "ok")
                except Exception as e:
                    ser = None
                    panel.log(f"[SERIAL] Falha em {new_com}: {e}", "error")
            else:
                ser = None
                panel.log("[SERIAL] Modo teste — sem Arduino", "info")
            _nc = cv2.VideoCapture(new_cam_idx, cv2.CAP_DSHOW)
            if _nc.isOpened() and _nc.read()[0]:
                cap.release()   # só libera a antiga depois de confirmar a nova
                cap = _nc
                panel.log(f"[CAM] Reconectada: indice {new_cam_idx}", "ok")
            else:
                _nc.release()
                panel.log(f"[CAM] Falha no indice {new_cam_idx} — mantendo camera atual", "warn")

        ret, frame = cap.read()
        if not ret:
            break

        frame = corrector.correct(frame)
        img = frame.copy()

        # ── Detecção de sinais de trânsito ────────────────────
        sign_det.update(frame)
        flag_stop, flag_sg, flag_sv = sign_det.get_flags()

        # Log apenas quando o estado dos sinais muda
        curr_flags = (flag_stop, flag_sg, flag_sv)
        if curr_flags != prev_flags:
            if flag_stop:
                panel.log("[SINAL] Placa STOP — motores parados", "warn")
            elif flag_sv:
                panel.log("[SINAL] Semáforo VERMELHO — motores parados", "warn")
            elif flag_sg:
                panel.log("[SINAL] Semáforo VERDE — retomando", "ok")
            prev_flags = curr_flags

        # ── Leitura dos controles ─────────────────────────────
        upper        = panel.get("ROI", "Linha superior")
        lower        = panel.get("ROI", "Linha inferior")
        y_top        = panel.get("ROI", "Altura sup")
        y_bot        = panel.get("ROI", "Altura inf")
        limiar_value = panel.get("IMAGEM", "Limiar")
        pwm          = panel.get("PARÂMETROS DO CARRO", "PWM")
        sign_det.set_conf_stop(panel.get("DETECTOR", "Conf STOP")     / 100.0)
        sign_det.set_conf_sg(  panel.get("DETECTOR", "Conf Verde")    / 100.0)
        sign_det.set_conf_sv(  panel.get("DETECTOR", "Conf Vermelho") / 100.0)
        sign_det.set_min_diag( panel.get("DETECTOR", "Box diagonal"))

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

        # ── Digital Twin ──────────────────────────────────────────────
        effective_pwm = (0 if (flag_stop or flag_sv) else pwm) if run else 0
        update_state(effective_pwm, run)

        # ── Envio de dados para o Arduino ─────────────────────────────
        if run:
            now = time.time() * 1000
            if now - last_send >= 200:
                last_send = now
                angle = pidHub(error, pid_straight, pid_curve, dt=0.2)

                data = {
                    "DEVIATION": False,
                    "STOP":      flag_stop,
                    "SG":        flag_sg,
                    "SV":        flag_sv,
                    "SERVO":     int(angle + 90),
                    "PWM":       effective_pwm,
                }

                msg = json.dumps(data) + '\n'
                if ser is not None:
                    try:
                        ser.write(msg.encode('utf-8'))
                        panel.log(f"TX → {msg.strip()}", "tx")
                    except serial.SerialException as e:
                        panel.log(f"[SERIAL] Falha ao enviar: {e}", "warn")
                else:
                    panel.log(f"[TESTE] TX → {msg.strip()}", "tx")

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
                if ser is not None:
                    try:
                        ser.write(msg.encode('utf-8'))
                        panel.log(f"TX → {msg.strip()}", "tx")
                    except serial.SerialException as e:
                        panel.log(f"[SERIAL] Falha ao enviar: {e}", "warn")
                else:
                    panel.log(f"[TESTE] TX → {msg.strip()}", "tx")
                panel.log("[CONTROLE MANUAL] veículo parado pelo painel de controle", "warn")
            
        last_run = run

        if ser is not None:
            try:
                if ser.in_waiting:
                    response = ser.readline().decode('utf-8', errors='ignore').strip()
                    if response:
                        last_rx = response
                        panel.log(f"RX ← {response}", "rx")
            except serial.SerialException as e:
                panel.log(f"[SERIAL] Falha ao receber: {e}", "warn")

        # ── Dashboard ──────────────────────────────────────
        sign_det.draw(img)

        img_view  = cv2.resize(img, (960, 540))
        bird_view = cv2.resize(limiar_bgr, (320, 180))

        img_view[10:190, 630:950] = bird_view
        cv2.rectangle(img_view, (630, 10), (950, 190), (0, 255, 255), 2)
        cv2.putText(img_view, "Bird Eye", (635, 205),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)

        info = addInfo(error, angle, pwm, kp_straight, ki_straight, kd_straight,
                       kp_curve, ki_curve, kd_curve, last_rx, run,
                       flag_stop, flag_sg, flag_sv)

        dashboard = np.vstack((img_view, info))
        cv2.imshow("AutoCar", dashboard)

        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    if ser is not None:
        ser.close()
    cv2.destroyAllWindows()

# ── Cores ANSI (habilita VT100 no Windows) ────────────────────────────────
try:
    ctypes.windll.kernel32.SetConsoleMode(
        ctypes.windll.kernel32.GetStdHandle(-11), 7
    )
except Exception:
    pass
_G  = "\033[92m"   # verde
_Y  = "\033[93m"   # amarelo
_C  = "\033[96m"   # ciano
_R  = "\033[91m"   # vermelho
_B  = "\033[1m"    # negrito
_RS = "\033[0m"    # reset


def _scan_usb_devices() -> list[int]:
    """Imprime todos os dispositivos USB detectados (câmeras e seriais) e retorna índices de câmera."""
    from serial.tools import list_ports

    print(f"\n{_C}{_B}[USB]{_RS} Dispositivos detectados:")

    ports = list(list_ports.comports())
    for p in ports:
        desc = p.description if (p.description and p.description != p.device) else "dispositivo USB"
        mfr  = (p.manufacturer or "").lower()
        is_arduino = "arduino" in desc.lower() or "arduino" in mfr
        kind = f"{_G}Arduino{_RS}" if is_arduino else f"{_Y}Serial/USB{_RS}"
        print(f"  {kind}  {_B}{p.device}{_RS}  —  {desc}")

    cam_indices: list[int] = []
    for idx in range(3):
        c = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
        if c.isOpened() and c.read()[0]:
            cam_indices.append(idx)
            print(f"  {_G}Camera{_RS}   índice {_B}{idx}{_RS}  —  câmera de vídeo")
        c.release()

    if not ports and not cam_indices:
        print(f"  {_Y}Nenhum dispositivo USB encontrado{_RS}")
    print()
    return cam_indices


def _select_com() -> str:
    from serial.tools import list_ports
    ports = list(list_ports.comports())
    if not ports:
        raw = input(f"{_Y}{_B}[COM]{_RS} Nenhuma porta detectada. Digite manualmente ou Enter para modo teste: ").strip()
        if not raw:
            print(f"{_G}{_B}[COM]{_RS} Modo teste — sem Arduino")
            return None
        return raw
    print(f"{_C}{_B}[COM]{_RS} Portas detectadas:")
    for i, p in enumerate(ports):
        desc = p.description if (p.description and p.description != p.device) else "dispositivo USB"
        print(f"  {_C}[{i}]{_RS} {_B}{p.device}{_RS}  —  {desc}")
    print(f"  {_C}[t]{_RS} Modo teste (sem Arduino)")
    raw = input(f"{_Y}{_B}[COM]{_RS} Escolha o número (0-{len(ports)-1}) ou 't': ").strip().lower()
    if raw == "t":
        print(f"{_G}{_B}[COM]{_RS} Modo teste — sem Arduino")
        return None
    try:
        chosen = ports[int(raw)].device
    except (ValueError, IndexError):
        chosen = ports[0].device
        print(f"{_Y}{_B}[COM]{_RS} Entrada inválida, usando {_G}{chosen}{_RS}")
    print(f"{_G}{_B}[COM]{_RS} Usando: {_G}{_B}{chosen}{_RS}")
    return chosen


def _open_camera(cam_indices: list[int]) -> tuple[cv2.VideoCapture, int]:
    """Abre automaticamente a câmera de maior índice disponível (prefere índice 1)."""
    priority = [idx for idx in (1, 0) if idx in cam_indices] or (1, 0)
    for idx in priority:
        c = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
        if c.isOpened() and c.read()[0]:
            print(f"{_G}{_B}[CAM]{_RS} Câmera aberta automaticamente no índice {_G}{_B}{idx}{_RS}")
            return c, idx
        c.release()
    print(f"{_R}{_B}[ERRO]{_RS} Nenhuma câmera disponível.")
    exit()

# ── Silencia o Werkzeug antes de subir a thread ────────────────────────────
logging.getLogger("werkzeug").setLevel(logging.ERROR)
load_config_from_file()

_DASHBOARD_PORT = 5000
_dashboard_ip   = get_local_ip()

# Libera a porta no Firewall do Windows (silencioso — requer admin na primeira vez)
try:
    import subprocess
    subprocess.run([
        "netsh", "advfirewall", "firewall", "add", "rule",
        f"name=AutoCar-Dashboard-{_DASHBOARD_PORT}",
        "dir=in", "action=allow", "protocol=TCP",
        f"localport={_DASHBOARD_PORT}",
    ], capture_output=True, check=False, timeout=5)
except Exception:
    pass

threading.Thread(
    target=lambda: dashboard_app.run(host="0.0.0.0", port=_DASHBOARD_PORT,
                                     debug=False, use_reloader=False),
    daemon=True,
).start()

_usb_cams = _scan_usb_devices()
COM = _select_com()
cap, _cam_idx = _open_camera(_usb_cams)
print(f"{_C}{_B}[Dashboard]{_RS} http://{_dashboard_ip}:{_DASHBOARD_PORT}/")
ret, frame = cap.read()

if not ret:
    print("[ERRO] Falha ao ler o primeiro frame.")
    exit()

height, width = get_frame_dimensions(frame, 1)

pid_straight  = PID(Kp=0, Ki=0, Kd=0, output_limit=90.0)
pid_curve = PID(Kp=0, Ki=0, Kd=0, output_limit=90.0)

ROI_W = 320
ROI_H = 240

sign_det = SignDetector("model/traffic_sign_detector.pt")

_twin_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),"AutoCar-DigitalTwin", "index.html")

corrector = FisheyeCorrector("calibration/fisheye_calibration.npz", width, height, balance=0.5)


panel = ControlPanel(width, height, test_mode=(COM is None),
                     dashboard_url=f"http://{_dashboard_ip}:{_DASHBOARD_PORT}",
                     twin_path=_twin_path if os.path.exists(_twin_path) else "",
                     initial_cam_idx=_cam_idx)
t = threading.Thread(target=mainLoop, daemon=True)
t.start()

panel.run()
