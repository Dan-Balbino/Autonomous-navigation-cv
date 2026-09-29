import time
import threading
import logging
import os
import json

import cv2
import serial

from core.pid import PID
from ctrl_panel import ControlPanel
from vision.lane_detection import lane_detection_pipeline, get_frame_dimensions, extract_bird_eye_view, set_lane_preference
from vision.object_detector import ObjectDetector
from messaging.messaging_core import (
    app as dashboard_app, get_local_ip, update_state, load_config_from_file,
    update_frames as dashboard_update_frames,
    update_vehicle_info as dashboard_update_vehicle_info,
    push_log as dashboard_push_log,
)
from vision.calibration import FisheyeCorrector
from config.setup import (
    select_com, scan_usb_devices, open_camera, allow_dashboard_firewall_rule
)
from core.car import Car
from core.telemetry import CarTelemetry
from core.remote_control import RemoteControl
from core.navigation import Navigation

# ── Inicialização de variáveis ────────────────────────────
ROI_W = 320
ROI_H = 240
DASHBOARD_PORT = 5000
MAX_PWM = 255
MIN_MOVING_PWM = 30
SERIAL_BAUDRATE = 115200
TRAFFIC_LIGHT_LABELS = {-1: "Nenhum", 0: "Vermelho", 1: "Amarelo", 2: "Verde"}
COM = select_com()

shared_frame = None
shared_frame_id = 0

flag_stop = False
flag_tl = -1
flag_right_detour = False
right_detour = False

# ── Fonte opcional de imagens para teste ───────────────────────────────
_project_dir = os.path.dirname(os.path.abspath(__file__))
_test_image_dirs = (
    os.path.join(_project_dir, "teste"),
    os.path.join(_project_dir, "tests", "images"),
)


def _load_test_image(filename):
    for directory in _test_image_dirs:
        path = os.path.join(directory, filename)
        image = cv2.imread(path)
        if image is not None:
            return image
    return None


_test_road_frame = None#_load_test_image("road.png")
_test_stop_frame = None #_load_test_image("pare.png")
_use_test_images = _test_road_frame is not None and _test_stop_frame is not None


frame_lock = threading.Lock()
sign_lock = threading.Lock()

_usb_cams = scan_usb_devices()
cap_1, _cam_idx_1, cap_2, _cam_idx_2 = open_camera(_usb_cams)
cap_1.set(cv2.CAP_PROP_BUFFERSIZE, 1)
cap_2.set(cv2.CAP_PROP_BUFFERSIZE, 1)


# ── Inicialização da cãmera ────────────────────────────
if _use_test_images:
    ret_1, frame_1 = True, _test_road_frame.copy()
    ret_2, frame_2 = True, _test_stop_frame.copy()
elif cap_1 is cap_2:
    ret_1, frame_1 = cap_1.read()
    ret_2, frame_2 = ret_1, frame_1.copy() if ret_1 else None
else:
    ret_1, frame_1 = cap_1.read()
    ret_2, frame_2 = cap_2.read()


if not ret_1 or not ret_2:
    print("[ERRO] Falha ao ler o primeiro frame.")
    exit()

height, width = get_frame_dimensions(frame_1, 1)


# ── Parêmtros e configuração do dashboard ────────────────────────────
logging.getLogger("werkzeug").setLevel(logging.ERROR)
load_config_from_file()

_dashboard_ip = get_local_ip()

print(f"Dashboard http://{_dashboard_ip}:{DASHBOARD_PORT}/")
_twin_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),"DigitalTwin", "index.html")

# Libera a porta no Firewall do Windows (silencioso — requer admin na primeira vez)
allow_dashboard_firewall_rule(DASHBOARD_PORT)


# ── Inicialização dos objetos ───────────────
corrector = FisheyeCorrector("calibration/fisheye_calibration.npz", width, height, balance=0.4, offset_x=-86)
sign_det = ObjectDetector("model/Modelo_4.pt")
car = Car(COM)
rc = RemoteControl()
nav = Navigation()
panel = ControlPanel(width, height, test_mode=(COM is None),
                     dashboard_url=f"http://{_dashboard_ip}:{DASHBOARD_PORT}",
                     twin_path=_twin_path if os.path.exists(_twin_path) else "",
                     initial_cam_idx=_cam_idx_1,
                     secondary_cam_idx=_cam_idx_2,
                     car=car, nav=nav, remote_control=rc)

