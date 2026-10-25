// Starship Static Fire · Simulator (website page /static-fire/).
// A SIMULATED test-stand static fire: made-up timeline, made-up readings, simulated ambient weather.
// Nothing on this page is real telemetry or a real event. Fan-made; not affiliated with SpaceX.
import { SF_START, SF_END, SF_CALLOUTS, makeRun, sfState, sfSample } from "./staticfire.js";
import { createSfHud } from "./sfhud.js";
import { createLite } from "./lite.js";

(function () {
  const root = document.getElementById("sf-stage"); if (!root) return;
  const $ = (id) => document.getElementById(id);
  const Q = new URLSearchParams(location.search);
  const btn = $("sf-start"), big = $("sf-go"), callout = $("sf-callout"), tierLbl = $("sf-tier"), status = $("sf-status");
  // A pretend test stand (Starship model on its launch mount). Simulated daylight, simulated ambient weather (no METAR).
  const simDate = () => { const d = new Date(); d.setUTCHours(17, 30, 0, 0); return d; };
  const STAND = { rocket: "Starship", family: "Starship", padLat: 25.997, padLon: -97.157, _az: 90, metar: null, net: simDate().getTime() };
  const PROFILE = { sep: 1e9, fairing: 1e9, meco: 1e9, ses: 1e9, maxq: 1e9 };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hud = createSfHud(root);
  const NEXT = { ultra: "standard", standard: "lite", lite: null };
  let engine = null, lite = null, tier = null, switching = false, run = makeRun(1), t0 = 0, running = false, done = false;
  let last = 0, fpsT = 0, fpsN = 0, fpsW = 0, visible = true;

  function has3D() { try { const c = document.createElement("canvas"); return !!c.getContext("webgl2"); } catch (e) { return false; } }
  function pickTier() {
    const q = Q.get("tier"); if (q && NEXT[q] !== undefined) return q;
    if (!has3D()) return "lite";
    return (matchMedia("(pointer: coarse)").matches || innerWidth < 760) ? "standard" : "ultra";
  }
  let loading3D = null;
  function load3D() {
    if (window.YWSF3D) return Promise.resolve(window.YWSF3D);
    return loading3D ||= new Promise((ok, bad) => { const s = document.createElement("script"); s.src = root.dataset.three; s.async = true;
      s.onload = () => window.YWSF3D ? ok(window.YWSF3D) : bad(new Error("3D module missing")); s.onerror = () => bad(new Error("3D module failed to load")); document.head.appendChild(s); });
  }
  async function useTier(t) {
    switching = true; tier = t; root.dataset.tier = t; tierLbl.textContent = t === "ultra" ? "ULTRA" : t === "standard" ? "STANDARD" : "LITE";
    if (engine) { try { engine.dispose(); } catch (e) {} engine = null; }
    const lc = $("sf-lite");
    if (t === "lite") { $("sf-gl").hidden = true; lc.hidden = false; lite ||= createLite(lc); switching = false; resize(); return; }
    try {
      root.classList.add("loading");
      const mod = await load3D();
      const fresh = $("sf-gl").cloneNode(); $("sf-gl").replaceWith(fresh); fresh.hidden = false; lc.hidden = true;
      fresh.addEventListener("webglcontextlost", (e) => { e.preventDefault(); if (!switching && tier !== "lite") useTier(NEXT[tier]); });
      engine = await mod.createScene({ canvas: fresh, tier: t, launch: STAND, region: null, assetBase: root.dataset.assets });
    } catch (e) {
      console.warn("Static fire 3D (" + t + ") unavailable, trying " + NEXT[t] + ":", e && e.message);
      if (engine) { try { engine.dispose(); } catch (x) {} engine = null; }
      root.classList.remove("loading"); return useTier(NEXT[t]);
    }
    root.classList.remove("loading"); fpsT = 0; fpsW = 0; switching = false; resize();
  }
  function resize() { const w = root.clientWidth, h = root.clientHeight; if (engine) engine.resize(w, h); if (lite) lite.resize(w, h); }
  addEventListener("resize", resize);
  // step down one tier after ~3 s of low frame rate (never back up)
  function watchdog() {
    if (Q.get("tier") || switching || !engine) return;
    const now = performance.now(); if (!fpsT) { fpsT = now; return; } if (now - fpsT < 2000) return;
    if (!fpsW) { fpsW = now; fpsN = 0; } fpsN++;
    if (now - fpsW > 3000) { const fps = fpsN * 1000 / (now - fpsW); fpsW = now; fpsN = 0; if (fps < 22) useTier(NEXT[tier]); }
  }
  function simT() { if (!running) return SF_START; const t = (performance.now() - t0) / 1000 + SF_START; if (t >= SF_END) { done = true; return SF_END; } return t; }
  function start() {
    run = makeRun(+Q.get("seed") || ((Math.random() * 2 ** 31) >>> 0)); t0 = performance.now(); running = true; done = false;
    hud.show(true, run); root.classList.add("on"); big.hidden = true; btn.textContent = "↻ Restart static fire";
    status.textContent = "Simulated static fire running. Not a real event.";
  }
  btn.addEventListener("click", start); big.addEventListener("click", start);
  function tick(ts) {
    requestAnimationFrame(tick);
    if (!visible || document.hidden || switching) { last = ts; return; }
    const dt = Math.min(0.1, (ts - (last || ts)) / 1000 || 0.016); last = ts;
    const t = simT(), st = sfState(t, run, null), s = sfSample(st);
    if (running) {
      hud.update(st);
      let co = ""; for (const k in SF_CALLOUTS) if (t >= +k && t < +k + 2.5) co = SF_CALLOUTS[k];
      if (st.out >= 0 && t < run.outAt + 2.5) co = "ENGINE OUT";
      if (done) co = "TEST COMPLETE · SIM";
      if (callout.textContent !== co) callout.textContent = co;
      if (done && status.textContent.indexOf("finished") < 0) status.textContent = "Simulated static fire finished. Tap Restart to run it again.";
    }
    const opts = { view: "outside", reduced, shake: reduced ? 0 : 0.5, profile: PROFILE, date: simDate(), day: 1, sep: 1e9, vehicle: "starship",
      sf: { deluge: st.deluge, steam: st.steam, groups: st.groups, cam: "close" } };
    if (engine) engine.frame(s, opts, dt); else if (lite && tier === "lite") lite.frame(s, opts, dt);
    watchdog();
  }
  if ("IntersectionObserver" in window) new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(root);
  useTier(pickTier()).then(() => requestAnimationFrame(tick));
  if (Q.get("autostart") === "1") start();
  window.YWSF = { start, get tier() { return tier; }, get t() { return simT(); } };   // for tests
})();
