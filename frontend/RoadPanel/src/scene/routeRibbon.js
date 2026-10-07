/**
 * Fita azul da trajetória esperada, desenhada no asfalto.
 *
 * Desempenho e fluidez: a geometria é construída UMA vez por plano (quando a rota
 * muda); a cada quadro só o uniform uCarS anda, apagando a fita atrás do carro e
 * esmaecendo à frente. Nada é reconstruído enquanto o carro se move.
 */
import * as THREE from 'three';
import { PX_TO_WORLD } from '../track/trackData.js';

const STEP_PX = 4;
const RIBBON_WIDTH = 0.66;
const REVEAL_MS = 1100;

const vertexShader = /* glsl */ `
  attribute float aTravel;
  attribute float aSide;
  varying float vTravel;
  varying float vSide;
  void main() {
    vTravel = aTravel;
    vSide = aSide;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uEdge;
  uniform float uTime;
  uniform float uCarS;
  uniform float uReveal;
  uniform float uFade;
  varying float vTravel;
  varying float vSide;
  void main() {
    float ahead = vTravel - uCarS;
    if (ahead < -0.3 || vTravel > uReveal) discard;
    float side = abs(vSide);
    float aa = fwidth(side) * 1.5;
    // Bordas finas e nítidas, corpo translúcido, setas andando no sentido da trajetória
    float edge = smoothstep(0.84 - aa, 0.84 + aa, side) * (1.0 - smoothstep(1.0 - aa, 1.0, side));
    float body = 0.2;
    float chevronPhase = fract((vTravel + side * 0.22) / 0.85 - uTime * 0.55);
    float chevron = smoothstep(0.0, 0.06, chevronPhase) * (1.0 - smoothstep(0.16, 0.24, chevronPhase));
    chevron *= 1.0 - smoothstep(0.55, 0.7, side);
    float fade = 1.0 - smoothstep(uFade * 0.35, uFade, ahead);
    float near = smoothstep(-0.3, 0.9, ahead);
    vec3 color = mix(uColor, uEdge, edge * 0.7);
    color = mix(color, vec3(1.0), chevron * 0.55);
    float alpha = (body + edge * 0.7 + chevron * 0.45) * fade * near;
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.92));
  }
`;

export class RouteRibbon {
  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      extensions: { derivatives: true },
      uniforms: {
        uColor: { value: new THREE.Color(0x2f7bff) },
        uEdge: { value: new THREE.Color(0x1546b8) },
        uTime: { value: 0 },
        uCarS: { value: 0 },
        uReveal: { value: 1e6 },
        uFade: { value: 34 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this.revealStart = -1e9;
    this.length = 0;
  }

  /** Constrói a fita para um plano novo; `reveal` acende a partir do carro (rota mudou). */
  setPlan(plan, reveal = false) {
    const line = plan.line;
    const count = Math.max(2, Math.ceil(line.length / STEP_PX) + 1);
    const positions = new Float32Array(count * 6);
    const travel = new Float32Array(count * 2);
    const side = new Float32Array(count * 2);
    const h = RIBBON_WIDTH / 2;
    for (let i = 0; i < count; i++) {
      const s = Math.min(line.length, i * STEP_PX);
      const p = line.sample(s);
      const x = p.x * PX_TO_WORLD;
      const z = p.y * PX_TO_WORLD;
      const nx = -p.dir[1];
      const nz = p.dir[0];
      positions.set([x + nx * h, 0.012, z + nz * h, x - nx * h, 0.012, z - nz * h], i * 6);
      const t = s * PX_TO_WORLD;
      travel[i * 2] = t;
      travel[i * 2 + 1] = t;
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
    geometry.setAttribute('aTravel', new THREE.BufferAttribute(travel, 1));
    geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.mesh.geometry.dispose();
    this.mesh.geometry = geometry;
    this.length = line.length * PX_TO_WORLD;
    if (reveal) this.revealStart = performance.now();
  }

  /** A cada quadro: posição do carro na trajetória (px) e tempo. */
  tick(now, carSPx) {
    const u = this.material.uniforms;
    u.uTime.value = now / 1000;
    u.uCarS.value = carSPx * PX_TO_WORLD;
    const t = Math.min(1, (now - this.revealStart) / REVEAL_MS);
    const eased = 1 - Math.pow(1 - t, 3);
    u.uReveal.value = t >= 1 ? 1e6 : u.uCarS.value + eased * Math.max(this.length - u.uCarS.value, 1);
  }
}
