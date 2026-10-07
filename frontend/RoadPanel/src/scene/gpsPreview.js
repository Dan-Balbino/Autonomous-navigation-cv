/**
 * Prévia "estilo GPS" enquanto o carro está parado na placa PARE: a rota do carro até a
 * próxima placa é traçada em azul com contorno branco, um alfinete marca a placa e um
 * anel pulsa sob o carro. A geometria é montada uma vez por parada; por quadro só andam
 * uniforms e a animação do alfinete.
 */
import * as THREE from 'three';
import { PX_TO_WORLD } from '../track/trackData.js';

const STEP_PX = 3;
const WIDTH = 0.44;
const DRAW_MS = 1100;
const FADE_MS = 450;
const BLUE = 0x1f5fd8;

const routeVertex = /* glsl */ `
  attribute float aT;
  attribute float aSide;
  varying float vT;
  varying float vSide;
  void main() {
    vT = aT;
    vSide = aSide;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const routeFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uProgress;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uLength;
  varying float vT;
  varying float vSide;
  void main() {
    if (vT > uProgress) discard;
    float side = abs(vSide);
    float aa = fwidth(side) * 1.5;
    // Contorno branco + miolo azul, como a linha de rota de um GPS
    float casing = smoothstep(0.62 - aa, 0.62 + aa, side);
    vec3 color = mix(uColor, vec3(1.0), casing);
    // Pontos de luz correndo em direção à placa
    float run = fract(vT * uLength / 0.7 - uTime * 0.9);
    float dash = (1.0 - smoothstep(0.0, 0.18, run)) * (1.0 - casing);
    color = mix(color, vec3(0.78, 0.88, 1.0), dash * 0.7);
    // Ponta que desenha a rota fica mais clara
    float head = 1.0 - smoothstep(0.0, 0.05, uProgress - vT);
    color = mix(color, vec3(1.0), head * 0.5 * step(uProgress, 0.999));
    float edgeAlpha = 1.0 - smoothstep(1.0 - aa, 1.0, side);
    gl_FragColor = vec4(color, edgeAlpha * uOpacity);
  }
`;

function ringTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 20, 64, 64, 64);
  g.addColorStop(0, 'rgba(31, 95, 216, 0)');
  g.addColorStop(0.72, 'rgba(31, 95, 216, 0.55)');
  g.addColorStop(0.86, 'rgba(31, 95, 216, 0.9)');
  g.addColorStop(1, 'rgba(31, 95, 216, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function buildPin() {
  const pin = new THREE.Group();
  const blue = new THREE.MeshBasicMaterial({ color: BLUE, transparent: true });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 14), blue);
  head.position.y = 1.15;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.21, 0.62, 20, 1, true), blue);
  tip.rotation.x = Math.PI;
  tip.position.y = 0.78;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), white);
  dot.position.set(0, 1.15, 0);
  dot.scale.set(1, 1, 0.2);
  dot.renderOrder = 6;
  pin.add(head, tip, dot);
  pin.userData.materials = [blue, white];
  return pin;
}

export class GpsPreview {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'gps';
    this.group.visible = false;

    this.material = new THREE.ShaderMaterial({
      vertexShader: routeVertex,
      fragmentShader: routeFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      extensions: { derivatives: true },
      uniforms: {
        uColor: { value: new THREE.Color(BLUE) },
        uProgress: { value: 0 },
        uOpacity: { value: 1 },
        uTime: { value: 0 },
        uLength: { value: 1 },
      },
    });
    this.route = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.route.renderOrder = 4;
    this.route.frustumCulled = false;

