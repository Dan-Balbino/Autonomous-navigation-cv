import os
import json
import socket
import threading
import time
from collections import deque

import cv2
from flask import Flask, jsonify, request, send_from_directory, redirect, url_for, Response

app = Flask(__name__)

_TWIN_DIR   = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "DigitalTwin"))
_EYES_DIR   = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "EyesFront"))
_ROAD_DIR   = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "RoadPanel"))
_CONFIG_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "config/config.json"))

_lock = threading.Lock()

# ── Telemetria do veículo (Digital Twin) ─────────────────────────────────────
_state: dict = {
    "tabDashboard_rpm":      0,
    "tabDashboard_light":    False,
    "tabDashboard_rotate":   True,
    "tabDashboard_sensor_1": None,
    "tabDashboard_sensor_2": None,
    "tabDashboard_sensor_3": None,
    "tabDashboard_sensor_4": None,
    "tabDashboard_sensor_5": None,
    # Velocidade e bateria reais, lidas de car.telemetry (não simuladas a partir do PWM).
    "tabDashboard_speed":                0.0,
    # Velocidade de cada roda (m/s), de car.telemetry.speed1..4, para a telemetria do Digital Twin.
    "tabDashboard_speed1":               0.0,
    "tabDashboard_speed2":               0.0,
    "tabDashboard_speed3":               0.0,
    "tabDashboard_speed4":               0.0,
    "tabDashboard_battery":              None,
    "tabDashboard_running":              False,
    # Placa de PARE / semáforo / desvio à direita, para os indicadores do Digital Twin.
    "tabDashboard_stop_active":          False,
    "tabDashboard_traffic_light_code":   -1,
    "tabDashboard_traffic_light_label":  "Nenhum",
    "tabDashboard_right_detour_active":  False,
}
_PWM_TO_RPM = 3.0

# ── Config do painel de controle ──────────────────────────────────────────────
# Mesmas chaves e padrões usados pelo painel Python (ctrl_panel.py) / config.json,
# para que os dois painéis fiquem sempre em sincronia via /api/config.
_config: dict = {
    "ROI_Linha superior":          1280,
    "ROI_Linha inferior":          1280,
    "ROI_Altura sup":               263,
    "ROI_Altura inf":               541,
    "IMAGEM_Limiar":                195,
    "IMAGEM_Erro de transição":      12,
    "RETA_Kp":                      200,
    "RETA_Ki":                        0,
    "RETA_Kd":                        5,
    "CURVA_Kp":                     650,
    "CURVA_Ki":                       0,
    "CURVA_Kd":                       0,
    "PID DE CURVA FECHADA_Kp":      650,
    "PID DE CURVA FECHADA_Ki":        0,
    "PID DE CURVA FECHADA_Kd":        0,
    "IMAGEM_Erro para ativar o PID de curva fechada (px)": 80,
    "PARÂMETROS DO CARRO_PWM":                         40,
    "PARÂMETROS DO CARRO_Velocidade na curva (PWM)": 70,
    "PARÂMETROS DO CARRO_Erro para iniciar velocidade na curva (px)": 24,
    "PARÂMETROS DO CARRO_Velocidade no amarelo (%)": 50,
    "PARÂMETROS DO CARRO_Ângulo máximo":             90,
    "PARÂMETROS DO CARRO_Intervalo comando (ms)":   200,
    "PARE_Confiança (%)":                            40,
    "PARE_Diagonal mínima da caixa (px)":             0,
    "PARE_Tempo de parada (s)":                       3,
    "PARE_Cooldown (s)":                              3,
    "SEMÁFORO_Confiança (%)":                        80,
    "SEMÁFORO_Diagonal mínima da caixa (px)":         0,
    "SEMÁFORO_Timeout (ms)":                       2000,
    "SEMÁFORO_Intervalo IA (frames)":                 5,
    "DESVIO DIREITA_Confiança (%)":                  80,
    "DESVIO DIREITA_Diagonal mínima da caixa (px)":   0,
    "DESVIO DIREITA_Frames seguidos":                 3,
    "PESSOAS_Confiança (%)":                         50,
    "PESSOAS_Diagonal mínima da caixa (px)":          0,
    "PONTO A_Confiança (%)":                         40,
    "PONTO A_Diagonal mínima da caixa (px)":          0,
    "PONTO B_Confiança (%)":                         40,
    "PONTO B_Diagonal mínima da caixa (px)":          0,
    "PONTO C_Confiança (%)":                         40,
    "PONTO C_Diagonal mínima da caixa (px)":          0,
    "running":                                    False,
}
_config_updated = False


def load_config_from_file() -> None:
    global _config
    try:
        with open(_CONFIG_PATH, encoding="utf-8") as f:
            data = json.load(f)
        close_curve_error_key = (
            "IMAGEM_Erro para ativar o PID de curva fechada (px)"
        )
        legacy_close_curve_error_keys = (
            "PID DE CURVA FECHADA_Erro para ativar o PID de curva fechada (px)",
            "PID DE CURVA FECHADA_Erro para iniciar (px)",
        )
        if close_curve_error_key not in data:
            for legacy_key in legacy_close_curve_error_keys:
                if legacy_key in data:
                    data[close_curve_error_key] = data[legacy_key]
                    break
        with _lock:
            _config.update(data)
    except Exception:
        pass


# ── Informações do veículo (espelha o que ctrl_panel.py mostra) ──────────────
_vehicle_lock = threading.Lock()
_vehicle_info: dict = {}


def update_vehicle_info(info: dict) -> None:
    """Recebe o mesmo tipo de snapshot passado a ControlPanel.update_vehicle_info,
    incluindo telemetria e o estado dos sinais (placa de pare / semáforo)."""
    with _vehicle_lock:
        _vehicle_info.clear()
        _vehicle_info.update(info)
        _vehicle_info["_ts"] = time.time()


# ── Câmeras ao vivo (mesmos 3 frames exibidos no painel Python) ──────────────
_frames_lock = threading.Lock()
_frame_jpegs: dict = {"road": None, "bird": None, "sign": None}
_JPEG_QUALITY = 70


def update_frames(road_frame=None, bird_frame=None, sign_frame=None) -> None:
    """Codifica os frames mais recentes em JPEG para os streams MJPEG do painel web."""
    encoded = {}
    for key, frame in (("road", road_frame), ("bird", bird_frame), ("sign", sign_frame)):
        if frame is None or getattr(frame, "size", 0) == 0:
            continue
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, _JPEG_QUALITY])
        if ok:
            encoded[key] = buf.tobytes()
    if not encoded:
        return
    with _frames_lock:
        _frame_jpegs.update(encoded)


# ── Log (espelha panel.log(...) do painel Python) ────────────────────────────
_log_lock = threading.Lock()
_log_entries = deque(maxlen=300)
_log_next_id = 1


def push_log(msg, tag="info") -> None:
    global _log_next_id
    with _log_lock:
        _log_entries.append({
            "id": _log_next_id,
            "ts": time.strftime("%H:%M:%S"),
            "msg": str(msg),
            "tag": tag,
        })
        _log_next_id += 1


# Zonas dos ultrassônicos (0 livre, 1 longe, 2 perto, 3 crítico) -> distância em cm
# para as ondas do Digital Twin, que usam a escala 0-60 cm:
# acima de 40 cm acende branco, de 20 a 40 amarelo, abaixo de 20 vermelho.
_ZONE_TO_CM = {1: 50, 2: 30, 3: 8}


def _zone_to_cm(zone):
    try:
        return _ZONE_TO_CM.get(int(zone))
    except (TypeError, ValueError):
        return None


