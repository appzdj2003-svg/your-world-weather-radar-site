import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect, NoiseEffect, BlendFunction, DepthOfFieldEffect } from "postprocessing";
import SunCalc from "suncalc";
import { makeRocket, makeStarship, makePlume } from "./rocket.js";
import { isStarship } from "../vehicle.js";
import { Particles } from "./particles.js";
import { LensEffect } from "./effects.js";
import { concreteTexture, groundTexture } from "./textures.js";
import { NOISE } from "./rocket.js";

const UP = new THREE.Vector3(0, 1, 0), R_EARTH = 6371e3;
const TIERS = {
  standard: { dpr: 1.5, shadow: 1024, smoke: 2200, clouds: 45, msaa: 2, dof: false, grain: false, hdri: false },
  ultra: { dpr: 2, shadow: 2048, smoke: 6000, clouds: 90, msaa: 4, dof: true, grain: true, hdri: true },
};
function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function rnd(a, b) { return a + Math.random() * (b - a); }

export async function createScene({ canvas, tier, launch, region, assetBase = "assets/" }) {
  const T = TIERS[tier] || TIERS.standard;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false, depth: true });
  renderer.setPixelRatio(Math.min(T.dpr, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.xr.enabled = false; // WebXR-ready: scene + camera rig work with renderer.xr; post-FX would be bypassed in XR.
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.3, 150000);
  const rig = new THREE.Group(); rig.add(camera); scene.add(rig); // all camera moves go through the rig (XR-compatible)

  // ---------- real sun angle at the pad for the launch time ----------
  const lat = launch.padLat ?? 28.56, lon = launch.padLon ?? -80.58;
  const sunDirAt = (date) => { const p = SunCalc.getPosition(date, lat, lon); return new THREE.Vector3(-Math.sin(p.azimuth) * Math.cos(p.altitude), Math.sin(p.altitude), Math.cos(p.azimuth) * Math.cos(p.altitude)).normalize(); };
  let sunDir = sunDirAt(new Date(launch.net || Date.now()));

  // ---------- sky (Preetham scattering, faded to black space with altitude) ----------
  const sky = new Sky(); sky.scale.setScalar(100000); scene.add(sky);
  const su = sky.material.uniforms;
  su.turbidity.value = 2.2; su.rayleigh.value = 1.4; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.82;
  sky.material.uniforms.uSkyFade = { value: 1 };
  sky.material.fragmentShader = sky.material.fragmentShader.replace("uniform float time;", "uniform float time;\nuniform float uSkyFade;")
    .replace("gl_FragColor = vec4( texColor, 1.0 );", `
      // civil/nautical twilight glow (Preetham alone goes black once the sun is below the horizon)
      float sEl = vSunDirection.y;
      float tw = smoothstep(-0.33, -0.03, sEl) * (1.0 - smoothstep(0.02, 0.15, sEl));
      float hz = exp(-max(direction.y, 0.0) * 5.0);
      float toward = pow(max(dot(normalize(direction.xz + 1e-4), normalize(vSunDirection.xz + 1e-4)), 0.0), 3.0);
      float lvl = smoothstep(-0.33, -0.05, sEl);
      vec3 glow = vec3(0.012, 0.025, 0.07) * (0.4 + 0.6*(1.0-hz*0.3)) * lvl + vec3(0.55, 0.22, 0.07) * toward * hz * lvl * lvl;
      texColor += glow * tw * 0.9;
      gl_FragColor = vec4( texColor * uSkyFade, 1.0 );`);
  const cover = { FEW: 0.15, SCT: 0.35, BKN: 0.62, OVC: 0.9 }[(launch.metar && launch.metar.cover) || "FEW"] ?? 0.2;
  if (su.cloudCoverage) { su.cloudCoverage.value = cover; su.cloudDensity.value = 0.45; su.cloudElevation.value = 0.45; }
  // stars
  const starG = new THREE.BufferGeometry(), sp = [];
  for (let i = 0; i < 4000; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(90000); sp.push(v.x, v.y, v.z); }
  starG.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(starG, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, color: 0xffffff, transparent: true, depthWrite: false, fog: false }));
  scene.add(stars);

  // ---------- lights ----------
  const sun = new THREE.DirectionalLight(0xffffff, 3); sun.castShadow = true;
  sun.shadow.mapSize.set(T.shadow, T.shadow); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 800 });
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0x8fb3ff, 0x3a3020, 0.4); scene.add(hemi);
  const flame = new THREE.PointLight(0xff8a3a, 0, 0, 2); scene.add(flame);
  const flameFill = new THREE.PointLight(0xffa860, 0, 0, 2); scene.add(flameFill); // plume glow lighting the vehicle body

  // ---------- world (floating origin: the rocket stays near 0,0,0) ----------
  const world = new THREE.Group(); scene.add(world);
  scene.fog = new THREE.FogExp2(0x9fb6d0, 1 / 45000);
  const gtex = groundTexture(); gtex.repeat.set(380, 380);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000), new THREE.MeshStandardMaterial({ map: gtex, roughness: 0.95, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; world.add(ground);
  // ocean on the real side of the coast (nearest Natural Earth coastline point to the pad)
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(180000, 180000), new THREE.MeshStandardMaterial({ color: 0x0b2a3c, roughness: 0.12, metalness: 0.0 }));
  ocean.rotation.x = -Math.PI / 2; ocean.position.y = 0.15; ocean.receiveShadow = true;
  const coast = nearestCoast(region, lat, lon);
  if (coast && coast.d < 30000) {
    const d = Math.max(700, coast.d), dir = new THREE.Vector3(coast.x, 0, coast.z).normalize();
    const holder = new THREE.Group(); holder.add(ocean); ocean.position.set(0, 0.15, 90000); // near edge of the water plane sits on the coast
    holder.position.copy(dir.clone().multiplyScalar(d)); holder.lookAt(holder.position.clone().add(dir)); world.add(holder);
  }
  // pad
  const ctex = concreteTexture(); ctex.repeat.set(10, 10);
  const concrete = new THREE.MeshStandardMaterial({ map: ctex, roughness: 0.85, metalness: 0 });
  const apron = new THREE.Mesh(new THREE.CircleGeometry(120, 64), concrete); apron.rotation.x = -Math.PI / 2; apron.position.y = 0.05; apron.receiveShadow = true; world.add(apron);
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.9 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x6d7076, roughness: 0.55, metalness: 0.7 });
  const STARSHIP = isStarship(launch);
  // pad camera azimuth (the t<28 shot): Starship's tiles are turned so that camera sees steel, tiles and both flaps
  const camAz = Math.atan2(560, 330);
  const padGroup = STARSHIP ? starshipPad(world, steel, concrete, dark, tier, camAz) : null;
  if (!STARSHIP) {
    const trench = new THREE.Mesh(new THREE.BoxGeometry(14, 0.6, 70), dark); trench.position.set(0, 0.1, -42); world.add(trench);
    const mount = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 3.2, 24), concrete); mount.position.y = -0.2; mount.castShadow = mount.receiveShadow = true; world.add(mount);
    world.add(lattice(steel, -13, 0, 9, 84));
    const arm = new THREE.Mesh(new THREE.BoxGeometry(9, 2.2, 2.2), steel); arm.position.set(-6.5, 62, 0); arm.castShadow = true; world.add(arm);
  }
  if (!STARSHIP) for (const [x, z] of [[-110, -110], [110, -110], [-110, 110], [110, 110]]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.8, 105, 8), steel); m.position.set(x, 52.5, z); m.castShadow = true; world.add(m);
  }
  const wt = new THREE.Group(); const tank = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 16), new THREE.MeshStandardMaterial({ color: 0xd7dadf, roughness: 0.5, metalness: 0.2 }));
  tank.position.y = 52; wt.add(tank); for (let i = 0; i < 4; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 50, 6), steel); l.position.set(Math.cos(i * 1.57) * 6, 25, Math.sin(i * 1.57) * 6); wt.add(l); }
  wt.position.set(-200, 0, 250); wt.traverse(o => { o.castShadow = true; }); if (!STARSHIP) world.add(wt);
  // pad flood lights (used at night)
  const floods = [];
  const rocket = STARSHIP ? makeStarship(tier, { tileAz: camAz + 1.25 }) : makeRocket(tier);
  const RK = rocket.userData, KS = RK.k, BS = RK.base;  // vehicle scale vs Falcon 9 (1 for Falcon) and engine height above the pad
  for (const [x, z] of [[140, 60], [-120, 90], [60, -150]]) { const s = new THREE.SpotLight(0xfff1dc, 0, 600 * KS, 0.35, 0.6, 2); s.position.set(x * KS, 18, z * KS); s.target.position.set(0, 35 * KS, 0); world.add(s, s.target); floods.push(s); }

  // rocket
  world.add(rocket);
  // Starship: exhaust deflected sideways by the deck / water-cooled steel plate under the launch mount
  const deflect = [];
  if (STARSHIP) for (let i = 0; i < 8; i++) {
    const a = i / 8 * 6.283 + 0.2, holder = new THREE.Group(); holder.rotation.y = a; holder.position.y = 1.2;
    const pl = makePlume({ radius: 3.2, length: 34, layers: 2 }); pl.rotation.z = Math.PI / 2; pl.position.x = 14; pl.scale.set(3.2, 34, 1.4);
    holder.add(pl); holder.visible = false; world.add(holder); deflect.push(holder);
  }
  // earth from altitude (stylized, procedural)
  const earth = makeEarth(); earth.visible = false; scene.add(earth);

  // particles
  const smoke = new Particles(T.smoke, "smoke"); world.add(smoke.mesh);
  const clouds = new Particles(T.clouds, "cloud"); world.add(clouds.mesh);
  const az = (launch._az ?? 90) * Math.PI / 180, dirH = new THREE.Vector3(Math.sin(az), 0, -Math.cos(az));
  seedClouds(clouds, launch, dirH, T.clouds);

  // ---------- inside: imagined crew cabin mounted at the top of stage 2 ----------
  const cabinMount = new THREE.Group(); cabinMount.position.y = RK.cabinY; rocket.add(cabinMount);
  const cabin = makeCabin(dirH); cabinMount.add(cabin.group); cabin.group.visible = false;
  const cabinLight = new THREE.PointLight(0xbfd8ff, 0, 6, 2); cabinLight.position.copy(cabin.lightPos); cabinMount.add(cabinLight);

  // ---------- HDRI environment (Ultra; CC0 Poly Haven) or sky-generated environment ----------
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envFromSky = null, envT = -1;
  const skyScene = new THREE.Scene(); const sky2 = new Sky(); sky2.scale.setScalar(1000); skyScene.add(sky2);
  function refreshSkyEnv(fade) {
    Object.keys(su).forEach(k => { if (sky2.material.uniforms[k]) sky2.material.uniforms[k].value = su[k].value; });
    if (envFromSky) envFromSky.dispose();
    envFromSky = pmrem.fromScene(skyScene, 0.02).texture; scene.environment = envFromSky;
  }
  let hdri = null;
  if (T.hdri) {
    const file = sunDir.y > 0.12 ? "kloofendal_43d_clear_puresky-1k.hdr" : "qwantani_dusk_2_puresky-1k.hdr";
    try { const tex = await new HDRLoader().loadAsync(assetBase + "hdri/" + file); tex.mapping = THREE.EquirectangularReflectionMapping; hdri = pmrem.fromEquirectangular(tex).texture; tex.dispose(); } catch (e) { hdri = null; }
  }

  // ---------- post-processing ----------
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: T.msaa });
  composer.addPass(new RenderPass(scene, camera));
  const lens = new LensEffect(); composer.addPass(new EffectPass(camera, lens));
  let dof = null;
  if (T.dof) { dof = new DepthOfFieldEffect(camera, { focusDistance: 300, focusRange: 400, bokehScale: 1.4, resolutionScale: 0.75 }); dof.target = new THREE.Vector3(); composer.addPass(new EffectPass(camera, dof)); }
  const bloom = new BloomEffect({ mipmapBlur: true, intensity: 0.9, luminanceThreshold: STARSHIP ? 2.5 : 1.0, luminanceSmoothing: 0.3, radius: 0.62 });
  const vign = new VignetteEffect({ darkness: 0.55, offset: 0.32 });
  const fx = [bloom, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }), vign];  // grain after tone mapping (blend modes expect LDR)
  if (T.grain) { const n = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false }); n.blendMode.opacity.value = 0.06; fx.push(n); }
  composer.addPass(new EffectPass(camera, ...fx));

  // ---------- state ----------
  const st = { exposure: 1, trauma: 0, shakePrev: new THREE.Euler(), head: new THREE.Vector3(), headV: new THREE.Vector3(), lastT: null, view: "outside",
    camPos: new THREE.Vector3(200, 20, 200), camLook: new THREE.Vector3(0, 35, 0), fov: 40, sepDone: false, fairDone: false, jolts: [], envAlt: -1e9, floatObj: cabin.tag };
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), q = new THREE.Quaternion();
  const shadowH = (dip) => dip <= 0 ? 0 : R_EARTH * (1 / Math.cos(dip) - 1);

  function resize(w, h) { renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }

  // ---------- per-frame ----------
  function frame(S, opts, dt) {
    const t = S.t, s = S;
    const reduced = !!opts.reduced, inside = opts.view === "inside";
    if (opts.date) sunDir = sunDirAt(opts.date);
    // rocket kinematics (world frame, flat-earth near the pad)
    const rp = tmp.copy(dirH).multiplyScalar(s.down).setY(s.alt);
    rocket.position.copy(rp);
    const tilt = Math.PI / 2 - s.gamma, axisK = tmp2.crossVectors(UP, dirH).normalize();
    rocket.quaternion.setFromAxisAngle(axisK, tilt);
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(rocket.quaternion);
    world.position.copy(rp).negate();
    const alt = s.alt;
    // separation & fairing
    const P = opts.profile;
    if (t >= P.sep) {
      const k = t - P.sep; RK.s1.position.set(Math.sin(k * 0.3) * 0.4 * k, -(1.2 * k + 0.9 * k * k), 0); RK.s1.rotation.set(k * 0.012, 0, k * 0.02); RK.s1.visible = k < 60;
      RK.mvac.visible = true;
    } else { RK.s1.position.set(0, 0, 0); RK.s1.rotation.set(0, 0, 0); RK.s1.visible = true; RK.mvac.visible = false; }
    const fh = RK.s2.userData.fairing;
    if (t >= P.fairing) { const k = t - P.fairing; fh.forEach((h, i) => { const sgn = i ? -1 : 1; h.position.set(sgn * (0.6 * k + 0.05 * k * k), 13.9 - 0.5 * k * k * 0.2, 0); h.rotation.set(0, i * Math.PI, sgn * -Math.min(1.4, 0.25 * k)); h.visible = k < 40; }); }
    else fh.forEach((h, i) => { h.position.set(0, 13.9, 0); h.rotation.set(0, i * Math.PI, 0); h.visible = true; });
    fh.forEach(h => { if (inside) h.visible = false; }); if (RK.s2.userData.fairBase) RK.s2.userData.fairBase.visible = !inside || t >= P.fairing;
    // plumes
    const pressure = Math.exp(-alt / 7400);
    const ptime = performance.now() / 1000;
    const flick = 0.92 + 0.08 * Math.sin(ptime * 37) * Math.sin(ptime * 23.7);
    const shH = shadowH(Math.max(0, -Math.asin(Math.max(-1, Math.min(1, sunDir.y)))));
    const sunlitHigh = sunDir.y > 0 ? 1 : smooth(shH - 8000, shH + 8000, alt);
    for (const [pl, th] of [[RK.p1, s.thrust1], [RK.p2, s.thrust2]]) {
      pl.visible = th > 0.001 && (pl === RK.p2 || RK.s1.visible); const u = pl.userData.u;
      u.uTime.value = ptime; u.uThrust.value = th * flick; u.uPressure.value = pl === RK.p2 ? Math.min(pressure, 0.02) : pressure; u.uSunlit.value = sunlitHigh;
    }
    RK.p1.scale.set(RK.pR, RK.pL * (0.35 + 0.65 * Math.min(1, s.thrust1)), RK.pR);
    RK.glare.visible = s.thrust1 > 0.01 && RK.s1.visible; RK.glare.material.opacity = Math.min(1, s.thrust1) * flick; const gs = (7 + 7 * s.thrust1 * (1 + (1 - pressure) * 1.5)) * RK.glareK; RK.glare.scale.set(gs, gs, 1);
    if (RK.bellMats.length > 1) { const eg = opts.sf && opts.sf.groups; RK.bellMats.forEach((m, i) => { m.emissiveIntensity = (eg ? eg[i] : s.thrust1) * 2.5; }); } else RK.bellMat.emissiveIntensity = s.thrust1 * 2.5;
    if (deflect.length) { const dk = s.thrust1 * (1 - smooth(BS * 0.6, BS * 3.5, alt)) * flick; deflect.forEach((d, i) => { d.visible = dk > 0.01; const u = d.children[0].userData.u; u.uTime.value = ptime + i * 1.7; u.uThrust.value = dk * 0.8; u.uPressure.value = 1; d.children[0].scale.set(3.2, 34 * (0.4 + 0.6 * dk) * (1 + 0.12 * Math.sin(ptime * 3 + i * 2)), 1.6); }); } RK.mvac.material.emissiveIntensity = s.thrust2 * 3.0;
    // lights: sun, sky, floods, flame
    const day = smooth(-0.1, 0.08, sunDir.y);
    const skyFade = 1 - smooth(14000, 70000, alt);
    su.sunPosition.value.copy(sunDir); sky.material.uniforms.uSkyFade.value = 0.08 + 0.92 * skyFade;
    sky.position.copy(camera.getWorldPosition(new THREE.Vector3())); stars.position.copy(sky.position);
    { const R = alt > 15000 || t > P.fairing ? 1.6e7 : 100000; sky.scale.setScalar(R); stars.scale.setScalar(R / 90000); }
    stars.material.opacity = Math.max(0, 1 - day * 1.6 * skyFade - 0.15) ;
    const sunVis = Math.max(smooth(-0.03, 0.06, sunDir.y), sunlitHigh * (alt > 20000 ? 1 : 0));
    sun.intensity = 3.4 * sunVis; sun.color.setHSL(0.08, 0.6 * (1 - smooth(0.05, 0.4, sunDir.y)), 0.5 + 0.5 * smooth(0, 0.4, sunDir.y));
    sun.position.copy(sunDir).multiplyScalar(400); sun.target.position.set(0, 0, 0);
    if (inside) { sun.shadow.camera.left = sun.shadow.camera.bottom = -4; sun.shadow.camera.right = sun.shadow.camera.top = 4; }
    else { const e = (alt < 300 ? 90 : 60) * KS; sun.shadow.camera.left = sun.shadow.camera.bottom = -e; sun.shadow.camera.right = sun.shadow.camera.top = e; }
    sun.shadow.camera.updateProjectionMatrix();
    hemi.intensity = (0.05 + 0.6 * day) * skyFade + 0.02 + 0.06 * (1 - skyFade);
    floods.forEach(f => f.intensity = (1 - day) * 9000 * (alt < 2000 ? 1 : 0));
    const fl = Math.max(s.thrust1, s.thrust2 * 0.4) * flick;
    flame.intensity = inside ? 0 : fl * 30000 * RK.flameK; flame.position.copy(axis).multiplyScalar(BS - 14 * KS);
    flameFill.intensity = inside ? 0 : fl * 2600 * RK.flameK; flameFill.position.copy(axis).multiplyScalar(BS - 6 * KS).addScaledVector(axisK, 9 * KS);
    // environment
    const envTarget = (0.06 + 0.94 * day) * (0.1 + 0.9 * skyFade);
    if (hdri) { scene.environment = hdri; scene.environmentIntensity = envTarget * 0.9; }
    else { if (!envFromSky || Math.abs(alt - st.envAlt) > 6000) { st.envAlt = alt; refreshSkyEnv(); } scene.environmentIntensity = envTarget * 1.2; }
    // fog / ground fade / earth
    const horizon = new THREE.Color().setHSL(0.6, 0.35, 0.08 + 0.5 * day);
    if (sunDir.y < 0.15 && sunDir.y > -0.2) horizon.lerp(new THREE.Color(0.85, 0.45, 0.25), 0.35 * (1 - Math.abs(sunDir.y) / 0.2));
    scene.fog.color.copy(horizon).multiplyScalar(skyFade * 0.55); scene.fog.density = (1 / 60000) * Math.exp(-alt / 6000) + 1 / 2e6;
    ground.visible = alt < 60000; world.children.forEach(c => { if (c !== rocket && c !== smoke.mesh && c !== clouds.mesh) c.visible = alt < 60000; });
    earth.visible = alt > 9000; earth.position.set(0, -(R_EARTH + alt) - 40, 0);
    earth.userData.u.uSun.value.copy(sunDir); earth.userData.u.uFade.value = smooth(9000, 40000, alt);
    // particles
    const nozzleW = new THREE.Vector3().copy(axis).multiplyScalar(BS - 2 * KS).add(rp); // world
    smokeEmit(smoke, s, dt, nozzleW, axis, pressure, T.smoke, t, RK, opts.sf);
    for (const p of [smoke, clouds]) {
      p.u.uTime.value = ptime; p.u.uSunDir.value.copy(sunDir); p.u.uSunCol.value.copy(sun.color).multiplyScalar(sunVis * 1.6);
      p.u.uSky.value.setRGB(0.05 + 0.35 * day, 0.06 + 0.4 * day, 0.08 + 0.48 * day).multiplyScalar(skyFade).addScalar((1 - day) * (p === clouds ? 0.006 : 0.014));
      p.u.uFlamePos.value.copy(nozzleW).addScaledVector(axis, -20 * KS); p.u.uFlame.value = fl * (p === clouds ? 1.6 : 4.0) * (1 + 0.8 * (1 - day));
      p.u.uVis.value = p === clouds ? 0.2 + 0.8 * day + Math.min(1, fl) * 0.5 : 1; p.u.uSunlitAlt.value = sunDir.y > 0 ? -1e9 : shH; p.u.uLitBase.value = sunDir.y > 0 ? 0 : 1.4;
    }
    const camW = camera.getWorldPosition(new THREE.Vector3()).sub(world.position);
    smoke.update(dt, opts.wind || new THREE.Vector3(2, 0, 1), camW); clouds.update(dt, null, camW);

    // ---------- camera director ----------
    const side = new THREE.Vector3().crossVectors(axis, axisK).normalize(); // perpendicular to plane of flight
    let pos = new THREE.Vector3(), look = new THREE.Vector3(), fov = 40;
    cabin.group.visible = inside; cabinLight.intensity = inside ? 1.2 : 0;
    const motion = !reduced;
    const K = reduced ? 0 : Math.max(0, Math.min(1, opts.shake ?? 0.5)) * 2; // user Shake slider: 0 off, 1 = medium (default), 2 = max
    // G-force + shake "trauma"
    const g = s.g || 0, q = s.q || 0, th = Math.max(s.thrust1, s.thrust2);
    if (!inside) {
      const W = (v) => v.clone().add(world.position); // world -> scene
      const sf = opts.sf;
      if (sf && sf.cam === "close") { pos.copy(W(new THREE.Vector3(560 * 0.8, 3, 330 * 0.8))); look.copy(W(new THREE.Vector3(0, BS + 58, 0))); fov = 30; }
      else if (t < -15 && !sf) { const a = ptime * 0.03; pos.copy(W(new THREE.Vector3(Math.cos(a) * 230 * KS, 24 + 6 * Math.sin(ptime * 0.05), Math.sin(a) * 230 * KS))); look.copy(W(new THREE.Vector3(0, 38 * KS, 0))); fov = 42; }
      else if (t < 28 || sf) { pos.copy(W(new THREE.Vector3(560 * KS, 4, 330 * KS))); const tgt = rp.clone().addScaledVector(axis, (t < 0 || sf ? 34 : 28) * KS); look.copy(W(tgt)); const dist = pos.distanceTo(W(tgt)); fov = THREE.MathUtils.clamp(17 * 650 * KS / Math.max(650 * KS, dist), 5, 17); }
      else if (t < P.maxq + 25) { // long-range tracking camera on the ground (telephoto)
        const camW = new THREE.Vector3().copy(dirH).multiplyScalar(-1800).addScaledVector(axisK, 4200).setY(12);
        pos.copy(W(camW)); look.copy(axis).multiplyScalar(BS - 20 * KS); const dist = pos.length(); fov = THREE.MathUtils.clamp(2 * Math.atan(170 * KS / dist) * 57.3, 1.2, 30); }
      else if (t < P.sep - 4) { pos.copy(axisK).multiplyScalar(-78 * KS).addScaledVector(axis, BS - 10 * KS).addScaledVector(side, 18 * KS); look.copy(axis).multiplyScalar(BS - 14 * KS); fov = 46; }
      else if (t < P.sep + 22) { pos.copy(axisK).multiplyScalar(62 * KS).addScaledVector(axis, BS - 6 * KS).addScaledVector(side, 14 * KS); look.copy(axis).multiplyScalar(BS - 14 * KS); fov = 50; }
      else if (t < P.fairing + 15) { pos.copy(axisK).multiplyScalar(-46 * KS).addScaledVector(axis, BS + 8 * KS).addScaledVector(side, 10 * KS); look.copy(axis).multiplyScalar(BS + 4 * KS); fov = 52; }
      else { const k = Math.min(1, (t - P.fairing - 15) / 80), d = (70 + 220 * k) * KS, a = ptime * 0.015; pos.copy(side).multiplyScalar(Math.cos(a) * d * 0.7).addScaledVector(axisK, -d * 0.5).addScaledVector(UP, d * 0.45).addScaledVector(axis, -d * 0.2); look.set(0, -d * 0.35, 0); fov = 58; }
      // smooth blend between shots (or cut when reduced motion)
      const cut = st.camPos.distanceTo(pos) > 400 * KS || !motion || (t >= 28 && t < P.maxq + 25 && !opts.sf);
      const kk = cut ? 1 : 1 - Math.exp(-dt * 2.2);
      if ((t >= 0 && t < 28) || opts.sf) { st.camPos.copy(pos); st.camLook.copy(look); } else { st.camPos.lerp(pos, kk); st.camLook.lerp(look, kk); }
      st.fov += (fov - st.fov) * (cut ? 1 : 1 - Math.exp(-dt * 2.0));
      rig.position.copy(st.camPos); aim(rig, st.camLook, UP);
      // shake: thrust & Max-Q; at the pad camera the shock arrives with the sound (~0.9 s at 300 m)
      const padCam = (t > -15 && t < 28) || !!opts.sf, arrival = padCam ? 0.9 * Math.sqrt(KS) : 0;
      const tr = th * (padCam ? Math.max(0, Math.min(1, (t + 3 - arrival) / 1.2)) * (t < 6 ? 1.0 : Math.max(0.15, 1 - (t - 6) / 22)) : 0.12 + 0.35 * q);
      st.trauma += (tr - st.trauma) * Math.min(1, dt * 6);
    } else {
      // inside: cabin follows rocket; head on a spring (window parallax), pressed back by g
      const target = new THREE.Vector3(0, -0.06 * Math.max(0, g - 1) * K, 0);
      const kSpring = 60, damp = 9;
      const steps = Math.max(1, Math.ceil(dt / 0.008)), h = dt / steps;
      for (let i = 0; i < steps; i++) { const acc = target.clone().sub(st.head).multiplyScalar(kSpring).addScaledVector(st.headV, -damp); st.headV.addScaledVector(acc, h); st.head.addScaledVector(st.headV, h); }
      if (!isFinite(st.head.y)) { st.head.set(0, 0, 0); st.headV.set(0, 0, 0); }
      if (g < 0.05 && t > 0) st.head.y += Math.sin(ptime * 0.7) * 0.0006; // float
      const eye = cabin.eye.clone().add(st.head);
      cabinMount.updateWorldMatrix(true, false);
      const eyeW = cabinMount.localToWorld(eye.clone()), lookW = cabinMount.localToWorld(cabin.eye.clone().add(cabin.lookDir).add(new THREE.Vector3(0, st.head.y * 0.5, 0)));
      rig.position.copy(eyeW).add(world.position.clone().sub(world.position)); // scene coords (world already offset)
      rig.position.copy(eyeW); aim(rig, lookW, axis);
      st.fov = 82 - 4 * Math.min(1.5, K) * Math.max(0, Math.min(3, g - 1));
      const tr = th * (0.32 + 0.55 * q + 0.08 * g);
      st.trauma += (tr - st.trauma) * Math.min(1, dt * 8);
      // cabin vibration (shell jitters, head lags = parallax)
      const a = st.trauma * st.trauma * 0.012 * K;
      cabin.group.position.set((Math.sin(ptime * 71) + Math.sin(ptime * 113)) * a, (Math.sin(ptime * 89) + Math.sin(ptime * 57)) * a, (Math.sin(ptime * 97)) * a);
      // tethered tag: hangs "down" (toward the seat) under thrust, floats in the coast
      const tag = cabin.tag; const floatK = g < 0.05 && t > 0 ? 1 : 0;
      tag.rotation.z += ((floatK ? Math.sin(ptime * 0.6) * 1.2 : 0) - tag.rotation.z) * Math.min(1, dt * (floatK ? 0.8 : 6));
      tag.rotation.x += ((floatK ? Math.cos(ptime * 0.45) * 0.9 : 0.15 * Math.sin(ptime * 9) * st.trauma) - tag.rotation.x) * Math.min(1, dt * (floatK ? 0.8 : 6));
      cabin.updateScreens(s, ptime);
    }
    // MECO / staging jolt (inside: strong; outside: light)
    for (const ev of [P.meco, P.ses]) {
      if (st.lastT != null && st.lastT < ev && t >= ev) { st.jolts.push({ at: ptime }); if (inside && K > 0) st.headV.y += (ev === P.meco ? 0.9 : -0.7) * Math.min(1.5, K); st.trauma = Math.min(1.2, st.trauma + (inside ? 0.7 : 0.35)); }
    }
    st.lastT = t;
    const shakeAmp = st.trauma * st.trauma * K;
    const sh = new THREE.Euler((Math.sin(ptime * 31.3) * 0.6 + Math.sin(ptime * 53.1) * 0.4) * shakeAmp * (inside ? 0.008 : 0.012),
      (Math.sin(ptime * 27.7) * 0.6 + Math.sin(ptime * 61.7) * 0.4) * shakeAmp * (inside ? 0.008 : 0.012), Math.sin(ptime * 19.1) * shakeAmp * 0.006);
    camera.rotation.copy(sh);
    camera.position.set(Math.sin(ptime * 43.1) * shakeAmp * 0.06, Math.sin(ptime * 37.9) * shakeAmp * 0.06, 0);
    // motion blur vector from shake angular velocity
    const dx = (sh.y - st.shakePrev.y) / Math.max(1e-3, dt), dy = (sh.x - st.shakePrev.x) / Math.max(1e-3, dt);
    st.shakePrev.copy(sh);
    lens.uniforms.get("uBlur").value.set(-dx, dy).multiplyScalar(0.0035).clampLength(0, 0.012);
    camera.fov = st.fov; const dc = st.camPos.length() / KS;
    camera.near = inside ? 0.05 : THREE.MathUtils.clamp(dc * 0.01, 0.3, 40); camera.far = alt > 15000 || (!inside && t > P.fairing) ? 2.2e7 : 150000;
    camera.updateProjectionMatrix();
    // heat shimmer around the plume (strong near the ground)
    const np = new THREE.Vector3().copy(axis).multiplyScalar(BS - 10 * KS).project(camera);
    lens.uniforms.get("uHeatPos").value.set(np.x * 0.5 + 0.5, np.y * 0.5 + 0.5);
    lens.uniforms.get("uHeat").value = !inside && np.z < 1 ? th * (alt < 3000 ? 1 : 0.25) * (motion ? 1 : 0.3) : 0;
    lens.uniforms.get("uHeatR").value = 0.18 * (STARSHIP ? 1.4 : 1); lens.uniforms.get("uTime").value = ptime;
    lens.uniforms.get("uCA").value = (inside ? 0.0016 : 0.0008) * shakeAmp;
    lens.uniforms.get("uTunnel").value = inside ? smooth(2.4, 4.2, g) * 0.75 : smooth(3.2, 4.5, g) * 0.15;
    // eye adaptation
    const flameSeen = !inside ? fl * (t < 40 ? 1 : 0.6) : fl * 0.3;
    const expTarget = (inside ? 1.2 : 1.0) * (0.42 + 2.2 * (1 - day)) / (1 + flameSeen * (day > 0.5 ? 0.6 : 2.2)) * (alt > 40000 ? 1.25 : 1);
    st.exposure += (expTarget - st.exposure) * Math.min(1, dt * 1.2);
    lens.uniforms.get("uExposure").value = st.exposure;
    vign.darkness = 0.5 + (inside ? 0.25 : 0);
    if (dof) { dof.target.set(0, 0, 0).addScaledVector(axis, BS + 20 * KS); dof.bokehScale = inside ? 0.0 : 1.4; dof.cocMaterial.focusRange = Math.max(120, camera.position.length() * 0.9); }
    composer.render(dt);
    return { jolt: st.jolts.length ? st.jolts.splice(0).length : 0, trauma: st.trauma };
  }
  function dispose() { renderer.setAnimationLoop(null); composer.dispose(); renderer.dispose(); pmrem.dispose(); }
  return { renderer, scene, camera, rig, frame, resize, dispose, tier, vehicle: RK.kind };
}