    const texture = ringTexture();
    const ringMaterial = () => new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
    this.targetRing = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), ringMaterial());
    this.carRing = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), ringMaterial());
    for (const ring of [this.targetRing, this.carRing]) {
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 5;
    }
    this.pin = buildPin();
    this.group.add(this.route, this.targetRing, this.carRing, this.pin);

    this.active = false;
    this.plan = null;
    this.startedAt = 0;
    this.endedAt = 0;
  }

  /** Começa a prévia de `fromS` até o evento `target` da trajetória `plan`. */
  show(plan, fromS, target, now) {
    const line = plan.line;
    const s1 = Math.min(line.length, target.s);
    const span = Math.max(STEP_PX * 2, s1 - fromS);
    const count = Math.max(2, Math.ceil(span / STEP_PX) + 1);
    const positions = new Float32Array(count * 6);
    const along = new Float32Array(count * 2);
    const side = new Float32Array(count * 2);
    const h = WIDTH / 2;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const p = line.sample(fromS + span * t);
      const x = p.x * PX_TO_WORLD;
      const z = p.y * PX_TO_WORLD;
      const nx = -p.dir[1];
      const nz = p.dir[0];
      positions.set([x + nx * h, 0.03, z + nz * h, x - nx * h, 0.03, z - nz * h], i * 6);
      along[i * 2] = along[i * 2 + 1] = t;
      side[i * 2] = 1;
      side[i * 2 + 1] = -1;
    }
    const index = new Uint32Array((count - 1) * 6);
    for (let i = 0; i < count - 1; i++) {
      const a = i * 2;
      index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aT', new THREE.BufferAttribute(along, 1));
    geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.route.geometry.dispose();
    this.route.geometry = geometry;
    this.material.uniforms.uLength.value = span * PX_TO_WORLD;

    // Alfinete sobre a faixa, no ponto da trajetória mais perto da placa
    const end = line.sample(s1);
    const start = line.sample(fromS);
    this.pin.position.set(end.x * PX_TO_WORLD, 0, end.y * PX_TO_WORLD);
    this.targetRing.position.set(end.x * PX_TO_WORLD, 0.035, end.y * PX_TO_WORLD);
    this.carRing.position.set(start.x * PX_TO_WORLD, 0.034, start.y * PX_TO_WORLD);

    this.start = new THREE.Vector3(start.x * PX_TO_WORLD, 0, start.y * PX_TO_WORLD);
    this.end = this.pin.position.clone();
    this.plan = plan;
    this.active = true;
    this.startedAt = now;
    this.endedAt = 0;
    this.group.visible = true;
  }

  hide(now) {
    if (!this.active) return;
    this.active = false;
    this.endedAt = now;
  }

  /** Enquadramento para a câmera: centro e raio do trecho carro → placa. */
  focus() {
    if (!this.active) return null;
    const center = this.start.clone().add(this.end).multiplyScalar(0.5);
    const dir = this.end.clone().sub(this.start).setY(0);
    const radius = Math.max(2.5, dir.length() / 2);
    return { center, radius, dir: dir.lengthSq() > 1e-6 ? dir.normalize() : new THREE.Vector3(0, 0, -1) };
  }

  tick(now) {
    if (!this.group.visible) return;
    const u = this.material.uniforms;
    u.uTime.value = now / 1000;
    const drawn = Math.min(1, (now - this.startedAt) / DRAW_MS);
    u.uProgress.value = 1 - Math.pow(1 - drawn, 3);
    const fade = this.active ? 1 : Math.max(0, 1 - (now - this.endedAt) / FADE_MS);
    u.uOpacity.value = fade;
    if (fade <= 0) {
      this.group.visible = false;
      return;
    }

    // Alfinete cai no lugar quando a rota chega e depois flutua de leve
    const arrive = Math.min(1, Math.max(0, (now - this.startedAt - DRAW_MS * 0.7) / 380));
    const drop = (1 - arrive) * 1.4;
    this.pin.position.y = drop + Math.sin(now / 420) * 0.07 * arrive;
    this.pin.scale.setScalar(0.4 + 0.6 * arrive);
    for (const material of this.pin.userData.materials) material.opacity = fade * arrive;

    // Anéis pulsando (alvo e carro)
    const pulse = (now / 1300) % 1;
    this.targetRing.scale.setScalar(0.6 + pulse * 1.1);
    this.targetRing.material.opacity = (1 - pulse) * fade * arrive;
    const carPulse = ((now / 1300) + 0.5) % 1;
    this.carRing.scale.setScalar(0.7 + carPulse * 0.9);
    this.carRing.material.opacity = (1 - carPulse) * 0.7 * fade;
  }
}
