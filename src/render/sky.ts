/**
 * Turbo Karts Arena — skybox HDR procédurale par circuit.
 *
 * Un dôme (sphere inversée) en ShaderMaterial : dégradé de ciel, halo solaire,
 * bande d'horizon, nuages FBM et étoiles la nuit. Le rendu est fait en HDR
 * (luminances > 1 dans le ciel) pour que le bloom réagisse au soleil.
 */

import * as THREE from 'three';
import type { CircuitTheme } from '../game/circuits';

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mvp = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = mvp.xyww; // profondeur maximale : le ciel est toujours derrière
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSun;
  uniform vec3 uSunDir;
  uniform vec3 uGround;
  uniform float uSunPower;
  uniform float uStars;
  uniform float uClouds;
  uniform float uTime;
  uniform float uHorizonSharp;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0; float a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    float up = clamp(d.y, -1.0, 1.0);
    // dégradé vertical
    float t = pow(clamp(up * 0.5 + 0.5, 0.0, 1.0), uHorizonSharp);
    vec3 col = mix(uHorizon, uTop, smoothstep(0.42, 0.98, t));
    col = mix(uGround, col, smoothstep(-0.12, 0.06, up));

    // halo solaire (HDR)
    float sd = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSun * pow(sd, uSunPower) * 1.35;
    col += uSun * pow(sd, 6.0) * 0.35;

    // nuages volumétriques simples, projetés sur un plan
    if (uClouds > 0.01 && up > 0.02) {
      vec2 p = d.xz / max(up, 0.06) * 1.4 + vec2(uTime * 0.004, uTime * 0.002);
      float c = fbm(p * 1.3);
      float c2 = fbm(p * 2.9 + 4.1);
      float mask = smoothstep(0.44, 0.80, c * 0.75 + c2 * 0.42);
      vec3 cloudCol = mix(uHorizon * 1.15, uSun * 0.9 + uHorizon, pow(sd, 3.0));
      col = mix(col, cloudCol, mask * uClouds * smoothstep(0.015, 0.22, up) * 0.92);
    }

    // étoiles la nuit
    if (uStars > 0.01 && up > 0.0) {
      vec2 sp = floor(d.xz / max(up, 0.08) * 140.0);
      float s = hash(sp);
      float star = smoothstep(0.9975, 1.0, s);
      float tw = 0.7 + 0.3 * sin(uTime * 2.0 + s * 100.0);
      col += vec3(star * tw * uStars);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly uniforms: Record<string, THREE.IUniform>;

  constructor(theme: CircuitTheme) {
    const night = theme.mood === 'night';
    this.uniforms = {
      uTop: { value: new THREE.Color(theme.skyTop) },
      uHorizon: { value: new THREE.Color(theme.skyHorizon) },
      uSun: { value: new THREE.Color(theme.skySun) },
      uGround: { value: new THREE.Color(theme.groundColor).multiplyScalar(night ? 0.35 : 0.8) },
      uSunDir: { value: new THREE.Vector3(...theme.sunDir).normalize() },
      uSunPower: { value: night ? 900 : theme.mood === 'sunset' ? 260 : 140 },
      uStars: { value: night ? 1 : 0 },
      uClouds: { value: night ? 0.25 : theme.mood === 'sunset' ? 0.7 : 0.85 },
      uTime: { value: 0 },
      uHorizonSharp: { value: night ? 1.6 : 1.15 },
    };
    const geo = new THREE.SphereGeometry(1, 32, 20);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.scale.setScalar(1);
  }

  update(camera: THREE.Camera, time: number) {
    this.mesh.position.copy(camera.position);
    this.mesh.scale.setScalar(900);
    this.uniforms.uTime.value = time;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/**
 * Environnement PBR : on rend le ciel dans un CubeRenderTarget puis on le
 * preconvolue (PMREM). Résultat : des reflets cohérents sur la carrosserie
 * (métal peint, chrome, visières) sans aucun fichier HDR à télécharger.
 */
export function buildEnvironment(
  renderer: THREE.WebGLRenderer,
  theme: CircuitTheme,
  pmrem: THREE.PMREMGenerator,
  size = 128,
) {
  const scene = new THREE.Scene();
  const sky = new SkyDome(theme);
  sky.mesh.scale.setScalar(50);
  scene.add(sky.mesh);

  // une "bande de sol" colorée pour que les réflexions vers le bas restent crédibles
  const groundGeo = new THREE.SphereGeometry(60, 24, 8, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.48);
  // Sol de l'environnement : volontairement NEUTRE (gris bleuté) pour ne pas
  // teinter les carrosseries de la couleur de l'herbe.
  const groundMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(theme.mood === 'night' ? 0x1a1a28 : 0x8b90a0),
    side: THREE.BackSide,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  scene.add(ground);

  const cubeRT = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType });
  const cubeCam = new THREE.CubeCamera(0.1, 200, cubeRT);
  cubeCam.update(renderer, scene);
  const env = pmrem.fromCubemap(cubeRT.texture);

  sky.dispose();
  groundGeo.dispose();
  groundMat.dispose();
  cubeRT.dispose();
  return env;
}
