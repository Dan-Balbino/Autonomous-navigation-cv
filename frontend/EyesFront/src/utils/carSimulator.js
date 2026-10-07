/**
 * Carro simulado para o modo ?demo=1.
 * Gera o mesmo JSON de /api/vehicle_info (hud + command + telemetry) percorrendo um roteiro de cenas,
 * para testar as expressoes sem o main.py rodando.
 */

const SCENES = [
  { name: "parado", ms: 4000, hud: { running: false, speed: 0 } },
  { name: "saindo", ms: 5000, hud: { running: true, speed: 100 }, steer: 25 },
  { name: "acelerando", ms: 5000, hud: { running: true, speed: 190 }, steer: 8 },
  { name: "obstaculo perto", ms: 3000, hud: { running: true, speed: 80 }, sensors: { f_left: 2, left: 2 } },
  { name: "freada inesperada", ms: 2500, hud: { running: true, speed: 0 } },
  { name: "andando", ms: 3000, hud: { running: true, speed: 90 }, steer: -20 },
  { name: "pessoa na frente", ms: 3000, hud: { running: true, speed: 0 }, command: { lights: 0b100, stop: true } },
  { name: "andando de novo", ms: 2500, hud: { running: true, speed: 90 } },
  { name: "susto", ms: 3500, hud: { running: true, speed: 0 }, sensors: { f_right: 3 } },
  { name: "placa de pare", ms: 4000, hud: { running: true, speed: 0, stop_active: true } },
  { name: "sinal vermelho", ms: 3500, hud: { running: true, speed: 0, traffic_light_code: 0 } },
  { name: "sinal verde", ms: 3500, hud: { running: true, speed: 100, traffic_light_code: 2 } },
  { name: "desvio a direita", ms: 4000, hud: { running: true, speed: 70, right_detour_active: true }, steer: 30 },
  { name: "re (controle manual)", ms: 3000, hud: { running: false, speed: 0, control_mode: "MANUAL" }, command: { reverse: true } },
  { name: "bateria baixa", ms: 6000, hud: { running: false, speed: 0 }, battery: 12 },
];

const TOTAL_MS = SCENES.reduce((sum, scene) => sum + scene.ms, 0);

export function createCarSimulator() {
  const startedAt = performance.now();

  return {
    next(now) {
      let t = (now - startedAt) % TOTAL_MS;
      let scene = SCENES[0];
      for (const candidate of SCENES) {
        if (t < candidate.ms) {
          scene = candidate;
          break;
        }
        t -= candidate.ms;
      }

      // Volante oscila suavemente em volta do angulo da cena
      const steer = (scene.steer || 0) + (scene.hud.running ? Math.sin(now / 900) * 6 : 0);
      const sensors = { left: 0, f_left: 0, f_right: 0, right: 0, ...(scene.sensors || {}) };
      const hud = {
        running: false,
        speed: 0,
        servo: Math.round(90 + steer),
        stop_active: false,
        traffic_light_code: -1,
        right_detour_active: false,
        control_mode: "AUTOMATICO",
        ...scene.hud,
        scene: scene.name,
      };

      return {
        _ts: now / 1000,
        hud,
        // Mesmo formato de car.command.to_dict()
        command: {
          run: hud.running,
          lights: 0,
          stop: false,
          servo: hud.servo,
          speed: hud.speed,
          reverse: false,
          ...(scene.command || {}),
        },
        telemetry: {
          speed: scene.hud.speed ? scene.hud.speed / 40 : 0,
          battery: scene.battery ?? 82,
          ...sensors,
          can: {},
        },
      };
    },
  };
}
