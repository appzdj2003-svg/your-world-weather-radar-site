// Sound for the SIMULATED static fire: a small self-contained Web Audio synth (no samples, no network).
// Everything is generated from noise and oscillators and driven by the same simulated state the HUD shows.
// Browsers only allow audio after a tap, so the context is created/unlocked inside the Start (or sound) tap.
import { sfEvents, SF_CALLOUTS } from "./staticfire.js";

const KEY = "ywsf.sound";
export function soundPref() { try { return localStorage.getItem(KEY) !== "0"; } catch (e) { return true; } }
export function setSoundPref(on) { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) {} }

export function createSfAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null, out = null, master = null, bus = null, wet = null, analyser = null, L = null, built = false;
  let on = soundPref(), active = false, ducked = false, prevT = null, events = [], prevR = null, outFired = false, vol = 0.8;

  function noiseBuf(sec, kind) {   // white / brown / crackle loops
    const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === "brown") { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else if (kind === "crackle") d[i] = 0;
      else d[i] = w;
    }
    if (kind === "crackle") {        // sparse random pops with fast decay: the "tearing" texture of a big rocket
      const rate = 420, pops = Math.floor(sec * rate);
      for (let p = 0; p < pops; p++) {
        const at = Math.floor(Math.random() * n), amp = Math.pow(Math.random(), 2.2) * (Math.random() < 0.5 ? -1 : 1), len = 30 + Math.floor(Math.random() * 220);
        for (let k = 0; k < len && at + k < n; k++) d[at + k] += amp * Math.exp(-k / (len * 0.25)) * (k % 2 ? -0.6 : 1);
      }
      let m = 0; for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(d[i])); for (let i = 0; i < n; i++) d[i] /= m || 1;
    }
    // fade loop seam
    const f = Math.min(512, n >> 4); for (let i = 0; i < f; i++) { const g = i / f; d[i] *= g; d[n - 1 - i] *= g; }
    return b;
  }
  function loop(buf, rate = 1) { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(ctx.currentTime + Math.random() * 0.01, Math.random() * buf.duration); return s; }
  function filt(type, f, q = 0.7, g = 0) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = g; return b; }
  function gain(v = 0) { const g = ctx.createGain(); g.gain.value = v; return g; }
  function chain(...n) { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; }
  function reverbIR(sec) {   // generated "big open pad" reflection tail
    const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2) * (i < ctx.sampleRate * 0.03 ? i / (ctx.sampleRate * 0.03) : 1); }
    return b;
  }

  function build() {
    if (built) return; built = true;
    // output: layers -> bus (+ reverb send) -> master -> compressor -> limiter -> analyser -> speakers
    out = gain(0.9);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -20; comp.knee.value = 8; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.25;
    const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
    master = gain(0); bus = gain(1); analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
    const verb = ctx.createConvolver(); verb.buffer = reverbIR(2.6); wet = gain(0.22);
    bus.connect(master); bus.connect(wet); chain(wet, verb, master);
    chain(master, comp, lim, out, analyser); out.connect(ctx.destination);

    const W = noiseBuf(4, "white"), B = noiseBuf(6, "brown"), C = noiseBuf(3, "crackle");
    L = {};
    // 1) ambience: soft wind (brown noise, slow swell) + faint ground-support hum
    L.amb = gain(0); chain(loop(B, 0.7), filt("lowpass", 520), L.amb, bus);
    const sw = ctx.createOscillator(); sw.frequency.value = 0.09; const swg = gain(0.02); chain(sw, swg, L.amb.gain); sw.start();
    L.hum = gain(0); const h1 = ctx.createOscillator(); h1.type = "sawtooth"; h1.frequency.value = 120; chain(h1, filt("lowpass", 300), L.hum, bus); h1.start();
    // 2) deluge: broadband water rush (hiss band + low churn)
    L.del = gain(0); chain(loop(W, 1), filt("bandpass", 1100, 0.45), L.del, bus);
    L.delLo = gain(0); chain(loop(B, 1.6), filt("lowpass", 380), L.delLo, bus);
    // 3) roar: deep low-frequency body, mid roar, crackle, sub rumble; slow "buffeting" modulation
    L.roarLo = gain(0); chain(loop(B, 0.9), filt("lowpass", 160, 0.9), L.roarLo, bus);
    L.roarMid = gain(0); chain(loop(W, 0.8), filt("lowpass", 900), filt("highpass", 120), L.roarMid, bus);
    L.crk = gain(0); chain(loop(C, 1), filt("highpass", 700), filt("peaking", 2600, 0.8, 5), L.crk, bus);
    L.crk2 = gain(0); chain(loop(C, 0.47), filt("bandpass", 420, 0.6), L.crk2, bus);
    L.sub = gain(0); [31, 43.5, 58].forEach((f, i) => { const o = ctx.createOscillator(); o.frequency.value = f; o.detune.value = i * 7; const g = gain(0.33); chain(o, g, L.sub); o.start(); });
    L.sub.connect(bus);
    L.buf = gain(1); const lf = ctx.createOscillator(); lf.frequency.value = 5.3; const lfg = gain(0.12); chain(lf, lfg, L.buf.gain); lf.start();
    const lf2 = ctx.createOscillator(); lf2.frequency.value = 1.7; const lf2g = gain(0.08); chain(lf2, lf2g, L.buf.gain); lf2.start();
    L.roarLo.disconnect(); L.roarMid.disconnect(); L.roarLo.connect(L.buf); L.roarMid.connect(L.buf); L.buf.connect(bus);
    // 4) steam: high hiss after cutoff
    L.steam = gain(0); chain(loop(W, 1.25), filt("highpass", 2600), filt("peaking", 6500, 1, 4), L.steam, bus);
    L.W = W;
  }

  const now = () => ctx.currentTime;
  const to = (g, v, tc = 0.06) => g.gain.setTargetAtTime(v, now(), tc);
  function burst({ f = 2000, q = 1, dur = 0.06, amp = 0.5, low = 0, lowF = 70, at = 0 }) {   // one-shot crack/pop/click
    const t = now() + at, s = ctx.createBufferSource(); s.buffer = L.W; const bp = filt("bandpass", f, q), g = gain(0);
    chain(s, bp, g, bus); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    s.start(t, Math.random() * 3); s.stop(t + dur + 0.05);
    if (low) { const o = ctx.createOscillator(), og = gain(0); o.frequency.setValueAtTime(lowF * 1.8, t); o.frequency.exponentialRampToValueAtTime(lowF * 0.6, t + dur * 3);
      chain(o, og, bus); og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(low, t + 0.004); og.gain.exponentialRampToValueAtTime(0.0005, t + dur * 3.5); o.start(t); o.stop(t + dur * 4); }
  }
  function beep(f, dur = 0.09, amp = 0.12, at = 0) {    // control-room style callout tone (dry, not reverbed much)
    const t = now() + at, o = ctx.createOscillator(), g = gain(0); o.type = "sine"; o.frequency.value = f;
    chain(o, g, master); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + 0.006); g.gain.setValueAtTime(amp, t + dur - 0.02); g.gain.linearRampToValueAtTime(0, t + dur);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function ensure() {   // call inside a user tap
    if (!AC) return false;
    if (!ctx) { try { ctx = new AC({ latencyHint: "interactive" }); } catch (e) { try { ctx = new AC(); } catch (x) { return false; } } }
    // iOS/Safari unlock: start a 1-sample silent buffer within the gesture, then resume
    try { const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0); } catch (e) {}
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    build(); return true;
  }
  function applyMaster() { if (!ctx) return; to(master, on && active && !ducked ? vol : 0, 0.08); }
  // iOS can put the context in "interrupted"/"suspended" (calls, lock screen); resume on the next tap or when visible again
  const kick = () => { if (ctx && on && ctx.state !== "running" && ctx.state !== "closed") ctx.resume().catch(() => {}); };
  ["pointerdown", "touchend", "keydown"].forEach(e => addEventListener(e, kick, { passive: true }));
  document.addEventListener("visibilitychange", () => { if (!ctx) return; if (document.hidden) ctx.suspend().catch(() => {}); else kick(); });

  return {
    get on() { return on; }, get state() { return ctx ? ctx.state : "none"; }, get node() { return out; }, get ctx() { return ctx; },
    level() { if (!analyser) return { rms: 0, peak: 0 }; const a = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(a); let s = 0, p = 0; for (const v of a) { s += v * v; p = Math.max(p, Math.abs(v)); } return { rms: Math.sqrt(s / a.length), peak: p }; },
    start(run) { if (on) ensure(); active = true; prevT = null; prevR = null; outFired = false; events = sfEvents(run); applyMaster(); },
    setOn(v) { on = !!v; setSoundPref(on); if (on) ensure(); applyMaster(); },
    duck(v) { if (ducked !== !!v) { ducked = !!v; applyMaster(); } },
    stop() { active = false; applyMaster(); },
    update(st) {
      if (!ctx || !built || !active) return;
      const t = st.t, jump = prevT == null || t < prevT || t - prevT > 0.6;   // restart / tab return: no one-shot pile-up
      const thr = st.thrust, steamTail = t > 8.2 ? st.steam : 0;
      // continuous layers follow the sim
      to(L.amb, 0.05 + 0.04 * (1 - Math.min(1, thr * 3)), 0.4);
      to(L.hum, t < 9 ? 0.012 : 0.006, 0.5);
      to(L.del, 0.11 * st.deluge * (1 - 0.6 * thr), 0.15); to(L.delLo, 0.14 * st.deluge, 0.2);
      const body = Math.pow(thr, 0.8);
      to(L.roarLo, 1.15 * body, 0.05); to(L.roarMid, 0.28 * body, 0.05);
      to(L.crk, 0.34 * Math.pow(thr, 1.6), 0.04); to(L.crk2, 0.32 * Math.pow(thr, 1.2), 0.05);
      to(L.sub, 0.22 * body, 0.08);
      to(L.steam, 0.09 * steamTail, 0.3);
      if (!jump) {
        // callout ticks: countdown ticks T-10..T-1, tone for each event line, two-tone for big callouts
        for (let s = -10; s <= -1; s++) if (prevT < s && t >= s) burst({ f: 3200, q: 4, dur: 0.018, amp: 0.18 });
        for (const e of events) if (prevT < e[0] && t >= e[0]) {
          if (SF_CALLOUTS[String(e[0])]) { beep(988, 0.11, 0.11); beep(1319, 0.14, 0.11, 0.13); } else beep(1175, 0.07, 0.07);
        }
        // staged ignition: a crack + thump as each engine lights
        if (prevR) for (let i = 0; i < 33; i++) if (prevR[i] < 0.04 && st.r[i] >= 0.04) {
          burst({ f: 1400 + Math.random() * 2600, q: 0.9, dur: 0.05 + Math.random() * 0.05, amp: 0.55, low: i < 3 ? 0.7 : 0.35, lowF: 55 + Math.random() * 25, at: Math.random() * 0.02 });
        }
        // engine out: a sharp pop + low thud
        if (st.out >= 0 && !outFired) { outFired = true; burst({ f: 900, q: 0.7, dur: 0.16, amp: 0.85, low: 0.9, lowF: 48 }); burst({ f: 3800, q: 1.4, dur: 0.05, amp: 0.4, at: 0.01 }); }
        // cutoff: "chuff" as the last engines stop
        if (prevT < 8.6 && t >= 8.6) burst({ f: 260, q: 0.6, dur: 0.35, amp: 0.6, low: 0.6, lowF: 38 });
      }
      prevT = t; prevR = Float32Array.from(st.r);
    },
  };
}
