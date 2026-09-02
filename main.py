import time
import threading
import logging
import os
import json

import cv2
import numpy as np
import serial

from pid import PID
from ctrl_panel import ControlPanel
from vision.lane_detection import lane_detection_pipeline, get_frame_dimensions, extract_bird_eye_view
from vision.object_detector import ObjectDetector
from messaging.messaging_core import (
    app as dashboard_app, get_local_ip, update_state, load_config_from_file,
)
from vision.calibration import FisheyeCorrector
from config.setup import (
    select_com, scan_usb_devices, open_camera, allow_dashboard_firewall_rule
)
from core.car import Car
from core.telemetry import CarTelemetry

# ── Inicialização de variáveis ────────────────────────────
ROI_W = 320
ROI_H = 240
DASHBOARD_PORT = 5000
MAX_SPEED_MPS = 10.0
MIN_MOVING_SPEED_MPS = 1.5
COM = select_com()

shared_frame = None

flag_stop = False
flag_tl = 0

frame_lock = threading.Lock()
sign_lock = threading.Lock()

_usb_cams = scan_usb_devices()
cap, _cam_idx = open_camera(_usb_cams)


# ── Inicialização da cãmera ────────────────────────────
ret, frame = cap.read()

if not ret:
    print("[ERRO] Falha ao ler o primeiro frame.")
    exit()

height, width = get_frame_dimensions(frame, 1)


# ── Parêmtros e configuração do dashboard ────────────────────────────
logging.getLogger("werkzeug").setLevel(logging.ERROR)
load_config_from_file()

_dashboard_ip = get_local_ip()

print(f"Dashboard http://{_dashboard_ip}:{DASHBOARD_PORT}/")
_twin_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),"AutoCar-DigitalTwin", "index.html")

# Libera a porta no Firewall do Windows (silencioso — requer admin na primeira vez)
allow_dashboard_firewall_rule(DASHBOARD_PORT)


# ── Inicialização dos objetos ───────────────
corrector = FisheyeCorrector("calibration/fisheye_calibration.npz", width, height, balance=0.4, offset_x=-86)
sign_det = ObjectDetector("model/Modelo_3.pt")
panel = ControlPanel(width, height, test_mode=(COM is None),
                     dashboard_url=f"http://{_dashboard_ip}:{DASHBOARD_PORT}",
                     twin_path=_twin_path if os.path.exists(_twin_path) else "",
                     initial_cam_idx=_cam_idx)
car = Car(COM)


# ── Inicialização dos PIDs ───────────────
pid_straight  = PID(Kp=0, Ki=0, Kd=0, output_limit=90.0)
pid_curve = PID(Kp=0, Ki=0, Kd=0, output_limit=90.0)


def pidHub(erro, pid_straight, pid_curve, dt=0.2):
    if -panel.get("IMAGEM", "Erro de transição") < erro < panel.get("IMAGEM", "Erro de transição"):
        return pid_straight.update(erro, dt=dt)
    return pid_curve.update(erro, dt=dt)


