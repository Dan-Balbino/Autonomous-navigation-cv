import os
import json
import socket
import threading
import time
from collections import deque

import cv2
from flask import Flask, jsonify, request, send_from_directory, redirect, url_for, Response

app = Flask(__name__)

_TWIN_DIR   = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "DigitalTwin"))
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
    "PARÂMETROS DO CARRO_PWM":                         40,
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
    "PESSOAS_Confiança (%)":                         50,
    "PESSOAS_Diagonal mínima da caixa (px)":          0,
    "running":                                    False,
}
_config_updated = False


def load_config_from_file() -> None:
    global _config
    try:
        with open(_CONFIG_PATH, encoding="utf-8") as f:
            data = json.load(f)
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


def update_state(pwm, running, *, real_speed=None, battery=None,
                  stop_active=None, traffic_light_code=None,
                  traffic_light_label=None,
                  right_detour_active=None) -> None:
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
        return jsonify({"ok": True, "config": snapshot})
    except FileNotFoundError:
        return jsonify({"ok": False, "error": "config.json não encontrado"}), 404
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


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
<title>AutoCar — Painel</title>
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
.actions{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:10px 16px;border-bottom:1px solid var(--border)}
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
@media(max-width:520px){.actions{grid-template-columns:1fr 1fr}}

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
.pid-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
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
</style>
</head>
<body>

<div class="top-bar">
  <header>
    <h1>Painel de Controle — APEX</h1>
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
    <button class="btn btn-reset" onclick="resetConfig()">↺ Resetar</button>
    <button class="btn btn-save"  onclick="saveConfig()">Salvar</button>
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
      <div class="cam-hint">Câmeras ao vivo — mesmo feed do painel Python.</div>
      <label class="switch">
        <input type="checkbox" id="camToggle" checked onchange="toggleCameras(this.checked)">
        <span class="switch-track"><span class="switch-thumb"></span></span>
        <span>Mostrar câmeras</span>
      </label>
    </div>
    <div class="cam-grid" id="camGrid">
      <div class="cam-card">
        <div class="cam-img-wrap"><img data-src="/api/stream/road" alt="Câmera da pista" loading="lazy"></div>
        <div class="cam-caption">CÂMERA DA PISTA — imagem original com ROI</div>
      </div>
      <div class="cam-card">
        <div class="cam-img-wrap"><img data-src="/api/stream/bird" alt="Vista superior" loading="lazy"></div>
        <div class="cam-caption">VISTA SUPERIOR — bird-eye view e faixas</div>
      </div>
      <div class="cam-card">
        <div class="cam-img-wrap"><img data-src="/api/stream/sign" alt="Sinais" loading="lazy"></div>
        <div class="cam-caption">SINAIS — detecções do modelo de IA</div>
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
    <div class="section-title" style="margin-bottom:10px">PID utilizado pelo veículo</div>
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
    <div class="metric-card"><div class="metric-value" id="mSpeedReceived">--</div><div class="metric-label">VELOCIDADE RECEBIDA</div></div>
    <div class="metric-card"><div class="metric-value" id="mBattery">--</div><div class="metric-label">BATERIA</div></div>
    <div class="metric-card"><div class="metric-value" id="mSpeedApplied">--</div><div class="metric-label">VELOCIDADE APLICADA</div></div>
    <div class="metric-card"><div class="metric-value" id="mServo">--</div><div class="metric-label">SERVO</div></div>
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
      <div class="info-row"><span>Frontal</span><span class="val" id="iFront">--</span></div>
      <div class="info-row"><span>Esquerdo</span><span class="val" id="iLeft">--</span></div>
      <div class="info-row"><span>Direito</span><span class="val" id="iRight">--</span></div>
    </div>
    <div class="info-card" style="grid-column:1/-1">
      <div class="section-title">Módulos</div>
      <div id="canModules"><div class="info-row"><span>Nenhum módulo CAN</span></div></div>
    </div>
  </div>
  <div class="raw-card">
    <div class="section-title">Último retorno do Arduino</div>
    <div class="raw-text" id="rawRx">Nenhum retorno recebido</div>
  </div>
