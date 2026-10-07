/**
 * Ultrassônicos do carro real desenhados no chão em volta dele (filho de car.root).
 * Quatro setores (esquerda, frente-esquerda, frente-direita, direita) acendem pela zona
 * da telemetria: 1 longe (azul), 2 perto (âmbar), 3 crítico (vinho) — as mesmas cores
 * do Digital Twin. Zona 0 = setor apagado. Custo: 4 malhas pequenas, sem luz.
 */
import * as THREE from 'three';
import { CAR_SIZE } from './car.js';

const ZONE_COLORS = { 1: 0x2f78d4, 2: 0xffa41b, 3: 0x861a36 };
const ZONE_REACH = { 1: 0.95, 2: 0.6, 3: 0.32 };   // alcance do setor (unidades do mundo)
const ZONE_OPACITY = { 1: 0.32, 2: 0.48, 3: 0.62 };

// Ângulo central de cada sensor no plano do chão; frente do carro = -Z local
const SENSORS = [
  { key: 'left', angle: Math.PI * 0.82 },
  { key: 'frontLeft', angle: Math.PI * 0.6 },
  { key: 'frontRight', angle: Math.PI * 0.4 },
  { key: 'right', angle: Math.PI * 0.18 },
];
const SPREAD = Math.PI * 0.17;

export class Proximity {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'ultrassonicos';
    // O anel nasce no contorno do carro, à frente do centro
    this.group.position.set(0, 0.012, -CAR_SIZE.length * 0.18);
    this.sectors = SENSORS.map(({ key, angle }) => {
      const geometry = new THREE.RingGeometry(1, 2, 18, 1, angle - SPREAD / 2, SPREAD);
      const material = new THREE.MeshBasicMaterial({
        color: ZONE_COLORS[1], transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      // Ring no plano XY: deita no chão com a frente (+Y do ring) em -Z
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.group.add(mesh);
      return { key, mesh, zone: 0, level: 0 };
    });
  }

  /** zones = { left, frontLeft, frontRight, right } (0–3) ou null para apagar tudo. */
  update(zones, dt) {
    for (const sector of this.sectors) {
      const zone = zones ? Math.max(0, Math.min(3, Math.round(zones[sector.key] || 0))) : 0;
      if (zone) sector.zone = zone;
      // Acende rápido, apaga devagar (leitura sem piscar)
      const goal = zone ? 1 : 0;
      sector.level += (goal - sector.level) * (1 - Math.exp(-dt * (goal ? 16 : 5)));
      const visible = sector.level > 0.02;
      sector.mesh.visible = visible;
      if (!visible) continue;
      const shown = sector.zone || 1;
      const inner = CAR_SIZE.width * 0.55;
      sector.mesh.material.color.setHex(ZONE_COLORS[shown]);
      sector.mesh.material.opacity = ZONE_OPACITY[shown] * sector.level;
      this.shape(sector, inner, inner + ZONE_REACH[shown]);
    }
  }

  /** Ajusta o raio interno/externo do setor sem recriar a geometria. */
  shape(sector, inner, outer) {
    if (sector.inner === inner && sector.outer === outer) return;
    sector.inner = inner;
    sector.outer = outer;
    const position = sector.mesh.geometry.attributes.position;
    const base = sector.base || (sector.base = Float32Array.from(position.array));
    for (let i = 0; i < position.count; i++) {
      const x = base[i * 3];
      const y = base[i * 3 + 1];
      const r = Math.hypot(x, y);              // 1 (dentro) ou 2 (fora)
      const target = r < 1.5 ? inner : outer;
      position.array[i * 3] = (x / r) * target;
      position.array[i * 3 + 1] = (y / r) * target;
    }
    position.needsUpdate = true;
    sector.mesh.geometry.computeBoundingSphere();
  }
}
