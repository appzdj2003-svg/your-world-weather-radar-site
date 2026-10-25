import * as THREE from "three";
import { smokeTexture, cloudTexture } from "./textures.js";

// Billboard particle system (instanced). Lit by sun + sky + the engine flame (point light term).
const VS = /* glsl */`
  attribute vec3 iPos; attribute vec4 iData; // size, alpha, seed, heat
  uniform float uTime; varying vec2 vUv; varying vec4 vData; varying vec3 vWorld;
  void main(){
    vUv = uv; vData = iData;
    vec4 wp = modelMatrix * vec4(iPos, 1.0); vWorld = wp.xyz;
    vec4 mv = viewMatrix * wp;
    float a = iData.z * 6.2831 + uTime * 0.05 * (iData.z - 0.5);
    vec2 p = mat2(cos(a), -sin(a), sin(a), cos(a)) * position.xy * iData.x;
    mv.xy += p;
    gl_Position = projectionMatrix * mv;
  }`;
const FS = /* glsl */`
  uniform sampler2D uTex; uniform vec3 uSunDir, uSunCol, uSky, uFlamePos, uFlameCol; uniform float uFlame, uSunlitAlt, uLitBase, uVis;
  varying vec2 vUv; varying vec4 vData; varying vec3 vWorld;
  void main(){
    vec4 t = texture2D(uTex, vUv);
    float a = t.a * vData.y * uVis;
    float cd = length(vWorld - cameraPosition); a *= smoothstep(vData.x * 0.12, vData.x * 0.6, cd);
    if (a < 0.003) discard;
    float dens = t.r;                                    // brighter = thinner edge
    float sunUp = clamp(uSunDir.y * 4.0 + 0.3, 0.0, 1.0);
    float topLit = clamp((vUv.y - 0.2) * 1.2, 0.0, 1.0);
    vec3 col = uSky * (0.35 + 0.65 * dens) * (0.6 + 0.4 * topLit) + uSunCol * sunUp * (0.35 + 0.65 * topLit) * dens;
    float lit = smoothstep(uSunlitAlt - 2000.0, uSunlitAlt + 2000.0, vWorld.y); // twilight: high smoke catches the sun
    col += uSunCol * lit * uLitBase * dens;
    float d = length(vWorld - uFlamePos);
    float under = 0.25 + 0.75 * (1.0 - vUv.y);                                       // undersides face the flame
    float hgt = exp(-max(vWorld.y - uFlamePos.y, 0.0) / 60.0);
    col += uFlameCol * uFlame * under * hgt / (1.0 + pow(d / 32.0, 2.0)) * (0.35 + 0.65 * dens * dens);
    col += vec3(1.0, 0.45, 0.12) * vData.w * 3.0;                                    // own heat (fresh exhaust)
    gl_FragColor = vec4(col * a, a);
  }`;

export class Particles {
  constructor(max, kind = "smoke") {
    this.max = max; this.n = 0; this.kind = kind;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.age = new Float32Array(max);
    this.size0 = new Float32Array(max); this.grow = new Float32Array(max); this.seed = new Float32Array(max); this.heat = new Float32Array(max); this.grav = new Float32Array(max); this.alpha0 = new Float32Array(max);
    const g = new THREE.InstancedBufferGeometry(); const q = new THREE.PlaneGeometry(1, 1);
    g.index = q.index; g.attributes.position = q.attributes.position; g.attributes.uv = q.attributes.uv;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("iPos", this.aPos); g.setAttribute("iData", this.aData); g.instanceCount = 0;
    this.u = { uTex: { value: kind === "cloud" ? cloudTexture() : smokeTexture() }, uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color(1, 1, 1) }, uSky: { value: new THREE.Color(0.3, 0.35, 0.4) }, uFlamePos: { value: new THREE.Vector3() },
      uFlameCol: { value: new THREE.Color(1.0, 0.55, 0.2) }, uFlame: { value: 0 }, uSunlitAlt: { value: 1e9 }, uLitBase: { value: 0 }, uVis: { value: 1 } };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = kind === "cloud" ? 5 : 8;
    this.order = new Uint32Array(max); this._depth = new Float32Array(max); this._frame = 0;
  }
  spawn(x, y, z, vx, vy, vz, life, size, grow, alpha = 1, heat = 0, grav = 0) {
    let i = this.n < this.max ? this.n++ : -1;
    if (i < 0) { // recycle oldest-ish
      let best = 0, ba = -1; for (let k = 0; k < 24; k++) { const j = (Math.random() * this.max) | 0; const r = this.age[j] / this.life[j]; if (r > ba) { ba = r; best = j; } } i = best;
    }
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3); this.life[i] = life; this.age[i] = 0;
    this.size0[i] = size; this.grow[i] = grow; this.seed[i] = Math.random(); this.alpha0[i] = alpha; this.heat[i] = heat; this.grav[i] = grav;
  }
  update(dt, wind, camPos) {
    const P = this.pos, V = this.vel;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.kind === "cloud") continue;
      const drag = Math.exp(-dt * 0.9), k = i * 3; // grav > 0: water droplets (deluge) fall
      V[k] = V[k] * drag + wind.x * (1 - drag); V[k + 1] = V[k + 1] * drag + ((1.2 + 3 * this.heat[i]) * 2 - 9.8 * this.grav[i]) * dt; V[k + 2] = V[k + 2] * drag + wind.z * (1 - drag);
      if (P[k + 1] < 1 && V[k + 1] < 0) V[k + 1] *= -0.3;
      P[k] += V[k] * dt; P[k + 1] = Math.max(0.5, P[k + 1] + V[k + 1] * dt); P[k + 2] += V[k + 2] * dt;
      this.heat[i] *= Math.exp(-dt * 3.5);
    }
    // depth sort (back to front) every 2nd frame
    const n = this.n;
    if ((this._frame++ & 1) === 0 && camPos) {
      for (let i = 0; i < n; i++) { const k = i * 3, dx = P[k] - camPos.x, dy = P[k + 1] - camPos.y, dz = P[k + 2] - camPos.z; this._depth[i] = dx * dx + dy * dy + dz * dz; this.order[i] = i; }
      const o = this.order.subarray(0, n), D = this._depth; o.sort((a, b) => D[b] - D[a]);
    }
    const ap = this.aPos.array, ad = this.aData.array;
    let m = 0;
    for (let s = 0; s < n; s++) {
      const i = this.order[s] < n ? this.order[s] : s;
      const r = this.age[i] / this.life[i]; if (r >= 1) continue;
      const k = i * 3;
      ap[m * 3] = P[k]; ap[m * 3 + 1] = P[k + 1]; ap[m * 3 + 2] = P[k + 2];
      const fade = this.kind === "cloud" ? 1 : Math.min(1, r * 8) * (1 - r) * (1 - r);
      ad[m * 4] = this.size0[i] + this.grow[i] * Math.sqrt(this.age[i]); ad[m * 4 + 1] = this.alpha0[i] * fade; ad[m * 4 + 2] = this.seed[i]; ad[m * 4 + 3] = this.heat[i];
      m++;
    }
    this.mesh.geometry.instanceCount = m;
    this.aPos.needsUpdate = true; this.aData.needsUpdate = true;
  }
  clear() { this.n = 0; this.mesh.geometry.instanceCount = 0; }
}
