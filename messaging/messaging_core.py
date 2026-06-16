import os
import json
import socket
import threading
from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__)

_TWIN_DIR   = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "AutoCar-DigitalTwin"))
_CONFIG_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "config.json"))

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
}
_PWM_TO_RPM = 3.0

# ── Config do painel de controle ─────────────────────────────────────────────
_config: dict = {
    "ROI_Linha superior":          1280,
    "ROI_Linha inferior":          1280,
    "ROI_Altura sup":               263,
    "ROI_Altura inf":               541,
    "IMAGEM_Limiar":                195,
    "IMAGEM_Erro de transição":      12,
    "RETA_Kp":                      150,
    "RETA_Ki":                        0,
    "RETA_Kd":                        5,
    "CURVA_Kp":                     300,
    "CURVA_Ki":                       0,
    "CURVA_Kd":                       0,
    "PARÂMETROS DO CARRO_PWM":       30,
    "DETECTOR_Conf STOP":            40,
    "DETECTOR_Conf Verde":           40,
    "DETECTOR_Conf Vermelho":        40,
    "DETECTOR_Box diagonal":          0,
    "running":                    False,
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


def update_state(pwm: int, running: bool) -> None:
    with _lock:
        _state["tabDashboard_rpm"]   = round(pwm * _PWM_TO_RPM)
        _state["tabDashboard_light"] = running and pwm > 0


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


# ── Painel de controle web ────────────────────────────────────────────────────
@app.route("/panel")
def panel_page():
    return _PANEL_HTML


# ── Digital Twin (arquivos estáticos) ─────────────────────────────────────────
@app.route("/")
def index():
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
  --bg:#1e1e2e;--surface:#181825;--card:#313244;--border:#45475a;
  --fg:#cdd6f4;--muted:#6c7086;--blue:#89b4fa;--green:#a6e3a1;
  --red:#f38ba8;--orange:#fab387;--purple:#cba6f7;--teal:#94e2d5;
  --radius:10px;--font:'Courier New',monospace;
}
html{height:100%;overflow-x:hidden}
body{background:var(--bg);color:var(--fg);font-family:var(--font);min-height:100%;padding-bottom:env(safe-area-inset-bottom)}

/* ── Sticky bar: header + status + actions ── */
.top-bar{position:sticky;top:0;z-index:20;background:var(--bg)}

