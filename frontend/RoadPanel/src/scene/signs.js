/**
 * Placas da pista em 3D: pontos A/B/C (hexágono, legível dos dois lados), PARE
 * (octógono), desvio à direita (losango âmbar) e semáforo (caixa com 3 luzes).
 * Cada placa fica num poste preto, voltada para quem chega (direção calculada pela rede).
 * Sem luzes reais: o semáforo acende por cor (barato para o FPS).
 */
import * as THREE from 'three';
import { PX_TO_WORLD } from '../track/trackData.js';

const SIGN_SIZE = 0.6;
const POST_HEIGHT = 0.9;

export const SIGN_COLORS = {
  stop: '#c4122f',
  detour: '#f2b705',
  point: '#ffffff',
  ink: '#0d1118',
  post: 0x1b2028,
};

const LIGHT_COLORS = { red: 0xff2a3a, yellow: 0xffb21a, green: 0x14c97a };
const LAMP_OFF = 0x2a303b;

const textureCache = new Map();

function polygonPath(ctx, size, sides, rotation, inset = 0) {
  const r = size / 2 - inset;
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i * Math.PI * 2) / sides;
    const x = size / 2 + Math.cos(a) * r;
    const y = size / 2 + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Face da placa desenhada em canvas (também usada pelo editor 2D). */
export function drawSignFace(ctx, size, kind, label = '') {
  ctx.clearRect(0, 0, size, size);
  if (kind === 'point') {
    polygonPath(ctx, size, 6, 0, size * 0.02);
    ctx.fillStyle = SIGN_COLORS.ink;
    ctx.fill();
    polygonPath(ctx, size, 6, 0, size * 0.09);
    ctx.fillStyle = SIGN_COLORS.point;
    ctx.fill();
    ctx.fillStyle = SIGN_COLORS.ink;
    ctx.font = `700 ${size * 0.5}px Saira, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, size / 2, size / 2 + size * 0.03);
  } else if (kind === 'stop') {
    polygonPath(ctx, size, 8, Math.PI / 8, size * 0.015);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    polygonPath(ctx, size, 8, Math.PI / 8, size * 0.065);
    ctx.fillStyle = SIGN_COLORS.stop;
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${size * 0.27}px Saira, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PARE', size / 2, size / 2 + size * 0.02);
  } else if (kind === 'detour') {
    polygonPath(ctx, size, 4, 0, size * 0.02);
    ctx.fillStyle = SIGN_COLORS.ink;
    ctx.fill();
    polygonPath(ctx, size, 4, 0, size * 0.07);
    ctx.fillStyle = SIGN_COLORS.detour;
    ctx.fill();
    ctx.strokeStyle = SIGN_COLORS.ink;
    ctx.lineWidth = size * 0.055;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const c = size / 2;
    ctx.beginPath();
    ctx.moveTo(c - size * 0.06, c + size * 0.26);
    ctx.lineTo(c - size * 0.06, c - size * 0.24);
    ctx.moveTo(c - size * 0.06, c + size * 0.02);
    ctx.lineTo(c + size * 0.14, c - size * 0.16);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c + size * 0.03, c - size * 0.18);
    ctx.lineTo(c + size * 0.16, c - size * 0.18);
    ctx.lineTo(c + size * 0.16, c - size * 0.05);
    ctx.stroke();
  } else if (kind === 'traffic-light') {
    ctx.fillStyle = SIGN_COLORS.ink;
    ctx.beginPath();
    ctx.roundRect(size * 0.3, size * 0.06, size * 0.4, size * 0.88, size * 0.12);
    ctx.fill();
    ['#ff2a3a', '#ffb21a', '#14c97a'].forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(size / 2, size * (0.23 + i * 0.27), size * 0.09, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

function faceTexture(kind, label) {
  const key = `${kind}:${label}`;
  if (textureCache.has(key)) return textureCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  drawSignFace(canvas.getContext('2d'), 256, kind, label);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  textureCache.set(key, texture);
  return texture;
}

const postGeometry = new THREE.CylinderGeometry(0.022, 0.026, 1, 8);
const postMaterial = new THREE.MeshLambertMaterial({ color: SIGN_COLORS.post });
const plateGeometry = new THREE.PlaneGeometry(SIGN_SIZE, SIGN_SIZE);

function post(height) {
  const mesh = new THREE.Mesh(postGeometry, postMaterial);
  mesh.scale.y = height;
  mesh.position.y = height / 2;
  return mesh;
}

function plate(kind, label, twoSided) {
  const group = new THREE.Group();
  const texture = faceTexture(kind, label);
  const front = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.5 });
  const back = twoSided ? front : new THREE.MeshBasicMaterial({ map: texture, color: 0x3a414d, transparent: true, alphaTest: 0.5 });
  const face = new THREE.Mesh(plateGeometry, front);
  const rear = new THREE.Mesh(plateGeometry, back);
  rear.rotation.y = Math.PI;
  rear.position.z = -0.003;
  group.add(face, rear);
  return group;
}

function trafficLight() {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(
    new THREE.BoxGeometry(0.17, 0.44, 0.12),
    new THREE.MeshLambertMaterial({ color: SIGN_COLORS.ink })
  ));
  const lamps = {};
  ['red', 'yellow', 'green'].forEach((name, i) => {
    const material = new THREE.MeshBasicMaterial({ color: LAMP_OFF });
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.052, 20), material);
    lamp.position.set(0, 0.135 - i * 0.135, 0.061);
    group.add(lamp);
    lamps[name] = material;
  });
  group.userData.lamps = lamps;
  return group;
}

/** Cria as placas a partir das placas da rede (posição e direção já calculadas). */
export function buildSigns(signs) {
  const group = new THREE.Group();
  group.name = 'placas';
  let light = null;

  for (const sign of signs) {
    const holder = new THREE.Group();
    holder.position.set(sign.at[0] * PX_TO_WORLD, 0, sign.at[1] * PX_TO_WORLD);
    // A face (+Z local) aponta para `facing` (de onde vem quem lê a placa)
    holder.rotation.y = Math.atan2(sign.facing[0], sign.facing[1]);

    if (sign.kind === 'traffic-light') {
      holder.add(post(POST_HEIGHT * 0.8));
      light = trafficLight();
      light.position.y = POST_HEIGHT * 0.8 + 0.2;
      holder.add(light);
    } else {
      holder.add(post(POST_HEIGHT));
      const face = plate(sign.kind, sign.point || '', sign.kind === 'point');
      face.position.y = POST_HEIGHT + SIGN_SIZE / 2 - 0.04;
      holder.add(face);
    }
    group.add(holder);
  }

  let lastState;
  const setLight = (state) => {
    if (!light || state === lastState) return;
    lastState = state;
    for (const [name, material] of Object.entries(light.userData.lamps)) {
      material.color.set(name === state ? LIGHT_COLORS[name] : LAMP_OFF);
    }
  };

  return { group, setLight };
}
