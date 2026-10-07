"""
Simulador do carro para testar Digital Twin, painel web e olhos sem ligar o carro.

Sobe o mesmo servidor Flask do main.py (messaging/messaging_core.py) e alimenta a API
com um carro de mentira: um objeto passa na frente dos ultrassônicos, as rodas aceleram
e freiam, e placa de PARE / semáforo / desvio mudam ao longo do tempo.

Uso:
    python tests/simulate_dashboard.py              # cenário completo
    python tests/simulate_dashboard.py --sem-sensores
        (sensores sempre livres, para usar o objeto do mouse do Digital Twin: tecle Q 5x)
    python tests/simulate_dashboard.py --port 5050

Depois abra:
    http://127.0.0.1:5000/        Digital Twin
    http://127.0.0.1:5000/panel   Painel web
    http://127.0.0.1:5000/eyes/   Olhos (EyesFront)

O "Salvar" do painel grava numa cópia temporária do config.json; o arquivo real não muda.
"""

import argparse
import math
import os
import shutil
import sys
import tempfile
import threading
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

import messaging.messaging_core as mc  # noqa: E402

# Zonas dos ultrassônicos: 0 livre, 1 longe, 2 perto, 3 crítico
FREE, FAR, NEAR, CRITICAL = 0, 1, 2, 3
CYCLE_S = 24.0


def obstacle_zones(t):
    """Objeto que atravessa a frente do carro: entra pela esquerda, chega perto no centro e sai pela direita."""
    phase = (t % CYCLE_S) / CYCLE_S
    if phase < 0.15:
        return {"left": FAR, "f_left": FREE, "f_right": FREE, "right": FREE}
    if phase < 0.30:
        return {"left": NEAR, "f_left": FAR, "f_right": FREE, "right": FREE}
    if phase < 0.45:
        return {"left": FREE, "f_left": NEAR, "f_right": NEAR, "right": FREE}
    if phase < 0.55:
        return {"left": FREE, "f_left": CRITICAL, "f_right": CRITICAL, "right": FREE}
    if phase < 0.70:
        return {"left": FREE, "f_left": FREE, "f_right": NEAR, "right": NEAR}
    if phase < 0.80:
        return {"left": FREE, "f_left": FREE, "f_right": FREE, "right": CRITICAL}
    return {"left": FREE, "f_left": FREE, "f_right": FREE, "right": FREE}


def signals(t):
    """Placa de PARE, semáforo e desvio mudando ao longo do ciclo."""
    phase = (t % CYCLE_S) / CYCLE_S
    stop = 0.45 <= phase < 0.55          # para junto com o obstáculo crítico
    light = 0 if phase < 0.1 else 1 if phase < 0.2 else 2 if phase < 0.35 else -1
    detour = 0.85 <= phase < 0.95
    return stop, light, detour


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--sem-sensores", action="store_true",
                        help="mantém os ultrassônicos livres (para usar o objeto do mouse no Digital Twin)")
    args = parser.parse_args()

    # Cópia temporária do config.json: o Salvar do painel web não altera o arquivo real
    tmp_dir = tempfile.mkdtemp(prefix="autocar_sim_")
    real_config = os.path.join(ROOT, "config", "config.json")
    if os.path.exists(real_config):
        shutil.copy(real_config, os.path.join(tmp_dir, "config.json"))
    mc._CONFIG_PATH = os.path.join(tmp_dir, "config.json")
    mc.load_config_from_file()

    route = []
    mc.register_action("add_route_point", lambda p: route.append(p) or list(route))
    mc.register_action("remote_connect", lambda: "Simulador: nenhum controle")
    mc.register_action("remote_disconnect", lambda: "Controle desconectado")
    mc.register_action("close", lambda: mc.push_log("[SIMULADOR] Fechar ignorado no modo simulação", "warn"))

    def feed():
        start = time.time()
        while True:
            t = time.time() - start
            zones = ({"left": FREE, "f_left": FREE, "f_right": FREE, "right": FREE}
                     if args.sem_sensores else obstacle_zones(t))
            stop, light, detour = signals(t)

            # PWM sobe e desce; para quando há placa/obstáculo crítico ou sinal vermelho
            blocked = stop or light == 0 or CRITICAL in zones.values()
            pwm = 0 if blocked else int(110 + 60 * math.sin(t / 3))
            base = 0 if blocked else 3 + 2.5 * math.sin(t / 3)
            wheels = tuple(max(0.0, base + 0.6 * math.sin(t * 1.7 + i)) for i in range(4))
            servo = int(90 + 30 * math.sin(t / 2.5))

            mc.update_state(pwm, True, real_speed=sum(wheels) / 4, battery=78,
                            stop_active=stop, traffic_light_code=light,
                            traffic_light_label={0: "Vermelho", 1: "Amarelo", 2: "Verde"}.get(light, "Nenhum"),
                            right_detour_active=detour, wheel_speeds=wheels, ultrasonic=zones)
            mc.update_vehicle_info({
                "hud": {
                    "error": int(25 * math.sin(t / 2.5)), "servo": servo, "speed": pwm,
                    "control_mode": "AUTOMÁTICO", "pid_mode": "RETA",
                    "reta": {"kp": 1.3, "ki": 0.005, "kd": 0}, "curva": {"kp": 1.5, "ki": 0.008, "kd": 0.02},
                    "curva_fechada": {"kp": 2, "ki": 0, "kd": 0}, "signals": "Simulação",
                    "running": True, "stop_active": stop, "traffic_light_code": light,
                    "traffic_light_label": "", "right_detour_active": detour,
                    "route": " → ".join(route) if route else "Nenhum ponto",
                },
                "raw_rx": "simulador",
                "command": {"run": True, "lights": 0, "stop": False, "servo": servo, "speed": pwm, "reverse": False},
                "camera_idx": 0, "com": None,
                "remote": {"connected": False, "feedback": "Simulador: nenhum controle"},
                "telemetry": {"speed": sum(wheels) / 4, "battery": 78, "battery_state": 3,
                              "speed1": wheels[0], "speed2": wheels[1], "speed3": wheels[2], "speed4": wheels[3],
                              **zones, "can": {"Motor": True, "Sensoriamento": True}},
            })
            time.sleep(0.15)

    threading.Thread(target=feed, daemon=True).start()
    print(f"Simulador rodando. Digital Twin: http://127.0.0.1:{args.port}/  |  "
          f"Painel: /panel  |  Olhos: /eyes/  (Ctrl+C para sair)")
    mc.app.run(host="0.0.0.0", port=args.port, debug=False, use_reloader=False, threaded=True)


if __name__ == "__main__":
    main()