/* ── Header ── */
header{
  background:var(--surface);padding:14px 16px;
  display:flex;align-items:center;gap:10px;
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

/* ── Action buttons 2x2 ── */
.actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border)}
.btn{
  padding:14px 8px;border:none;border-radius:var(--radius);
  font-family:var(--font);font-size:13px;font-weight:bold;
  cursor:pointer;min-height:50px;-webkit-appearance:none;
  transition:opacity .1s,transform .1s;
}
.btn:active{opacity:.75;transform:scale(.97)}
.btn-start{background:var(--green);color:#1e1e2e}
.btn-stop {background:var(--red);color:#1e1e2e}
.btn-reset{background:var(--orange);color:#1e1e2e}
.btn-save {background:var(--purple);color:#1e1e2e}

/* ── Grid ── */
.grid{display:grid;grid-template-columns:1fr;gap:10px;padding:12px 16px 24px}
@media(min-width:560px){.grid{grid-template-columns:1fr 1fr}}
@media(min-width:900px){.grid{grid-template-columns:1fr 1fr 1fr}}

/* ── Section card ── */
.section{background:var(--surface);border-radius:var(--radius);padding:14px 16px;border:1px solid var(--border)}
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
  min-width:42px;text-align:right;
}

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
</style>
</head>
<body>

<div class="top-bar">
  <header>
    <h1>⚙ Painel de Controle</h1>
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
    <button class="btn btn-save"  onclick="saveConfig()">💾 Salvar</button>
  </div>
</div>

<div class="grid" id="grid"></div>

<script>
const SECTIONS=[
  {title:"ROI",controls:[
    {key:"ROI_Linha superior",label:"Linha superior",min:0,max:1280},
    {key:"ROI_Linha inferior",label:"Linha inferior",min:0,max:1280},
    {key:"ROI_Altura sup",    label:"Altura sup",    min:0,max:720},
    {key:"ROI_Altura inf",    label:"Altura inf",    min:0,max:720},
  ]},
  {title:"IMAGEM",controls:[
    {key:"IMAGEM_Limiar",            label:"Limiar",            min:0,max:255},
    {key:"IMAGEM_Erro de transição", label:"Erro de transição", min:0,max:100},
  ]},
  {title:"RETA — PID",controls:[
    {key:"RETA_Kp",label:"Kp",min:0,max:1000},
    {key:"RETA_Ki",label:"Ki",min:0,max:1000},
    {key:"RETA_Kd",label:"Kd",min:0,max:1000},
  ]},
  {title:"CURVA — PID",controls:[
    {key:"CURVA_Kp",label:"Kp",min:0,max:1000},
    {key:"CURVA_Ki",label:"Ki",min:0,max:1000},
    {key:"CURVA_Kd",label:"Kd",min:0,max:1000},
  ]},
  {title:"PARÂMETROS DO CARRO",controls:[
    {key:"PARÂMETROS DO CARRO_PWM",label:"PWM",min:0,max:255},
  ]},
  {title:"DETECTOR",controls:[
    {key:"DETECTOR_Conf STOP",    label:"Conf STOP (%)",    min:0,max:100},
    {key:"DETECTOR_Conf Verde",   label:"Conf Verde (%)",   min:0,max:100},
    {key:"DETECTOR_Conf Vermelho",label:"Conf Vermelho (%)",min:0,max:100},
    {key:"DETECTOR_Box diagonal", label:"Box diagonal (px)",min:0,max:300},
  ]},
];

let debounceTimer=null,pendingUpdate={},currentConfig={},editMode=false;

function toggleEdit(){
  editMode=!editMode;
  document.getElementById('editBtn').classList.toggle('active',editMode);
  document.querySelectorAll('input[type=range]').forEach(el=>{el.disabled=!editMode});
}

function buildUI(cfg){
  currentConfig=cfg;
  const grid=document.getElementById('grid');
  grid.innerHTML='';
  SECTIONS.forEach((sec,si)=>{
    const card=document.createElement('div');
    card.className='section';
    const title=document.createElement('div');
    title.className='section-title';
    title.textContent=sec.title;
    card.appendChild(title);
    sec.controls.forEach((ctrl,ci)=>{
      const id=`c${si}_${ci}`;
      const val=cfg[ctrl.key]??ctrl.min;
      const row=document.createElement('div');
      row.className='ctrl';
      row.dataset.key=ctrl.key;
      row.innerHTML=`
        <div class="ctrl-header">
          <span class="ctrl-label">${ctrl.label}</span>
          <span class="ctrl-val" id="${id}L">${val}</span>
        </div>
        <div class="range-wrap">
          <input type="range" id="${id}I" min="${ctrl.min}" max="${ctrl.max}" value="${val}" disabled>
        </div>`;
      card.appendChild(row);
      row.querySelector('input').addEventListener('input',function(){
        const v=parseInt(this.value);
        document.getElementById(id+'L').textContent=v;
        currentConfig[ctrl.key]=v;
        pendingUpdate[ctrl.key]=v;
        clearTimeout(debounceTimer);
        debounceTimer=setTimeout(flushUpdate,350);
      });
    });
    grid.appendChild(card);
  });
  updateRunDot(cfg.running);
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
      if(data.ok){buildUI(data.config);setStatus('Resetado '+new Date().toLocaleTimeString());}
      else setStatus('Erro: '+(data.error||'reset falhou'));
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
    document.querySelectorAll('.ctrl').forEach(row=>{
      const key=row.dataset.key;
      if(pendingUpdate[key]!==undefined)return;
      const inp=row.querySelector('input');
      const lbl=row.querySelector('.ctrl-val');
      if(inp&&cfg[key]!==undefined){inp.value=cfg[key];lbl.textContent=cfg[key];}
    });
    if(cfg.running!==undefined)updateRunDot(cfg.running);
  }catch{}
}

fetch('/api/config').then(r=>r.json())
  .then(cfg=>{buildUI(cfg);setStatus(cfg.running?'Em execução':'Parado');})
  .catch(()=>setStatus('Sem conexão'));
setInterval(syncConfig,2000);
</script>
</body>
</html>"""
