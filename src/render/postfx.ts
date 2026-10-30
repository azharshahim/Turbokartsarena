/**
 * Turbo Karts Arena — post-traitement.
 *
 * Chaîne : scène → bloom (UnrealBloomPass) → passe "vitesse" maison → FXAA.
 *
 * La passe maison regroupe, en UN SEUL passage plein écran (coût mobile maîtrisé) :
 *   • flou de mouvement radial (taps pondérés vers le point de fuite)
 *   • aberration chromatique (décalage des canaux qui augmente avec la vitesse)
 *   • lignes de vitesse (bandes angulaires additives, masquées au centre)
 *   • vignette dynamique + flash de turbo (teinté selon le palier)
 *   • étalonnage colorimétrique (contraste, saturation, gamma)
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { QualitySettings } from '../core/config';

export const SpeedShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    /** 0 = arrêt, 1 = vitesse max + turbo */
    uSpeed: { value: 0 },
    /** Palier de turbo actif (0-3) → couleur du flash. */
    uBoostTier: { value: 0 },
    uBoost: { value: 0 },
    uAberration: { value: 0.0016 },
    uMotionBlur: { value: 0 },
    uSpeedLines: { value: 1 },
    uVignette: { value: 0.4 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(0xffffff) },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uSaturation: { value: 1.12 },
    uContrast: { value: 1.06 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uSpeed;
    uniform float uBoostTier;
    uniform float uBoost;
    uniform float uAberration;
    uniform float uMotionBlur;
    uniform float uSpeedLines;
    uniform float uVignette;
    uniform float uFlash;
    uniform vec3 uFlashColor;
    uniform vec2 uResolution;
    uniform float uSaturation;
    uniform float uContrast;
    varying vec2 vUv;

    float hash(float n) { return fract(sin(n) * 43758.5453123); }

    void main() {
      vec2 center = vec2(0.5, 0.48);
      vec2 dir = vUv - center;
      float dist = length(dir);

      // ---- aberration chromatique (radiale) ----
      float ab = uAberration * (0.35 + uSpeed * 1.6);
      vec2 off = normalize(dir + 1e-5) * ab;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off * 1.15).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off * 1.15).b;

      // ---- flou de mouvement radial (échantillonnage pondéré) ----
      float blurAmt = uMotionBlur * (0.004 + uSpeed * 0.028) * smoothstep(0.06, 0.75, dist);
      if (blurAmt > 0.0002) {
        vec3 acc = col * 1.4;
        float wsum = 1.4;
        for (int i = 1; i <= 5; i++) {
          float t = float(i) / 5.0;
          float w = 1.0 - t * 0.72;
          vec2 uv2 = vUv - dir * blurAmt * t;
          acc += texture2D(tDiffuse, uv2).rgb * w;
          wsum += w;
        }
        col = acc / wsum;
      }

      // ---- lignes de vitesse ----
      if (uSpeedLines > 0.5) {
        float ang = atan(dir.y, dir.x);
        float sectors = 46.0;
        float lane = floor((ang / 6.28318 + 0.5) * sectors);
        float rnd = hash(lane * 7.13);
        float phase = fract(uTime * (1.6 + rnd * 2.2) + rnd);
        // la ligne voyage du centre vers l'extérieur
        float band = smoothstep(0.0, 0.06, phase - dist * 0.9) * smoothstep(0.28, 0.0, phase - dist * 0.9);
        float edge = smoothstep(0.32, 0.72, dist) * (1.0 - smoothstep(0.95, 1.3, dist));
        float mask = band * edge * step(0.45, rnd) * uSpeed;
        float laneWidth = smoothstep(0.06, 0.0, abs(fract((ang / 6.28318 + 0.5) * sectors) - 0.5));
        vec3 lineCol = mix(vec3(0.95, 0.98, 1.0), vec3(0.75, 0.55, 1.0), uBoostTier > 2.5 ? 1.0 : 0.0);
        col += lineCol * mask * laneWidth * 0.55 * uSpeedLines;
      }

      // ---- vignette + flash de turbo ----
      float vig = smoothstep(0.42, 1.05, dist) * uVignette;
      col *= 1.0 - vig;
      vec3 boostTint = uBoostTier > 2.5 ? vec3(0.55, 0.25, 1.0)
                     : uBoostTier > 1.5 ? vec3(1.0, 0.55, 0.15)
                     : vec3(0.2, 0.65, 1.0);
      float edgeBoost = smoothstep(0.35, 1.0, dist) * uBoost * 0.55;
      col = mix(col, boostTint, edgeBoost * 0.5);
      col += uFlashColor * uFlash * (0.25 + 0.75 * dist);

      // ---- étalonnage ----
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(lum), col, uSaturation);
      col = clamp((col - 0.5) * uContrast + 0.5, 0.0, 8.0);

      // sortie en HDR LINÉAIRE : le tone mapping + la conversion sRGB sont faits
      // par l'OutputPass final (indispensable pour un bloom correct).
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export interface PostFX {
  composer: EffectComposer;
  speedPass: ShaderPass;
  bloomPass: UnrealBloomPass | null;
  fxaaPass: ShaderPass | null;
  setSize(width: number, height: number, pixelRatio: number): void;
  render(dt: number): void;
  dispose(): void;
}

