/** Phase 2 — Rendu 3D des cadeaux (Three.js) : boîtes cadeaux rotatives, réutilisables par world.ts. */
import * as THREE from 'three';
import { giftBobY, giftRotation, type Gift } from '../core/powerups';
const COLORS: Record<Gift['kind'], number> = { turbo: 0x40c8ff, superTurbo: 0xb44dff, shield: 0x4dffc8, repair: 0x7dff4d, coins: 0xffd21f, weapon: 0xff4d5e };
export function createGiftMesh(gift: Gift): THREE.Group {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.MeshStandardMaterial({ color: COLORS[gift.kind], metalness: 0.35, roughness: 0.3, emissive: COLORS[gift.kind], emissiveIntensity: 0.35 }));
  const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.2, 0.2), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.6, roughness: 0.25 }));
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.05, 8, 24), new THREE.MeshBasicMaterial({ color: COLORS[gift.kind], transparent: true, opacity: 0.55 }));
  halo.rotation.x = Math.PI / 2;
  g.add(box, ribbon, halo); // 3 meshes/cadeau : budget draw-calls mobile g.userData.giftId = gift.id; return g;
}
export function updateGiftMesh(mesh: THREE.Group, gift: Gift, t: number): void {
  mesh.visible = gift.active; mesh.rotation.y = giftRotation(t, gift.id); mesh.position.y = giftBobY(t, gift.id);
}
export function createShieldBubble(): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(1.9, 20, 14), new THREE.MeshPhysicalMaterial({ color: 0x6ee7ff, transparent: true, opacity: 0.22, roughness: 0.1, metalness: 0, side: THREE.DoubleSide }));
}
