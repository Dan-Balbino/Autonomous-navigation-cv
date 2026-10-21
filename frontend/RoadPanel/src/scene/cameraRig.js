/**
 * Câmera do painel:
 * - chase: atrás e acima do carro, olhando à frente (padrão, estilo BYD);
 * - top:   pista inteira vista de cima, levemente inclinada;
 * - free:  órbita livre com o mouse (debug).
 * Em perseguição, `setFocus()` sobe a câmera para enquadrar um trecho (prévia GPS na PARE).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { IMAGE_SIZE, PX_TO_WORLD } from '../track/trackData.js';

// Câmera mais alta e olhando para baixo: horizonte perto de 30% do topo, como no BYD
const CHASE = { back: 4.8, up: 3.7, ahead: 4.6, lookUp: 0.0 };
const CHASE_PORTRAIT = { back: 5.6, up: 5.2, ahead: 4.0, lookUp: 0.0 };
// Prévia GPS afastada: a partir destes raios (mundo) a vista gira até a pista ficar deitada
const WIDE_FROM = 3.5;
const WIDE_TO = 8;

export class CameraRig {
  constructor(camera, domElement) {
    this.camera = camera;
    this.mode = 'chase';
    this.controls = new OrbitControls(camera, domElement);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.lookAt = new THREE.Vector3();
    this.trackCenter = new THREE.Vector3(IMAGE_SIZE.w / 2 * PX_TO_WORLD, 0, IMAGE_SIZE.h / 2 * PX_TO_WORLD);
    this.initialized = false;
    this.focus = null;
    this.wideUp = new THREE.Vector3(0, 0, -1);   // "para cima" da tela na vista afastada
  }

  /**
   * Direção da prévia: perto segue o carro; afastada gira até o eixo comprido da pista
   * (x) ficar na horizontal da tela, como na vista de topo. Escolhe entre ±z o lado mais
   * próximo do carro (com folga, para não virar 180° no meio da prévia).
   */
  focusDir(dir, radius) {
    if (dir.z < -0.2) this.wideUp.set(0, 0, -1);
    else if (dir.z > 0.2) this.wideUp.set(0, 0, 1);
    const wide = THREE.MathUtils.smoothstep(radius, WIDE_FROM, WIDE_TO);
    const out = dir.clone().lerp(this.wideUp, wide);
    return out.lengthSq() > 1e-6 ? out.normalize() : this.wideUp.clone();
  }

  /** Enquadra { center, radius, dir } (ou null para voltar a seguir o carro). */
  setFocus(focus) {
    this.focus = focus;
  }

  setMode(mode) {
    this.mode = mode;
    this.controls.enabled = mode === 'free';
    if (mode === 'free') {
      this.controls.target.copy(this.lookAt);
      this.controls.update();
    }
  }

  /** Atualiza a câmera; `car` = { x, z, dirX, dirZ }, `dt` em segundos. */
  update(car, dt) {
    if (this.mode === 'free') {
      this.controls.update();
      return;
    }
    let target;
    let look;
    if (this.mode === 'top') {
      // Distância calculada pelo campo de visão para a pista inteira caber na área livre
      // da tela (fora do cartão da missão, da barra de cima e dos botões laterais)
      const w = IMAGE_SIZE.w * PX_TO_WORLD;
      const h = IMAGE_SIZE.h * PX_TO_WORLD;
      const aspect = this.camera.aspect || 1.6;
      const portrait = aspect < 0.9;
      const safe = portrait ? { w: 0.9, h: 0.42, x: 0, y: -0.12 } : { w: 0.6, h: 0.66, x: 0.09, y: -0.02 };
      const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      const dist = Math.max(h / (safe.h * 2 * tan), w / (safe.w * aspect * 2 * tan)) * 1.04;
      const viewW = 2 * dist * tan * aspect;
      const viewH = 2 * dist * tan;
      // Desloca o centro para a pista ficar no meio da área livre
      const center = this.trackCenter.clone().add(new THREE.Vector3(-safe.x * viewW, 0, -safe.y * viewH));
      const tilt = 0.18;   // leve inclinação, mantém a sensação de 3D
      target = new THREE.Vector3(center.x, dist * Math.cos(tilt), center.z + dist * Math.sin(tilt));
      look = center;
    } else if (this.focus) {
      // Quase de cima, um pouco atrás do carro; o carro fica acima do cartão da prévia
      const { center, radius } = this.focus;
      const portrait = (this.camera.aspect || 1.6) < 0.9;
      // Em retrato a tela é alta: a pista deitada não cabe, segue a direção do carro
      const dir = portrait ? this.focus.dir : this.focusDir(this.focus.dir, radius);
      // O topo da tela tem o HUD: o alvo mira um pouco além do meio para a placa descer
      const height = radius * (portrait ? 5.2 : 2.7) + 4;
      const back = radius * 0.55 + 1.5;
      const aim = center.clone().addScaledVector(dir, radius * (portrait ? 0.32 : 0.12));
      target = new THREE.Vector3(aim.x - dir.x * back, height, aim.z - dir.z * back);
      look = aim;
    } else {
      const c = (this.camera.aspect || 1.6) < 0.9 ? CHASE_PORTRAIT : CHASE;
      target = new THREE.Vector3(car.x - car.dirX * c.back, c.up, car.z - car.dirZ * c.back);
      look = new THREE.Vector3(car.x + car.dirX * c.ahead, c.lookUp, car.z + car.dirZ * c.ahead);
    }
    if (!this.initialized) {
      this.camera.position.copy(target);
      this.lookAt.copy(look);
      this.initialized = true;
    }
    // Aproximação exponencial: segue o carro sem tremer e sem atraso perceptível
    const k = 1 - Math.exp(-dt * (this.mode === 'top' || this.focus ? 2.6 : 5.5));
    this.camera.position.lerp(target, k);
    this.lookAt.lerp(look, Math.min(1, k * 1.6));
    this.camera.lookAt(this.lookAt);
  }
}