const _m4 = new THREE.Matrix4();
function aim(obj, target, up) { _m4.lookAt(obj.position, target, up); obj.quaternion.setFromRotationMatrix(_m4); }

function lattice(mat, x0, z0, w, h) {
  const g = new THREE.Group(), box = new THREE.BoxGeometry(1, 1, 1), parts = [];
  const add = (x, y, z, sx, sy, sz, rx = 0, rz = 0) => parts.push({ x, y, z, sx, sy, sz, rx, rz });
  for (const [cx, cz] of [[0, 0], [w, 0], [0, w], [w, w]]) add(cx, h / 2, cz, 0.7, h, 0.7);
  for (let y = 0; y < h; y += 6) {
    add(w / 2, y, 0, w, 0.35, 0.35); add(w / 2, y, w, w, 0.35, 0.35); add(0, y, w / 2, 0.35, 0.35, w); add(w, y, w / 2, 0.35, 0.35, w);
    const dl = Math.hypot(w, 6), ang = Math.atan2(6, w);
    add(w / 2, y + 3, 0, dl, 0.25, 0.25, 0, ang); add(w / 2, y + 3, w, dl, 0.25, 0.25, 0, -ang);
  }
  const im = new THREE.InstancedMesh(box, mat, parts.length); const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler();
  parts.forEach((p, i) => { qq.setFromEuler(e.set(p.rx, 0, p.rz)); m.compose(new THREE.Vector3(p.x, p.y, p.z), qq, new THREE.Vector3(p.sx, p.sy, p.sz)); im.setMatrixAt(i, m); });
  im.castShadow = im.receiveShadow = true; g.add(im); g.position.set(x0 - w / 2, 0, z0 - w / 2); return g;
}

