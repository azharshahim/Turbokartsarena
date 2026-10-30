/** Colour-coded gifts, built from original lightweight procedural geometry. */
import * as THREE from 'three';
import { giftBobY, giftRotation, type Gift } from '../core/powerups';
const COLORS: Record<Gift['kind'], number> = { turbo: 0x40c8ff, superTurbo: 0xb44dff, shield: 0x4dffc8, repair: 0x7dff4d, coins: 0xffd21f, weapon: 0xff4d5e };
export function createGiftMesh(gift: Gift): THREE.Group {
  const g = new THREE.Group();
  const color = COLORS[gift.kind];
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.35, 1.35), new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.3, emissive: color, emissiveIntensity: 0.35 }));
  const ribbonMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.25 });
  const ribbon1 = new THREE.Mesh(new THREE.BoxGeometry(1.39, 1.39, 0.19), ribbonMat);
  const ribbon2 = new THREE.Mesh(new THREE.BoxGeometry(0.19, 1.39, 1.39), ribbonMat);
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.075, 6, 12), ribbonMat);
  bow.position.y = 0.82;
  const halo = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.055, 6, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.65, depthWrite: false }));
  halo.rotation.x = Math.PI / 2; halo.position.y = -0.8;
  g.add(box, ribbon1, ribbon2, bow, halo);
  g.userData.giftId = gift.id; return g;
}
export function updateGiftMesh(mesh: THREE.Group, gift: Gift, t: number): void {
  mesh.visible = gift.active; mesh.rotation.y = giftRotation(t, gift.id); mesh.position.y = giftBobY(t, gift.id);
}
export function createShieldBubble(): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(1.9, 20, 14), new THREE.MeshPhysicalMaterial({ color: 0x6ee7ff, transparent: true, opacity: 0.22, roughness: 0.1, metalness: 0, side: THREE.DoubleSide }));
}
