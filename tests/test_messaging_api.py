"""Testes da API Flask (messaging/messaging_core.py): painel web, Digital Twin e olhos."""
import json

import pytest

import messaging.messaging_core as mc


@pytest.fixture
def client(tmp_path, monkeypatch):
    """Cliente de teste com config.json temporário e estado do servidor isolado."""
    config_file = tmp_path / "config.json"
    config_file.write_text(json.dumps({"RETA_Kp": 123, "PARÂMETROS DO CARRO_PWM": 90}), encoding="utf-8")
    monkeypatch.setattr(mc, "_CONFIG_PATH", str(config_file))
    monkeypatch.setattr(mc, "_config", dict(mc._config))
    monkeypatch.setattr(mc, "_state", dict(mc._state))
    monkeypatch.setattr(mc, "_actions", {})
    monkeypatch.setattr(mc, "_reconnect_request", None)
    mc.pop_config_update()
    mc.app.config["TESTING"] = True
    yield mc.app.test_client()
    mc.pop_config_update()


# ── /api/config ──────────────────────────────────────────────────────────────

def test_get_config_has_panel_keys(client):
    cfg = client.get("/api/config").get_json()
    for key in (
        "ROI_Linha superior", "IMAGEM_Limiar",
        "RETA_Kp", "CURVA_Kp", "PID DE CURVA FECHADA_Kp",
        "PARÂMETROS DO CARRO_PWM", "PARÂMETROS DO CARRO_Ângulo máximo",
        "PARE_Confiança (%)", "SEMÁFORO_Confiança (%)", "PESSOAS_Confiança (%)",
        "DESVIO DIREITA_Confiança (%)", "DESVIO DIREITA_Frames seguidos",
        "PONTO A_Confiança (%)", "PONTO B_Confiança (%)", "PONTO C_Confiança (%)",
        "running",
    ):
        assert key in cfg, f"Chave ausente: {key}"


def test_post_config_updates_and_flags_change(client):
    r = client.post("/api/config", json={"PARE_Confiança (%)": 75})
    assert r.status_code == 200 and r.get_json()["ok"] is True
    assert client.get("/api/config").get_json()["PARE_Confiança (%)"] == 75

    updated = mc.pop_config_update()
    assert updated is not None and updated["PARE_Confiança (%)"] == 75
    assert mc.pop_config_update() is None, "flag deveria ter sido limpo"


def test_reset_restores_values_from_config_file(client):
    client.post("/api/config", json={"RETA_Kp": 999})
    r = client.post("/api/reset")
    assert r.status_code == 200
    assert r.get_json()["config"]["RETA_Kp"] == 123


def test_reset_without_config_file_returns_404(client, tmp_path, monkeypatch):
    monkeypatch.setattr(mc, "_CONFIG_PATH", str(tmp_path / "nao_existe.json"))
    r = client.post("/api/reset")
    assert r.status_code == 404 and r.get_json()["ok"] is False


def test_save_writes_config_file_without_running(client):
    r = client.post("/api/save", json={"RETA_Kp": 321, "running": True})
    assert r.status_code == 200 and r.get_json()["ok"] is True

    with open(mc._CONFIG_PATH, encoding="utf-8") as f:
        saved = json.load(f)
    assert saved["RETA_Kp"] == 321
    assert "running" not in saved


# ── /api/dashboard (Digital Twin) ────────────────────────────────────────────

def test_dashboard_reflects_update_state(client):
    mc.update_state(pwm=40, running=True)
    d = client.get("/api/dashboard").get_json()["data"]
    assert d["tabDashboard_rpm"] == 120
    assert d["tabDashboard_light"] is True
    assert d["tabDashboard_running"] is True

    mc.update_state(pwm=0, running=False)
    d = client.get("/api/dashboard").get_json()["data"]
    assert d["tabDashboard_rpm"] == 0
    assert d["tabDashboard_light"] is False


def test_dashboard_signals_speed_and_battery(client):
    mc.update_state(50, True, real_speed=3.456, battery=77, stop_active=True,
                    traffic_light_code=0, traffic_light_label="Vermelho", right_detour_active=True)
    d = client.get("/api/dashboard").get_json()["data"]
    assert d["tabDashboard_speed"] == 3.46
    assert d["tabDashboard_battery"] == 77
    assert d["tabDashboard_stop_active"] is True
    assert d["tabDashboard_traffic_light_code"] == 0
    assert d["tabDashboard_right_detour_active"] is True