function nearestCoast(region, lat, lon) {
  if (!region || !region.lines) return null;
  let best = null; const kx = 111320 * Math.cos(lat * Math.PI / 180), kz = 110540;
  for (const ln of region.lines) for (const [x, y] of ln) {
    const dx = (x - lon) * kx, dz = -(y - lat) * kz, d = Math.hypot(dx, dz);
    if (!best || d < best.d) best = { d, x: dx, z: dz };
  }
  if (!best) return null;
  // which side is water? sample the coast tangent; ocean is the side away from the pad
  return best;
}

function seedClouds(clouds, launch, dirH, max) {
  const m = launch.metar, layers = (m && m.clouds && m.clouds.length ? m.clouds : [{ cover: "FEW", base: 4500 }]).slice(0, 3);
  const per = Math.floor(max / layers.length);
  for (const L of layers) {
    const base = (L.base || 4000) * 0.3048, n = Math.round(per * ({ FEW: 0.35, SCT: 0.6, BKN: 0.85, OVC: 1 }[L.cover] ?? 0.5));
    for (let i = 0; i < n; i++) {
      const onPath = i < n * 0.25;
      const r = onPath ? rnd(0, 2500) : rnd(1500, 26000), a = rnd(0, Math.PI * 2);
      const p = onPath ? dirH.clone().multiplyScalar(base * 0.25 + rnd(-300, 900)).add(new THREE.Vector3(rnd(-500, 500), 0, rnd(-500, 500))) : new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
      clouds.spawn(p.x, base + rnd(0, 260), p.z, 0, 0, 0, 1e9, rnd(350, 900), 0, rnd(0.55, 0.9));
    }
  }
}