def update_state(pwm, running, *, real_speed=None, battery=None,
                  stop_active=None, traffic_light_code=None,
                  traffic_light_label=None,
                  right_detour_active=None,
                  wheel_speeds=None, ultrasonic=None) -> None:
    """Atualiza o estado do Digital Twin.

    `pwm`/`running` seguem o comportamento antigo (indicador de PWM e farol).
    Os demais parâmetros, quando informados, vêm direto de car.telemetry e do
    estado dos sinais (placa de PARE / semáforo / desvio à direita), para o
    velocímetro, a bateria e os indicadores de sinalização do Digital Twin.
    """
    with _lock:
        _state["tabDashboard_rpm"]     = round(pwm * _PWM_TO_RPM)
        _state["tabDashboard_light"]   = running and pwm > 0
        _state["tabDashboard_running"] = bool(running)
        if real_speed is not None:
            try:
                _state["tabDashboard_speed"] = round(float(real_speed), 2)
            except (TypeError, ValueError):
                pass
        if battery is not None:
            try:
                _state["tabDashboard_battery"] = int(battery)
            except (TypeError, ValueError):
                pass
        if stop_active is not None:
            _state["tabDashboard_stop_active"] = bool(stop_active)
        if traffic_light_code is not None:
            try:
                _state["tabDashboard_traffic_light_code"] = int(traffic_light_code)
            except (TypeError, ValueError):
                pass
        if traffic_light_label is not None:
            _state["tabDashboard_traffic_light_label"] = str(traffic_light_label)
        if right_detour_active is not None:
            _state["tabDashboard_right_detour_active"] = bool(right_detour_active)
        if wheel_speeds is not None:
            for index, value in enumerate(list(wheel_speeds)[:4], start=1):
                try:
                    _state[f"tabDashboard_speed{index}"] = round(float(value), 2)
                except (TypeError, ValueError):
                    pass
        if ultrasonic is not None:
            # Carro visto de cima apontando para a esquerda: o topo da tela é o lado
            # direito do carro. Ponta superior = right, centro = pior frontal, ponta inferior = left.
            left = ultrasonic.get("left", 0)
            right = ultrasonic.get("right", 0)
            front = max(int(ultrasonic.get("f_left", 0) or 0), int(ultrasonic.get("f_right", 0) or 0))
            _state["tabDashboard_sensor_1"] = _zone_to_cm(right)
            _state["tabDashboard_sensor_2"] = _zone_to_cm(front)
            _state["tabDashboard_sensor_3"] = _zone_to_cm(left)


# ── Ações do painel web que dependem de objetos do main.py ───────────────────
# O main.py registra aqui as mesmas funções que o painel Python executa
# (rota, controle remoto, fechar), já que o servidor não conhece nav/rc/panel.
_actions_lock = threading.Lock()
_actions: dict = {}


def register_action(name: str, fn) -> None:
    with _actions_lock:
        _actions[name] = fn


def _run_action(name: str, *args):
    with _actions_lock:
        fn = _actions.get(name)
    if fn is None:
        return False, "Ação indisponível (main.py não registrou)"
    try:
        result = fn(*args)
    except Exception as exc:
        return False, str(exc)
    return True, result


# ── Reconexão pedida pelo painel web (consumida pelo loop do main.py) ────────
_reconnect_lock = threading.Lock()
_reconnect_request: dict | None = None


def pop_reconnect_request() -> dict | None:
    """Retorna {"com": str|None} se o painel web pediu reconexão (com=None = modo teste)."""
    global _reconnect_request
    with _reconnect_lock:
        req, _reconnect_request = _reconnect_request, None
    return req


def pop_config_update() -> dict | None:
    """Retorna config se o painel web a atualizou, senão None. Limpa o flag."""
    global _config_updated
    with _lock:
        if _config_updated:
            _config_updated = False
            return dict(_config)
        return None


def get_local_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


# ── CORS ─────────────────────────────────────────────────────────────────────
@app.after_request
def _add_cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response


# ── API: telemetria ───────────────────────────────────────────────────────────
@app.route("/api/dashboard")
def api_dashboard():
    with _lock:
        snapshot = dict(_state)
    return jsonify({"data": snapshot})


# ── API: painel de controle ───────────────────────────────────────────────────
@app.route("/api/config", methods=["GET"])
def api_config_get():
    with _lock:
        snapshot = dict(_config)
    return jsonify(snapshot)


@app.route("/api/config", methods=["POST"])
def api_config_post():
    global _config_updated
    data = request.get_json(force=True, silent=True) or {}
    with _lock:
        _config.update(data)
        _config_updated = True
    return jsonify({"ok": True})


