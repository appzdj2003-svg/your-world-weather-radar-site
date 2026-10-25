// SIMULATED Starship static fire: a made-up test-stand timeline and made-up sensor readings.
// Nothing here is real telemetry. Values are plausible-looking ballpark numbers for a full
// Super Heavy static fire (33 Raptors, ~2.35 MN each), ramped smoothly along the timeline,
// with light deterministic noise. Optional real input: the METAR near the pad (ambient only).
export const SF_START = -20, SF_END = 40;
const N = 33, PC_NOM = 330, F_ENG = 2.35;                  // bar, MN per engine (sim values)
const MDOT_LOX = 0.51, MDOT_CH4 = 0.14;                    // t/s per engine at full thrust
const LOX0 = 2700, CH40 = 750, STACK0 = 5000;              // t loaded, full stack wet mass (sim)
const DELUGE_M3S = 17.6, WATER_M3 = 1325;
const CUT = 8.0;
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const nz = (t, k) => Math.sin(t * (7.3 + k * 1.7) + k * 12.9) * 0.6 + Math.sin(t * (17.1 + k * 0.9) + k * 3.1) * 0.4; // deterministic wobble

// engine layout (same ring order as the 3D model): 3 center, 10 inner, 20 outer
export const ENGINES = (() => { const out = [], ring = (n, r, ph, g) => { for (let i = 0; i < n; i++) out.push({ x: Math.cos(i / n * 6.283 + ph) * r, z: Math.sin(i / n * 6.283 + ph) * r, g }); };
  ring(3, 0.95, 0.5, 0); ring(10, 2.35, 0.1, 1); ring(20, 3.72, 0, 2); return out; })();
function ignAt(i) { return i < 3 ? i * 0.08 : i < 13 ? 0.45 + (i - 3) * 0.045 : 1.0 + (i - 13) * 0.04; }
function cutAt(i) { return i >= 13 ? CUT + (i - 13) * 0.012 : i >= 3 ? CUT + 0.26 + (i - 3) * 0.01 : CUT + 0.42 + i * 0.03; }

export function makeRun(seed) {
  seed = (seed >>> 0) || 1;
  const out = seed % 4 === 0 ? 13 + (seed >> 3) % 20 : -1;     // ~1 in 4 runs: one outer engine shuts down early
  const outAt = 4.6 + ((seed >> 5) % 10) * 0.12;
  return { seed, out, outAt };
}
function engR(i, t, run) {   // 0..1 chamber pressure fraction
  const a = ignAt(i), b = run.out === i ? run.outAt : cutAt(i);
  if (t < a) return 0;
  const up = sm(a, a + 0.65, t) * (1 + 0.07 * Math.exp(-Math.pow((t - a - 0.55) / 0.12, 2)));   // small start overshoot
  return t < b ? up : up * Math.exp(-(t - b) / 0.11);
}
export function sfEvents(run) {
  const ev = [[-20, "TEST DIRECTOR: GO FOR STATIC FIRE"], [-18, "GSE: PROPELLANT LOAD COMPLETE · TOP-OFF"], [-16, "ENGINE CHILL-DOWN"],
    [-12, "TOWER / PAD CLEAR · RANGE GREEN"], [-10, "DELUGE ARMED"], [-8, "DELUGE ON"], [-5, "PREVALVES OPEN"], [-3, "TANKS AT FIRE PRESSURE"],
    [-1, "IGNITERS ARMED"], [0, "IGNITION SEQUENCE START"], [0.3, "CENTER 3 LIT"], [0.9, "INNER 10 LIT"], [1.8, "OUTER 20 LIT"], [2.4, "MAINSTAGE"]];
  if (run.out >= 0) ev.push([run.outAt, `ENG ${run.out + 1} SHUTDOWN · CONTROLLER (SIM)`]);
  ev.push([CUT, "CUTOFF COMMAND"], [CUT + 0.7, "ALL ENGINES OFF"], [CUT + 1.5, "TEST DURATION " + CUT.toFixed(1) + " s"], [12, "N2 PURGE · SAFING"], [16, "DELUGE OFF"],
    [22, "TANK VENT · DETANK STARTED"], [30, "VEHICLE SAFED · TEST COMPLETE"]);
  return ev.sort((a, b) => a[0] - b[0]);
}
// callouts shown big in the middle of the screen
export const SF_CALLOUTS = { "-8": "DELUGE ON", "0": "IGNITION", "2.4": "MAINSTAGE", [String(CUT)]: "CUTOFF" };

