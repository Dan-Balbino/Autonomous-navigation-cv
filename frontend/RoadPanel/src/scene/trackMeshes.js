/**
 * Malhas da pista em visual diurno:
 * - campo branco/cinza com malha de pontos azuis "semi vivos" (faixas de luz passando);
 * - asfalto cinza claro com grão sutil, ilhas brancas baixas com sombra de contato suave;
 * - linhas pretas finas e translúcidas (a largada fica sólida);
 * - cada grupo mesclado numa única geometria (uma chamada de desenho).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOUNDARIES, START_LINE, PX_TO_WORLD, LINE_WIDTH_PX, IMAGE_SIZE } from '../track/trackData.js';
import { smoothPolyline } from '../track/network.js';

export const COLORS = {
  field: 0xeef1f5,
  lane: 0xdde2e9,
  island: 0xfdfdfe,
  line: 0x0e131b,
  dot: 0x2f7bff,
};

const ISLAND_HEIGHT = 0.022;
const LINE_OPACITY = 0.58;
// Linha desenhada um pouco mais fina que a medida (8 px): lê melhor em perspectiva
const LINE_DRAW_PX = LINE_WIDTH_PX * 0.72;
const SHADOW_WIDTH = 0.42;

export const toWorld = ([x, y]) => new THREE.Vector3(x * PX_TO_WORLD, 0, y * PX_TO_WORLD);

/** Faixa plana ao longo de uma polilinha (px), com largura em unidades do mundo. */
export function stripGeometry(points, width, { closed = false, y = 0, sides = false } = {}) {
  const pts = points.map(toWorld);
  if (closed) pts.push(pts[0].clone());
  const positions = [];
  const half = width / 2;
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const dir = new THREE.Vector3().subVectors(next, prev).setY(0).normalize();
    const p = pts[i];
    positions.push(p.x - dir.z * half, y, p.z + dir.x * half, p.x + dir.z * half, y, p.z - dir.x * half);
  }
  const index = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (sides) geometry.setAttribute('aSide', new THREE.Float32BufferAttribute(pts.flatMap(() => [1, -1]), 1));
  geometry.setIndex(index);
  return geometry;
}

/** Asfalto com variação de tom suave e de baixa frequência (sem textura, sem serrilhado). */
function laneMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
    side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uColor: { value: new THREE.Color(COLORS.lane) } },
    ]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec2 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform vec3 uColor;
      varying vec2 vWorld;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        float soft = noise(vWorld * 1.6) * 0.6 + noise(vWorld * 4.3) * 0.4 - 0.5;
        vec3 color = uColor * (1.0 + soft * 0.03);
        gl_FragColor = vec4(color, 1.0);
        #include <fog_fragment>
      }
    `,
  });
}

/** Sombra de contato em volta das ilhas: faixa com alfa caindo para fora. */
function contactShadowMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float aSide;
      varying float vSide;
      void main() {
        vSide = aSide;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vSide;
      void main() {
        float a = 1.0 - abs(vSide);
        gl_FragColor = vec4(0.06, 0.09, 0.16, a * a * 0.16);
      }
    `,
  });
}

const toShapePoints = (points) => points.map(([x, y]) => new THREE.Vector2(x * PX_TO_WORLD, y * PX_TO_WORLD));