export function createPostFX(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  quality: QualitySettings,
): PostFX {
  const size = new THREE.Vector2();
  renderer.getSize(size);

  // Render target du composer : HalfFloat (HDR indispensable au bloom).
  // Pas de MSAA matériel : sur un target HalfFloat il est mal supporté par
  // plusieurs pilotes mobiles (résultat noir) et coûteux. L'anticrénelage est
  // assuré par FXAA en fin de chaîne, moins cher et universel.
  const rt = new THREE.WebGLRenderTarget(
    Math.max(1, Math.floor(size.x)),
    Math.max(1, Math.floor(size.y)),
    { type: THREE.HalfFloatType, samples: 0, depthBuffer: true, stencilBuffer: false },
  );
  const composer = new EffectComposer(renderer, rt);
  // Dernière passe → écran. (Le comportement par défaut de three cible le render
  // target interne du composer quand il y en a plusieurs : écran noir garanti.)
  composer.renderToScreen = true;
  composer.addPass(new RenderPass(scene, camera));

  let bloomPass: UnrealBloomPass | null = null;
  if (quality.bloom) {
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      quality.bloomStrength,
      0.72, // rayon
      0.82, // seuil : seules les zones HDR (soleil, néons, étincelles) débordent
    );
    // Fullscreen bloom never uses depth; avoid eleven unused depth buffers.
    for (const target of [bloomPass.renderTargetBright, ...bloomPass.renderTargetsHorizontal, ...bloomPass.renderTargetsVertical]) target.depthBuffer = false;
    // Preserve the existing CSS-sized bloom budget at DPR > 1, but let the
    // composer size it ONCE, not effective-size then CSS-size on every change.
    const resizeBloom = bloomPass.setSize.bind(bloomPass);
    bloomPass.setSize = (w, h) => resizeBloom(Math.min(w, size.x), Math.min(h, size.y));
    composer.addPass(bloomPass);
  }

  const speedPass = new ShaderPass(SpeedShader);
  speedPass.uniforms.uMotionBlur.value = quality.motionBlur ? 1 : 0;
  speedPass.uniforms.uSpeedLines.value = quality.speedLines ? 1 : 0;
  speedPass.uniforms.uAberration.value = quality.chromatic ? 0.0018 : 0;
  composer.addPass(speedPass);
  speedPass.renderToScreen = true;

  speedPass.renderToScreen = false;

  // Tone mapping ACES + conversion sRGB
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  let fxaaPass: ShaderPass | null = null;
  if (quality.antialias === 'fxaa') {
    outputPass.renderToScreen = false;
    fxaaPass = new ShaderPass(FXAAShader);
    fxaaPass.renderToScreen = true;
    composer.addPass(fxaaPass);
  }

  let widthNow = size.x, heightNow = size.y, ratioNow = NaN;
  const setSize = (width: number, height: number, pixelRatio: number) => {
    size.set(width, height);
    if (width !== widthNow || height !== heightNow) {
      composer.setSize(width, height);
      widthNow = width; heightNow = height;
    }
    if (pixelRatio !== ratioNow) {
      composer.setPixelRatio(pixelRatio);
      ratioNow = pixelRatio;
    }
    speedPass.uniforms.uResolution.value.set(width * pixelRatio, height * pixelRatio);
    if (fxaaPass) fxaaPass.material.uniforms.resolution.value.set(1 / (width * pixelRatio), 1 / (height * pixelRatio));
  };

  let disposed = false;
  return {
    composer,
    speedPass,
    bloomPass,
    fxaaPass,
    setSize,
    render(dt: number) {
      composer.render(dt);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const pass of composer.passes) pass.dispose();
      // Three r166 UnrealBloomPass.dispose omits this owned material.
      bloomPass?.materialHighPassFilter.dispose();
      composer.dispose();
    },
  };
}