function smokeEmit(smoke, s, dt, nozzleW, axis, pressure, budget, t, RK, sf) {
  const th1 = s.thrust1, alt = s.alt;
  const rate = budget / 6;
  if (RK.kind === "starship") return starshipSmoke(smoke, s, dt, nozzleW, axis, pressure, budget, t, RK, sf);
  // pad: flame trench exhaust + deluge steam while the rocket is near the pad
  if (th1 > 0 && alt < 350) {
    const k = th1 * (1 - alt / 350), n = Math.round(rate * k * dt * 1.6 + Math.random());
    for (let i = 0; i < n; i++) {
      if (Math.random() < 0.6) smoke.spawn(rnd(-6, 6), rnd(1, 4), -60 + rnd(-4, 4), rnd(-16, 16), rnd(3, 16), -rnd(28, 75), rnd(16, 30), rnd(9, 15), rnd(7, 12), 0.6, 0.5);
      else { const a = rnd(0, 6.283), v = rnd(14, 34); smoke.spawn(Math.cos(a) * 7, rnd(1, 5), Math.sin(a) * 7, Math.cos(a) * v, rnd(1, 7), Math.sin(a) * v, rnd(14, 26), rnd(7, 11), rnd(5, 9), 0.55, 0.25); }
    }
  }
  // ascent exhaust trail (thins out with altitude)
  if (th1 > 0 && alt > 20 && alt < 48000) {
    const n = Math.round(rate * 0.35 * dt + Math.random());
    for (let i = 0; i < n; i++) {
      const back = rnd(10, 60), p = nozzleW.clone().addScaledVector(axis, -back);
      smoke.spawn(p.x + rnd(-2, 2), p.y, p.z + rnd(-2, 2), rnd(-1, 1), rnd(-1, 1), rnd(-1, 1), rnd(40, 80), 6 + alt * 0.0012, 4 + alt * 0.0011, 0.55 * Math.max(0.25, pressure), 0.2);
    }
  }
  // pre-launch LOX venting
  if (t < -3 && t > -3600 && Math.random() < dt * 8) smoke.spawn(rnd(-2, 2), 47 + rnd(0, 2), rnd(-2, 2), rnd(-2, 2), rnd(-2.5, -0.5), rnd(-2, 2), rnd(5, 9), 1.2, 2.2, 0.5, 0);
}

