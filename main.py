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
import vision.lane_detection as lane_detection
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

shared_frame = None
shared_frame_id = 0

flag_stop = False
flag_tl = -1
flag_right_detour = False
flag_person_detected = False
right_detour = False

_project_dir = os.path.dirname(os.path.abspath(__file__))
# Configure image testing here; leave disabled to use the camera.
USE_TEST_IMAGES = False
TEST_IMAGE_PATHS = [
    #"tests/images/road.png",
    #"tests/images/pare.png",
    "tests/images/pista02.png",
    #"tests/images/curva_2.png",
    #"tests/images/curva_2_no_right_lane.png",
]
TEST_IMAGE_INTERVAL_SECONDS = 60.0


def _load_test_images(paths):
    if not paths:
        raise ValueError("USE_TEST_IMAGES está ativo, mas TEST_IMAGE_PATHS está vazio")

    images = []
    for image_path in paths:
        path = image_path
        if not os.path.isabs(path):
            path = os.path.join(_project_dir, path)
        image = cv2.imread(path)
        if image is None:
            raise FileNotFoundError(f"Não foi possível abrir a imagem de teste: {path}")
        images.append((path, image))
    return images


_test_image_frames = _load_test_images(TEST_IMAGE_PATHS) if USE_TEST_IMAGES else []
_image_test_mode = USE_TEST_IMAGES
_test_image_index = 0
_test_image_last_change = None
_test_image_interval = TEST_IMAGE_INTERVAL_SECONDS
if _image_test_mode and _test_image_interval <= 0:
    raise ValueError("TEST_IMAGE_INTERVAL_SECONDS deve ser maior que zero")


def _read_source_frame():
    global _test_image_index, _test_image_last_change

    if not _image_test_mode:
        return camera.read()

    now = time.monotonic()
    if _test_image_last_change is None:
        _test_image_last_change = now
    elif (
        len(_test_image_frames) > 1
        and now - _test_image_last_change >= _test_image_interval
    ):
        _test_image_index = (_test_image_index + 1) % len(_test_image_frames)
        _test_image_last_change = now
        log(f"[IMAGEM] {_test_image_frames[_test_image_index][0]}", "info")

    return True, _test_image_frames[_test_image_index][1].copy()

frame_lock = threading.Lock()
sign_lock = threading.Lock()

if _image_test_mode:
    COM = None
    camera, camera_idx = None, -1
    print(f"[TESTE] {len(_test_image_frames)} imagem(ns); Arduino e câmera desativados.")
else:
    COM = select_com()
    _usb_cams = scan_usb_devices()
    camera, camera_idx = open_camera(_usb_cams)
    camera.set(cv2.CAP_PROP_BUFFERSIZE, 1)


# ── Inicialização da cãmera ────────────────────────────
if _image_test_mode:
    ret_1, frame_1 = True, _test_image_frames[0][1].copy()
else:
    ret_1, frame_1 = camera.read()


if not ret_1:
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
if not _image_test_mode:
    allow_dashboard_firewall_rule(DASHBOARD_PORT)


# ── Inicialização dos objetos ───────────────
corrector = FisheyeCorrector("calibration/fisheye_calibration.npz", width, height, balance=0.63, offset_x=-90)
sign_det = ObjectDetector("model/modelo_6.pt")
car = Car(COM)
rc = RemoteControl()
nav = Navigation()
panel = ControlPanel(width, height, test_mode=(COM is None),
                     dashboard_url=f"http://{_dashboard_ip}:{DASHBOARD_PORT}",
                     twin_path=_twin_path if os.path.exists(_twin_path) else "",
                     camera_idx=camera_idx,
                     car=car, nav=nav, remote_control=rc)

# ── Inicialização dos PIDs ───────────────
pid_straight  = PID(Kp=0, Ki=0, Kd=0, output_limit=90.0)
pid_curve = PID(Kp=0, Ki=0, Kd=0, output_limit=90.0)
pid_close_curve = PID(Kp=0, Ki=0, Kd=0, output_limit=90.0)


def log(msg, tag="info"):
    """Registra no painel Python e replica para o painel web (mesmo console)."""
    panel.log(msg, tag)
    dashboard_push_log(msg, tag)


def pidHub(erro, pid_straight, pid_curve, pid_close_curve, dt=0.2):
    close_curve_error = panel.get(
        "IMAGEM",
        "Erro para ativar o PID de curva fechada (px)",
    )
    if abs(erro) >= close_curve_error:
        return pid_close_curve.update(erro, dt=dt)
    if -panel.get("IMAGEM", "Erro de transição") < erro < panel.get("IMAGEM", "Erro de transição"):
        return pid_straight.update(erro, dt=dt)
    return pid_curve.update(erro, dt=dt)