def test_dashboard_wheel_speeds(client):
    mc.update_state(60, True, wheel_speeds=(1.234, 2, 3.5, 4.04))
    d = client.get("/api/dashboard").get_json()["data"]
    assert [d[f"tabDashboard_speed{i}"] for i in range(1, 5)] == [1.23, 2.0, 3.5, 4.04]


def test_dashboard_ultrasonic_zones_map_to_twin_sensors(client):
    # ponta superior = right, centro = pior frontal, ponta inferior = left
    mc.update_state(60, True, ultrasonic={"left": 1, "f_left": 2, "f_right": 3, "right": 0})
    d = client.get("/api/dashboard").get_json()["data"]
    assert d["tabDashboard_sensor_1"] is None   # right livre -> apagado
    assert d["tabDashboard_sensor_2"] == 8      # crítico
    assert d["tabDashboard_sensor_3"] == 50     # longe


# ── /api/vehicle_info, /api/log ──────────────────────────────────────────────

def test_vehicle_info_roundtrip_with_timestamp(client):
    mc.update_vehicle_info({"hud": {"servo": 100}, "command": {"run": True}})
    info = client.get("/api/vehicle_info").get_json()
    assert info["hud"]["servo"] == 100
    assert info["command"]["run"] is True
    assert isinstance(info["_ts"], float)


def test_log_returns_new_entries(client):
    before = client.get("/api/log").get_json()["latest"]
    mc.push_log("mensagem de teste", "ok")
    data = client.get(f"/api/log?since={before}").get_json()
    assert [e["msg"] for e in data["entries"]] == ["mensagem de teste"]


# ── Ações do painel web (registradas pelo main.py) ───────────────────────────

def test_route_uses_registered_action(client):
    route = []
    mc.register_action("add_route_point", lambda p: route.append(p) or list(route))
    r = client.post("/api/route", json={"point": "b"})
    assert r.status_code == 200 and r.get_json()["route"] == ["B"]


def test_route_rejects_invalid_point_and_missing_action(client):
    assert client.post("/api/route", json={"point": "Z"}).status_code == 400
    assert client.post("/api/route", json={"point": "A"}).status_code == 503


def test_remote_actions(client):
    mc.register_action("remote_connect", lambda: "Controle conectado")
    r = client.post("/api/remote/connect")
    assert r.status_code == 200 and r.get_json()["feedback"] == "Controle conectado"
    assert client.post("/api/remote/explodir").status_code == 404


def test_action_errors_are_reported(client):
    def boom():
        raise RuntimeError("falhou")
    mc.register_action("close", boom)
    r = client.post("/api/close")
    assert r.status_code == 503 and "falhou" in r.get_json()["error"]


def test_reconnect_queues_request_for_main_loop(client):
    assert client.post("/api/reconnect", json={"test_mode": True}).status_code == 200
    assert mc.pop_reconnect_request() == {"com": None}
    assert mc.pop_reconnect_request() is None

    assert client.post("/api/reconnect", json={"com": "COM7"}).status_code == 200
    assert mc.pop_reconnect_request() == {"com": "COM7"}

    assert client.post("/api/reconnect", json={}).status_code == 400


def test_ports_endpoint_returns_list(client):
    assert isinstance(client.get("/api/ports").get_json()["ports"], list)


def test_qrcode_endpoint(client):
    pytest.importorskip("qrcode")
    r = client.get("/api/qrcode")
    assert r.status_code == 200 and r.mimetype == "image/png"


# ── Páginas ──────────────────────────────────────────────────────────────────

def test_panel_page(client):
    r = client.get("/panel")
    assert r.status_code == 200
    assert "Interface de Controle" in r.get_data(as_text=True)


def test_eyes_are_served(client):
    r = client.get("/eyes")
    assert r.status_code in (301, 302, 308) and r.headers["Location"].endswith("/eyes/")
    assert client.get("/eyes/").status_code == 200
    assert client.get("/eyes/src/main.js").status_code == 200


def test_road_map_is_served(client):
    r = client.get("/road")
    assert r.status_code in (301, 302, 308) and r.headers["Location"].endswith("/road/")
    assert client.get("/road/").status_code == 200
    assert client.get("/road/src/main.js").status_code == 200
    assert client.get("/road/vendor/three/three.module.min.js").status_code == 200
    assert client.get("/road/models/car.glb").status_code == 200


def test_panel_has_map_button(client):
    assert "/road/" in client.get("/panel").get_data(as_text=True)


def test_digital_twin_is_served(client):
    assert client.get("/").status_code == 200
    assert client.get("/src/js/main.js").status_code == 200