</div>

<div class="tab-content" id="tabLog">
  <div class="conn-card">
    <span>API</span>
    <span id="connStatus" style="color:var(--muted)">Verificando...</span>
  </div>
  <div class="section-title">Log</div>
  <div class="log-box" id="logBox"></div>
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
];

const SIGNAL_SECTIONS=[
  {title:"PARÂMETROS DO CARRO",controls:[
    {key:"PARÂMETROS DO CARRO_PWM",label:"PWM",min:0,max:255,default:40,speed:true},
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
  {title:"PESSOAS",controls:[
    {key:"PESSOAS_Confiança (%)",label:"Confiança (%)",min:0,max:100,default:50},
    {key:"PESSOAS_Diagonal mínima da caixa (px)",label:"Diagonal mínima da caixa (px)",min:0,max:1000,default:0},
  ]},
];

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

function isSpeedKey(key){ return key==="PARÂMETROS DO CARRO_PWM"; }
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
          <input type="range" id="${id}I" min="${ctrl.min}" max="${ctrl.max}" value="${sliderValue(ctrl.key,val)}" disabled>
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

function saveConfig(){
  fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(currentConfig)})
    .then(()=>setStatus('Configuração salva '+new Date().toLocaleTimeString()))
    .catch(()=>setStatus('Sem conexão'));
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
    document.getElementById('mSpeedApplied').innerHTML=fmtNumber(hud.speed,' PWM');
    document.getElementById('mServo').innerHTML=(hud.servo!==undefined?hud.servo+'°':'--');

    document.getElementById('iControlMode').textContent=hud.control_mode||'--';
    document.getElementById('iError').textContent=(hud.error!==undefined?hud.error:'--');
    document.getElementById('iPidMode').textContent=hud.pid_mode||'--';
    document.getElementById('iSignals').textContent=hud.signals||'--';
    document.getElementById('iFront').innerHTML=sensorLabel(telemetry.front);
    document.getElementById('iLeft').innerHTML=sensorLabel(telemetry.left);
    document.getElementById('iRight').innerHTML=sensorLabel(telemetry.right);
    document.getElementById('rawRx').textContent=info.raw_rx||'Nenhum retorno recebido';

    const can=telemetry.can||{};
    const canBox=document.getElementById('canModules');
    const names=Object.keys(can).sort();
    canBox.innerHTML = names.length===0
      ? '<div class="info-row"><span>Nenhum módulo CAN</span></div>'
      : names.map(name=>{
          const on=can[name]===true;
          const color=on?'var(--green)':'var(--red)';
          return `<div class="info-row"><span>${name}</span><span class="val" style="color:${color}">${on?'ATIVADO':'DESATIVADO'}</span></div>`;
        }).join('');

    ['reta','curva'].forEach(prefix=>{
      const values=hud[prefix]||{};
      ['kp','ki','kd'].forEach(term=>{
        const el=document.getElementById(`pid${prefix.toUpperCase()}_${term[0].toUpperCase()+term.slice(1)}`);
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
    const box=document.getElementById('logBox');
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
    data.entries.forEach(e=>{
      const color=LOG_COLORS[e.tag]||'var(--fg)';
      const line=document.createElement('div');
      line.className='log-line';
      line.innerHTML=`<span class="log-ts">[${e.ts}]</span> <span style="color:${color}">${e.msg}</span>`;
      box.appendChild(line);
    });
    while(box.children.length>300) box.removeChild(box.firstChild);
    logCursor=data.latest;
    if(atBottom) box.scrollTop=box.scrollHeight;
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

initCameras();
setInterval(syncConfig,2000);
setInterval(syncVehicleInfo,700);
setInterval(syncLog,1500);
syncVehicleInfo();
syncLog();
</script>
</body>
</html>"""