# ── Inicialização dos PIDs ───────────────
pid_straight  = PID(Kp=0, Ki=0, Kd=0, output_limit=90.0)
pid_curve = PID(Kp=0, Ki=0, Kd=0, output_limit=90.0)


def log(msg, tag="info"):
    """Registra no painel Python e replica para o painel web (mesmo console)."""
    panel.log(msg, tag)
    dashboard_push_log(msg, tag)


def pidHub(erro, pid_straight, pid_curve, dt=0.2):
    if -panel.get("IMAGEM", "Erro de transição") < erro < panel.get("IMAGEM", "Erro de transição"):
        return pid_straight.update(erro, dt=dt)
    return pid_curve.update(erro, dt=dt)


# ── Loop principal ───────────────
def mainLoop():
    global cap_1, cap_2, _cam_idx_1, _cam_idx_2
    global shared_frame, shared_frame_id, right_detour

    error = 0
    angle = 0
    last_send = 0
    last_rx   = "Stand by..."
    last_run  = None
    last_right_button = False
    last_left_button = False
    last_start_button = False
    remote_control_active = False
    right_trigger_active = False
    left_trigger_active = False

    while True:
        # ── Reconexão dinâmica (solicitada pelo painel) ───────────────
        req = panel.get_connection()
        if req:
            new_com, new_cam_idx = req
            try:
                car.reconnect(new_com)
                if new_com is not None:
                    log(f"[SERIAL] Reconectado: {new_com} @ {SERIAL_BAUDRATE}", "ok")
                else:
                    log("[SERIAL] Modo teste — sem Arduino", "info")
            except (serial.SerialException, OSError) as e:
                log(f"[SERIAL] Falha ao reconectar: {e}", "error")
            _nc = cv2.VideoCapture(new_cam_idx, cv2.CAP_DSHOW)
            if _nc.isOpened() and _nc.read()[0]:
                _nc.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                cap_1.release()   # só libera a antiga depois de confirmar a nova
                cap_1 = _nc
                _cam_idx_1 = new_cam_idx
                panel.update_camera_ids(_cam_idx_1, _cam_idx_2)
                log(f"[CAM] Reconectada: indice {new_cam_idx}", "ok")
            else:
                _nc.release()
                log(f"[CAM] Falha no indice {new_cam_idx} — mantendo camera atual", "warn")


        if cap_1 is cap_2:
            ret_1, frame_1 = cap_1.read()
            ret_2, frame_2 = ret_1, frame_1.copy() if ret_1 else None
        else:
            ret_1, frame_1 = cap_1.read()
            ret_2, frame_2 = cap_2.read()
        if not ret_1 or not ret_2:
            break
        
        with frame_lock:
            shared_frame = frame_2.copy()
            shared_frame_id += 1

        frame_1 = corrector.correct(frame_1)
        img = frame_1.copy()

        # ── Leitura dos controles ─────────────────────────────
        upper        = panel.get("ROI", "Linha superior")
        lower        = panel.get("ROI", "Linha inferior")
        y_top        = panel.get("ROI", "Altura sup")
        y_bot        = panel.get("ROI", "Altura inf")
        limiar_value = panel.get("IMAGEM", "Limiar")
        pwm_value    = panel.get("PARÂMETROS DO CARRO", "PWM")
        yellow_pwm   = pwm_value * panel.get("PARÂMETROS DO CARRO", "Velocidade no amarelo (%)") / 100.0
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
            right_detour_confidence=panel.get("DESVIO DIREITA", "Confiança (%)") / 100.0,
            min_right_detour_diagonal=panel.get("DESVIO DIREITA", "Diagonal mínima da caixa (px)"),
            right_detour_required_frames=panel.get("DESVIO DIREITA", "Frames seguidos"),
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

        # O controle deve ser lido mesmo com o carro parado, pois o botao
        # START troca o modo de controle independentemente de run.
        remote_inputs = None
        if rc.connected:
            remote_inputs = rc.read_inputs()
            if remote_inputs is not None:
                (
                    start_button,
                    left_joystick_x,
                    right_trigger,
                    left_trigger,
                    right_button,
                    left_button,
                ) = remote_inputs

                if start_button and not last_start_button:
                    remote_control_active = not remote_control_active

                if remote_control_active:
                    if right_button and not last_right_button:
                        panel.adjust_speed(5)
                    if left_button and not last_left_button:
                        panel.adjust_speed(-5)

                    if right_trigger >= 0.25:
                        right_trigger_active = True
                    elif right_trigger <= 0.10:
                        right_trigger_active = False

                    if left_trigger >= 0.25:
                        left_trigger_active = True
                    elif left_trigger <= 0.10:
                        left_trigger_active = False

                last_start_button = bool(start_button)
                last_right_button = bool(right_button)
                last_left_button = bool(left_button)
        else:
            remote_control_active = False
            right_trigger_active = False
            left_trigger_active = False
            last_start_button = False
            last_right_button = False
            last_left_button = False
        
        # ── Extração do ROI e imagem com a área de interesse ─────────────────────────────
        roi, img = extract_bird_eye_view(frame_1, img, upper, lower, y_top, y_bot, ROI_W, ROI_H)

        # ── Processamento da ROI ─────────────────────────────
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        _, limiar = cv2.threshold(gray, limiar_value, 255, cv2.THRESH_BINARY)
        limiar_bgr = cv2.cvtColor(limiar, cv2.COLOR_GRAY2BGR)

        if flag_right_detour and not right_detour:    
            lane = nav.update_lane()
            set_lane_preference(lane)
            right_detour = True
        elif not flag_right_detour and right_detour:
            right_detour = False

        error, limiar_bgr, lane_state = lane_detection_pipeline(ROI_H, ROI_W, limiar, limiar_bgr, last_error=error)

        # ── Digital Twin ──────────────────────────────────────────────
        if not run or flag_stop or flag_tl == 0 or pwm_value < MIN_MOVING_PWM:
            effective_pwm = 0
        elif flag_tl == 1:
            effective_pwm = yellow_pwm
        else:
            effective_pwm = pwm_value

        effective_pwm = int(round(max(0, min(MAX_PWM, effective_pwm))))
        if effective_pwm < MIN_MOVING_PWM:
            effective_pwm = 0
        
        update_state(
            effective_pwm, run,
            real_speed=car.telemetry.speed,
            battery=car.telemetry.battery,
            stop_active=flag_stop,
            traffic_light_code=flag_tl,
            traffic_light_label=TRAFFIC_LIGHT_LABELS.get(flag_tl, "Nenhum"),
            right_detour_active=flag_right_detour,
        )

        # ── Envio de dados para o Arduino ─────────────────────────────
        car.command.run = run
        now = time.time() * 1000
        if run or remote_control_active:
            should_send = now - last_send >= command_period_ms
            if should_send:
                last_send = now
                if run and not remote_control_active:
                    angle = pidHub(error, pid_straight, pid_curve, dt=0.2)
        else:
            should_send = last_run != False

        if should_send:
            if remote_control_active and remote_inputs is not None:
                # Ajuste do ângulo com base no joystick esquerdo
                angle = left_joystick_x * steering_limit
                angle = max(-steering_limit, min(steering_limit, angle))  # Limita o ângulo

                if left_trigger_active and right_trigger_active or not left_trigger_active and not right_trigger_active:
                    effective_pwm = 0  # Ambos os gatilhos pressionados: velocidade zero
                    reverse = False
                elif left_trigger_active:
                    effective_pwm = 0
                    reverse = True
                elif right_trigger_active:
                    reverse = False
                    effective_pwm = pwm_value if pwm_value >= MIN_MOVING_PWM else 0
            else:
                reverse = False

            car.command.traffic_light = flag_tl
            car.command.lights = 1
            car.command.servo = int(angle + 90)
            car.command.stop = flag_stop if run else True
            car.command.speed = effective_pwm if (run or remote_control_active) else 0
            car.command.reverse = reverse if (run or remote_control_active) else False

            if car.COM is not None:
                try:
                    car.send_command()
                    log(f"TX → {car.command.to_dict()}", "tx")
                except serial.SerialException as e:
                    log(f"[SERIAL] Falha ao enviar: {e}", "warn")
            else:
                log(f"[TESTE] TX → {car.command.to_dict()}", "tx")

        last_run = run

        data = car.receive()
        if data:
            last_rx = data
            log(f"RX ← {data}", "rx")

        if data:
            try:
                decoded = json.loads(data)
                if isinstance(decoded, dict):
                    car.telemetry = CarTelemetry.from_dict(decoded)
                else:
                    log(f"[SERIAL] Telemetria ignorada: JSON não é objeto: {data}", "warn")
            except (TypeError, ValueError, json.JSONDecodeError):
                log(f"[SERIAL] Telemetria inválida: {data}", "warn")

        # ── Dashboard ──────────────────────────────────────
        route_points = [str(point) for point in getattr(nav, "route", [])]
        route_text = " → ".join(route_points) if route_points else "Nenhum ponto"
        hud = {
            "error": error,
            "servo": int(angle + 90),
            "speed": effective_pwm,
            "control_mode": "MANUAL" if remote_control_active and rc.connected else "AUTOMÁTICO",
            "pid_mode": "RETA" if abs(error) < panel.get("IMAGEM", "Erro de transição") else "CURVA",
            "reta": {"kp": kp_straight, "ki": ki_straight, "kd": kd_straight},
            "curva": {"kp": kp_curve, "ki": ki_curve, "kd": kd_curve},
            "signals": ", ".join(
                name for name, active in (
                    ("Pare", flag_stop),
                    ("Semáforo verde", flag_tl == 2),
                    ("Semáforo amarelo", flag_tl == 1),
                    ("Semáforo vermelho", flag_tl == 0),
                    ("Desvio à direita", flag_right_detour),
                ) if active
            ) or "Nenhum",
            "running": run,
            # Estado explícito da placa de PARE, semáforo e sinal de desvio à direita,
            # para os indicadores do painel web (o painel Python já deriva isso de "signals").
            "stop_active": flag_stop,
            "traffic_light_code": flag_tl,
            "traffic_light_label": TRAFFIC_LIGHT_LABELS.get(flag_tl, "Nenhum"),
            "right_detour_active": flag_right_detour,
            "route": route_text,
        }
        panel.update_vehicle_info({"hud": hud, "raw_rx": last_rx})
        dashboard_update_vehicle_info({
            "hud": hud,
            "raw_rx": last_rx,
            "telemetry": {
                "speed": car.telemetry.speed,
                "battery": car.telemetry.battery,
                "left": car.telemetry.left,
                "f_left": car.telemetry.f_left,
                "f_right": car.telemetry.f_right,
                "right": car.telemetry.right,
                "can": car.telemetry.can,
            },
        })

        sign_view = frame_2.copy()
        sign_det.draw(sign_view)
        panel.update_frames(img, limiar_bgr, sign_view)
        dashboard_update_frames(img, limiar_bgr, sign_view)

    cap_1.release()
    cap_2.release()
    car.serial.close()
    cv2.destroyAllWindows()


def sign_thread():

    global flag_stop, flag_tl, flag_right_detour
    last_frame_id = -1

    while True:

        with frame_lock:
            if shared_frame is None or shared_frame_id == last_frame_id:
                frame = None
            else:
                frame = shared_frame.copy()
                last_frame_id = shared_frame_id

        if frame is None:
            time.sleep(0.001)
            continue

        sign_det.update(frame)

        stop, right_detour = sign_det.get_state()
        traffic_light = sign_det.get_light_state()

        with sign_lock:
            flag_stop = stop
            flag_tl = traffic_light
            flag_right_detour = right_detour


# ── Inicialização das threads ────────────────────────────
threading.Thread(
    target=lambda: dashboard_app.run(host="0.0.0.0", port=DASHBOARD_PORT,
                                     debug=False, use_reloader=False, threaded=True),
    daemon=True,
).start()

t_sign = threading.Thread(target=sign_thread, daemon=True)
t_sign.start()

t = threading.Thread(target=mainLoop, daemon=True)
t.start()

# ── Início do painel de controle ────────────────────────────
panel.run()