// integrate consumption (cheap: <= 600 steps)
function used(t, run) {
  let lox = 0, ch4 = 0, water = 0; const h = 0.1;
  for (let x = -8; x < t; x += h) { water += deluge(x) * DELUGE_M3S * h; }
  for (let x = 0; x < Math.min(t, CUT + 1.5); x += 0.05) { let s = 0; for (let i = 0; i < N; i++) s += engR(i, x, run); lox += s * MDOT_LOX * 0.05; ch4 += s * MDOT_CH4 * 0.05; }
  return { lox, ch4, water };
}
function deluge(t) { return sm(-8, -6.5, t) * (1 - sm(16, 18, t)); }

export function sfState(t, run, metar) {
  const r = new Float32Array(N); let sum = 0, lit = 0; const groups = [0, 0, 0], gn = [3, 10, 20];
  for (let i = 0; i < N; i++) { r[i] = engR(i, t, run); sum += r[i]; if (r[i] > 0.85) lit++; groups[ENGINES[i].g] += r[i] / gn[ENGINES[i].g]; }
  const thrust = sum / N, U = used(t, run);
  const d = deluge(t), firing = thrust > 0.01;
  const pcs = [...r].filter(x => x > 0.05).map((x, i) => x * PC_NOM * (1 + 0.004 * nz(t, i)));
  const pcAvg = pcs.length ? pcs.reduce((a, b) => a + b, 0) / pcs.length : 0;
  const thrustMN = sum * F_ENG * (1 + 0.003 * nz(t, 40));
  const massT = STACK0 - U.lox - U.ch4, weightMN = massT * 9.80665 / 1000;
  const press = (base, k) => {
    const pre = 3.2 + (base - 3.2) * sm(-6, -3, t);
    const dip = -0.28 * thrust + 0.06 * thrust * nz(t, k) * 0.5;
    const post = t > CUT + 1 ? 0.25 * sm(CUT + 1, 12, t) - (base + 0.25 - 3.4) * sm(22, 30, t) : 0;
    return pre + dip + post;
  };
  const engBayK = 296 + 92 * sm(0.5, CUT, t) * (1 - 0.6 * sm(CUT + 1, 30, t)) + 3 * thrust * nz(t, 9);
  const vib = 0.02 + 2.6 * thrust * (1 + 0.15 * nz(t, 5)) + 3.2 * [0.15, 0.6, 1.4, CUT].reduce((a, e) => a + Math.exp(-Math.pow((t - e) / 0.08, 2)), 0) * (t < CUT + 1 ? 1 : 0);
  const dB = 10 * Math.log10(Math.pow(10, (d > 0 ? 84 * d + 40 * (1 - d) : 40) / 10) + (firing ? Math.pow(10, (136 + 10 * Math.log10(thrust)) / 10) : 0) + Math.pow(10, 4.4));
  const amb = metar && metar.tempC != null ? { tempC: metar.tempC, wdir: metar.wdir, wkt: metar.wspdKt, real: true, station: metar.station }
    : { tempC: 26 + 0.3 * nz(t * 0.01, 1), wdir: 140, wkt: 9, real: false };
  const gse = t < -10 ? "QD LOX ✓ CH4 ✓ · HPU ON · N2 PURGE ✓" : t < CUT + 1 ? "QD CONNECTED · CLAMPS LOCKED · FTS SAFE" : t < 22 ? "N2 PURGE ON · CLAMPS LOCKED · SAFING" : "DETANKING · VENTS OPEN · PAD SAFE SOON";
  return {
    t, r, thrust, groups, lit, out: run.out >= 0 && t >= run.outAt ? run.out : -1,
    pcAvg, pcMin: pcs.length ? Math.min(...pcs) : 0, pcMax: pcs.length ? Math.max(...pcs) : 0,
    thrustMN, thrustTf: thrustMN * 1e6 / 9.80665 / 1000,
    clampMN: (thrustMN - weightMN) / 20,
    lox: { p: press(6.0, 1), lvl: 100 * (LOX0 - U.lox) / LOX0, K: 66.4 + 0.012 * (t - SF_START) + 0.4 * sm(CUT, 30, t) },
    ch4: { p: press(5.6, 2), lvl: 100 * (CH40 - U.ch4) / CH40, K: 93.0 + 0.01 * (t - SF_START) + 0.3 * sm(CUT, 30, t) },
    deluge: d, delugeM3s: d * DELUGE_M3S * (1 + 0.01 * nz(t, 3)), waterPct: 100 * (WATER_M3 - U.water) / WATER_M3,
    vibG: vib, dB, engBayK, amb, gse,
    steam: Math.max(sm(0.2, 3, t) * (1 - sm(CUT + 2, 34, t)), 0) * 1.0,
  };
}
// the sim sample the 3D scene / audio / rumble already understand (held down: no liftoff)
export function sfSample(st) {
  return { t: st.t, alt: 0, vel: 0, down: 0, gamma: Math.PI / 2, g: 1, q: 0, phase: st.t < 0 ? "pre" : "ignition", thrust1: st.thrust, thrust2: 0 };
}
