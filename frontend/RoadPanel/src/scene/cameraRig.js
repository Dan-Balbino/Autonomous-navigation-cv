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
      const span = IMAGE_SIZE.w * PX_TO_WORLD;
      const aspect = this.camera.aspect || 1.6;
      const height = Math.max(span / aspect, IMAGE_SIZE.h * PX_TO_WORLD) * 0.95;
      target = new THREE.Vector3(this.trackCenter.x, height, this.trackCenter.z + height * 0.42);
      look = this.trackCenter.clone();
    } else if (this.focus) {
      // Quase de cima, um pouco atrás do carro; o carro fica acima do cartão da prévia
      const { center, radius, dir } = this.focus;
      const portrait = (this.camera.aspect || 1.6) < 0.9;
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