/** Campo com malha de pontos animada (shader barato, uma só malha). */
function dotField(center) {
  const material = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uBase: { value: new THREE.Color(COLORS.field) },
        uDot: { value: new THREE.Color(COLORS.dot) },
        uSpacing: { value: 0.46 },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec2 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform vec3 uBase;
      uniform vec3 uDot;
      uniform float uSpacing;
      varying vec2 vWorld;
      void main() {
        vec2 cell = fract(vWorld / uSpacing) - 0.5;
        float d = length(cell) * uSpacing;
        float aa = fwidth(d) * 1.2;
        float dotMask = 1.0 - smoothstep(0.035 - aa, 0.035 + aa, d);
        // Faixas de luz passando em direções diferentes
        float w1 = smoothstep(0.82, 1.0, sin(dot(vWorld, vec2(0.21, 0.08)) - uTime * 0.9));
        float w2 = smoothstep(0.86, 1.0, sin(dot(vWorld, vec2(-0.06, 0.19)) - uTime * 0.6 + 1.7));
        float w3 = smoothstep(0.9, 1.0, sin(length(vWorld - vec2(11.0, 6.0)) * 0.55 - uTime * 1.1));
        float glow = clamp(w1 + w2 * 0.8 + w3 * 0.7, 0.0, 1.0);
        float strength = dotMask * (0.22 + 0.78 * glow);
        gl_FragColor = vec4(mix(uBase, uDot, strength), 1.0);
        #include <fog_fragment>
      }
    `,
  });
  material.extensions = { derivatives: true };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(center.x, -0.002, center.z);
  return mesh;
}

export function buildTrack() {
  const group = new THREE.Group();
  group.name = 'pista';
  const center = toWorld([IMAGE_SIZE.w / 2, IMAGE_SIZE.h / 2]);

  const field = dotField(center);
  group.add(field);

  const smooth = Object.fromEntries(BOUNDARIES.map((b) => [b.id, smoothPolyline(b.points, b.closed)]));
  const islands = BOUNDARIES.filter((b) => b.id.startsWith('ilha'));

  // Asfalto: contorno externo com as ilhas como furos
  const laneShape = new THREE.Shape(toShapePoints(smooth.externo));
  for (const island of islands) laneShape.holes.push(new THREE.Path(toShapePoints(smooth[island.id])));
  const laneGeometry = new THREE.ShapeGeometry(laneShape);
  laneGeometry.rotateX(Math.PI / 2);
  const lanes = new THREE.Mesh(laneGeometry, laneMaterial());
  lanes.position.y = 0.001;
  group.add(lanes);

  // Ilhas brancas elevadas (uma malha)
  const islandGeometries = islands.map((island) => {
    const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(toShapePoints(smooth[island.id])), {
      depth: ISLAND_HEIGHT, bevelEnabled: false, curveSegments: 1,
    });
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, ISLAND_HEIGHT, 0);
    return geometry;
  });
  group.add(new THREE.Mesh(mergeGeometries(islandGeometries), new THREE.MeshLambertMaterial({ color: COLORS.island })));

  // Sombra de contato das ilhas no asfalto (metade fica escondida sob a ilha)
  const shadows = new THREE.Mesh(
    mergeGeometries(islands.map((island) => stripGeometry(smooth[island.id], SHADOW_WIDTH, { closed: true, y: 0.002, sides: true }))),
    contactShadowMaterial()
  );
  shadows.renderOrder = 1;
  group.add(shadows);

  // Linhas pretas translúcidas da pista (uma malha)
  const lineWidth = LINE_DRAW_PX * PX_TO_WORLD;
  const lineGeometries = BOUNDARIES.map((boundary) => {
    const lift = boundary.id.startsWith('ilha') ? ISLAND_HEIGHT + 0.003 : 0.004;
    return stripGeometry(smooth[boundary.id], lineWidth, { closed: true, y: lift });
  });
  const lines = new THREE.Mesh(mergeGeometries(lineGeometries), new THREE.MeshBasicMaterial({
    color: COLORS.line, transparent: true, opacity: LINE_OPACITY, depthWrite: false, side: THREE.DoubleSide,
  }));
  lines.renderOrder = 1;
  group.add(lines);

  // Largada quadriculada (sólida)
  const startGeometries = [];
  const { x, y, w, h, cols, rows } = START_LINE;
  const cellW = (w / cols) * PX_TO_WORLD;
  const cellH = (h / rows) * PX_TO_WORLD;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if ((c + r) % 2 === 1) continue;
      const square = new THREE.PlaneGeometry(cellW, cellH);
      square.rotateX(-Math.PI / 2);
      square.translate((x + (c + 0.5) * (w / cols)) * PX_TO_WORLD, 0.005, (y + (r + 0.5) * (h / rows)) * PX_TO_WORLD);
      square.deleteAttribute('uv');
      square.deleteAttribute('normal');
      startGeometries.push(square);
    }
  }
  group.add(new THREE.Mesh(mergeGeometries(startGeometries), new THREE.MeshBasicMaterial({ color: COLORS.line, side: THREE.DoubleSide })));

  return { group, tick: (time) => { field.material.uniforms.uTime.value = time; } };
}
