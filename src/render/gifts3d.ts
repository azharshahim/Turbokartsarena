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
  const badge = new THREE.Group();
  badge.position.z = .73;
  const symbolMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  // Six silhouettes rather than relying on color alone; no font or texture load.
  const add = (geometry: THREE.BufferGeometry, x = 0, y = 0) => {
    const symbol = new THREE.Mesh(geometry, symbolMat); symbol.position.set(x, y, 0); badge.add(symbol); return symbol;
  };
  if (gift.kind === 'repair') { add(new THREE.BoxGeometry(.48, .13, .04)); add(new THREE.BoxGeometry(.13, .48, .04)); }
  else if (gift.kind === 'coins') { add(new THREE.TorusGeometry(.24, .055, 5, 16)); add(new THREE.BoxGeometry(.06, .3, .03)); }
  else if (gift.kind === 'shield') add(new THREE.CircleGeometry(.28, 5)).rotation.z = Math.PI / 2;
  else if (gift.kind === 'weapon') { add(new THREE.TorusGeometry(.23, .035, 4, 16)); add(new THREE.BoxGeometry(.6, .04, .03)); add(new THREE.BoxGeometry(.04, .6, .03)); }
  else { const arrow = add(new THREE.ConeGeometry(.19, .4, 3), 0, .03); arrow.rotation.z = -.4; if (gift.kind === 'superTurbo') add(new THREE.ConeGeometry(.13, .28, 3), .22, -.1).rotation.z = -.4; }
  g.add(box, ribbon1, ribbon2, bow, halo, badge);
  g.userData.giftId = gift.id; return g;
}
export function collectGiftMesh(mesh: THREE.Group, time: number) { mesh.userData.collectedAt = time; }
export function updateGiftMesh(mesh: THREE.Group, gift: Gift, t: number): void {
  const age = typeof mesh.userData.collectedAt === 'number' ? t - mesh.userData.collectedAt : Infinity;
  const collecting = !gift.active && age >= 0 && age < .55;
  mesh.visible = gift.active || collecting;
  mesh.scale.setScalar(collecting ? 1 + age * 1.4 : 1);
  mesh.rotation.y = giftRotation(t, gift.id) + (collecting ? age * 9 : 0);
  mesh.position.y = giftBobY(t, gift.id) + (collecting ? age * 3 : 0);
  if (gift.active) delete mesh.userData.collectedAt;
}
export function createShieldBubble(): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(1.9, 20, 14), new THREE.MeshPhysicalMaterial({ color: 0x6ee7ff, transparent: true, opacity: 0.22, roughness: 0.1, metalness: 0, side: THREE.DoubleSide }));
}