function makeEarth() {
  const u = { uSun: { value: new THREE.Vector3(0, 1, 0) }, uFade: { value: 0 } };
  const m = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: true, fog: false,
    vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(position); vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform vec3 uSun; uniform float uFade; varying vec3 vN; varying vec3 vW; ${NOISE}
      void main(){ vec3 n = normalize(vN); float day = smoothstep(-0.08, 0.25, dot(n, uSun));
        float land = smoothstep(0.52, 0.56, fbm(n*7.0+3.0)); float cl = smoothstep(0.5, 0.75, fbm(n*24.0+vec3(1.3)));
        vec3 ocean = vec3(0.02,0.07,0.16), ground = mix(vec3(0.09,0.12,0.06), vec3(0.22,0.19,0.12), fbm(n*40.0));
        vec3 c = mix(ocean, ground, land); c = mix(c, vec3(0.85), cl*0.85);
        vec3 V = normalize(cameraPosition - vW); vec3 H = normalize(V + uSun);
        float spec = pow(max(dot(n,H),0.0), 120.0) * (1.0-land) * (1.0-cl) * 2.0;
        float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
        float term = exp(-pow(dot(n, uSun) / 0.12, 2.0));
        vec3 col = c * (0.012 + 1.4*day) + spec*day + vec3(0.25,0.45,1.0)*rim*(0.06+1.2*day) + vec3(0.9,0.4,0.15)*term*rim*0.6 + vec3(0.6,0.3,0.12)*term*0.05;
        gl_FragColor = vec4(col, uFade); }` });
  const e = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH, 192, 96), m); e.renderOrder = -1; e.userData.u = u; return e;
}

function makeCabin(dirH) {
  const g = new THREE.Group();
  const panel = new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.75, metalness: 0.2 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x8a9099, roughness: 0.35, metalness: 0.85 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.95 });
  // cabin local frame: y = rocket axis; window faces downrange (dirH), tilted up
  const fwd = dirH.clone().normalize(), right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const basis = new THREE.Matrix4().makeBasis(right, new THREE.Vector3(0, 1, 0), fwd.clone().negate());
  const inner = new THREE.Group(); inner.quaternion.setFromRotationMatrix(basis); g.add(inner);
  // walls: a box room with a window cut-out on the front (-z local)
  const W = 2.6, H = 2.2, D = 2.4, ww = 1.35, wh = 0.95, wy = 0.3;
  const wall = (w, h, x, y, z, ry = 0, rx = 0, mat = panel) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); m.castShadow = m.receiveShadow = true; inner.add(m); return m; };
  const fz = -D / 2;
  wall(W, (H / 2 - (wy + wh / 2)), 0, (H / 2 + wy + wh / 2) / 2, fz);                 // above window
  wall(W, (H / 2 + wy - wh / 2), 0, (-H / 2 + wy - wh / 2) / 2, fz);                 // below
  wall((W - ww) / 2, wh, -(ww / 2 + (W - ww) / 4), wy, fz); wall((W - ww) / 2, wh, (ww / 2 + (W - ww) / 4), wy, fz);
  wall(D, H, -W / 2, 0, 0, Math.PI / 2); wall(D, H, W / 2, 0, 0, Math.PI / 2); wall(W, H, 0, 0, D / 2);
  wall(W, D, 0, H / 2, 0, 0, Math.PI / 2); wall(W, D, 0, -H / 2, 0, 0, Math.PI / 2);
  // window frame + glass
  const rr = (w, h, r) => { const sh = new THREE.Shape(); const x = -w / 2, y = -h / 2; sh.moveTo(x + r, y); sh.lineTo(x + w - r, y); sh.quadraticCurveTo(x + w, y, x + w, y + r); sh.lineTo(x + w, y + h - r); sh.quadraticCurveTo(x + w, y + h, x + w - r, y + h); sh.lineTo(x + r, y + h); sh.quadraticCurveTo(x, y + h, x, y + h - r); sh.lineTo(x, y + r); sh.quadraticCurveTo(x, y, x + r, y); return sh; };
  const frS = rr(ww + 0.16, wh + 0.16, 0.16); frS.holes.push(rr(ww - 0.04, wh - 0.04, 0.12));
  const fr = new THREE.Mesh(new THREE.ExtrudeGeometry(frS, { depth: 0.09, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 8 }), trim);
  fr.position.set(0, wy, fz - 0.02); fr.castShadow = true; inner.add(fr);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), new THREE.MeshStandardMaterial({ color: 0x99aabb, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.07, depthWrite: false }));
  glass.position.set(0, wy, fz + 0.01); inner.add(glass);
  // console + screens (canvas textures, SIMULATED numbers)
  const desk = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.6), panel); desk.position.set(0, -0.32, fz + 0.4); desk.rotation.x = 0.5; inner.add(desk);
  const cvs = document.createElement("canvas"); cvs.width = 512; cvs.height = 160; const ctx = cvs.getContext("2d");
  const stex = new THREE.CanvasTexture(cvs); stex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.47), new THREE.MeshBasicMaterial({ map: stex, toneMapped: false }));
  screen.position.set(0, -0.28, fz + 0.38); screen.rotation.x = -1.07; inner.add(screen);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.18), cloth); seat.position.set(0, 0.0, 0.95); inner.add(seat);
  // tethered tag (shows g: hangs under thrust, floats in the coast)
  const tagPivot = new THREE.Group(); tagPivot.position.set(0.55, 0.85, fz + 0.45); inner.add(tagPivot);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.28, 4), cloth); cord.position.y = -0.14; tagPivot.add(cord);
  const tagM = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.012), new THREE.MeshStandardMaterial({ color: 0xff6b2c, roughness: 0.6 })); tagM.position.y = -0.3; tagPivot.add(tagM);
  let last = 0;
  function updateScreens(s, now) {
    if (now - last < 0.25) return; last = now;
    ctx.fillStyle = "#03080d"; ctx.fillRect(0, 0, 512, 160); ctx.font = "bold 22px monospace"; ctx.fillStyle = "#38bdf8";
    ctx.fillText("ALT", 18, 34); ctx.fillText("VEL", 190, 34); ctx.fillText("G", 370, 34);
    ctx.fillStyle = "#e6f1ff"; ctx.font = "bold 40px monospace";
    ctx.fillText((s.alt / 1000).toFixed(1), 18, 90); ctx.fillText(Math.round(s.vel * 3.6).toLocaleString("en-US"), 190, 90); ctx.fillText((s.g || 0).toFixed(1), 370, 90);
    ctx.font = "16px monospace"; ctx.fillStyle = "#94a3b8"; ctx.fillText("km", 18, 116); ctx.fillText("km/h", 190, 116); ctx.fillText("g", 370, 116);
    ctx.fillStyle = "#fbbf24"; ctx.fillText("SIMULATED - not live telemetry", 18, 148); stex.needsUpdate = true;
  }
  const eye = new THREE.Vector3(0, 0.2, 0.75).applyQuaternion(inner.quaternion);
  const lookDir = new THREE.Vector3(0, -0.12, -1).applyQuaternion(inner.quaternion);
  return { group: g, eye, lookDir, tag: tagPivot, updateScreens, lightPos: new THREE.Vector3(0, 0.9, 0.2).applyQuaternion(inner.quaternion) };
}

// ---------- Starship pad: tapered concrete orbital launch mount (OLM) + steel table, Mechazilla tower, tank farm ----------
function starshipPad(world, steel, concrete, dark, tier, camAz = 0) {
  const g = new THREE.Group(), ZB = 18, R = 5.2, H0 = ZB - 3.4;
  const sh = o => { o.castShadow = o.receiveShadow = true; return o; };
  const crete = new THREE.MeshStandardMaterial({ color: 0xd2ccc0, roughness: 0.85, metalness: 0.0 });
  // OLM pedestal: square frustum with sloped sides (half-width 19 m at the ground, 10.5 m on top)
  const ped = sh(new THREE.Mesh(new THREE.CylinderGeometry(10.5 * Math.SQRT2, 19 * Math.SQRT2, H0, 4, 1), crete)); ped.geometry.rotateY(Math.PI / 4); ped.position.y = H0 / 2; g.add(ped);
  const cap = sh(new THREE.Mesh(new THREE.BoxGeometry(22, 0.8, 22), crete)); cap.position.y = H0 + 0.4; g.add(cap);
  for (let i = 0; i < 4; i++) {                                                     // exhaust / service openings at the foot of each face
    const a = i * Math.PI / 2, o = new THREE.Mesh(new THREE.BoxGeometry(9, 5.5, 4), dark); o.position.set(Math.cos(a) * 17.6, 2.75, Math.sin(a) * 17.6); o.rotation.y = -a; g.add(o);
    const ser = sh(new THREE.Mesh(new THREE.BoxGeometry(2.2, 3, 5), crete)); ser.position.set(Math.cos(a + 0.6) * 21, 1.5, Math.sin(a + 0.6) * 21); ser.rotation.y = -a; g.add(ser);
  }
  // steel table ring the booster sits on + 20 hold-down clamps
  const ringPts = [[R + 0.4, 0], [11.5, 0], [11.5, 1.2], [9.5, 3.4], [R + 0.4, 3.4], [R + 0.4, 0]].map(([x, y]) => new THREE.Vector2(x, y));
  const table = sh(new THREE.Mesh(new THREE.LatheGeometry(ringPts, 48), steel)); table.position.y = ZB - 3.4 + 0.8; g.add(table);
  for (let i = 0; i < 20; i++) { const a = i / 20 * 6.283, c = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.6, 0.9), dark); c.position.set(Math.cos(a) * (R + 0.45), ZB + 0.4, Math.sin(a) * (R + 0.45)); g.add(c); }
  // Mechazilla: dense square lattice tower (~150 m), chopsticks parked at the booster top, ship QD arm, top structure
  const TX = -31, TW = 15, TH = 150, tg = new THREE.Group(); tg.rotation.y = camAz - 0.2; g.add(tg);   // tower sits to the left of the pad camera, like the classic Starbase view
  const gAdd = g.add.bind(g); g.add = (...o) => tg.add(...o);
  const tsteel = new THREE.MeshStandardMaterial({ color: 0x3e4146, roughness: 0.75, metalness: 0.3 }); steel = tsteel;
  g.add(megaTower(tsteel, TX, 0, TW, TH));
  const top = sh(new THREE.Mesh(new THREE.BoxGeometry(TW + 3, 7, TW + 3), steel)); top.position.set(TX, TH + 3.5, 0); g.add(top);
  const mast = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 14, 6), steel)); mast.position.set(TX - 3, TH + 14, 2); g.add(mast);
  const yc = 92, carriage = sh(new THREE.Mesh(new THREE.BoxGeometry(5, 12, TW + 4), steel)); carriage.position.set(TX + TW / 2 + 2, yc, 0); g.add(carriage);
  for (const sz of [-1, 1]) {                                                        // chopsticks: deep truss arms reaching past the booster
    const x0 = TX + TW / 2 + 3.5, z0 = sz * 4.2, x1 = 3, z1 = sz * (R + 3.4), len = Math.hypot(x1 - x0, z1 - z0);
    const arm = truss(steel, len, 4.2, 1.8); arm.position.set(x0, yc, z0); arm.rotation.y = -Math.atan2(z1 - z0, x1 - x0); g.add(arm);
  }
  // ship quick-disconnect arm near the top, with the big diagonal truss above it
  const yq = ZB + 69.8 + 1.8 + 22;
  const qd = truss(steel, 22, 3.2, 2.2); qd.position.set(TX + TW / 2, yq, 0); qd.rotation.y = -0.18; g.add(qd);
  const brace = truss(steel, 26, 3.0, 2.0); brace.position.set(TX + TW / 2, yq + 3, 0); brace.rotation.set(0, -0.12, 0.62); g.add(brace);
  const qdh = sh(new THREE.Mesh(new THREE.BoxGeometry(3.4, 4.5, 4.5), steel)); qdh.position.set(-(R + 1.2), yq - 1, -2.6); g.add(qdh);
  g.add = gAdd;
  // tank farm: white vertical cryo tanks + low buildings off to the side
  const tmat = new THREE.MeshStandardMaterial({ color: 0xe6e8eb, roughness: 0.4, metalness: 0.25 });
  for (let i = 0; i < 7; i++) { const h = i % 3 === 0 ? 34 : 26, t = sh(new THREE.Mesh(new THREE.CylinderGeometry(4, 4, h, 24), tmat)); t.position.set(-120 + i * 10.5 + (i > 3 ? 14 : 0), h / 2, -120 - (i % 2) * 9); g.add(t); }
  for (let i = 0; i < 3; i++) { const t = sh(new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 22, 20), tmat)); t.position.set(70 + i * 9, 11, -150); g.add(t); }
  const bmat = new THREE.MeshStandardMaterial({ color: 0xbfc2c4, roughness: 0.8, metalness: 0.1 });
  for (const [x, z, w, h, d] of [[-85, -60, 30, 7, 16], [-60, -95, 24, 10, 12], [55, -95, 34, 8, 18], [95, -60, 18, 6, 14], [-140, -40, 20, 5, 30]]) {
    const b = sh(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bmat)); b.position.set(x, h / 2, z); g.add(b);
  }
  world.add(g); return g;
}
// box truss (length along +x from the origin): top/bottom chords on two faces + zig-zag web
function truss(mat, len, h, d) {
  const g = new THREE.Group(), parts = [];
  for (const y of [h / 2, -h / 2]) for (const z of [d / 2, -d / 2]) parts.push([len / 2, y, z, len, 0.8, 0.8, 0, 0]);
  const n = Math.max(2, Math.round(len / h)), sx = len / n, dl = Math.hypot(sx, h), ang = Math.atan2(h, sx);
  for (let i = 0; i < n; i++) for (const z of [d / 2, -d / 2]) { parts.push([i * sx + sx / 2, 0, z, dl, 0.45, 0.45, 0, (i & 1 ? 1 : -1) * ang]); parts.push([i * sx, 0, z, 0.45, h, 0.45, 0, 0]); }
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, parts.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  parts.forEach((p, i) => { q.setFromEuler(e.set(0, 0, p[7])); m.compose(new THREE.Vector3(p[0], p[1], p[2]), q, new THREE.Vector3(p[3], p[4], p[5])); im.setMatrixAt(i, m); });
  im.castShadow = im.receiveShadow = true; g.add(im); return g;
}
// Starbase-style tower: heavy corner columns, chords every 4 m and X-bracing on all four faces, an inner core
function megaTower(mat, x0, z0, w, h) {
  const g = new THREE.Group(), parts = [], st = 3.75;
  const add = (x, y, z, sx, sy, sz, rx = 0, rz = 0, ry = 0) => parts.push({ x, y, z, sx, sy, sz, rx, rz, ry });
  for (const [cx, cz] of [[0, 0], [w, 0], [0, w], [w, w]]) add(cx, h / 2, cz, 2.0, h, 2.0);
  for (const [cx, cz] of [[w * 0.3, w * 0.3], [w * 0.7, w * 0.3], [w * 0.3, w * 0.7], [w * 0.7, w * 0.7]]) add(cx, h / 2, cz, 0.6, h, 0.6);
  const dl = Math.hypot(w, st), ang = Math.atan2(st, w);
  for (let y = 0; y < h; y += st) {
    add(w / 2, y, 0, w, 0.7, 0.7); add(w / 2, y, w, w, 0.7, 0.7); add(0, y, w / 2, 0.7, 0.7, w); add(w, y, w / 2, 0.7, 0.7, w);
    for (const s of [1, -1]) {
      add(w / 2, y + st / 2, 0, dl, 0.45, 0.45, 0, s * ang); add(w / 2, y + st / 2, w, dl, 0.45, 0.45, 0, s * ang);
      add(0, y + st / 2, w / 2, dl, 0.45, 0.45, 0, s * ang, Math.PI / 2); add(w, y + st / 2, w / 2, dl, 0.45, 0.45, 0, s * ang, Math.PI / 2);
    }
  }
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, parts.length); const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, "YXZ");
  parts.forEach((p, i) => { qq.setFromEuler(e.set(p.rx, p.ry, p.rz)); m.compose(new THREE.Vector3(p.x, p.y, p.z), qq, new THREE.Vector3(p.sx, p.sy, p.sz)); im.setMatrixAt(i, m); });
  im.castShadow = im.receiveShadow = true; g.add(im); g.position.set(x0 - w / 2, 0, z0 - w / 2); return g;
}

function starshipSmoke(smoke, s, dt, nozzleW, axis, pressure, budget, t, RK, sf) {
  const th1 = s.thrust1, alt = s.alt, rate = budget / 6, ZB = RK.base;
  // deluge water: sprays up from the steel plate and the mount ring (static fire: sf.deluge; launch: on from T-6 s)
  const del = sf ? sf.deluge : (t > -6 && t < 18 && alt < 300 ? 1 : 0);
  if (del > 0) {
    const n = Math.round(rate * 0.9 * del * dt + Math.random());
    for (let i = 0; i < n; i++) {
      const a = rnd(0, 6.283), r = rnd(19, 24), up = Math.random() < 0.6;
      if (up) smoke.spawn(Math.cos(a) * r, 0.8, Math.sin(a) * r, Math.cos(a) * rnd(0, 3), rnd(18, 36), Math.sin(a) * rnd(0, 3), rnd(1.4, 2.6), rnd(1.8, 3.2), rnd(2.5, 4), 0.55, 0, 1.6);
      else { const rr = RK.R + 1.2; smoke.spawn(Math.cos(a) * rr, ZB - 0.2, Math.sin(a) * rr, -Math.cos(a) * rnd(2, 8), rnd(-2, 6), -Math.sin(a) * rnd(2, 8), rnd(1.2, 2), 1.8, 3, 0.45, 0, 1.4); }
    }
  }
  // exhaust hitting the plate: huge radial steam / dust billows (white steam when the deluge is running)
  if (th1 > 0 && alt < 600) {
    const k = th1 * (1 - alt / 600), n = Math.round(rate * k * dt * 2.2 + Math.random());
    const heat = del > 0 ? 0.3 : 0.55;
    for (let i = 0; i < n; i++) {
      const a = rnd(0, 6.283), v = rnd(26, 70);
      smoke.spawn(Math.cos(a) * 19, rnd(1, 6), Math.sin(a) * 19, Math.cos(a) * v, rnd(2, 12), Math.sin(a) * v, rnd(18, 34), rnd(11, 18), rnd(9, 15), 0.62, heat);
    }
  }
  // static fire: lingering steam cloud that keeps rising after shutdown and slowly dissipates
  if (sf && sf.steam > 0) {
    const n = Math.round(rate * 0.12 * sf.steam * dt + Math.random() * 0.6);
    for (let i = 0; i < n; i++) { const a = rnd(0, 6.283), r = rnd(12, 60); smoke.spawn(Math.cos(a) * r, rnd(4, 20), Math.sin(a) * r, Math.cos(a) * rnd(2, 6), rnd(1, 4), Math.sin(a) * rnd(2, 6), rnd(22, 40), rnd(16, 26), rnd(10, 16), 0.45 * sf.steam, 0); }
  }
  // ascent trail
  if (th1 > 0 && alt > 20 && alt < 48000) {
    const n = Math.round(rate * 0.4 * dt + Math.random());
    for (let i = 0; i < n; i++) {
      const back = rnd(15, 110), p = nozzleW.clone().addScaledVector(axis, -back);
      smoke.spawn(p.x + rnd(-4, 4), p.y, p.z + rnd(-4, 4), rnd(-1, 1), rnd(-1, 1), rnd(-1, 1), rnd(40, 80), 10 + alt * 0.0016, 6 + alt * 0.0014, 0.55 * Math.max(0.25, pressure), 0.2);
    }
  }
  // cryo venting before ignition (booster and ship tanks)
  if (t < -3 && t > -3600 && Math.random() < dt * 14) {
    const y = RK.vents[(Math.random() * RK.vents.length) | 0], a = rnd(0, 6.283);
    smoke.spawn(Math.cos(a) * RK.R, y + rnd(0, 2), Math.sin(a) * RK.R, Math.cos(a) * rnd(1, 3), rnd(-3, -0.5), Math.sin(a) * rnd(1, 3), rnd(6, 11), 2.0, 3.2, 0.5, 0);
  }
}