# ── Loop principal ───────────────
def mainLoop():
    global camera, camera_idx
    global shared_frame, shared_frame_id, right_detour, flag_person_detected

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
    flag_point_detected = False

    while True:
        # ── Reconexão dinâmica (solicitada pelo painel) ───────────────
        req = panel.get_connection()
        if req:
            if _image_test_mode:
                log("[TESTE] Reconexão de câmera/Arduino indisponível com imagens.", "warn")
            else:
                new_com, new_camera_idx = req
                try:
                    car.reconnect(new_com)
                    if new_com is not None:
                        log(f"[SERIAL] Reconectado: {new_com} @ {SERIAL_BAUDRATE}", "ok")
                    else:
                        log("[SERIAL] Modo teste — sem Arduino", "info")
                except (serial.SerialException, OSError) as e:
                    log(f"[SERIAL] Falha ao reconectar: {e}", "error")
                _nc = cv2.VideoCapture(new_camera_idx, cv2.CAP_DSHOW)
                if _nc.isOpened() and _nc.read()[0]:
                    _nc.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                    camera.release()   # só libera a antiga depois de confirmar a nova
                    camera = _nc
                    camera_idx = new_camera_idx
                    panel.update_camera_id(camera_idx)
                    log(f"[CAM] Reconectada: indice {new_camera_idx}", "ok")
                else:
                    _nc.release()
                    log(f"[CAM] Falha no indice {new_camera_idx} — mantendo camera atual", "warn")

        ret_1, frame_1 = _read_source_frame()
        if not ret_1:
            break
        
        with frame_lock:
            shared_frame = frame_1.copy()
            shared_frame_id += 1

        sign_view = frame_1.copy()
        if not _image_test_mode:
            frame_1 = corrector.correct(frame_1)
        img = frame_1.copy()
        frame_scale_x = frame_1.shape[1] / width
        frame_scale_y = frame_1.shape[0] / height

        # ── Leitura dos controles ─────────────────────────────
        upper        = round(panel.get("ROI", "Linha superior") * frame_scale_x)
        lower        = round(panel.get("ROI", "Linha inferior") * frame_scale_x)
        y_top        = round(panel.get("ROI", "Altura sup") * frame_scale_y)
        y_bot        = round(panel.get("ROI", "Altura inf") * frame_scale_y)
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
            stop_point_a_confidence=panel.get("PONTO A", "Confiança (%)") / 100.0,
            min_stop_point_a_diagonal=panel.get("PONTO A", "Diagonal mínima da caixa (px)"),
            stop_point_b_confidence=panel.get("PONTO B", "Confiança (%)") / 100.0,
            min_stop_point_b_diagonal=panel.get("PONTO B", "Diagonal mínima da caixa (px)"),
            stop_point_c_confidence=panel.get("PONTO C", "Confiança (%)") / 100.0,
            min_stop_point_c_diagonal=panel.get("PONTO C", "Diagonal mínima da caixa (px)"),
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

        kp_close_curve = panel.get("PID DE CURVA FECHADA", "Kp") / 100.0
        ki_close_curve = panel.get("PID DE CURVA FECHADA", "Ki") / 1000.0
        kd_close_curve = panel.get("PID DE CURVA FECHADA", "Kd") / 100.0
        pid_close_curve.setValues(kp_close_curve, ki_close_curve, kd_close_curve)
        pid_close_curve.output_limit = steering_limit
        
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
        
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25))  # maior que a largura da linha
        tophat = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, k)
        blur = cv2.GaussianBlur(tophat, (5, 5), 1.1)
       
        _, limiar = cv2.threshold(blur, limiar_value, 255, cv2.THRESH_BINARY)
        limiar_bgr = cv2.cvtColor(limiar, cv2.COLOR_GRAY2BGR)
        
        
        
        # teste na segunda
        # gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        # blur = cv2.GaussianBlur(gray, (5, 5), 1.1)
        # _, limiar = cv2.threshold(blur, limiar_value, 255, cv2.THRESH_BINARY)

        # # remove blobs grandes demais (mancha de luz)
        # n, labels, stats, _ = cv2.connectedComponentsWithStats(limiar)
        # for i in range(1, n):
        #     if stats[i, cv2.CC_STAT_AREA] > 2500:
        #         limiar[labels == i] = 0

        # limiar_bgr = cv2.cvtColor(limiar, cv2.COLOR_GRAY2BGR)


        # ── Detecção de Desvio ──────────────────────────────────────────────
        if flag_right_detour and not right_detour:    
            lane = nav.update_lane()
            set_lane_preference(lane)
            right_detour = True
        elif not flag_right_detour and right_detour:
            right_detour = False

        error, limiar_bgr, lane_state = lane_detection_pipeline(ROI_H, ROI_W, limiar, limiar_bgr, last_error=error)

        # ── Dtecções da IA ──────────────────────────────────────────────
        if (not run or flag_stop or flag_tl == 0 or pwm_value < MIN_MOVING_PWM
            or flag_point_detected or flag_person_detected):
            effective_pwm = 0
        elif flag_tl == 1:
            effective_pwm = yellow_pwm
        else:
            curve_speed_error = panel.get(
                "PARÂMETROS DO CARRO",
                "Erro para iniciar velocidade na curva (px)",
            )
            curve_pwm = panel.get("PARÂMETROS DO CARRO", "Velocidade na curva (PWM)")
            effective_pwm = curve_pwm if abs(error) >= curve_speed_error else pwm_value

        if flag_person_detected:
            car.command.stop = True
        else:
            car.command.stop = False

        effective_pwm = int(round(max(0, min(MAX_PWM, effective_pwm))))
        if effective_pwm < MIN_MOVING_PWM:
            effective_pwm = 0
        
        # ── Digital Twin ──────────────────────────────────────────────
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
                    angle = pidHub(error, pid_straight, pid_curve, pid_close_curve, dt=0.2)
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
                    car.command.lights = (car.command.lights | 0b100000) if True else (car.command.lights & ~0b100000)
                elif right_trigger_active:
                    reverse = False
                    effective_pwm = pwm_value if pwm_value >= MIN_MOVING_PWM else 0
            else:
                reverse = False


            if not remote_control_active:
                car.command.lights = (car.command.lights | 0b1) if lane_detection.preference_lane == "left" else (car.command.lights & ~0b1)
                car.command.lights = (car.command.lights | 0b10) if lane_detection.preference_lane == "right" else (car.command.lights & ~0b10)
                car.command.lights = (car.command.lights | 0b100) if flag_person_detected else (car.command.lights & ~0b100)
                car.command.lights = (car.command.lights | 0b1000) if effective_pwm == 0 else (car.command.lights & ~0b1000)
                car.command.lights = (car.command.lights | 0b10000) if True else (car.command.lights & ~0b10000)
                
                    
            car.command.servo = int(angle + 90)
            car.command.stop = flag_person_detected or (
                car.command.stop and not remote_control_active
            )
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
            "pid_mode": (
                "CURVA FECHADA"
                if abs(error) >= panel.get(
                    "IMAGEM",
                    "Erro para ativar o PID de curva fechada (px)",
                )
                else "RETA"
                if abs(error) < panel.get("IMAGEM", "Erro de transição")
                else "CURVA"
            ),
            "reta": {"kp": kp_straight, "ki": ki_straight, "kd": kd_straight},
            "curva": {"kp": kp_curve, "ki": ki_curve, "kd": kd_curve},
            "curva_fechada": {"kp": kp_close_curve, "ki": ki_close_curve, "kd": kd_close_curve},
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

        # sign_det.draw(frame_1)
        # panel.update_frames(img, limiar_bgr, frame_1)
        # dashboard_update_frames(img, limiar_bgr, frame_1)

        sign_det.draw(sign_view)
        panel.update_frames(img, limiar_bgr, sign_view)
        dashboard_update_frames(img, limiar_bgr, sign_view)

        if _image_test_mode:
            time.sleep(1 / 30)
        
    if camera is not None:
        camera.release()
    car.serial.close()
    cv2.destroyAllWindows()


def sign_thread():

    global flag_stop, flag_tl, flag_right_detour, flag_point_detected, flag_person_detected
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

        current_route_point = nav.current_route
        point_detected = sign_det.has_valid_stop_point(current_route_point)
        person_detected = sign_det.has_valid_person()
        stop, right_detour = sign_det.get_state(current_route_point)
        traffic_light = sign_det.get_light_state()
        if point_detected:
            nav.confirm_current_point(current_route_point)

        with sign_lock:
            flag_stop = stop
            flag_tl = traffic_light
            flag_right_detour = right_detour
            flag_point_detected = point_detected
            flag_person_detected = person_detected


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
