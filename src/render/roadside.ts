import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Track } from '../core/track';
import { buildHazards, hazardSignPosition, type Hazard } from '../core/hazards';
import type { Circuit } from '../game/circuits';
import type { QualitySettings } from '../core/config';
import { makeRng } from '../core/math';
export function createRoadside(track: Track, circuit: Circuit, q: QualitySettings) {
  const group = new T.Group(),
    geos: T.BufferGeometry[] = [],
    mats: T.Material[] = [],
    hazards = buildHazards(track, circuit);
  const material = (color: number, metalness = 0, roughness = 0.7, emissive = 0) => {
    const m = new T.MeshStandardMaterial({
      color,
      metalness,
      roughness,
      emissive,
      emissiveIntensity: emissive ? 1.6 : 0,
      side: T.DoubleSide,
    });
    mats.push(m);
    return m;
  };
  const red = material(0xe74648),
    white = material(0xf2f0dc),
    black = material(0x17202e),
    steel = material(0xa7b2bd, 0.7, 0.36),
    concrete = material(0x767c85),
    rock = material(circuit.environment === 'alpine' ? 0xc1c7cd : 0xb2a080),
    orange = material(0xffad38),
    glow = material(0x8eeeff, 0.2, 0.3, 0x55cddd);
  const add = (
    g: T.BufferGeometry,
    m: T.Material,
    p: [number, number, number],
    parent: T.Object3D = group,
  ) => {
    geos.push(g);
    const mesh = new T.Mesh(g, m);
    mesh.position.set(...p);
    mesh.castShadow = q.shadows;
    mesh.receiveShadow = q.shadows;
    parent.add(mesh);
    return mesh;
  };
  const box = (
    w: number,
    h: number,
    d: number,
    m: T.Material,
    p: [number, number, number],
    parent: T.Object3D = group,
  ) => add(new T.BoxGeometry(w, h, d), m, p, parent);
  const line = (pts: T.Vector3[], radius: number, m: T.Material, parent: T.Object3D = group) =>
    add(
      new T.TubeGeometry(new T.CatmullRomCurve3(pts), Math.max(4, pts.length * 3), radius, 5, false),
      m,
      [0, 0, 0],
      parent,
    );
  function symbol(h: Hazard, sign: T.Group) {
    const stroke = (points: number[][]) =>
      line(
        points.map(([x, y]) => new T.Vector3(x, 3.7 + y, 0.12)),
        0.075,
        black,
        sign,
      );
    if (h.kind === 'left' || h.kind === 'right' || h.kind === 'bends') {
      const k = h.kind === 'left' ? -1 : 1;
      stroke([
        [0, -0.45],
        [0, 0],
        [k * 0.45, 0.22],
      ]);
      stroke([
        [k * 0.18, 0.37],
        [k * 0.45, 0.22],
        [k * 0.27, -0.01],
      ]);
      if (h.kind === 'bends')
        stroke([
          [0, -0.45],
          [-0.4, -0.25],
          [0, 0],
        ]);
    } else if (h.kind === 'descent') {
      stroke([
        [-0.52, 0.22],
        [0.52, -0.32],
      ]);
    } else if (h.kind === 'narrow') {
      stroke([
        [-0.48, -0.4],
        [-0.2, 0.35],
      ]);
      stroke([
        [0.48, -0.4],
        [0.2, 0.35],
      ]);
    } else if (h.kind === 'tunnel') {
      stroke([
        [-0.45, -0.4],
        [-0.45, 0.1],
        [0, 0.4],
        [0.45, 0.1],
        [0.45, -0.4],
      ]);
    } else if (h.kind === 'bridge') {
      stroke([
        [-0.5, -0.1],
        [0, 0.2],
        [0.5, -0.1],
      ]);
      stroke([
        [-0.3, -0.4],
        [-0.3, 0.03],
      ]);
      stroke([
        [0.3, -0.4],
        [0.3, 0.03],
      ]);
    } else if (h.kind === 'slippery') {
      stroke([
        [-0.3, -0.4],
        [-0.5, -0.2],
        [-0.2, 0],
        [0.2, 0.2],
      ]);
      stroke([
        [0.1, -0.4],
        [-0.1, -0.2],
        [0.2, 0],
        [0.5, 0.2],
      ]);
    } else if (h.kind === 'works') {
      stroke([
        [-0.4, -0.35],
        [0, 0.12],
        [0.45, -0.35],
      ]);
      add(new T.SphereGeometry(0.13, 6, 6), black, [0.08, 4.05, 0.12], sign);
    } else {
      for (const [x, y] of [
        [0, 0.18],
        [-0.3, -0.2],
        [0.3, -0.3],
      ])
        add(new T.IcosahedronGeometry(0.16, 0), black, [x, 3.7 + y, 0.12], sign);
    }
  }
  const triangle = (scale: number) => {
    const shape = new T.Shape();
    shape.moveTo(0, 1.2 * scale);
    shape.lineTo(-1.15 * scale, -0.8 * scale);
    shape.lineTo(1.15 * scale, -0.8 * scale);
    shape.closePath();
    return new T.ShapeGeometry(shape);
  };
  for (const h of hazards) {
    const pos = hazardSignPosition(track, h);
    if (!pos) continue;
    const sign = new T.Group();
    sign.name = `sign:${h.kind}`;
    sign.position.set(pos.x, pos.y, pos.z);
    sign.rotation.y = pos.heading;
    group.add(sign);
    box(0.11, 3.6, 0.11, steel, [0, 1.8, 0], sign);
    add(triangle(1), red, [0, 3.7, 0], sign);
    add(triangle(0.81), white, [0, 3.7, 0.04], sign);
    symbol(h, sign);
  }
  // Continuous guardrails and road markings follow the exact sampled road edge.
  const railParts: T.BufferGeometry[] = [];
  for (let s = 0; s < track.length; s += 8) {
    const p = track.sampleAtDistance(s);
    for (const side of [-1, 1]) {
      const x = p.x + p.rx * (p.halfWidth + 2.5) * side,
        z = p.z + p.rz * (p.halfWidth + 2.5) * side;
      const g = new T.BoxGeometry(0.12, 0.38, 8.2);
      g.rotateY(Math.atan2(p.tx, p.tz));
      g.translate(x, p.y + 0.92, z);
      railParts.push(g);
      geos.push(g);
    }
    const stripe = box(0.16, 0.015, 3, white, [p.x, p.y + 0.06, p.z]);
    stripe.rotation.y = Math.atan2(p.tx, p.tz);
  }
  const rails = mergeGeometries(railParts);
  if (rails) add(rails, steel, [0, 0, 0]);
  for (const feature of circuit.features ?? []) {
    for (
      let s = feature.start * track.length;
      s < feature.end * track.length;
      s += feature.kind === 'tunnel' ? 4 : 10
    ) {
      const p = track.sampleAtDistance(s),
        section = new T.Group();
      section.position.set(p.x, p.y, p.z);
      section.rotation.y = Math.atan2(p.tx, p.tz);
      group.add(section);
      if (feature.kind === 'tunnel') {
        // Clear width is larger than the road; vault clearance is >= 6 m.
        const span = p.halfWidth + 4;
        for (const side of [-1, 1]) box(0.65, 5.7, 4.25, concrete, [side * span, 2.85, 0], section);
        const arch: T.Vector3[] = [];
        for (let i = 0; i <= 10; i++) {
          const a = (i / 10) * Math.PI;
          arch.push(new T.Vector3(Math.cos(a) * span, 5.6 + Math.sin(a) * 3, 0));
        }
        const vault = line(arch, 0.55, concrete, section);
        vault.scale.z = 4;
        box(span * 2 + 0.6, 0.6, 4.3, concrete, [0, 8.5, 0], section);
        for (const side of [-1, 1]) box(0.22, 0.12, 2.2, glow, [side * (span - 0.4), 4.9, 0], section);
      } else if (feature.kind === 'bridge') {
        box(p.halfWidth * 2 + 3, 0.65, 10.2, concrete, [0, -0.6, 0], section);
        for (const side of [-1, 1]) box(1.3, 9, 1.3, concrete, [side * (p.halfWidth + 1), -5, 0], section);
      } else if (feature.kind === 'works') {
        for (const side of [-1, 1])
          for (let j = 0; j < 3; j++)
            add(
              new T.ConeGeometry(0.25, 0.8, 6),
              orange,
              [side * (p.halfWidth + 1.6), 0.4, j * 2 - 2],
              section,
            );
      } else {
        for (const side of [-1, 1]) {
          const b = add(
            new T.DodecahedronGeometry(1.2, 0),
            rock,
            [side * (p.halfWidth + 5), 0.2, 0],
            section,
          );
          b.scale.set(1.4, 1.6, 1.2);
        }
      }
    }
  }
  const sand = material(0xd8b27b),
    forest = material(0x286742);
  const mountainMaterial = new T.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    flatShading: true,
  });
  mats.push(mountainMaterial);
  const rng = makeRng(circuit.seed + 909);
  // Skyline, high snowy ridges, desert dunes, tropical canopy and limestone cliffs.
  const environment = circuit.environment;
  for (let i = 0; i < (q.level === 'low' ? 20 : 48); i++) {
    const p = track.sampleAtDistance((i / 48) * track.length),
      side = i % 2 ? 1 : -1,
      dist = p.halfWidth + 22 + rng() * 65;
    const x = p.x + p.rx * dist * side,
      z = p.z + p.rz * dist * side;
    const clearance = environment === 'alpine' ? 42 : environment === 'dunes' ? 28 : 14;
    if (track.samples.some((s) => Math.hypot(s.x - x, s.z - z) < s.halfWidth + clearance)) continue;
    if (environment === 'alpine') {
      const g = new T.IcosahedronGeometry(1, q.level === 'low' ? 1 : 2),
        position = g.getAttribute('position');
      const colors: number[] = [];
      for (let v = 0; v < position.count; v++) {
        const px = position.getX(v),
          py = position.getY(v),
          pz = position.getZ(v);
        const ridge = 1 + 0.14 * Math.sin(px * 15 + pz * 9) + 0.08 * Math.cos(pz * 23);
        position.setXYZ(v, px * 32 * ridge, Math.max(-0.3, py) * 45 * ridge, pz * 29 * ridge);
        const color = new T.Color(py > 0.48 ? 0xe6edf0 : py > 0.1 ? 0x869098 : 0x5f7370);
        colors.push(color.r, color.g, color.b);
      }
      g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
      g.computeVertexNormals();
      add(g, mountainMaterial, [x, p.y + 8, z]);
    } else if (environment === 'dunes') {
      const dune = add(new T.SphereGeometry(15, 12, 8), sand, [x, p.y - 3, z]);
      dune.scale.set(1.7, 0.48, 1);
    } else if (environment === 'mediterranean') {
      const cliff = add(new T.DodecahedronGeometry(12, 0), rock, [x, p.y - 9, z]);
      cliff.scale.set(1, 1.6, 1.4);
    } else if (environment === 'jungle') {
      const tree = new T.Group();
      tree.position.set(x, p.y, z);
      group.add(tree);
      box(0.7, 12, 0.7, black, [0, 5, 0], tree);
      const canopy = add(new T.SphereGeometry(5, 8, 6), forest, [0, 12, 0], tree);
      canopy.scale.y = 0.5;
    } else if (environment === 'city') {
      const h = 15 + rng() * 40;
      box(8, h, 9, black, [x, p.y + h / 2 - 2, z]);
      for (let j = 1; j < h / 3; j++) box(8.1, 0.28, 9.1, glow, [x, p.y + j * 3, z]);
    }
  }

  // Batch all static scenery per material after transforms; bounded draw calls.
  group.updateMatrixWorld(true);
  const batches = new Map<T.Material, T.BufferGeometry[]>();
  group.traverse((o) => {
    if (o instanceof T.Mesh) {
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      geos.push(g);
      const m = o.material as T.Material;
      const a = batches.get(m) ?? [];
      a.push(g);
      batches.set(m, a);
    }
  });
  group.clear();
  for (const [m, parts] of batches) {
    const normalized = parts.map((p) => {
      const g = p.index ? p.toNonIndexed() : p;
      geos.push(g);
      return g;
    });
    const g = mergeGeometries(normalized);
    if (!g) throw new Error('Roadside geometry batching failed');
    add(g, m, [0, 0, 0]);
  }
  // Decorative traffic is instanced, moves on a parallel lane behind the rails,
  // and disappears in segments that would overlap any playable road ribbon.
  let traffic: T.InstancedMesh | undefined;
  const trafficMatrix = new T.Object3D();
  const trafficClear = track.samples.map((p) =>
    track.samples.every(
      (other) =>
        Math.hypot(other.x - (p.x + p.rx * (p.halfWidth + 7)), other.z - (p.z + p.rz * (p.halfWidth + 7))) >
        other.halfWidth + 3.2,
    ),
  );
  if (environment === 'city') {
    const parts: T.BufferGeometry[] = [];
    const part = (geometry: T.BufferGeometry, color: number, x: number, y: number, z: number) => {
      geometry.translate(x, y, z);
      const g = geometry.index ? geometry.toNonIndexed() : geometry;
      const c = new T.Color(color),
        colors: number[] = [];
      for (let i = 0; i < g.getAttribute('position').count; i++) colors.push(c.r, c.g, c.b);
      g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
      geos.push(geometry, g);
      parts.push(g);
    };
    part(new T.BoxGeometry(1.65, 0.6, 3.5), 0x567387, 0, 0.65, 0);
    part(new T.BoxGeometry(1.35, 0.5, 1.7), 0x19293b, 0, 1.18, -0.2);
    for (const x of [-0.85, 0.85])
      for (const z of [-1.1, 1.1]) {
        const wheel = new T.CylinderGeometry(0.32, 0.32, 0.16, 8);
        wheel.rotateZ(Math.PI / 2);
        part(wheel, 0x14151b, x, 0.32, z);
      }
    for (const x of [-0.5, 0.5]) part(new T.BoxGeometry(0.3, 0.12, 0.08), 0xb9efff, x, 0.8, 1.79);
    const geometry = mergeGeometries(parts);
    if (!geometry) throw new Error('Traffic geometry batching failed');
    geos.push(geometry);
    const material = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.3 });
    mats.push(material);
    traffic = new T.InstancedMesh(geometry, material, q.level === 'low' ? 4 : 8);
    traffic.castShadow = q.shadows;
    traffic.frustumCulled = false;
    group.add(traffic);
  }
  let trafficTime = 0;
  let rain: T.Points | undefined;
  let rainArray: Float32Array | undefined;
  if (circuit.rain) {
    const count = q.level === 'low' ? 100 : 400;
    rainArray = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      rainArray[i * 3] = rng() * 90 - 45;
      rainArray[i * 3 + 1] = rng() * 25;
      rainArray[i * 3 + 2] = rng() * 90 - 45;
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(rainArray, 3));
    geos.push(g);
    const m = new T.PointsMaterial({ color: 0xc6e1ec, size: 0.12, transparent: true, opacity: 0.65 });
    mats.push(m);
    rain = new T.Points(g, m);
    rain.frustumCulled = false;
    group.add(rain);
  }
  return {
    group,
    hazards,
    update(dt: number, x: number, y: number, z: number) {
      if (traffic) {
        trafficTime += dt;
        for (let i = 0; i < traffic.count; i++) {
          const index = Math.floor(
            ((i / traffic.count + (trafficTime * 12) / track.length) % 1) * track.count,
          );
          const p = track.samples[index];
          trafficMatrix.position.set(p.x + p.rx * (p.halfWidth + 7), p.y, p.z + p.rz * (p.halfWidth + 7));
          trafficMatrix.rotation.set(0, Math.atan2(p.tx, p.tz), 0);
          trafficMatrix.scale.setScalar(trafficClear[index] ? 1 : 0);
          trafficMatrix.updateMatrix();
          traffic.setMatrixAt(i, trafficMatrix.matrix);
        }
        traffic.instanceMatrix.needsUpdate = true;
      }

      if (rain && rainArray) {
        rain.position.set(x, y, z);
        for (let i = 1; i < rainArray.length; i += 3) {
          rainArray[i] -= dt * 18;
          if (rainArray[i] < 0) rainArray[i] += 25;
        }
        (rain.geometry.getAttribute('position') as T.BufferAttribute).needsUpdate = true;
      }
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
