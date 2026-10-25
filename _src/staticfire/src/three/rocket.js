import * as THREE from "three";
import { paintTexture, steelTexture, tileTexture, gridTexture } from "./textures.js";

const NOISE = /* glsl */`
float h3(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float n3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*n3(p); p*=2.03; a*=.5;} return s; }`;
export { NOISE };

// Physically-motivated exhaust plume: a stack of additive volumetric shells.
// Low altitude: tight, over-expanded jet with visible shock (Mach) diamonds.
// High altitude / near vacuum: the jet balloons outward and gets dim and translucent;
// it lights up if it climbs into sunlight while the ground is still in twilight.
export function makePlume({ radius = 1.9, length = 46, vac = false, layers = 3 }) {
  const g = new THREE.Group();
  const uni = { uTime: { value: 0 }, uThrust: { value: 0 }, uPressure: { value: 1 }, uSunlit: { value: 0 }, uSunCol: { value: new THREE.Color(1, 0.95, 0.9) } };
  const geo = new THREE.CylinderGeometry(1, 1, 1, 48, 48, true); geo.translate(0, -0.5, 0); // y: 0 at nozzle -> -1 at tail
  const mk = (k) => new THREE.ShaderMaterial({
    uniforms: { ...uni, uLayer: { value: k } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      uniform float uPressure, uLayer, uThrust, uTime; varying float vA, vS; varying vec3 vN, vV, vP;
      void main(){
        vec3 p = position; float a = -p.y; vA = a;
        float vacE = 1.0 - uPressure;                          // 0 sea level -> 1 vacuum
        float lay = 0.55 + uLayer*0.38;
        float shape = mix(1.0 + a*0.55 + 0.12*sin(a*20.0)*uPressure*(1.0-a), 1.0 + a*(3.0 + 14.0*vacE) , vacE*0.85);
        float r = lay * shape; vS = shape;
        p.xz *= r;
        p.y *= mix(1.0, 2.6, vacE) * (0.75 + 0.25*uThrust);
        vP = p;
        vec4 mv = modelViewMatrix * vec4(p,1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uThrust, uPressure, uSunlit, uLayer; uniform vec3 uSunCol;
      varying float vA, vS; varying vec3 vN, vV, vP;
      ${NOISE}
      void main(){
        float a = clamp(vA,0.0,1.0); float vacE = 1.0 - uPressure;
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.0 + uLayer*0.8);
        float turb = fbm(vec3(vP.x*0.35, vP.y*0.22 + uTime*9.0, vP.z*0.35));
        float tail = smoothstep(1.0, 0.0, a) * smoothstep(0.0, 0.03, a);
        // shock diamonds: periodic bright nodes, strongest near the nozzle at low altitude
        float dm = pow(0.5 + 0.5*cos(a*6.2831*5.5), 10.0) * uPressure * smoothstep(0.75, 0.0, a) * (1.0 - uLayer*0.6);
        vec3 core = vec3(1.0, 0.92, 0.75), hot = vec3(1.0, 0.55, 0.16), soot = vec3(0.55, 0.22, 0.06);
        vec3 col = mix(core, hot, smoothstep(0.0, 0.45, a + uLayer*0.25));
        col = mix(col, soot, smoothstep(0.35, 1.0, a) * uPressure);
        // vacuum: hot core stays small, outer plume is dim blue-violet unless sunlit
        col = mix(col, mix(vec3(0.35,0.42,0.75), uSunCol, uSunlit), vacE * smoothstep(0.05, 0.4, a));
        float I = (1.6 - uLayer*0.45) * tail * edge * (0.65 + 0.7*turb);
        I += dm * 2.4;
        I /= mix(1.0, vS * vS * 0.35 + 0.65, vacE);           // expanding gas gets dimmer per area
        I *= mix(1.0, 0.07 + 0.45*uSunlit, vacE * smoothstep(0.04, 0.4, a));
        gl_FragColor = vec4(min(col * I * uThrust * (uLayer < 0.5 ? 6.0 : 2.0), vec3(30.0)), 1.0);
      }`
  });
  for (let k = 0; k < layers; k++) { const m = new THREE.Mesh(geo, mk(k)); m.frustumCulled = false; m.renderOrder = 10 + k; g.add(m); }
  g.scale.set(radius, length, radius);
  g.userData.u = uni;
  return g;
}

export function makeRocket(tier) {
  const seg = tier === "ultra" ? 64 : 40;
  const root = new THREE.Group();
  const paint = paintTexture();
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, map: paint, roughness: 0.42, metalness: 0.05 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.55, metalness: 0.15 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x5a5f66, roughness: 0.32, metalness: 0.9 });
  const bellMat = new THREE.MeshStandardMaterial({ color: 0x3b3d42, roughness: 0.28, metalness: 0.95, emissive: new THREE.Color(1, 0.35, 0.08), emissiveIntensity: 0 });
  const R = 1.83;
  const cast = m => { m.castShadow = true; m.receiveShadow = true; return m; };
  // --- stage 1 ---
  const s1 = new THREE.Group(); s1.name = "stage1";
  const body1 = cast(new THREE.Mesh(new THREE.CylinderGeometry(R, R, 41, seg, 1, false), white)); body1.position.y = 20.5 + 1.2; s1.add(body1);
  const octa = cast(new THREE.Mesh(new THREE.CylinderGeometry(R * 1.02, R * 1.06, 1.2, seg), carbon)); octa.position.y = 0.6; s1.add(octa);
  const bellG = new THREE.LatheGeometry([...Array(12)].map((_, i) => new THREE.Vector2(0.18 + 0.27 * Math.pow(i / 11, 0.7), -i / 11 * 1.25)), 24);
  const bells = [];
  const bpos = [[0, 0]]; for (let i = 0; i < 8; i++) bpos.push([Math.cos(i / 8 * 6.283) * 1.18, Math.sin(i / 8 * 6.283) * 1.18]);
  for (const [x, z] of bpos) { const b = cast(new THREE.Mesh(bellG, bellMat)); b.position.set(x, 0.05, z); s1.add(b); bells.push(b); }
  for (let i = 0; i < 4; i++) { // folded landing legs
    const a = i / 4 * 6.283 + 0.785, leg = cast(new THREE.Mesh(new THREE.BoxGeometry(0.55, 9.5, 0.28), carbon));
    leg.position.set(Math.cos(a) * (R + 0.1), 5.6, Math.sin(a) * (R + 0.1)); leg.rotation.y = -a; s1.add(leg);
  }
  const inter = cast(new THREE.Mesh(new THREE.CylinderGeometry(R, R, 6.4, seg), carbon)); inter.position.y = 41 + 1.2 + 3.2; s1.add(inter);
  for (let i = 0; i < 4; i++) { // grid fins (stowed)
    const a = i / 4 * 6.283, f = cast(new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 0.12), metal));
    f.position.set(Math.cos(a) * (R + 0.08), 46.6, Math.sin(a) * (R + 0.08)); f.rotation.y = -a + Math.PI / 2; s1.add(f);
  }
  root.add(s1);
  // --- stage 2 + fairing ---
  const s2 = new THREE.Group(); s2.name = "stage2"; s2.position.y = 48.8;
  const body2 = cast(new THREE.Mesh(new THREE.CylinderGeometry(R, R, 12.6, seg), white)); body2.position.y = 6.3; s2.add(body2);
  const mvacG = new THREE.LatheGeometry([...Array(16)].map((_, i) => new THREE.Vector2(0.3 + 1.15 * Math.pow(i / 15, 0.75), -i / 15 * 3.6)), 40);
  const mvac = new THREE.Mesh(mvacG, bellMat.clone()); mvac.position.y = 0.2; s2.add(mvac); mvac.visible = false; // hidden inside interstage until separation
  s2.userData.mvac = mvac;
  const fairPts = []; for (let i = 0; i <= 24; i++) { const t = i / 24; fairPts.push(new THREE.Vector2(Math.max(0.02, 2.6 * Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.2)))), t * 11.5)); }
  const fairG = new THREE.LatheGeometry(fairPts, seg, 0, Math.PI);
  const fairBase = cast(new THREE.Mesh(new THREE.CylinderGeometry(2.6, R, 1.3, seg, 1, true), white)); fairBase.position.y = 13.25; s2.add(fairBase);
  const halves = [0, 1].map(k => { const h = cast(new THREE.Mesh(fairG, white)); h.material = white.clone(); h.material.side = THREE.DoubleSide; h.position.y = 13.9; h.rotation.y = k * Math.PI; s2.add(h); return h; });
  s2.userData.fairing = halves; s2.userData.fairBase = fairBase;
  root.add(s2);
  // plumes
  const p1 = makePlume({ radius: 2.9, length: 70, layers: tier === "ultra" ? 3 : 2 }); p1.position.y = -1.0; s1.add(p1);
  const p2 = makePlume({ radius: 1.1, length: 30, vac: true, layers: 2 }); p2.position.y = -3.6; s2.add(p2); p2.visible = false;
  const vapor = []; // LOX venting (pre-launch)
  // nozzle glare sprite (feeds the bloom)
  const glare = makeGlare();
  glare.scale.set(26, 26, 1); glare.position.y = -3; glare.renderOrder = 20; s1.add(glare);
  root.userData = { glare, s1, s2, p1, p2, bells, bellMat, mvac, height: 75,
    kind: "falcon9", base: 0, k: 1, cabinY: 62, vents: [47], pR: 2.9, pL: 70, glareK: 1, flameK: 1, bellMats: [bellMat] };
  return root;
}

function makeGlare() {
  const gc = document.createElement("canvas"); gc.width = gc.height = 128; const gx = gc.getContext("2d");
  const gg = gx.createRadialGradient(64, 64, 0, 64, 64, 64); gg.addColorStop(0, "rgba(255,250,235,1)"); gg.addColorStop(0.25, "rgba(255,200,120,0.55)"); gg.addColorStop(1, "rgba(255,120,40,0)");
  gx.fillStyle = gg; gx.fillRect(0, 0, 128, 128);
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gc), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(4, 3, 2), fog: false }));
}

// SpaceX Starship full stack (Super Heavy booster + Ship), same procedural style as makeRocket:
// stainless steel, black hex heat-shield tiles on the ship's windward side, forward + aft flaps,
// grid fins near the booster top, vented hot-staging ring, 33 Raptors on the booster, 6 on the ship.
// Generic model made in code (approximate dimensions: ~121 m tall, 9 m diameter). It stands on an
// orbital launch mount, so its engines sit `base` metres above the pad.
// tileAz = azimuth (rad, three.js cylinder theta) the tiled (windward) side faces.
export function makeStarship(tier, { tileAz = 0 } = {}) {
  const seg = tier === "ultra" ? 96 : 56;
  const root = new THREE.Group();
  const R = 5.2, ZB = 18, LB = 69.8, HSR = 1.8, LS = 35, LN = 15.2;           // radius, mount height, booster, hot-stage ring, ship barrel, nose
  const cast = m => { m.castShadow = true; m.receiveShadow = true; return m; };
  const steelMat = (tex) => new THREE.MeshStandardMaterial({ color: 0xe4eaf1, map: tex, roughness: 0.27, metalness: 0.7, envMapIntensity: 1.2 });
  const boosterSteel = steelMat(steelTexture({ h: 2048, rings: 38, frost: [[0.12, 0.5], [0.56, 0.86]], soot: 0.1, seed: 41 }));
  const shipSteel = steelMat(steelTexture({ h: 1024, rings: 20, frost: [[0.04, 0.38], [0.44, 0.7]], soot: 0.04, seed: 59 }));
  const noseSteel = steelMat(steelTexture({ h: 512, rings: 7, frost: [], soot: 0, seed: 63 }));
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5, metalness: 0.7 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x6a6e75, roughness: 0.34, metalness: 0.9 });
  const ttex = tileTexture();
  const tileMat = (rx, ry) => { const t = ttex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); return new THREE.MeshStandardMaterial({ color: 0x5a5c60, map: t, roughness: 0.92, metalness: 0.0, envMapIntensity: 0.12, side: THREE.DoubleSide }); }; // near-black so the stripe reads at pad distance
  const mkBellMat = () => new THREE.MeshStandardMaterial({ color: 0x3b3d42, roughness: 0.28, metalness: 0.95, emissive: new THREE.Color(1, 0.35, 0.08), emissiveIntensity: 0 });
  const bellMats = [mkBellMat(), mkBellMat(), mkBellMat()];                 // center 3 / inner 10 / outer 20 (lit in sequence)
  const bellG = new THREE.LatheGeometry([...Array(12)].map((_, i) => new THREE.Vector2(0.3 + 0.36 * Math.pow(i / 11, 0.7), -i / 11 * 1.9)), 20);
  // ---------- Super Heavy (s1) ----------
  const s1 = new THREE.Group(); s1.name = "superheavy";
  const body1 = cast(new THREE.Mesh(new THREE.CylinderGeometry(R, R, LB, seg, 1, false), boosterSteel)); body1.position.y = ZB + LB / 2; s1.add(body1);
  const floor = cast(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.985, R * 0.985, 0.4, seg), dark)); floor.position.y = ZB + 0.15; s1.add(floor);
  const bells = [], ring = (n, r, ph) => [...Array(n)].map((_, i) => [Math.cos(i / n * 6.283 + ph) * r, Math.sin(i / n * 6.283 + ph) * r]);
  [ring(3, 0.95, 0.5), ring(10, 2.5, 0.1), ring(20, R - 0.85, 0)].forEach((pts, gi) => pts.forEach(([x, z]) => {
    const b = cast(new THREE.Mesh(bellG, bellMats[gi])); b.position.set(x, ZB + 0.1, z); s1.add(b); bells.push(b);
  }));
  // chines / aero covers + a cable raceway
  for (const a of [tileAz + Math.PI / 2, tileAz - Math.PI / 2]) {
    const c = cast(new THREE.Mesh(new THREE.BoxGeometry(0.5, 14, 0.9), metal)); c.position.set(Math.sin(a) * (R + 0.2), ZB + 8, Math.cos(a) * (R + 0.2)); c.rotation.y = a; s1.add(c);
  }
  for (const a of [tileAz + Math.PI / 2, tileAz - Math.PI / 2]) {         // full-length chines
    const c = cast(new THREE.Mesh(new THREE.BoxGeometry(0.7, LB - 12, 0.55), boosterSteel)); c.position.set(Math.sin(a) * (R + 0.2), ZB + 8 + (LB - 12) / 2, Math.cos(a) * (R + 0.2)); c.rotation.y = a; s1.add(c);
  }
  const skirtMat = new THREE.MeshStandardMaterial({ color: 0x8b9097, roughness: 0.45, metalness: 0.7 });
  const skirt = cast(new THREE.Mesh(new THREE.CylinderGeometry(R + 0.04, R + 0.04, 5.2, seg, 1, true), skirtMat)); skirt.position.y = ZB + 2.6; s1.add(skirt);
  { const a = tileAz + Math.PI, rw = cast(new THREE.Mesh(new THREE.BoxGeometry(0.9, LB - 6, 0.45), boosterSteel)); rw.position.set(Math.sin(a) * (R + 0.18), ZB + LB / 2 + 2, Math.cos(a) * (R + 0.18)); rw.rotation.y = a; s1.add(rw); }
  // grid fins (4, fixed, near the top): lattice faces up/down, solid side frames
  const gtex = gridTexture();
  const finSide = new THREE.MeshStandardMaterial({ color: 0x34373c, roughness: 0.4, metalness: 0.85 });
  const finGrid = new THREE.MeshStandardMaterial({ color: 0x3e4247, roughness: 0.4, metalness: 0.85, alphaMap: gtex, alphaTest: 0.5, side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) {
    const a = tileAz + Math.PI / 4 + i * Math.PI / 2, f = cast(new THREE.Mesh(new THREE.BoxGeometry(5.0, 1.3, 4.0), [finSide, finSide, finGrid, finGrid, finSide, finSide]));
    f.position.set(Math.sin(a) * (R + 2.6), ZB + LB - 4.2, Math.cos(a) * (R + 2.6)); f.rotation.y = a - Math.PI / 2; s1.add(f);
    const act = cast(new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.4, 1.6), metal)); act.position.set(Math.sin(a) * (R + 0.35), ZB + LB - 3.9, Math.cos(a) * (R + 0.35)); act.rotation.y = a; s1.add(act);
  }
  // hot-staging ring (vented)
  const vc = document.createElement("canvas"); vc.width = 512; vc.height = 64; const vx = vc.getContext("2d");
  vx.fillStyle = "#8f9399"; vx.fillRect(0, 0, 512, 64); vx.fillStyle = "#050506"; vx.fillRect(0, 0, 512, 5); vx.fillRect(0, 59, 512, 5);
  for (let i = 0; i < 32; i++) { const x = i * 16 + 2; vx.beginPath(); vx.roundRect ? vx.roundRect(x, 8, 11, 48, 4) : vx.rect(x, 8, 11, 48); vx.fill(); }
  const vtex = new THREE.CanvasTexture(vc); vtex.colorSpace = THREE.SRGBColorSpace; vtex.wrapS = THREE.RepeatWrapping; vtex.repeat.set(2, 1);
  const hsr = cast(new THREE.Mesh(new THREE.CylinderGeometry(R + 0.12, R + 0.12, HSR, seg, 1, true), new THREE.MeshStandardMaterial({ map: vtex, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide })));
  hsr.position.y = ZB + LB + HSR / 2; s1.add(hsr);
  const dome = cast(new THREE.Mesh(new THREE.SphereGeometry(R * 0.98, 32, 8, 0, 6.283, 0, 0.6), dark)); dome.position.y = ZB + LB - R * 0.98 * Math.cos(0.6) + 0.2; s1.add(dome);
  root.add(s1);
  // ---------- Ship (s2) ----------
  const s2 = new THREE.Group(); s2.name = "ship"; s2.position.y = ZB + LB + HSR;
  const body2 = cast(new THREE.Mesh(new THREE.CylinderGeometry(R, R, LS, seg), shipSteel)); body2.position.y = LS / 2; s2.add(body2);
  const noseR = y => R * Math.pow(Math.max(0, 1 - Math.pow(y / LN, 1.75)), 0.6);   // ogive
  const nosePts = []; for (let i = 0; i <= 40; i++) { const y = i / 40 * LN; nosePts.push(new THREE.Vector2(Math.max(0.5, noseR(y)), y)); }
  nosePts.push(new THREE.Vector2(0.001, LN + 0.35));
  const nose = cast(new THREE.Mesh(new THREE.LatheGeometry(nosePts, seg), noseSteel)); nose.position.y = LS; s2.add(nose);
  // heat-shield tiles on the windward half (barrel + nose)
  const t0 = tileAz - Math.PI / 2;
  const tiles = cast(new THREE.Mesh(new THREE.CylinderGeometry(R + 0.05, R + 0.05, LS - 0.6, seg, 1, true, t0, Math.PI), tileMat(2, 5))); tiles.position.y = LS / 2 + 0.3; s2.add(tiles);
  const tnPts = nosePts.slice(0, 38).map(p => new THREE.Vector2(p.x + 0.05, p.y));
  const tnose = cast(new THREE.Mesh(new THREE.LatheGeometry(tnPts, seg >> 1, t0, Math.PI), tileMat(2, 2))); tnose.position.y = LS; s2.add(tnose);
  { const a = tileAz + Math.PI, rw = cast(new THREE.Mesh(new THREE.BoxGeometry(0.8, LS - 4, 0.4), shipSteel)); rw.position.set(Math.sin(a) * (R + 0.16), LS / 2, Math.cos(a) * (R + 0.16)); rw.rotation.y = a; s2.add(rw); }
  // flaps: aft (big) and forward (small, on the nose), hinged at the tile boundary; tiles on the windward face
  const flap = (pts, a, y0, windSign, tileRep) => {
    const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const th = 0.36, g = new THREE.Group();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: th, bevelEnabled: false }); geo.translate(0, 0, -th / 2);
    g.add(cast(new THREE.Mesh(geo, shipSteel)));
    const tp = cast(new THREE.Mesh(new THREE.ShapeGeometry(sh), tileMat(tileRep, tileRep))); tp.position.z = windSign * (th / 2 + 0.02); g.add(tp);
    g.position.y = y0; g.rotation.y = a - Math.PI / 2; s2.add(g); return g;
  };
  const aft = [[R - 0.2, 0.6], [R + 3.6, 1.6], [R + 3.6, 9.2], [R - 0.2, 12.2]];
  const fy0 = 2.2, fy1 = 9.6, fwd = [[noseR(fy0) - 0.3, 0], [noseR(fy0) + 2.6, 1.2], [noseR(fy1) + 1.6, fy1 - fy0 - 0.4], [noseR(fy1) - 0.3, fy1 - fy0]];
  const flaps = [];
  for (const [a, ws] of [[tileAz + Math.PI / 2, 1], [tileAz - Math.PI / 2, -1]]) {
    flaps.push(flap(aft, a, 0, ws, 1.4));
    flaps.push(flap(fwd, a, LS + fy0, ws, 1.0));
  }
  // ship engines: 3 sea-level + 3 vacuum Raptors (hidden inside the hot-staging ring until separation)
  const shipBellMat = mkBellMat();
  const mvac = new THREE.Group(); mvac.material = shipBellMat;
  const rvacG = new THREE.LatheGeometry([...Array(16)].map((_, i) => new THREE.Vector2(0.35 + 0.85 * Math.pow(i / 15, 0.75), -i / 15 * 3.0)), 32);
  ring(3, 0.95, 0.5).forEach(([x, z]) => { const b = new THREE.Mesh(bellG, shipBellMat); b.position.set(x, 0.1, z); mvac.add(b); });
  ring(3, 3.0, 0.5 + Math.PI / 3).forEach(([x, z]) => { const b = new THREE.Mesh(rvacG, shipBellMat); b.position.set(x, 0.1, z); mvac.add(b); });
  const floor2 = new THREE.Mesh(new THREE.CircleGeometry(R * 0.99, seg), dark); floor2.rotation.x = Math.PI / 2; floor2.position.y = 0.05; s2.add(floor2);
  s2.add(mvac); mvac.visible = false;
  const fairBase = new THREE.Group(); s2.add(fairBase);                       // no payload fairing on Starship
  s2.userData.mvac = mvac; s2.userData.fairing = []; s2.userData.fairBase = fairBase; s2.userData.flaps = flaps;
  root.add(s2);
  // plumes: very wide, bright booster plume (33 engines); ship plume
  const p1 = makePlume({ radius: 6.6, length: 125, layers: tier === "ultra" ? 3 : 2 }); p1.position.y = ZB - 1.6; s1.add(p1);
  const p2 = makePlume({ radius: 2.6, length: 44, vac: true, layers: 2 }); p2.position.y = -2.8; s2.add(p2); p2.visible = false;
  const glare = makeGlare(); glare.scale.set(46, 46, 1); glare.position.y = ZB - 4; glare.renderOrder = 20; s1.add(glare);
  const height = ZB + LB + HSR + LS + LN;
  root.userData = { glare, s1, s2, p1, p2, bells, bellMat: bellMats[0], bellMats, mvac, height,
    kind: "starship", base: ZB, k: height / 75, cabinY: ZB + LB + HSR + LS + 2, vents: [ZB + 30, ZB + 60, ZB + LB + HSR + 12],
    pR: 6.6, pL: 125, glareK: 1.75, flameK: 2.4, tileAz, R, boosterTop: ZB + LB + HSR };
  return root;
}
