/** Original procedural vehicle meshes; no external model or texture assets. */
import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { KartProfile } from '../game/roster';
import { vehicleFor } from '../game/vehicles';
import type { QualitySettings } from '../core/config';
import type { KartModel } from './models';

type Point = [number, number, number];
export function createVehicle(profile: KartProfile, q: QualitySettings): KartModel {
  const v = vehicleFor(profile)!;
  const bike = v.kind !== 'kart',
    cross = v.kind === 'cross',
    touring = v.kind === 'touring';
  const seg = q.level === 'low' ? 10 : q.level === 'ultra' ? 28 : 18;
  const root = new T.Group(),
    body = new T.Group(),
    lod = new T.Group();
  root.add(body, lod);
  lod.visible = false;
  root.name = v.name;
  root.userData.vehicleId = v.id;
  root.userData.kind = v.kind;
  const geos = new Set<T.BufferGeometry>(),
    mats: T.Material[] = [];
  const mat = (color: number, metalness = 0, roughness = 0.5, emissive = 0) => {
    const m = new T.MeshStandardMaterial({
      color,
      metalness,
      roughness,
      emissive,
      emissiveIntensity: emissive ? 1.8 : 0,
    });
    mats.push(m);
    return m;
  };
  const paint = mat(v.color, 0.4, 0.24),
    accent = mat(v.accent, 0.25, 0.3),
    alloy = mat(0xbfc8d2, 0.85, 0.28),
    dark = mat(0x202735, 0.5, 0.45),
    rubber = mat(0x13151b, 0, 0.86),
    seat = mat(0x22232c, 0, 0.77),
    suit = mat(profile.suitColor, 0.05, 0.7),
    helmet = mat(profile.riderColor ?? profile.suitColor, 0.3, 0.25),
    trim = mat(profile.riderAccent ?? profile.visorColor, 0.15, 0.32),
    visor = mat(profile.visorColor, 0.75, 0.12),
    lamp = mat(0xbdefff, 0.1, 0.2, 0x86cfff),
    tail = mat(0xee2748, 0.1, 0.25, 0xcc1637);
  const mesh = (g: T.BufferGeometry, m: T.Material, pos: Point, parent: T.Object3D = body) => {
    geos.add(g);
    const o = new T.Mesh(g, m);
    o.position.set(...pos);
    o.castShadow = q.shadows;
    o.receiveShadow = q.shadows;
    parent.add(o);
    return o;
  };
  const box = (w: number, h: number, d: number, m: T.Material, p: Point, parent: T.Object3D = body) =>
    mesh(new T.BoxGeometry(w, h, d), m, p, parent);
  const tube = (a: Point, b: Point, r: number, m: T.Material, parent: T.Object3D = body) => {
    const av = new T.Vector3(...a),
      bv = new T.Vector3(...b),
      delta = bv.clone().sub(av);
    const o = mesh(
      new T.CylinderGeometry(r, r, delta.length(), q.level === 'low' ? 6 : 10),
      m,
      av.add(bv).multiplyScalar(0.5).toArray() as Point,
      parent,
    );
    o.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize());
    return o;
  };
  const ellipsoid = (r: number, scale: Point, m: T.Material, p: Point, parent: T.Object3D = body) => {
    const o = mesh(new T.SphereGeometry(r, seg, 10), m, p, parent);
    o.scale.set(...scale);
    return o;
  };
  // Lofted continuous fairings: width, height and cross-section change along z.
  const shell = (rings: Array<[number, number, number, number]>, m: T.Material) => {
    const vertices: number[] = [],
      indices: number[] = [];
    const n = seg;
    for (const [z, y, w, h] of rings)
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        vertices.push(Math.cos(a) * w, y + Math.sin(a) * h, z);
      }
    for (let k = 0; k < rings.length - 1; k++)
      for (let i = 0; i < n; i++) {
        const a = k * n + i,
          b = k * n + ((i + 1) % n),
          c = a + n,
          d = b + n;
        indices.push(a, b, c, b, d, c);
      }
    // Cap both ends; ends use small rings to retain smooth silhouettes.
    for (let i = 1; i < n - 1; i++) {
      indices.push(0, i + 1, i);
      const o = (rings.length - 1) * n;
      indices.push(o, o + i, o + i + 1);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array((vertices.length / 3) * 2), 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    return mesh(g, m, [0, 0, 0]);
  };
  const wheelRadius = cross ? 0.48 : bike ? 0.43 : 0.34;
  const wheelZ = bike ? 1.03 : 0.84;
  const wheels: T.Object3D[] = [],
    frontWheels: T.Object3D[] = [];
  const wheel = (x: number, z: number, front: boolean) => {
    const steering = new T.Group();
    steering.position.set(x, wheelRadius, z);
    body.add(steering);
    if (front) frontWheels.push(steering);
    const spin = new T.Group();
    steering.add(spin);
    wheels.push(spin);
    const width = bike ? (front ? 0.17 : 0.24) : 0.34;
    const tire = mesh(new T.TorusGeometry(wheelRadius - 0.09, 0.095, 8, seg), rubber, [0, 0, 0], spin);
    tire.rotation.y = Math.PI / 2;
    tire.scale.z = width / 0.19;
    const rim = mesh(new T.TorusGeometry(wheelRadius - 0.13, 0.027, 5, seg), alloy, [0, 0, 0], spin);
    rim.rotation.y = Math.PI / 2;
    const disc = mesh(
      new T.CylinderGeometry(wheelRadius * 0.5, wheelRadius * 0.5, 0.025, seg),
      alloy,
      [width * 0.55, 0, 0],
      spin,
    );
    disc.rotation.z = Math.PI / 2;
    box(0.055, 0.17, 0.1, accent, [width * 0.64, 0.1, 0.09], steering);
    for (let i = 0; i < (q.level === 'low' ? 5 : 9); i++) {
      const a = (i / (q.level === 'low' ? 5 : 9)) * Math.PI * 2;
      tube(
        [0, 0, 0],
        [0, Math.sin(a) * (wheelRadius - 0.13), Math.cos(a) * (wheelRadius - 0.13)],
        0.018,
        alloy,
        spin,
      );
    }
    // Raised paired tread blocks, visible on every tire (not a color swap).
    if (!cross && q.level !== 'low')
      for (let i = 0; i < (q.level === 'ultra' ? 32 : 20); i++) {
        const a = i * Math.PI * 2 / (q.level === 'ultra' ? 32 : 20);
        for (const side of [-1, 1]) {
          const tread = box(width * 0.42, 0.012, 0.035, rubber,
            [side * width * 0.24, Math.cos(a) * (wheelRadius + 0.004), Math.sin(a) * (wheelRadius + 0.004)], spin);
          tread.rotation.x = a;
        }
      }
    if (cross)
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const tread = box(
          width,
          0.065,
          0.12,
          rubber,
          [0, Math.cos(a) * wheelRadius, Math.sin(a) * wheelRadius],
          spin,
        );
        tread.rotation.x = a;
      }
  };
  if (bike) {
    wheel(0, wheelZ, true);
    wheel(0, -wheelZ, false);
  } else
    for (const x of [-0.88, 0.88]) {
      wheel(x, wheelZ, true);
      wheel(x, -wheelZ, false);
    }
  const seatY = bike ? (cross ? 1.22 : 0.99) : 0.55;
  if (bike) {
    // Twin-spar frame, swingarm, fork stanchions, rear shock and finned engine.
    for (const side of [-1, 1]) {
      tube([side * 0.18, 0.64, -0.76], [side * 0.2, 1.1, 0.56], 0.055, alloy);
      tube([side * 0.2, 1.1, 0.56], [side * 0.21, 0.68, 0.03], 0.045, dark);
      tube([side * 0.14, 0.65, -0.15], [side * 0.12, wheelRadius, -1.03], 0.065, alloy);
      tube([side * 0.13, 1.29, 0.7], [side * 0.13, wheelRadius, 1.03], 0.035, alloy);
      tube([side * 0.13, 0.85, 0.9], [side * 0.13, wheelRadius, 1.03], 0.06, dark);
      tube([side * 0.13, 1.28, 0.72], [side * 0.38, 1.32, 0.65], 0.027, alloy);
      tube([side * 0.37, 1.32, 0.65], [side * 0.47, 1.32, 0.59], 0.04, rubber);
      ellipsoid(0.12, [0.4, 0.7, 1.3], alloy, [side * 0.57, 1.48, 0.57]);
      tube([side * 0.3, 0.52, -0.3], [side * 0.32, 0.65, -0.93], 0.09, dark);
      tube([side * 0.32, 0.65, -0.93], [side * 0.32, 0.69, -1.13], 0.075, alloy);
    }
    for (let i = 0; i < 6; i++) box(0.48, 0.025, 0.44, dark, [0, 0.55 + i * 0.045, -0.08]);
    ellipsoid(0.23, [1.05, 1, 1.3], alloy, [0, 0.55, -0.12]);
    for (let i = 0; i < 8; i++)
      tube([-0.23, 0.57, -0.55 - i * 0.045], [-0.23, 0.46, -0.74 - i * 0.025], 0.012, alloy);
    // Sculpted fuel tank, aerodynamic nose, tail and fenders.
    shell(
      [
        [-0.22, 1.05, 0.17, 0.09],
        [0.02, 1.16, 0.28, 0.2],
        [0.34, 1.19, 0.24, 0.19],
        [0.56, 1.12, 0.12, 0.08],
      ],
      paint,
    );
    shell(
      [
        [-1.12, 1.03, 0.04, 0.03],
        [-0.82, 1.11, 0.22, 0.09],
        [-0.48, 1.06, 0.23, 0.08],
        [-0.22, 1.02, 0.17, 0.04],
      ],
      paint,
    );
    ellipsoid(0.3, [0.67, 0.23, 1.15], seat, [0, seatY, -0.43]);
    if (!cross) {
      shell(
        [
          [0.3, 0.83, 0.17, 0.29],
          [0.55, 0.99, 0.37, 0.36],
          [0.89, 1.15, 0.31, 0.25],
          [1.07, 1.19, 0.11, 0.09],
        ],
        paint,
      );
      const screen = ellipsoid(0.32, [0.83, touring ? 1.55 : 0.68, 0.44], visor, [
        0,
        touring ? 1.57 : 1.38,
        0.67,
      ]);
      screen.rotation.x = -0.35;
      for (const side of [-1, 1]) {
        box(0.12, 0.035, 0.29, lamp, [side * 0.18, 1.23, 0.97]);
        box(0.04, 0.2, 0.32, dark, [side * 0.34, 0.84, 0.48]);
      }
    } else {
      shell(
        [
          [0.5, 0.98, 0.15, 0.05],
          [0.82, 1.07, 0.18, 0.06],
          [1.25, 1.04, 0.11, 0.03],
        ],
        paint,
      );
      box(0.25, 0.29, 0.07, accent, [0, 1.26, 0.83]);
    }
    if (touring)
      for (const side of [-1, 1]) {
        box(0.35, 0.42, 0.66, dark, [side * 0.42, 0.87, -0.75]);
        box(0.37, 0.08, 0.68, paint, [side * 0.42, 1.1, -0.75]);
      }
    box(0.22, 0.04, 0.05, tail, [0, 1.09, -1.12]);
    const shock = tube([0, 0.65, -0.55], [0, 1.05, -0.27], 0.055, accent);
    shock.name = 'rear-suspension';
  } else {
    // Separate original bodywork and frames for sprint/formula/rally/club karts.
    const formula = v.shape === 'formula',
      rally = v.id === 'nomad',
      sprint = v.id === 'pulse';
    for (const side of [-1, 1]) {
      tube([side * 0.55, 0.26, -1], [side * 0.55, 0.26, 1.05], 0.055, dark);
      tube([side * 0.55, 0.26, 0.65], [side * 0.88, 0.34, 0.84], 0.035, alloy);
      tube([side * 0.52, 0.32, -0.45], [side * 0.88, 0.34, -0.84], 0.045, alloy);
      tube([side * 0.58, 0.3, -0.82], [side * 0.82, 0.62, -0.74], 0.04, accent);
      const pod = shell(
        [
          [-0.6, 0.42, 0.15, 0.14],
          [0.05, 0.4, 0.24, 0.16],
          [0.55, 0.37, 0.12, 0.12],
        ],
        paint,
      );
      pod.position.x = side * 0.53;
      tube([side * 0.75, 0.33, 0.92], [side * 0.75, 0.34, 1.19], 0.06, alloy);
      box(0.13, 0.065, 0.08, lamp, [side * 0.43, 0.44, 1.04]);
    }
    shell(
      [
        [-0.36, 0.32, 0.46, 0.1],
        [0.5, 0.32, formula ? 0.22 : 0.4, 0.11],
        [1.13, 0.3, formula ? 0.12 : 0.32, 0.08],
      ],
      paint,
    );
    tube([-0.75, 0.34, 1.19], [0.75, 0.34, 1.19], 0.055, alloy);
    box(0.5, 0.13, 0.68, seat, [0, 0.49, -0.28]);
    const back = box(0.49, 0.56, 0.1, seat, [0, 0.71, -0.58]);
    back.rotation.x = -0.16;
    box(0.38, 0.33, 0.43, dark, [0.5, 0.5, -0.65]);
    for (let i = 0; i < 6; i++) box(0.41, 0.018, 0.33, alloy, [0.5, 0.42 + i * 0.045, -0.65]);
    tube([0.56, 0.4, -0.7], [0.75, 0.55, -1.05], 0.08, dark);
    if (formula || !sprint) {
      box(formula ? 1.63 : 1.15, 0.06, 0.29, accent, [0, 0.98, -1.02]);
      for (const x of [-0.45, 0.45]) box(0.04, 0.4, 0.06, dark, [x, 0.78, -1.02]);
    }
    if (formula) box(1.5, 0.05, 0.27, accent, [0, 0.32, 1.18]);
    if (rally)
      for (const side of [-1, 1]) {
        tube([side * 0.48, 0.35, -0.8], [side * 0.45, 1.55, -0.65], 0.04, alloy);
        tube([side * 0.45, 1.55, -0.65], [side * 0.45, 0.36, 0.65], 0.04, alloy);
      }
    if (rally) tube([-0.45, 1.55, -0.65], [0.45, 1.55, -0.65], 0.04, alloy);
    tube([0, 0.37, 0.38], [0, 0.88, 0.28], 0.035, alloy);
    const steering = mesh(new T.TorusGeometry(0.18, 0.027, 6, seg), rubber, [0, 0.87, 0.27]);
    steering.rotation.x = -0.65;
  }
  // V4 mechanical package: all parts are batched with the existing body/wheel
  // materials below. Detail tiers change geometry, not only lighting.
  const detail = q.level === 'low' ? 0 : q.level === 'ultra' ? 2 : 1;
  const coil = (a: Point, b: Point, radius: number) => {
    const start = new T.Vector3(...a), end = new T.Vector3(...b);
    const axis = end.clone().sub(start).normalize();
    const u = new T.Vector3(1, 0, 0).cross(axis).normalize();
    const w = axis.clone().cross(u);
    const points: T.Vector3[] = [];
    const count = detail === 2 ? 64 : 32;
    for (let i = 0; i <= count; i++) {
      const t = i / count, angle = t * Math.PI * 12;
      points.push(start.clone().lerp(end, t).addScaledVector(u, Math.cos(angle) * radius).addScaledVector(w, Math.sin(angle) * radius));
    }
    mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points), count, 0.012, 4, false), accent, [0, 0, 0]);
  };
  if (detail) {
    if (bike) {
      coil([0, 0.64, -0.56], [0, 1.07, -0.28], 0.085);
      // Radiator matrix, foot pegs and drilled rear sprocket/chain run.
      box(0.43, 0.35, 0.06, dark, [0, 0.8, 0.41]);
      for (let i = 0; i < 9; i++) box(0.39, 0.012, 0.025, alloy, [0, 0.65 + i * 0.035, 0.455]);
      for (const side of [-1, 1]) {
        tube([side * 0.2, 0.55, -0.25], [side * 0.43, 0.55, -0.25], 0.035, alloy);
        const panel = shell([[0.06, 0.86, 0.025, 0.2], [0.4, 0.93, 0.035, 0.24], [0.72, 1.06, 0.015, 0.1]], accent);
        panel.position.x = side * 0.32;
        // Aerodynamic winglets on sport bikes; bark guards on cross models.
        box(cross ? 0.23 : 0.3, 0.035, cross ? 0.09 : 0.18, paint,
          [side * (cross ? 0.43 : 0.4), cross ? 1.33 : 1.02, cross ? 0.64 : 0.66]);
        for (let i = 0; i < 4; i++) box(0.035, 0.025, 0.15, dark, [side * 0.365, 0.82 + i * 0.05, 0.38]);
      }
      tube([-0.16, 0.54, -0.21], [-0.16, wheelRadius + 0.15, -1.02], 0.014, dark);
      tube([-0.16, 0.48, -0.21], [-0.16, wheelRadius - 0.15, -1.02], 0.014, dark);
      const cap = mesh(new T.CylinderGeometry(0.065, 0.065, 0.016, seg), alloy, [0, 1.36, 0.22]);
      cap.rotation.x = 0.1;
    } else {
      // Front double wishbones, coil-over shocks and sculpted wheel arches.
      for (const side of [-1, 1]) {
        coil([side * 0.52, 0.55, 0.6], [side * 0.82, 0.36, 0.84], 0.055);
        for (const y of [0.25, 0.43]) {
          tube([side * 0.4, y, 0.52], [side * 0.83, y, 0.84], 0.023, alloy);
          tube([side * 0.4, y, 1.02], [side * 0.83, y, 0.84], 0.023, alloy);
        }
        const arch = mesh(new T.TorusGeometry(0.4, 0.065, 6, seg, Math.PI), paint, [side * 0.88, 0.34, -0.84]);
        arch.rotation.y = Math.PI / 2;
        // Bucket seat bolsters, air intake slats and rear diffuser vanes.
        ellipsoid(0.18, [0.5, 1.5, 1.8], seat, [side * 0.25, 0.62, -0.35]);
        for (let i = 0; i < 5; i++) box(0.12, 0.018, 0.025, dark, [side * 0.55, 0.55, -0.25 + i * 0.08]);
        box(0.035, 0.13, 0.35, dark, [side * 0.32, 0.23, -1.02]);
        box(0.04, 0.18, 0.34, paint, [side * 0.78, 0.39, 1.12]);
      }
      tube([-0.55, 0.3, -0.84], [0.88, 0.3, -0.84], 0.04, alloy);
      // Curved exhaust headers and rolled outlet lip.
      tube([0.53, 0.56, -0.62], [0.73, 0.62, -0.8], 0.06, alloy);
      const lip = mesh(new T.TorusGeometry(0.08, 0.018, 6, seg), alloy, [0.75, 0.55, -1.05]);
      lip.rotation.x = -0.4;
      box(0.54, 0.12, 0.025, tail, [0, 0.39, -1.08]);
    }
  }
  root.userData.detailTier = detail;
  root.userData.wheelRadius = wheelRadius;
  // Fully helmeted rider: articulated torso/head, bent arms and legs, boots,
  // gloves, shoulder protectors and individual helmet stripe/visor colors.
  const torso = new T.Group(),
    head = new T.Group();
  body.add(torso, head);
  const hip: Point = [0, seatY + 0.13, -0.42];
  const shoulder: Point = [0, bike ? 1.62 : 1.07, bike ? (cross || touring ? -0.17 : 0.05) : -0.27];
  tube(hip, shoulder, 0.19, suit, torso);
  head.position.set(shoulder[0], shoulder[1] + 0.24, shoulder[2] + (bike ? 0.07 : 0));
  ellipsoid(0.245, [0.92, 1.05, 1.04], helmet, [0, 0, 0], head);
  const glass = mesh(new T.SphereGeometry(0.252, seg, 10, -0.85, 1.7, 0.9, 1.0), visor, [0, 0, 0], head);
  glass.rotation.y = -Math.PI / 2;
  ellipsoid(0.247, [0.13, 1.07, 1.06], trim, [0, 0, 0], head);
  for (const side of [-1, 1]) {
    const sh: Point = [side * 0.2, shoulder[1] - 0.03, shoulder[2]],
      el: Point = [side * 0.34, shoulder[1] - 0.28, shoulder[2] + 0.1],
      hand: Point = [side * (bike ? 0.39 : 0.15), bike ? 1.32 : 0.88, bike ? 0.62 : 0.26];
    tube(sh, el, 0.075, suit);
    tube(el, hand, 0.065, suit);
    ellipsoid(0.085, [1, 0.8, 1.1], rubber, hand);
    ellipsoid(0.105, [1, 0.65, 1], trim, sh);
    const knee: Point = [side * (bike ? 0.27 : 0.22), bike ? 0.85 : 0.48, bike ? 0.04 : 0.27],
      foot: Point = [side * (bike ? 0.32 : 0.24), bike ? 0.53 : 0.34, bike ? -0.28 : 0.7];
    tube([side * 0.12, hip[1], hip[2]], knee, 0.1, suit);
    tube(knee, foot, 0.08, suit);
    ellipsoid(0.11, [0.8, 0.8, 1.7], rubber, foot);
    ellipsoid(0.105, [1, 0.75, 0.6], trim, knee);
  }
  const exhaust = new T.Group();
  exhaust.position.set(0, 0.5, -1.15);
  body.add(exhaust);
  const boostMat = new T.MeshBasicMaterial({ color: 0x40c8ff, transparent: true, opacity: 0 });
  mats.push(boostMat);
  const boostLight = mesh(new T.ConeGeometry(0.15, 0.65, 8), boostMat, [0, 0, -0.2], exhaust);
  boostLight.rotation.x = -Math.PI / 2;
  // Batch static parts per material. Wheels, head and torso keep independent pivots.
  function batch(group: T.Group) {
    const byMat = new Map<T.Material, T.BufferGeometry[]>();
    for (const child of [...group.children])
      if (child instanceof T.Mesh) {
        child.updateMatrix();
        const g = child.geometry.clone().applyMatrix4(child.matrix);
        geos.add(g);
        const list = byMat.get(child.material as T.Material) ?? [];
        list.push(g);
        byMat.set(child.material as T.Material, list);
        group.remove(child);
      }
    for (const [material, parts] of byMat) {
      const g = mergeGeometries(parts);
      if (!g) throw new Error('Vehicle geometry batching failed');
      mesh(g, material, [0, 0, 0], group);
    }
  }
  batch(body);
  batch(head);
  batch(torso);
  for (const w of wheels) batch(w as T.Group);
  // Recognizable low-detail silhouette with the correct number of wheels.
  const hull = box(bike ? 0.4 : 1.35, 0.4, bike ? 1.4 : 1.8, paint, [0, bike ? 0.83 : 0.43, -0.1], lod);
  hull.name = 'lod-hull';
  ellipsoid(0.25, [1, 1, 1], helmet, [0, bike ? 1.78 : 1.3, -0.2], lod);
  for (const x of bike ? [0] : [-0.88, 0.88])
    for (const z of [-wheelZ, wheelZ]) {
      const w = mesh(
        new T.CylinderGeometry(wheelRadius, wheelRadius, bike ? 0.2 : 0.32, 8),
        rubber,
        [x, wheelRadius, z],
        lod,
      );
      w.rotation.z = Math.PI / 2;
    }
  return {
    root,
    body,
    lod,
    wheels,
    frontWheels,
    exhaust,
    boostLight,
    driver: { head, body: torso },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