# ── Loop principal ───────────────
def mainLoop():
    global cap
    global shared_frame

    error = 0
    angle = 0
    last_send = 0
    last_rx   = "Stand by..."
    last_run  = None

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
        
        with frame_lock:
            shared_frame = frame.copy()

        #frame = corrector.correct(frame)
        img = frame.copy()

        # ── Leitura dos controles ─────────────────────────────
        upper        = panel.get("ROI", "Linha superior")
        lower        = panel.get("ROI", "Linha inferior")
        y_top        = panel.get("ROI", "Altura sup")
        y_bot        = panel.get("ROI", "Altura inf")
        limiar_value = panel.get("IMAGEM", "Limiar")
        speed_mps    = panel.get("PARÂMETROS DO CARRO", "Velocidade (m/s)")
        yellow_speed = speed_mps * panel.get("PARÂMETROS DO CARRO", "Velocidade no amarelo (%)") / 100.0
        command_period_ms = panel.get("PARÂMETROS DO CARRO", "Intervalo comando (ms)")
        steering_limit = panel.get("PARÂMETROS DO CARRO", "Ângulo máximo")

        sign_det.configure(
            stop_confidence=panel.get("PARE", "Confiança (%)") / 100.0,
            min_stop_diagonal=panel.get("PARE", "Diagonal mínima da caixa (px)"),
            stop_wait_seconds=panel.get("PARE", "Tempo de parada (s)"),
            cooldown_seconds=panel.get("PARE", "Cooldown (s)"),
            light_timeout_seconds=panel.get("SEMÁFORO", "Timeout (ms)") / 1000.0,
            detect_interval=panel.get("SEMÁFORO", "Intervalo IA (frames)"),
            min_light_diagonal=panel.get("SEMÁFORO", "Diagonal mínima da caixa (px)"),
            light_confidence=panel.get("SEMÁFORO", "Confiança (%)") / 100.0,
            person_confidence=panel.get("PESSOAS", "Confiança (%)") / 100.0,
            min_person_diagonal=panel.get("PESSOAS", "Diagonal mínima da caixa (px)"),
        )

        kp_straight = panel.get("RETA", "Kp") / 100.0
        ki_straight = panel.get("RETA", "Ki") / 1000.0
        kd_straight = panel.get("RETA", "Kd") / 100.0
        pid_straight.setValues(kp_straight, ki_straight, kd_straight)
        pid_straight.output_limit = steering_limit

        kp_curve = panel.get("CURVA", "Kp") / 100.0
        ki_curve = panel.get("CURVA", "Ki") / 1000.0
        kd_curve = panel.get("CURVA", "Kd") / 100.0
        pid_curve.setValues(kp_curve, ki_curve, kd_curve)
        pid_curve.output_limit = steering_limit
        
        run = panel._IsRunning()
        
        # ── Extração do ROI e imagem com a área de interesse ─────────────────────────────
        roi, img = extract_bird_eye_view(frame, img, upper, lower, y_top, y_bot, ROI_W, ROI_H)

        # ── Processamento da ROI ─────────────────────────────
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        _, limiar = cv2.threshold(gray, limiar_value, 255, cv2.THRESH_BINARY)
        limiar_bgr = cv2.cvtColor(limiar, cv2.COLOR_GRAY2BGR)

        error, limiar_bgr, lane_state = lane_detection_pipeline(ROI_H, ROI_W, limiar, limiar_bgr, last_error=error)

        # ── Digital Twin ──────────────────────────────────────────────
        if not run or flag_stop or flag_tl == 0 or speed_mps < MIN_MOVING_SPEED_MPS:
            effective_speed = 0.0
        elif flag_tl == 1:
            effective_speed = yellow_speed
        else:
            effective_speed = speed_mps
        
        update_state(effective_speed, run)

        # ── Envio de dados para o Arduino ─────────────────────────────
        if run:
            now = time.time() * 1000
            should_send = now - last_send >= command_period_ms
            if should_send:
                last_send = now
                angle = pidHub(error, pid_straight, pid_curve, dt=0.2)
        else:
            should_send = last_run != False

        if should_send:
            car.command.traffic_light = flag_tl
            car.command.lights = 1
            car.command.servo = int(angle + 90)
            car.command.stop = flag_stop if run else True
            car.command.speed = effective_speed if run else 0

            if car.COM is not None:
                try:
                    car.send_command()
                    panel.log(f"TX → {car.command.to_dict()}", "tx")
                except serial.SerialException as e:
                    panel.log(f"[SERIAL] Falha ao enviar: {e}", "warn")
            else:
                panel.log(f"[TESTE] TX → {car.command.to_dict()}", "tx")

        last_run = run

        data = car.receive()
        if data:
            last_rx = data
            panel.log(f"RX ← {data}", "rx")

        telemetry = {}
        if data:
            try:
                decoded = json.loads(data)
                if isinstance(decoded, dict):
                    telemetry = decoded
                    car.telemetry = CarTelemetry.from_dict(decoded)
            except (TypeError, ValueError, json.JSONDecodeError):
                pass

        # ── Dashboard ──────────────────────────────────────
        panel.update_vehicle_info({
            "hud": {
                "error": error,
                "servo": int(angle + 90),
                "speed": effective_speed,
                "pid_mode": "RETA" if abs(error) < panel.get("IMAGEM", "Erro de transição") else "CURVA",
                "reta": {"kp": kp_straight, "ki": ki_straight, "kd": kd_straight},
                "curva": {"kp": kp_curve, "ki": ki_curve, "kd": kd_curve},
                "signals": ", ".join(
                    name for name, active in (
                        ("Pare", flag_stop),
                        ("Semáforo verde", flag_tl == 2),
                        ("Semáforo amarelo", flag_tl == 1),
                        ("Semáforo vermelho", flag_tl == 0),
                    ) if active
                ) or "Nenhum",
                "running": run,
            },
            "telemetry": telemetry,
            "raw_rx": last_rx,
        })

        sign_view = frame.copy()
        sign_det.draw(sign_view)
        panel.update_frames(img, limiar_bgr, sign_view)

    cap.release()
    if ser is not None:
        ser.close()
    cv2.destroyAllWindows()


def sign_thread():

    global flag_stop, flag_tl

    while True:

        if shared_frame is None:
            continue

        frame = shared_frame.copy()

        sign_det.update(frame)

        stop = sign_det.get_state()
        traffic_light = sign_det.get_light_state()
        
        with sign_lock:
            flag_stop = stop
            flag_tl = traffic_light


# ── Inicialização das threads ────────────────────────────
threading.Thread(
    target=lambda: dashboard_app.run(host="0.0.0.0", port=DASHBOARD_PORT,
                                     debug=False, use_reloader=False),
    daemon=True,
).start()

t_sign = threading.Thread(target=sign_thread, daemon=True)
t_sign.start()

t = threading.Thread(target=mainLoop, daemon=True)
t.start()

# ── Início do painel de controle ────────────────────────────
panel.run()