@app.route("/api/reset", methods=["POST"])
def api_reset():
    global _config_updated
    try:
        with open(_CONFIG_PATH, encoding="utf-8") as f:
            saved = json.load(f)
        with _lock:
            for k, v in saved.items():
                if k in _config:
                    _config[k] = v
            _config_updated = True
            snapshot = dict(_config)
        push_log("[PAINEL WEB] Valores restaurados do config.json", "info")
        return jsonify({"ok": True, "config": snapshot})
    except FileNotFoundError:
        push_log("[PAINEL WEB] Nenhum config.json encontrado", "error")
        return jsonify({"ok": False, "error": "config.json não encontrado"}), 404
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/save", methods=["POST"])
def api_save():
    """Grava a configuração atual no config.json (mesmo efeito do Salvar do painel Python)."""
    data = request.get_json(force=True, silent=True) or {}
    with _lock:
        _config.update({k: v for k, v in data.items() if k != "running"})
        snapshot = {k: v for k, v in _config.items() if k != "running"}
    try:
        os.makedirs(os.path.dirname(_CONFIG_PATH), exist_ok=True)
        with open(_CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(snapshot, f, indent=4)
    except Exception as e:
        push_log(f"[PAINEL WEB] Falha ao salvar: {e}", "error")
        return jsonify({"ok": False, "error": str(e)}), 500
    push_log("[PAINEL WEB] Configurações salvas", "info")
    return jsonify({"ok": True})


# ── API: conexão (porta COM / modo teste) ─────────────────────────────────────
@app.route("/api/ports")
def api_ports():
    try:
        from serial.tools import list_ports
        ports = [p.device for p in list_ports.comports()]
    except Exception:
        ports = []
    return jsonify({"ports": ports})


@app.route("/api/reconnect", methods=["POST"])
def api_reconnect():
    global _reconnect_request
    data = request.get_json(force=True, silent=True) or {}
    test_mode = bool(data.get("test_mode"))
    com = None if test_mode else (str(data.get("com") or "").strip() or None)
    if not test_mode and com is None:
        push_log("[CONEXÃO] Selecione uma porta COM ou ative o modo teste", "warn")
        return jsonify({"ok": False, "error": "Selecione uma porta COM ou ative o modo teste"}), 400
    with _reconnect_lock:
        _reconnect_request = {"com": com}
    if test_mode:
        push_log("[CONEXÃO] Modo teste ativado (painel web)", "info")
    else:
        push_log(f"[CONEXÃO] Reconectando → COM={com} (painel web)", "info")
    return jsonify({"ok": True})


# ── API: ações que dependem do main.py (rota, controle remoto, fechar) ────────
@app.route("/api/route", methods=["POST"])
def api_route_add():
    data = request.get_json(force=True, silent=True) or {}
    point = str(data.get("point") or "").strip().upper()
    if point not in ("A", "B", "C"):
        return jsonify({"ok": False, "error": "Ponto inválido"}), 400
    ok, result = _run_action("add_route_point", point)
    status = 200 if ok else 503
    return jsonify({"ok": ok, "route": result if ok else None, "error": None if ok else result}), status


@app.route("/api/remote/<op>", methods=["POST"])
def api_remote(op):
    if op not in ("connect", "disconnect"):
        return jsonify({"ok": False, "error": "Operação inválida"}), 404
    ok, result = _run_action(f"remote_{op}")
    status = 200 if ok else 503
    return jsonify({"ok": ok, "feedback": result if ok else None, "error": None if ok else result}), status


@app.route("/api/close", methods=["POST"])
def api_close():
    ok, result = _run_action("close")
    status = 200 if ok else 503
    return jsonify({"ok": ok, "error": None if ok else result}), status


@app.route("/api/qrcode")
def api_qrcode():
    """QR Code do link do Digital Twin (mesmo do botão QR Code do painel Python)."""
    import io
    import qrcode
    url = request.host_url.rstrip("/")
    qr = qrcode.QRCode(box_size=6, border=3)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#cdd6f4", back_color="#1e1e2e")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(buf.getvalue(), mimetype="image/png")


# ── API: informações do veículo (telemetria, PID, placa de pare, semáforo) ───
@app.route("/api/vehicle_info")
def api_vehicle_info():
    with _vehicle_lock:
        snapshot = dict(_vehicle_info)
    return jsonify(snapshot)


# ── API: log (espelha o console do painel Python) ────────────────────────────
@app.route("/api/log")
def api_log():
    since = request.args.get("since", type=int, default=0)
    with _log_lock:
        entries = [e for e in _log_entries if e["id"] > since] if since else list(_log_entries)[-50:]
        latest = _log_next_id - 1
    return jsonify({"entries": entries, "latest": latest})


# ── API: câmeras ao vivo (MJPEG) ──────────────────────────────────────────────
def _mjpeg_generator(key):
    boundary = b"--frame"
    while True:
        with _frames_lock:
            jpg = _frame_jpegs.get(key)
        if jpg is not None:
            yield (boundary + b"\r\nContent-Type: image/jpeg\r\nContent-Length: "
                   + str(len(jpg)).encode() + b"\r\n\r\n" + jpg + b"\r\n")
        time.sleep(0.05)  # limita a ~20 FPS por cliente


@app.route("/api/stream/<key>")
def api_stream(key):
    if key not in _frame_jpegs:
        return jsonify({"error": "stream desconhecido"}), 404
    return Response(_mjpeg_generator(key), mimetype="multipart/x-mixed-replace; boundary=frame")


# ── Painel de controle web ────────────────────────────────────────────────────
@app.route("/panel")
def panel_page():
    return _PANEL_HTML


# ── Olhos do carro (EyesFront, arquivos estáticos) ────────────────────────────
# A barra final importa: o index.html dos olhos usa caminhos relativos (./src/...).
@app.route("/eyes")
def eyes_redirect():
    return redirect("/eyes/")


@app.route("/eyes/")
@app.route("/eyes/<path:filename>")
def eyes_static(filename="index.html"):
    return send_from_directory(_EYES_DIR, filename)


# ── Mapa 3D da pista (RoadPanel, arquivos estáticos) ──────────────────────────
@app.route("/road")
def road_redirect():
    return redirect("/road/")


@app.route("/road/")
@app.route("/road/<path:filename>")
def road_static(filename="index.html"):
    return send_from_directory(_ROAD_DIR, filename)


# ── Digital Twin (arquivos estáticos) ─────────────────────────────────────────
@app.route("/")
def index():
    if not os.path.isfile(os.path.join(_TWIN_DIR, "index.html")):
        return redirect(url_for("panel_page"))
    return send_from_directory(_TWIN_DIR, "index.html")


@app.route("/<path:filename>")
def twin_static(filename):
    return send_from_directory(_TWIN_DIR, filename)


# ── HTML do painel web ────────────────────────────────────────────────────────
_PANEL_HTML = """<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#181825">
<title>Interface de Controle ─ APEX</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
:root{
  --bg:#1e1e2e;--surface:#181825;--card:#313244;--border:#45475a;--console:#11111b;
  --fg:#cdd6f4;--muted:#6c7086;--blue:#89b4fa;--green:#a6e3a1;
  --red:#f38ba8;--orange:#fab387;--purple:#cba6f7;--teal:#94e2d5;
  --radius:10px;--font:'Cascadia Code','Consolas','Courier New',monospace;
}
html{height:100%;overflow-x:hidden}
body{background:var(--bg);color:var(--fg);font-family:var(--font);min-height:100%;padding-bottom:env(safe-area-inset-bottom)}

/* ── Sticky bar: header + status + actions ── */
.top-bar{position:sticky;top:0;z-index:20;background:var(--bg)}

/* ── Header ── */
header{
  background:var(--surface);padding:14px 16px;
  display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  border-bottom:1px solid var(--border);
  padding-top:calc(14px + env(safe-area-inset-top));
}
header h1{font-size:14px;color:var(--fg);flex:1;letter-spacing:1px;white-space:nowrap}
.back-btn{
  background:var(--blue);color:#1e1e2e;border:none;
  padding:9px 14px;border-radius:8px;
  font-family:var(--font);font-size:12px;font-weight:bold;
  cursor:pointer;white-space:nowrap;min-height:40px;
  -webkit-appearance:none;
}
.back-btn:active{opacity:.75}

/* ── Status pill ── */
.status-pill{
  display:flex;align-items:center;gap:6px;
  background:var(--card);border-radius:20px;
  padding:6px 12px;margin:10px 16px 0;font-size:11px;color:var(--muted);
}
.dot{width:8px;height:8px;border-radius:50%;background:var(--border);flex-shrink:0;transition:background .3s,box-shadow .3s}
.dot.on{background:var(--green);box-shadow:0 0 8px var(--green)}
#statusText{flex:1}

/* ── Action buttons ── */
.actions{display:grid;grid-template-columns:repeat(4,1fr) auto;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border)}
.btn{
  padding:10px 8px;border:none;border-radius:var(--radius);
  font-family:var(--font);font-size:12px;font-weight:bold;
  cursor:pointer;min-height:40px;-webkit-appearance:none;
  transition:opacity .1s,transform .1s;
}
.btn:active{opacity:.75;transform:scale(.97)}
.btn-start{background:var(--green);color:#1e1e2e}
.btn-stop {background:var(--red);color:#1e1e2e}
.btn-reset{background:var(--orange);color:#1e1e2e}
.btn-save {background:var(--purple);color:#1e1e2e}
@media(max-width:520px){.actions{grid-template-columns:1fr 1fr}.actions .btn-close{grid-column:1/-1}}

/* ── Indicadores de sinais (placa de pare / semáforo / motivo da parada) ── */
.signal-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px 16px}
@media(min-width:640px){.signal-row{grid-template-columns:repeat(3,1fr)}}
.pill{
  border-radius:var(--radius);padding:10px 12px;text-align:center;
  border:1px solid var(--border);background:var(--surface);
}
.pill-label{font-size:9px;letter-spacing:1.4px;color:var(--muted);text-transform:uppercase;margin-bottom:4px}
.pill-value{font-size:13px;font-weight:bold}
.pill-muted .pill-value{color:var(--muted)}
.pill-green .pill-value{color:var(--green)}
.pill-red .pill-value{color:var(--red)}
.pill-orange .pill-value{color:var(--orange)}
.pill-blue .pill-value{color:var(--blue)}

/* ── Câmeras ao vivo ── */
.cam-section{padding:4px 16px 6px}
.cam-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;flex-wrap:wrap}
.cam-hint{color:var(--muted);font-size:10px}
.cam-grid{display:grid;grid-template-columns:1fr;gap:10px}
@media(min-width:720px){.cam-grid{grid-template-columns:1fr 1fr 1fr}}
.cam-grid[hidden]{display:none}
.cam-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:8px;display:flex;flex-direction:column;gap:6px}
.cam-img-wrap{background:var(--console);border-radius:6px;aspect-ratio:4/3;display:flex;align-items:center;justify-content:center;overflow:hidden}
.cam-img-wrap img{width:100%;height:100%;object-fit:contain}
.cam-caption{color:var(--muted);font-size:9px}

/* ── Switch (mostrar/esconder câmeras) ── */
.switch{display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;font-size:11px;color:var(--muted);white-space:nowrap}
.switch input{display:none}
.switch-track{width:34px;height:19px;background:var(--border);border-radius:999px;position:relative;transition:background .2s;flex-shrink:0}
.switch-thumb{position:absolute;top:2px;left:2px;width:15px;height:15px;background:var(--fg);border-radius:50%;transition:transform .2s}
.switch input:checked ~ .switch-track{background:var(--green)}
.switch input:checked ~ .switch-track .switch-thumb{transform:translateX(15px);background:#1e1e2e}

/* ── Tabs ── */
.tabs{display:flex;gap:2px;padding:0 16px;border-bottom:1px solid var(--border);overflow-x:auto}
.tab-btn{
  background:var(--card);color:var(--muted);border:none;
  padding:10px 14px;font-family:var(--font);font-size:11px;font-weight:bold;
  cursor:pointer;white-space:nowrap;border-bottom:2px solid transparent;
  -webkit-appearance:none;
}
.tab-btn.active{color:var(--blue);border-bottom:2px solid var(--teal)}
.tab-content{display:none;padding:12px 16px 24px}
.tab-content.active{display:block}

/* ── Grid de seções (sliders) ── */
.grid{display:grid;grid-template-columns:1fr;gap:10px}
@media(min-width:560px){.grid{grid-template-columns:1fr 1fr}}

/* ── Section card ── */
.section{background:var(--surface);border-radius:var(--radius);padding:14px 16px;border:1px solid var(--border);margin-bottom:10px}
.section-title{
  color:var(--blue);font-size:10px;font-weight:bold;letter-spacing:1.8px;
  margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border);
  text-transform:uppercase;
}

/* ── Control row ── */
.ctrl{padding:6px 0}
.ctrl+.ctrl{border-top:1px solid var(--border)}
.ctrl-header{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
.ctrl-label{font-size:12px;color:var(--fg)}
.ctrl-val{
  font-size:13px;font-weight:bold;color:var(--blue);
  min-width:52px;text-align:right;
}
.ctrl-warning{color:var(--red);font-size:9px;font-weight:bold;margin-top:4px;display:block}

/* ── Range slider ── */
.range-wrap{position:relative;height:36px;display:flex;align-items:center}
input[type=range]{
  width:100%;height:4px;
  -webkit-appearance:none;appearance:none;
  background:var(--border);border-radius:2px;cursor:pointer;
  outline:none;
}
input[type=range]::-webkit-slider-thumb{
  -webkit-appearance:none;
  width:22px;height:22px;border-radius:50%;
  background:var(--blue);cursor:pointer;
  box-shadow:0 1px 4px rgba(0,0,0,.5);
}
input[type=range]::-moz-range-thumb{
  width:22px;height:22px;border-radius:50%;border:none;
  background:var(--blue);cursor:pointer;
}
input[type=range]::-webkit-slider-runnable-track{border-radius:2px}

/* ── Edit toggle ── */
.edit-btn{
  background:transparent;border:1.5px solid var(--muted);color:var(--muted);
  padding:8px 10px;border-radius:8px;cursor:pointer;min-height:40px;
  display:flex;align-items:center;justify-content:center;
  transition:border-color .2s,color .2s,background .2s;
  -webkit-appearance:none;flex-shrink:0;
}
.edit-btn:active{opacity:.75}
.edit-btn.active{border-color:var(--blue);color:var(--blue);background:rgba(137,180,250,.12)}
.edit-btn svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}

/* ── Sliders bloqueados ── */
input[type=range]:disabled{opacity:.35;cursor:not-allowed}
input[type=range]:disabled::-webkit-slider-thumb{background:var(--muted);cursor:not-allowed;box-shadow:none}
input[type=range]:disabled::-moz-range-thumb{background:var(--muted);cursor:not-allowed}

/* ── PID card ── */
.pid-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 16px;margin-bottom:12px}
.pid-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:18px}
.pid-col-title{color:var(--teal);font-weight:bold;margin-bottom:6px}
.pid-term{color:var(--teal);font-weight:bold;font-size:12px;padding:2px 0}

/* ── Informações do carro ── */
.status-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap}
.status-card .big{font-size:15px;font-weight:bold}
.status-card .small{color:var(--muted);font-size:10px}

.metrics-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
@media(min-width:640px){.metrics-grid{grid-template-columns:repeat(4,1fr)}}
.metric-card{background:var(--console);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px}
.metric-value{color:var(--blue);font-size:19px;font-weight:bold}
.metric-label{color:var(--muted);font-size:9px;font-weight:bold;margin-top:2px;letter-spacing:.5px}

.info-grid{display:grid;grid-template-columns:1fr;gap:12px;margin-bottom:12px}
@media(min-width:720px){.info-grid{grid-template-columns:1fr 1fr}}
.info-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 16px}
.info-row{display:flex;justify-content:space-between;gap:10px;padding:4px 0}
.info-row+.info-row{border-top:1px solid var(--border)}
.info-row .val{color:var(--teal);font-weight:bold;text-align:right}

.raw-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 16px}
.raw-card .raw-text{color:var(--teal);font-size:12px;word-break:break-all}

/* ── Log ── */
.log-box{background:var(--console);border-radius:6px;padding:8px;height:260px;overflow-y:auto;font-size:11px}
.log-line{padding:2px 0}
.log-ts{color:var(--muted)}
.conn-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 16px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.log-header{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.log-header .section-title{margin:0;padding:0;border:none;flex:1}
.link-btn{background:transparent;border:none;color:var(--muted);font-family:var(--font);font-size:11px;cursor:pointer;padding:4px 6px}
.link-btn:hover{color:var(--fg)}

/* ── Botões secundários (mesmas cores do painel Python) ── */
.btn-close{background:var(--border);color:var(--fg)}
.btn-teal{background:var(--teal);color:#1e1e2e}
.btn-green{background:var(--green);color:#1e1e2e}
.btn-red{background:var(--red);color:#1e1e2e}
.btn-purple{background:var(--purple);color:#1e1e2e}
.btn-blue{background:var(--blue);color:#1e1e2e}
.btn-dark{background:var(--border);color:var(--fg)}
.btn-block{width:100%}
.btn-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.stack{display:flex;flex-direction:column;gap:8px}

/* ── Cabeçalho das câmeras ── */
.cam-title{color:var(--blue);font-size:10px;font-weight:bold;letter-spacing:1.4px}

/* ── Slider de velocidade: faixa vermelha abaixo do mínimo de 30 PWM (igual ao painel Python) ── */
input[type=range].speed{background:linear-gradient(to right,var(--red) 0,var(--red) 15%,var(--border) 15.1%,var(--border) 100%)}

/* ── Velocidade das rodas ── */
.wheel-grid{display:grid;grid-template-columns:1fr;gap:10px 16px}
@media(min-width:560px){.wheel-grid{grid-template-columns:1fr 1fr}}
.wheel-head{display:flex;justify-content:space-between;margin-bottom:5px;font-size:12px}
.wheel-head .val{color:var(--teal);font-weight:bold}
.bar{height:12px;background:var(--console);border:1px solid var(--border);border-radius:5px;overflow:hidden}
.bar-fill{height:100%;width:0;background:var(--blue);border-radius:4px;transition:width .3s}

/* ── Métrica da bateria (percentual + estado) ── */
.metric-sub{color:var(--teal);font-size:11px;font-weight:bold;margin-top:2px}

/* ── Formulários (rota / conexão) ── */
.form-row{display:flex;align-items:center;gap:10px;padding:4px 0;flex-wrap:wrap}
.form-row .grow{flex:1}
select{
  background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:6px;
  padding:8px 10px;font-family:var(--font);font-size:12px;min-height:38px;min-width:80px;
}
.icon-btn{background:transparent;border:none;color:var(--blue);font-weight:bold;font-size:18px;cursor:pointer;min-width:34px;min-height:38px}
.check{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;padding:6px 0;user-select:none}
.check input{width:16px;height:16px;accent-color:var(--blue)}
.muted-small{color:var(--muted);font-size:10px;word-break:break-all}
.teal-text{color:var(--teal);font-weight:bold;font-size:12px;word-break:break-word}
.ops-grid{display:grid;grid-template-columns:1fr;gap:12px;margin-bottom:12px}
@media(min-width:720px){.ops-grid{grid-template-columns:1fr 1fr}}
.ops-grid .info-card{display:flex;flex-direction:column;gap:8px}

/* ── Modal do QR Code ── */
.modal{position:fixed;inset:0;background:rgba(17,17,27,.8);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px}
.modal[hidden]{display:none}
.modal-box{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:16px;display:flex;flex-direction:column;align-items:center;gap:10px;max-width:100%}
.modal-box img{max-width:100%;image-rendering:pixelated}
.modal-box .url{color:var(--blue);font-size:10px;word-break:break-all;text-align:center}
</style>
</head>
<body>

<div class="top-bar">
  <header>
    <h1>Interface de Controle ─ APEX</h1>
    <button class="edit-btn" id="editBtn" title="Editar configurações" onclick="toggleEdit()">
      <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
    </button>
    <button class="back-btn" onclick="window.location.href='/'">← Digital Twin</button>
  </header>

  <div class="status-pill">
    <div class="dot" id="runDot"></div>
    <span id="statusText">Carregando...</span>
  </div>

  <div class="actions">
    <button class="btn btn-start" onclick="setRunning(true)">▶ Iniciar</button>
    <button class="btn btn-stop"  onclick="setRunning(false)">■ Parar</button>
    <button class="btn btn-reset" onclick="resetConfig()">↻ Resetar</button>
    <button class="btn btn-save"  onclick="saveConfig()">Salvar</button>
    <button class="btn btn-close" onclick="closeSystem()" title="Fechar painel">✕ Fechar</button>
  </div>

  <div class="signal-row">
    <div class="pill pill-muted" id="pillStop">
      <div class="pill-label">Placa de pare</div>
      <div class="pill-value" id="pillStopValue">—</div>
    </div>
    <div class="pill pill-muted" id="pillLight">
      <div class="pill-label">Semáforo</div>
      <div class="pill-value" id="pillLightValue">—</div>
    </div>
    <div class="pill pill-muted" id="pillReason">
      <div class="pill-label">Veículo</div>
      <div class="pill-value" id="pillReasonValue">—</div>
    </div>
  </div>

  <div class="cam-section">
    <div class="cam-toolbar">
      <div class="cam-hint">Câmeras ao vivo — atualização de até 30 FPS, sem fila de frames.</div>
      <label class="switch">
        <input type="checkbox" id="camToggle" checked onchange="toggleCameras(this.checked)">
        <span class="switch-track"><span class="switch-thumb"></span></span>
        <span>Mostrar câmeras</span>
      </label>
    </div>
    <div class="cam-grid" id="camGrid">
      <div class="cam-card">
        <div class="cam-title">CÂMERA DA PISTA</div>
        <div class="cam-img-wrap"><img data-src="/api/stream/road" alt="Aguardando câmera" loading="lazy"></div>
        <div class="cam-caption">Imagem original com região de interesse</div>
      </div>
      <div class="cam-card">
        <div class="cam-title">BIRD-EYE VIEW</div>
        <div class="cam-img-wrap"><img data-src="/api/stream/bird" alt="Aguardando câmera" loading="lazy"></div>
        <div class="cam-caption">Bird-eye view e detecção de faixas</div>
      </div>
      <div class="cam-card">
        <div class="cam-title">SINAIS</div>
        <div class="cam-img-wrap"><img data-src="/api/stream/sign" alt="Aguardando câmera" loading="lazy"></div>
        <div class="cam-caption">Elementos detectados pelo modelo de IA</div>
      </div>
    </div>
  </div>

  <div class="tabs">
    <button class="tab-btn active" data-tab="tabPista" onclick="showTab('tabPista')">Pista e direção</button>
    <button class="tab-btn" data-tab="tabCarro" onclick="showTab('tabCarro')">Carro e sinais</button>
    <button class="tab-btn" data-tab="tabInfo" onclick="showTab('tabInfo')">Informações do carro</button>
    <button class="tab-btn" data-tab="tabLog" onclick="showTab('tabLog')">Conexão e registros</button>
  </div>
</div>

<div class="tab-content active" id="tabPista">
  <div class="pid-card">
    <div class="section-title" style="margin-bottom:10px">PID da direção</div>
    <div class="pid-grid">
      <div>
        <div class="pid-col-title">RETA</div>
        <div class="pid-term" id="pidRETA_Kp">Kp: --</div>
        <div class="pid-term" id="pidRETA_Ki">Ki: --</div>
        <div class="pid-term" id="pidRETA_Kd">Kd: --</div>
      </div>
      <div>
        <div class="pid-col-title">CURVA</div>
        <div class="pid-term" id="pidCURVA_Kp">Kp: --</div>
        <div class="pid-term" id="pidCURVA_Ki">Ki: --</div>
        <div class="pid-term" id="pidCURVA_Kd">Kd: --</div>
      </div>
      <div>
        <div class="pid-col-title">CURVA FECHADA</div>
        <div class="pid-term" id="pidCURVA_FECHADA_Kp">Kp: --</div>
        <div class="pid-term" id="pidCURVA_FECHADA_Ki">Ki: --</div>
        <div class="pid-term" id="pidCURVA_FECHADA_Kd">Kd: --</div>
      </div>
    </div>
  </div>
  <div class="grid" id="gridPista"></div>
</div>

<div class="tab-content" id="tabCarro">
  <div class="grid" id="gridCarro"></div>
</div>

<div class="tab-content" id="tabInfo">
  <div class="status-card">
    <span class="big" id="vehicleStatus" style="color:var(--orange)">AGUARDANDO DADOS</span>
    <span class="small" id="vehicleLastUpdate">Sem atualização</span>
  </div>
  <div class="metrics-grid">
    <div class="metric-card"><div class="metric-value" id="mSpeedReceived">--</div><div class="metric-label">VELOCIDADE ESTIMADA</div></div>
    <div class="metric-card"><div class="metric-value" id="mBattery">--%</div><div class="metric-sub" id="mBatteryState">--</div><div class="metric-label">BATERIA</div></div>
    <div class="metric-card"><div class="metric-value" id="mSpeedApplied">--</div><div class="metric-label">PWM APLICADO</div></div>
    <div class="metric-card"><div class="metric-value" id="mServo">--</div><div class="metric-label">SERVO</div></div>
  </div>
  <div class="info-card" style="margin-bottom:12px">
    <div class="section-title">Velocidade das rodas</div>
    <div class="wheel-grid" id="wheelGrid"></div>
  </div>
  <div class="info-grid">
    <div class="info-card">
      <div class="section-title">Controle e HUD</div>
      <div class="info-row"><span>Modo de controle</span><span class="val" id="iControlMode">--</span></div>
      <div class="info-row"><span>Erro da faixa</span><span class="val" id="iError">--</span></div>
      <div class="info-row"><span>Modo PID</span><span class="val" id="iPidMode">--</span></div>
      <div class="info-row"><span>Sinais detectados</span><span class="val" id="iSignals">--</span></div>
    </div>
    <div class="info-card">
      <div class="section-title">Ultrassônicos</div>
      <div class="info-row"><span>Esquerdo</span><span class="val" id="iLeft">--</span></div>
      <div class="info-row"><span>Frontal esquerdo</span><span class="val" id="iFLeft">--</span></div>
      <div class="info-row"><span>Frontal direito</span><span class="val" id="iFRight">--</span></div>
      <div class="info-row"><span>Direito</span><span class="val" id="iRight">--</span></div>
    </div>
    <div class="info-card" style="grid-column:1/-1">
      <div class="section-title">Módulos</div>
      <div id="canModules"><div class="info-row"><span>Nenhum módulo conectado</span></div></div>
    </div>
    <div class="info-card" style="grid-column:1/-1">
      <div class="section-title">Pontos de parada</div>
      <div class="form-row">
        <span class="grow">Adicionar ponto</span>
        <select id="routePoint"><option>A</option><option>B</option><option>C</option></select>
        <button class="btn btn-green" onclick="addRoutePoint()">Adicionar</button>
      </div>
      <div class="info-row"><span>Rota atual</span><span class="val" id="iRoute">Nenhum ponto</span></div>
    </div>
  </div>
  <div class="raw-card">
    <div class="section-title">Último retorno do Arduino</div>
    <div class="raw-text" id="rawRx">Nenhum retorno recebido</div>
  </div>
</div>

<div class="tab-content" id="tabLog">
  <div class="ops-grid">
    <div class="info-card">
      <div class="section-title">Conexão</div>
      <div class="form-row">
        <span>COM</span>
        <select id="comSelect" class="grow"></select>
        <button class="icon-btn" title="Atualizar portas" onclick="refreshPorts(true)">↻</button>
      </div>
      <div class="info-row"><span>ID da câmera</span><span class="val" id="iCameraId">--</span></div>
      <label class="check"><input type="checkbox" id="testMode"> Sem Arduino (modo teste)</label>
      <button class="btn btn-teal btn-block" onclick="reconnect()">Reconectar</button>
    </div>
    <div class="info-card">
      <div class="section-title">Mensageria</div>
      <div class="muted-small" id="apiUrl">API: --</div>
      <div class="btn-row">
        <button class="btn btn-green" onclick="window.location.href='/'">Abrir Digital Twin</button>
        <button class="btn btn-blue" onclick="window.open('/eyes/','_blank')" title="Abre os olhos do carro em uma nova aba">Abrir EyesFront</button>
      </div>
      <button class="btn btn-teal btn-block" onclick="window.open('/road/','_blank')" title="Abre o mapa 3D da pista em uma nova aba">Abrir mapa da pista</button>
      <button class="btn btn-dark btn-block" id="copyBtn" onclick="copyLink()">Copiar link</button>
      <button class="btn btn-purple btn-block" onclick="showQr(true)">QR Code</button>
      <div class="info-row"><span>Conexão com a API</span><span class="val" id="connStatus" style="color:var(--muted)">Verificando...</span></div>
    </div>
    <div class="info-card">
      <div class="section-title">Controle remoto</div>
      <div class="teal-text" id="remoteStatus">--</div>
      <div class="btn-row">
        <button class="btn btn-green" onclick="remoteAction('connect')">Conectar</button>
        <button class="btn btn-red" onclick="remoteAction('disconnect')">Desconectar</button>
      </div>
    </div>
  </div>
  <div class="log-header">
    <div class="section-title">Log</div>
    <button class="link-btn" onclick="clearLog()">limpar</button>
  </div>
  <div class="log-box" id="logBox"></div>
</div>

<div class="modal" id="qrModal" hidden onclick="showQr(false)">
  <div class="modal-box" onclick="event.stopPropagation()">
    <img id="qrImg" alt="QR Code do Dashboard">
    <div class="url" id="qrUrl"></div>
    <button class="btn btn-dark" onclick="showQr(false)">Fechar</button>
  </div>
</div>

<script>
const LOG_COLORS={info:'var(--blue)',ok:'var(--green)',warn:'var(--orange)',error:'var(--red)',rx:'var(--green)',tx:'var(--blue)'};
const SENSOR_LABELS={0:['LIVRE','var(--green)'],1:['DISTANTE','var(--blue)'],2:['PRÓXIMA','var(--orange)'],3:['CRÍTICA','var(--red)']};

const CONTROL_SECTIONS=[
  {title:"ROI",controls:[
    {key:"ROI_Linha superior",label:"Linha superior",min:0,max:1280,default:1280},
    {key:"ROI_Linha inferior",label:"Linha inferior",min:0,max:1280,default:1280},
    {key:"ROI_Altura sup",    label:"Altura sup",    min:0,max:720, default:263},
    {key:"ROI_Altura inf",    label:"Altura inf",    min:0,max:720, default:541},
  ]},
  {title:"IMAGEM",controls:[
    {key:"IMAGEM_Limiar",            label:"Limiar",            min:0,max:255,default:195},
    {key:"IMAGEM_Erro de transição", label:"Erro de transição", min:0,max:100,default:12},
    {key:"IMAGEM_Erro para ativar o PID de curva fechada (px)",label:"Erro para ativar o PID de curva fechada (px)",min:0,max:160,default:80},
  ]},
  {title:"RETA",controls:[
    {key:"RETA_Kp",label:"Kp",min:0,max:1000,default:200},
    {key:"RETA_Ki",label:"Ki",min:0,max:1000,default:0},
    {key:"RETA_Kd",label:"Kd",min:0,max:1000,default:5},
  ]},
  {title:"CURVA",controls:[
    {key:"CURVA_Kp",label:"Kp",min:0,max:1000,default:650},
    {key:"CURVA_Ki",label:"Ki",min:0,max:1000,default:0},
    {key:"CURVA_Kd",label:"Kd",min:0,max:1000,default:0},
  ]},
  {title:"PID DE CURVA FECHADA",controls:[
    {key:"PID DE CURVA FECHADA_Kp",label:"Kp",min:0,max:1000,default:650},
    {key:"PID DE CURVA FECHADA_Ki",label:"Ki",min:0,max:1000,default:0},
    {key:"PID DE CURVA FECHADA_Kd",label:"Kd",min:0,max:1000,default:0},
  ]},
];

const SIGNAL_SECTIONS=[
  {title:"PARÂMETROS DO CARRO",controls:[
    {key:"PARÂMETROS DO CARRO_PWM",label:"PWM",min:0,max:255,default:40,speed:true},
    {key:"PARÂMETROS DO CARRO_Velocidade na curva (PWM)",label:"Velocidade na curva (PWM)",min:0,max:255,default:70,speed:true},
    {key:"PARÂMETROS DO CARRO_Erro para iniciar velocidade na curva (px)",label:"Erro para iniciar velocidade na curva (px)",min:0,max:160,default:24},
    {key:"PARÂMETROS DO CARRO_Velocidade no amarelo (%)",label:"Velocidade no amarelo (%)",min:0,max:100,default:50},
    {key:"PARÂMETROS DO CARRO_Ângulo máximo",label:"Ângulo máximo",min:20,max:90,default:90},
    {key:"PARÂMETROS DO CARRO_Intervalo comando (ms)",label:"Intervalo comando (ms)",min:50,max:1000,default:200},
  ]},
  {title:"PARE",controls:[
    {key:"PARE_Confiança (%)",label:"Confiança (%)",min:0,max:100,default:40},
    {key:"PARE_Diagonal mínima da caixa (px)",label:"Diagonal mínima da caixa (px)",min:0,max:1000,default:0},
    {key:"PARE_Tempo de parada (s)",label:"Tempo de parada (s)",min:0,max:15,default:3},
    {key:"PARE_Cooldown (s)",label:"Cooldown (s)",min:0,max:15,default:3},
  ]},
  {title:"SEMÁFORO",controls:[
    {key:"SEMÁFORO_Confiança (%)",label:"Confiança (%)",min:0,max:100,default:80},
    {key:"SEMÁFORO_Diagonal mínima da caixa (px)",label:"Diagonal mínima da caixa (px)",min:0,max:1000,default:0},
    {key:"SEMÁFORO_Timeout (ms)",label:"Timeout (ms)",min:250,max:10000,default:2000},
    {key:"SEMÁFORO_Intervalo IA (frames)",label:"Intervalo IA (frames)",min:1,max:30,default:5},
  ]},
  {title:"DESVIO DIREITA",controls:[
    {key:"DESVIO DIREITA_Confiança (%)",label:"Confiança (%)",min:0,max:100,default:80},
    {key:"DESVIO DIREITA_Diagonal mínima da caixa (px)",label:"Diagonal mínima da caixa (px)",min:0,max:1000,default:0},
    {key:"DESVIO DIREITA_Frames seguidos",label:"Frames seguidos",min:1,max:30,default:3},
  ]},
  {title:"PESSOAS",controls:[
    {key:"PESSOAS_Confiança (%)",label:"Confiança (%)",min:0,max:100,default:50},
    {key:"PESSOAS_Diagonal mínima da caixa (px)",label:"Diagonal mínima da caixa (px)",min:0,max:1000,default:0},
  ]},
  {title:"PONTO A",controls:[
    {key:"PONTO A_Confiança (%)",label:"Confiança (%)",min:0,max:100,default:40},
    {key:"PONTO A_Diagonal mínima da caixa (px)",label:"Diagonal mínima da caixa (px)",min:0,max:1000,default:0},
  ]},
  {title:"PONTO B",controls:[
    {key:"PONTO B_Confiança (%)",label:"Confiança (%)",min:0,max:100,default:40},
    {key:"PONTO B_Diagonal mínima da caixa (px)",label:"Diagonal mínima da caixa (px)",min:0,max:1000,default:0},
  ]},
  {title:"PONTO C",controls:[
    {key:"PONTO C_Confiança (%)",label:"Confiança (%)",min:0,max:100,default:40},
    {key:"PONTO C_Diagonal mínima da caixa (px)",label:"Diagonal mínima da caixa (px)",min:0,max:1000,default:0},
  ]},
];

// Mesmos rótulos do painel Python
const WHEELS=[
  ['speed1','Roda frontal esquerda'],
  ['speed2','Roda traseira esquerda'],
  ['speed3','Roda frontal direita'],
  ['speed4','Roda traseira direita'],
];
const BATTERY_STATES=['Sem corrente','Carregando','Carregada','Descarregando','Bateria baixa'];

let debounceTimer=null,pendingUpdate={},currentConfig={},editMode=false,logCursor=0;

function showTab(id){
  document.querySelectorAll('.tab-content').forEach(el=>el.classList.toggle('active',el.id===id));
  document.querySelectorAll('.tab-btn').forEach(el=>el.classList.toggle('active',el.dataset.tab===id));
}

// Mostrar/esconder câmeras — só afeta o painel web (o painel Python não tem esse controle).
// Ao esconder, os <img> perdem o src para fechar o stream MJPEG e não gastar banda à toa.
function toggleCameras(show){
  const grid=document.getElementById('camGrid');
  grid.hidden=!show;
  document.querySelectorAll('#camGrid img').forEach(img=>{
    if(show){ if(!img.getAttribute('src')) img.src=img.dataset.src; }
    else{ img.removeAttribute('src'); }
  });
  try{ localStorage.setItem('autocar_cams_visible', show?'1':'0'); }catch{}
}

function initCameras(){
  let visible=true;
  try{
    const saved=localStorage.getItem('autocar_cams_visible');
    if(saved!==null) visible = saved==='1';
  }catch{}
  document.getElementById('camToggle').checked=visible;
  toggleCameras(visible);
}

function toggleEdit(){
  editMode=!editMode;
  document.getElementById('editBtn').classList.toggle('active',editMode);
  document.querySelectorAll('input[type=range]').forEach(el=>{el.disabled=!editMode});
}

function isSpeedKey(key){ return key==="PARÂMETROS DO CARRO_PWM" || key==="PARÂMETROS DO CARRO_Velocidade na curva (PWM)"; }
function sliderValue(key,val){ return isSpeedKey(key) ? Math.max(0,Math.min(255,Math.round(parseFloat(val)))) : parseInt(val); }
function controlValue(key,sliderVal){ return isSpeedKey(key) ? Math.round(parseInt(sliderVal)) : parseInt(sliderVal); }
function formatValue(key,val){ return isSpeedKey(key) ? Math.round(parseFloat(val))+' PWM' : String(val); }

function buildSections(containerId, sections){
  const grid=document.getElementById(containerId);
  grid.innerHTML='';
  sections.forEach((sec,si)=>{
    const card=document.createElement('div');
    card.className='section';
    const title=document.createElement('div');
    title.className='section-title';
    title.textContent=sec.title;
    card.appendChild(title);
    sec.controls.forEach((ctrl,ci)=>{
      const id=`${containerId}_${si}_${ci}`;
      const raw=currentConfig[ctrl.key]??ctrl.default;
      const val=controlValue(ctrl.key,sliderValue(ctrl.key,raw));
      const row=document.createElement('div');
      row.className='ctrl';
      row.dataset.key=ctrl.key;
      row.innerHTML=`
        <div class="ctrl-header">
          <span class="ctrl-label">${ctrl.label}</span>
          <span class="ctrl-val" id="${id}L">${formatValue(ctrl.key,val)}</span>
        </div>
        <div class="range-wrap">
          <input type="range" id="${id}I" class="${ctrl.speed?'speed':''}" min="${ctrl.min}" max="${ctrl.max}" value="${sliderValue(ctrl.key,val)}" ${editMode?'':'disabled'}>
        </div>
        ${ctrl.speed?'<span class="ctrl-warning">Valores abaixo de 30 PWM são tratados como 0 — mínimo para movimentar o carro.</span>':''}`;
      card.appendChild(row);
      row.querySelector('input').addEventListener('input',function(){
        const v=controlValue(ctrl.key,this.value);
        document.getElementById(id+'L').textContent=formatValue(ctrl.key,v);
        currentConfig[ctrl.key]=v;
        pendingUpdate[ctrl.key]=v;
        clearTimeout(debounceTimer);
        debounceTimer=setTimeout(flushUpdate,350);
      });
    });
    grid.appendChild(card);
  });
}

function refreshSliders(cfg){
  document.querySelectorAll('.ctrl').forEach(row=>{
    const key=row.dataset.key;
    if(pendingUpdate[key]!==undefined || cfg[key]===undefined) return;
    const inp=row.querySelector('input');
    const lbl=row.querySelector('.ctrl-val');
    const val=cfg[key];
    if(inp){ inp.value=sliderValue(key,val); }
    if(lbl){ lbl.textContent=formatValue(key,val); }
  });
}

function updateRunDot(running){
  document.getElementById('runDot').className='dot'+(running?' on':'');
}

function setStatus(msg){
  document.getElementById('statusText').textContent=msg;
}

function flushUpdate(){
  fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pendingUpdate)})
    .then(()=>{pendingUpdate={};setStatus('Salvo '+new Date().toLocaleTimeString())})
    .catch(()=>setStatus('Erro ao salvar'));
}

// Salvar: grava no config.json (igual ao painel Python), incluindo ajustes ainda não enviados
function saveConfig(){
  clearTimeout(debounceTimer);
  const payload={...currentConfig,...pendingUpdate};
  delete payload.running;
  fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
    .then(r=>r.json())
    .then(data=>{
      if(data.ok){ pendingUpdate={}; setStatus('Configurações salvas '+new Date().toLocaleTimeString()); }
      else setStatus('Erro ao salvar: '+(data.error||''));
    })
    .catch(()=>setStatus('Sem conexão'));
}

// Fechar: mesmo efeito do painel Python (para o carro e encerra o sistema)
function closeSystem(){
  if(!confirm('Fechar o painel encerra o sistema do carro (igual ao botão Fechar do painel Python). Continuar?')) return;
  fetch('/api/close',{method:'POST'})
    .then(r=>r.json())
    .then(data=>setStatus(data.ok?'Sistema encerrado':'Erro: '+(data.error||'falha ao fechar')))
    .catch(()=>setStatus('Sem conexão'));
}

// ── Pontos de parada ──
function addRoutePoint(){
  const point=document.getElementById('routePoint').value;
  fetch('/api/route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({point})})
    .then(r=>r.json())
    .then(data=>{
      if(data.ok){ setRoute(data.route); setStatus('Ponto '+point+' adicionado'); }
      else setStatus('Erro: '+(data.error||'falha ao adicionar ponto'));
    })
    .catch(()=>setStatus('Sem conexão'));
}

function setRoute(route){
  const text=Array.isArray(route)?(route.length?route.join(' → '):'Nenhum ponto'):(route||'Nenhum ponto');
  document.getElementById('iRoute').textContent=text;
}

// ── Conexão ──
let comInitialized=false;
function refreshPorts(logIt){
  const select=document.getElementById('comSelect');
  const previous=select.value;
  return fetch('/api/ports').then(r=>r.json()).then(data=>{
    const ports=data.ports||[];
    select.innerHTML=ports.map(p=>`<option>${p}</option>`).join('');
    if(ports.includes(previous)) select.value=previous;
    if(logIt) appendLocalLog(`[CONEXÃO] Portas atualizadas: [${ports.map(p=>"'"+p+"'").join(', ')}]`,'info');
  }).catch(()=>{ if(logIt) appendLocalLog('[CONEXÃO] Falha ao listar portas','error'); });
}

function reconnect(){
  const testMode=document.getElementById('testMode').checked;
  const com=document.getElementById('comSelect').value;
  if(!testMode && !com){
    appendLocalLog('[CONEXÃO] Selecione uma porta COM ou ative o modo teste','warn');
    return;
  }
  fetch('/api/reconnect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({com,test_mode:testMode})})
    .then(r=>r.json())
    .then(data=>setStatus(data.ok?'Reconexão solicitada':'Erro: '+(data.error||'')))
    .catch(()=>setStatus('Sem conexão'));
}

// ── Mensageria ──
function dashboardUrl(){ return window.location.origin; }

function copyLink(){
  const url=dashboardUrl();
  const done=()=>{
    const btn=document.getElementById('copyBtn');
    btn.textContent='Copiado!';
    setTimeout(()=>btn.textContent='Copiar link',1500);
  };
  // navigator.clipboard só existe em HTTPS/localhost; na rede local usa o fallback
  if(navigator.clipboard && window.isSecureContext){
    navigator.clipboard.writeText(url).then(done).catch(()=>fallbackCopy(url,done));
  } else fallbackCopy(url,done);
}

function fallbackCopy(text,done){
  const area=document.createElement('textarea');
  area.value=text;
  area.style.position='fixed';area.style.opacity='0';
  document.body.appendChild(area);
  area.select();
  try{ document.execCommand('copy'); done(); }catch{ prompt('Copie o link:',text); }
  document.body.removeChild(area);
}

function showQr(show){
  const modal=document.getElementById('qrModal');
  if(show){
    document.getElementById('qrImg').src='/api/qrcode?t='+Date.now();
    document.getElementById('qrUrl').textContent=dashboardUrl();
  }
  modal.hidden=!show;
}

// ── Controle remoto ──
function remoteAction(op){
  fetch('/api/remote/'+op,{method:'POST'})
    .then(r=>r.json())
    .then(data=>{
      document.getElementById('remoteStatus').textContent=data.ok?data.feedback:('Erro: '+(data.error||''));
    })
    .catch(()=>setStatus('Sem conexão'));
}

// ── Log ──
function appendLogLine(ts,msg,tag){
  const box=document.getElementById('logBox');
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
  const color=LOG_COLORS[tag]||'var(--fg)';
  const line=document.createElement('div');
  line.className='log-line';
  line.innerHTML=`<span class="log-ts">[${ts}]</span> <span style="color:${color}">${msg}</span>`;
  box.appendChild(line);
  while(box.children.length>300) box.removeChild(box.firstChild);
  if(atBottom) box.scrollTop=box.scrollHeight;
}

function appendLocalLog(msg,tag){
  appendLogLine(new Date().toLocaleTimeString('pt-BR',{hour12:false}),msg,tag);
}

function clearLog(){ document.getElementById('logBox').innerHTML=''; }

// ── Velocidade das rodas ──
function buildWheels(){
  document.getElementById('wheelGrid').innerHTML=WHEELS.map(([key,name])=>`
    <div>
      <div class="wheel-head"><span>${name}</span><span class="val" id="w_${key}">0.0 m/s</span></div>
      <div class="bar"><div class="bar-fill" id="b_${key}"></div></div>
    </div>`).join('');
}

function resetConfig(){
  fetch('/api/reset',{method:'POST'})
    .then(r=>r.json())
    .then(data=>{
      if(data.ok){
        currentConfig=data.config;
        buildSections('gridPista',CONTROL_SECTIONS);
        buildSections('gridCarro',SIGNAL_SECTIONS);
        updateRunDot(currentConfig.running);
        setStatus('Resetado '+new Date().toLocaleTimeString());
      } else setStatus('Erro: '+(data.error||'reset falhou'));
    })
    .catch(()=>setStatus('Sem conexão'));
}

function setRunning(val){
  currentConfig.running=val;
  fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({running:val})})
    .then(()=>{updateRunDot(val);setStatus(val?'Iniciado':'Parado')})
    .catch(()=>setStatus('Sem conexão'));
}

async function syncConfig(){
  try{
    const cfg=await fetch('/api/config').then(r=>r.json());
    currentConfig={...currentConfig,...cfg};
    refreshSliders(cfg);
    if(cfg.running!==undefined)updateRunDot(cfg.running);
    document.getElementById('connStatus').textContent='Conectado';
    document.getElementById('connStatus').style.color='var(--green)';
  }catch{
    document.getElementById('connStatus').textContent='Sem conexão';
    document.getElementById('connStatus').style.color='var(--red)';
  }
}

function fmtNumber(val,suffix){
  if(val===undefined||val===null||val==='--') return '--';
  const n=parseFloat(val);
  if(Number.isNaN(n)) return '--';
  const text=Number.isInteger(n)?String(n):n.toFixed(1);
  return text+(suffix||'');
}

function sensorLabel(val){
  const entry=SENSOR_LABELS[val];
  if(!entry) return '--';
  return `<span style="color:${entry[1]};font-weight:bold">${entry[0]}</span>`;
}

function setPill(elId,valueId,text,cls){
  const el=document.getElementById(elId);
  el.className='pill '+cls;
  document.getElementById(valueId).textContent=text;
}

async function syncVehicleInfo(){
  try{
    const info=await fetch('/api/vehicle_info').then(r=>r.json());
    const hud=info.hud||{};
    const telemetry=info.telemetry||{};

    const running=!!hud.running;
    const statusEl=document.getElementById('vehicleStatus');
    statusEl.textContent=running?'EM MOVIMENTO':'PARADO';
    statusEl.style.color=running?'var(--green)':'var(--red)';
    if(info._ts){
      document.getElementById('vehicleLastUpdate').textContent=
        'Atualizado às '+new Date(info._ts*1000).toLocaleTimeString();
    }

    document.getElementById('mSpeedReceived').innerHTML=fmtNumber(telemetry.speed,' m/s');
    document.getElementById('mBattery').innerHTML=fmtNumber(telemetry.battery,'%');
    document.getElementById('mBatteryState').textContent=BATTERY_STATES[telemetry.battery_state]||'--';
    document.getElementById('mSpeedApplied').innerHTML=fmtNumber(hud.speed,' PWM');
    document.getElementById('mServo').innerHTML=(hud.servo!==undefined?hud.servo+'°':'--');

    WHEELS.forEach(([key])=>{
      let v=parseFloat(telemetry[key]);
      if(Number.isNaN(v)||v<0) v=0;
      document.getElementById('w_'+key).textContent=v.toFixed(1)+' m/s';
      document.getElementById('b_'+key).style.width=Math.min(100,Math.round(v*10))+'%';
    });

    document.getElementById('iControlMode').textContent=hud.control_mode||'--';
    document.getElementById('iError').textContent=(hud.error!==undefined?hud.error:'--');
    document.getElementById('iPidMode').textContent=hud.pid_mode||'--';
    document.getElementById('iSignals').textContent=hud.signals||'--';
    document.getElementById('iLeft').innerHTML=sensorLabel(telemetry.left);
    document.getElementById('iFLeft').innerHTML=sensorLabel(telemetry.f_left);
    document.getElementById('iFRight').innerHTML=sensorLabel(telemetry.f_right);
    document.getElementById('iRight').innerHTML=sensorLabel(telemetry.right);
    document.getElementById('rawRx').textContent=info.raw_rx||'Nenhum retorno recebido';
    setRoute(hud.route);

    if(info.camera_idx!==undefined) document.getElementById('iCameraId').textContent=info.camera_idx;
    if(info.remote) document.getElementById('remoteStatus').textContent=info.remote.feedback||'--';
    // Estado inicial da conexão igual ao do painel Python (porta atual / modo teste)
    if(!comInitialized && 'com' in info){
      comInitialized=true;
      document.getElementById('testMode').checked = info.com===null;
      if(info.com){
        const select=document.getElementById('comSelect');
        if(![...select.options].some(o=>o.value===info.com)) select.add(new Option(info.com,info.com));
        select.value=info.com;
      }
    }

    const can=telemetry.can||{};
    const canBox=document.getElementById('canModules');
    const names=Object.keys(can).sort();
    canBox.innerHTML = names.length===0
      ? '<div class="info-row"><span>Nenhum módulo conectado</span></div>'
      : names.map(name=>{
          const on=can[name]===true;
          const color=on?'var(--green)':'var(--red)';
          return `<div class="info-row"><span>${name}</span><span class="val" style="color:${color}">${on?'ATIVADO':'DESATIVADO'}</span></div>`;
        }).join('');

    [['reta','RETA'],['curva','CURVA'],['curva_fechada','CURVA_FECHADA']].forEach(([prefix,label])=>{
      const values=hud[prefix]||{};
      ['kp','ki','kd'].forEach(term=>{
        const el=document.getElementById(`pid${label}_${term[0].toUpperCase()+term.slice(1)}`);
        if(el) el.textContent=`${term[0].toUpperCase()+term.slice(1)}: ${values[term]!==undefined?values[term]:'--'}`;
      });
    });

    if(hud.stop_active===true) setPill('pillStop','pillStopValue','ATIVA','pill-red');
    else if(hud.stop_active===false) setPill('pillStop','pillStopValue','LIVRE','pill-green');
    else setPill('pillStop','pillStopValue','—','pill-muted');

    const lightCode=hud.traffic_light_code;
    const lightMap={0:['VERMELHO','pill-red'],1:['AMARELO','pill-orange'],2:['VERDE','pill-green'],'-1':['NENHUM','pill-muted']};
    const lightEntry=lightMap[lightCode]||['—','pill-muted'];
    setPill('pillLight','pillLightValue',lightEntry[0],lightEntry[1]);

    let reasonText='—',reasonCls='pill-muted';
    if(!running){ reasonText='PARADO (painel)'; reasonCls='pill-red'; }
    else if(hud.stop_active){ reasonText='PARADO — PLACA'; reasonCls='pill-red'; }
    else if(lightCode===0){ reasonText='PARADO — SEMÁFORO'; reasonCls='pill-red'; }
    else { reasonText='EM MOVIMENTO'; reasonCls='pill-green'; }
    setPill('pillReason','pillReasonValue',reasonText,reasonCls);
  }catch{}
}

async function syncLog(){
  try{
    const data=await fetch('/api/log?since='+logCursor).then(r=>r.json());
    if(!data.entries || data.entries.length===0){ logCursor=data.latest||logCursor; return; }
    data.entries.forEach(e=>appendLogLine(e.ts,e.msg,e.tag));
    logCursor=data.latest;
  }catch{}
}

buildSections('gridPista',CONTROL_SECTIONS);
buildSections('gridCarro',SIGNAL_SECTIONS);

fetch('/api/config').then(r=>r.json())
  .then(cfg=>{
    currentConfig=cfg;
    buildSections('gridPista',CONTROL_SECTIONS);
    buildSections('gridCarro',SIGNAL_SECTIONS);
    updateRunDot(cfg.running);
    setStatus(cfg.running?'Em execução':'Parado');
  })
  .catch(()=>setStatus('Sem conexão'));

buildWheels();
document.getElementById('apiUrl').textContent='API: '+dashboardUrl();
refreshPorts(false);
initCameras();
setInterval(syncConfig,2000);
setInterval(syncVehicleInfo,700);
setInterval(syncLog,1500);
syncVehicleInfo();
syncLog();
</script>
</body>
</html>"""
