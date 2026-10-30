/** Original real-time environment layer. Instanced silhouettes and bounded
 * shader animation; no video, remote textures or allocations in update(). */
import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Track } from '../core/track';
import type { QualitySettings } from '../core/config';
import { makeRng } from '../core/math';

export class CinematicScenery {
  readonly group = new T.Group();
  private geometries: T.BufferGeometry[] = [];
  private materials: T.Material[] = [];
  private clock = { value: 0 };
  private moving: Array<{ object: T.Object3D; phase: number; y: number }> = [];
  private dummy = new T.Object3D();
  private traffic?: { mesh: T.InstancedMesh; x: number; y: number; z: number; radius: number };
  private billboards: T.MeshStandardMaterial[] = [];
  constructor(track: Track, q: QualitySettings, seed: number) {
    this.group.name = `cinematic-${track.layout.theme}`;
    const theme = track.layout.theme;
    const snow = ['alpes', 'alpine'].includes(theme);
    const desert = ['sahara', 'desert'].includes(theme);
    const tropical = ['tropical', 'jungle'].includes(theme);
    const ocean = ['ocean', 'coast', 'mediterranean'].includes(theme);
    const lava = theme === 'volcanic';
    const city = ['tokyo', 'neon'].includes(theme);
    const rng = makeRng(seed + 404);
    const detail = q.level === 'low' ? 1 : q.level === 'high' ? 2 : 3;
    const geo = <G extends T.BufferGeometry>(g: G): G => { this.geometries.push(g); return g; };
    const mat = (color: number, emissive = 0) => {
      const m = new T.MeshStandardMaterial({ color, roughness: .8, emissive, emissiveIntensity: emissive ? 1.5 : 0 });
      this.materials.push(m); return m;
    };
    const add = (g: T.BufferGeometry, m: T.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
      const mesh = new T.Mesh(g, m); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); this.group.add(mesh); return mesh;
    };
    const center = new T.Vector3();
    let minY = Infinity;
    for (const p of track.samples) { center.x += p.x; center.z += p.z; minY = Math.min(minY, p.y); }
    center.multiplyScalar(1 / track.count);
    let radius = 0;
    for (const p of track.samples) radius = Math.max(radius, Math.hypot(p.x - center.x, p.z - center.z));
    const vents: T.Vector3[] = [];
    const billboardMats = [mat(0x83f6ff, 0x118da6), mat(0xff8cd5, 0xa51767)];
    if (city) this.billboards = billboardMats;
    const buildingGeometry = geo(new T.BoxGeometry(1, 1, 1));
    const panelGeometry = geo(new T.PlaneGeometry(.82, .7));
    const stone = mat(lava ? 0x29222c : snow ? 0x657b92 : desert ? 0xb76c3b : 0x4c6461);
    const snowMat = mat(0xe6f7ff);
    const hill = geo(new T.ConeGeometry(1, 1, detail === 1 ? 7 : 12, 2));
    const mountainPositions = hill.getAttribute('position');
    for (let i = 0; i < mountainPositions.count; i++) {
      const x = mountainPositions.getX(i), y = mountainPositions.getY(i), z = mountainPositions.getZ(i), a = Math.atan2(z, x);
      const ridge = 1 + .2 * Math.sin(a * 5) + .12 * Math.sin(a * 9 + y * 3);
      mountainPositions.setXYZ(i, x * ridge, y + (1 - Math.abs(y * 2)) * .08 * Math.sin(a * 7), z * ridge);
    }
    hill.computeVertexNormals();
    const cap = geo(new T.ConeGeometry(1, 1, 10));
    const dune = geo(new T.SphereGeometry(1, 16, 8));
    // Horizon is beyond the bounding circle: these large forms cannot obstruct a road.
    for (let i = 0; i < (city ? 14 : 10) * detail; i++) {
      const angle = i * 2.399963, r = radius + 65 + rng() * 65;
      const x = center.x + Math.cos(angle) * r, z = center.z + Math.sin(angle) * r;
      const h = city ? 25 + rng() * 65 : desert ? 8 + rng() * 15 : 40 + rng() * 70;
      const w = desert ? 45 + rng() * 40 : city ? 8 + rng() * 8 : 25 + rng() * 30;
      if (desert) add(dune, stone, x, minY - 3, z, w, h, w * .6);
      else if (city) {
        const building = add(buildingGeometry, stone, x, minY + h / 2 - 4, z, w, h, w);
        const panels = add(panelGeometry, billboardMats[i % 2], x, minY + h * .62, z + w * .501, w, h, 1);
        panels.name = 'animated-billboard';
        building.rotation.y = 0;
      } else {
        add(hill, stone, x, minY + h / 2 - 5, z, w, h, w);
        if (snow) add(cap, snowMat, x, minY + h * .82 - 5, z, w * .36, h * .36, w * .36);
        if (lava) {
          const vent = add(geo(new T.TorusGeometry(w * .12, 1.2, 5, 18)), mat(0xff732c, 0xff3811), x, minY + h - 6, z);
          vent.rotation.x = Math.PI / 2;
          vents.push(vent.position.clone());
        }
      }
    }
    if (city) {
      const road = add(geo(new T.RingGeometry(radius + 35, radius + 52, 64)), mat(0x26313f), center.x, minY - 2, center.z);
      road.rotation.x = -Math.PI / 2;
      const chassis = new T.BoxGeometry(2.2, .7, 4.2), cabin = new T.BoxGeometry(1.8, .65, 2.1);
      cabin.translate(0, .6, -.2);
      const carGeometry = mergeGeometries([chassis, cabin])!; chassis.dispose(); cabin.dispose(); geo(carGeometry);
      const cars = new T.InstancedMesh(carGeometry, mat(0x66c3d4, 0x10252f), 5 * detail);
      this.traffic = { mesh: cars, x: center.x, y: minY - 1.3, z: center.z, radius: radius + 43 };
      cars.instanceMatrix.setUsage(T.DynamicDrawUsage); this.group.add(cars);
    }
    if (lava && vents.length) {
      const count = 40 * detail, positions = new Float32Array(count * 3), phases = new Float32Array(count);
      for (let i = 0; i < count; i++) { const p = vents[i % vents.length]; positions.set([p.x, p.y, p.z], i * 3); phases[i] = rng(); }
      const smokeGeometry = geo(new T.BufferGeometry()); smokeGeometry.setAttribute('position', new T.BufferAttribute(positions, 3)); smokeGeometry.setAttribute('aPhase', new T.BufferAttribute(phases, 1));
      const smokeMaterial = new T.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uTime: this.clock },
        vertexShader: 'uniform float uTime;attribute float aPhase;varying float vAge;void main(){float age=fract(aPhase+uTime*.06);vAge=age;vec3 p=position+vec3(age*14.+sin(aPhase*90.)*age*9.,age*38.,cos(aPhase*60.)*age*10.);vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp((4.+age*10.)*500./max(1.,-mv.z),1.,100.);}',
        fragmentShader: 'varying float vAge;void main(){float a=(1.-smoothstep(.05,.5,length(gl_PointCoord-.5)))*sin(vAge*3.14159)*.18;gl_FragColor=vec4(vec3(.24,.22,.25)+vAge*.12,a);}' });
      this.materials.push(smokeMaterial); const smoke = new T.Points(smokeGeometry, smokeMaterial); smoke.frustumCulled = false; this.group.add(smoke);
    }
    // Water uses PBR lighting and displaced vertices, independent of simulation.
    const flowing = (color: number, opacity: number, vertical: boolean) => {
      const m = new T.MeshStandardMaterial({ color, roughness: .23, metalness: .35, transparent: opacity < 1, opacity, side: T.DoubleSide });
      m.onBeforeCompile = shader => {
        shader.uniforms.uCinemaTime = this.clock;
        shader.vertexShader = 'uniform float uCinemaTime;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n transformed.${vertical ? 'z' : 'z'} += sin(position.x * .16 + uCinemaTime * 1.7) * .5 + cos(position.y * .13 - uCinemaTime * 2.) * .3;`);
        shader.fragmentShader = 'uniform float uCinemaTime;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= .85 + .15 * sin(vViewPosition.y * 3. + uCinemaTime * 5.);');
      };
      m.customProgramCacheKey = () => 'cinema-water-v1';
      this.materials.push(m); return m;
    };
    if (ocean || lava) {
      const water = add(geo(new T.PlaneGeometry(1500, 1500, 36 * detail, 36 * detail)), flowing(lava ? 0x17627b : 0x1cbdc8, 1, false), center.x, minY - 7, center.z);
      water.rotation.x = -Math.PI / 2;
    }
    if (tropical) {
      const waterfall = flowing(0x91eff2, .82, true);
      for (let i = 0; i < 3; i++) {
        const p = track.samples[Math.floor(track.count * (.18 + .25 * i))];
        const x = p.x + p.rx * 65, z = p.z + p.rz * 65;
        const contact = track.query(x, z, -1, false);
        if (Math.abs(contact.lateral) < contact.halfWidth + 20) continue;
        add(geo(new T.BoxGeometry(20, 42, 15)), stone, x, p.y + 12, z);
        const fall = add(geo(new T.PlaneGeometry(7, 35, 4, 20)), waterfall, x, p.y + 14, z + 7.6);
        fall.rotation.y = Math.atan2(center.x - x, center.z - z);
      }
    }
    // Bounded weather points around the player: one draw call, GPU wrapping.
    if (snow || desert || tropical || lava) {
      const count = 80 * detail;
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) { positions[i * 3] = rng() * 120 - 60; positions[i * 3 + 1] = rng() * 45; positions[i * 3 + 2] = rng() * 120 - 60; }
      const g = geo(new T.BufferGeometry()); g.setAttribute('position', new T.BufferAttribute(positions, 3));
      const m = new T.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uTime: this.clock, uColor: { value: new T.Color(snow ? 0xe4f7ff : desert ? 0xd8b27b : lava ? 0xff9a46 : 0xb8e3d0) }, uOrigin: { value: new T.Vector3() } },
        vertexShader: `uniform float uTime; uniform vec3 uOrigin; void main(){ vec3 p=position; p.x=mod(p.x+uTime*${desert ? '5.' : '1.'}+60.,120.)-60.; p.y=mod(p.y-uTime*${snow ? '2.5' : lava ? '-1.5' : '.5'},45.); vec4 mv=modelViewMatrix*vec4(p+uOrigin,1.); gl_Position=projectionMatrix*mv; gl_PointSize=clamp(${snow ? '85.' : '45.'}/max(1.,-mv.z),1.,5.); }`,
        fragmentShader: 'uniform vec3 uColor; void main(){float a=1.-smoothstep(.15,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(uColor,a*.45);}' });
      this.materials.push(m); const points = new T.Points(g, m); points.frustumCulled = false; this.group.add(points);
    }
    if (ocean || tropical) {
      const bird = geo(new T.BufferGeometry()); bird.setAttribute('position', new T.Float32BufferAttribute([-.8,0,0, 0,.15,0, 0,0,.3, 0,0,.3, 0,.15,0, .8,0,0], 3));
      // PBR needs a non-zero normal. Missing normals produced NaN HDR pixels;
      // bloom then spread those few bird pixels across most of the screen.
      bird.computeVertexNormals();
      const flock = new T.InstancedMesh(bird, mat(0xe8f6ec), 5 * detail);
      for (let i = 0; i < flock.count; i++) { this.dummy.position.set(center.x + i * 10 - 50, minY + 35 + i % 3 * 3, center.z + 40); this.dummy.scale.setScalar(1.8); this.dummy.updateMatrix(); flock.setMatrixAt(i, this.dummy.matrix); }
      this.moving.push({ object: flock, phase: 0, y: 0 }); this.group.add(flock);
    }
    // Static terrain forms share one draw per material, preserving animated objects.
    const batches = new Map<T.Material, T.BufferGeometry[]>();
    for (const child of [...this.group.children]) {
      if (!(child instanceof T.Mesh) || child instanceof T.InstancedMesh || this.moving.some(m => m.object === child)) continue;
      child.updateMatrix();
      const geometry = child.geometry.clone().applyMatrix4(child.matrix);
      const material = child.material as T.Material;
      const list = batches.get(material) ?? [];
      list.push(geometry); batches.set(material, list); this.group.remove(child);
    }
    for (const [material, parts] of batches) {
      const geometry = mergeGeometries(parts);
      if (geometry) { this.geometries.push(geometry); this.group.add(new T.Mesh(geometry, material)); }
      for (const part of parts) part.dispose();
    }
  }
  update(time: number, player: { x: number; y: number; z: number }, reduced: boolean) {
    this.clock.value = reduced ? 0 : time;
    for (let i = 0; i < this.billboards.length; i++) this.billboards[i].emissiveIntensity = reduced ? 1.5 : 1.1 + .7 * Math.sin(time * 1.5 + i * 2);
    if (this.traffic) {
      const t = this.traffic;
      for (let i = 0; i < t.mesh.count; i++) {
        const angle = i / t.mesh.count * Math.PI * 2 + (reduced ? 0 : time * .035);
        this.dummy.position.set(t.x + Math.cos(angle) * t.radius, t.y, t.z + Math.sin(angle) * t.radius);
        this.dummy.rotation.set(0, -angle, 0); this.dummy.scale.setScalar(1); this.dummy.updateMatrix(); t.mesh.setMatrixAt(i, this.dummy.matrix);
      }
      t.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const material of this.materials) if (material instanceof T.ShaderMaterial && material.uniforms.uOrigin) material.uniforms.uOrigin.value.set(player.x, player.y, player.z);
    for (const m of this.moving) { m.object.position.y = m.y + (reduced ? 0 : Math.sin(time * .6 + m.phase) * 1.5); if (m.object instanceof T.InstancedMesh) m.object.position.x = reduced ? 0 : Math.sin(time * .12) * 35; }
  }
  dispose() { for (const g of this.geometries) g.dispose(); for (const m of this.materials) m.dispose(); }
}
