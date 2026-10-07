/**
 * Carro na cena. Começa como um bloco provisório (branco com teto preto) e é trocado pelo
 * modelo real (models/car.glb, gerado de 3DModel/base_basic_pbr.glb) assim que ele carrega.
 * `loadModel(url)` mantém posição, direção e escala (o modelo é ajustado ao mesmo comprimento).
 */
import * as THREE from 'three';

export const CAR_SIZE = { length: 1.05, width: 0.62, height: 0.42 };

function placeholder() {
  const group = new THREE.Group();
  const { length, width, height } = CAR_SIZE;
  const white = new THREE.MeshLambertMaterial({ color: 0xf6f8fb });
  const black = new THREE.MeshLambertMaterial({ color: 0x11151c });

  // Carroceria branca + teto/vidros pretos (frente = -Z local)
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, height * 0.62, length), white);
  body.position.y = height * 0.31 + 0.03;
  group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(width * 0.82, height * 0.38, length * 0.52), black);
  cabin.position.set(0, height * 0.62 + height * 0.19 + 0.03, length * 0.06);
  group.add(cabin);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(body.geometry),
    new THREE.LineBasicMaterial({ color: 0x11151c })
  );
  edges.position.copy(body.position);
  group.add(edges);

  const lamp = (color, z, x) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.045, 0.01), new THREE.MeshBasicMaterial({ color }));
    mesh.position.set(x, height * 0.42 + 0.03, z);
    return mesh;
  };
  group.add(
    lamp(0x9cc4ff, -length / 2 - 0.006, -width * 0.3),
    lamp(0x9cc4ff, -length / 2 - 0.006, width * 0.3),
    lamp(0xe0334f, length / 2 + 0.006, -width * 0.3),
    lamp(0xe0334f, length / 2 + 0.006, width * 0.3)
  );

  return group;
}

function contactShadow() {
  const { length, width } = CAR_SIZE;
  // Sombra de contato suave (textura radial, sem mapa de sombras)
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(15, 22, 35, 0.42)');
  gradient.addColorStop(1, 'rgba(15, 22, 35, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 2.1, length * 1.7),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.008;
  return shadow;
}

function disposeTree(object) {
  object.traverse((child) => {
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material?.dispose());
  });
}

export class Car {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'carro';
    this.body = placeholder();
    this.shadow = contactShadow();
    this.root.add(this.body, this.shadow);
    this.isPlaceholder = true;
  }

  /** Posiciona o carro: x/z no mundo e direção (vetor unitário no chão). */
  place(x, z, dirX, dirZ) {
    this.root.position.set(x, 0, z);
    // Frente do carro é -Z local
    this.root.rotation.y = Math.atan2(-dirX, -dirZ);
  }

  /**
   * Troca o corpo atual pelo modelo 3D (.glb/.gltf). `yaw` gira o modelo para a frente
   * ficar em -Z; ele é escalado para o comprimento CAR_SIZE.length e apoiado no chão.
   */
  async loadModel(url, { yaw = 0 } = {}) {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = gltf.scene;
    model.rotation.y = yaw;
    model.traverse((child) => {
      if (child.isMesh) child.frustumCulled = false; // o carro está sempre na tela
    });
    const holder = new THREE.Group();
    holder.add(model);
    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3());
    holder.scale.setScalar(CAR_SIZE.length / Math.max(size.z, 1e-6));
    box.setFromObject(holder);
    const center = box.getCenter(new THREE.Vector3());
    holder.position.set(-center.x, -box.min.y, -center.z);
    const footprint = box.getSize(new THREE.Vector3());
    this.shadow.scale.set(footprint.x / CAR_SIZE.width, footprint.z / CAR_SIZE.length, 1);
    this.root.remove(this.body);
    disposeTree(this.body);
    this.body = holder;
    this.root.add(holder);
    this.isPlaceholder = false;
  }
}
