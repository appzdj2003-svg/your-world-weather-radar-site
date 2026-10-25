import * as THREE from "three";
// Procedural textures (generated at runtime, no image files)
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function valueNoise(w, h, oct, seed) {
  const r = rng(seed), out = new Float32Array(w * h);
  for (let o = 0; o < oct; o++) {
    const cell = Math.max(2, (w >> (o + 1))), gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
    const g = new Float32Array(gw * gh).map(() => r());
    const amp = Math.pow(0.5, o);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const fx = x / cell, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = g[iy * gw + ix], b = g[iy * gw + ix + 1], c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1];
      out[y * w + x] += (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * amp;
    }
  }
  let mn = 1e9, mx = -1e9; for (const v of out) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) / (mx - mn);
  return out;
}
function canvasTex(w, h, fn, srgb = true) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d"), img = ctx.createImageData(w, h); fn(img.data, w, h);
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}
export function smokeTexture() { // soft billowy puff (alpha)
  const n = valueNoise(128, 128, 5, 7);
  return canvasTex(128, 128, (d, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (x - 64) / 64, dy = (y - 64) / 64, r = Math.sqrt(dx * dx + dy * dy);
      const v = n[y * w + x], a = Math.max(0, Math.min(1, (1 - r) * 1.7 + (v - 0.55) * 1.6));
      const i = (y * w + x) * 4; const shade = 170 + 85 * v;
      d[i] = d[i + 1] = d[i + 2] = shade; d[i + 3] = Math.pow(a, 1.6) * 255;
    }
  }, false);
}
export function concreteTexture() {
  const n = valueNoise(512, 512, 7, 11), s = valueNoise(512, 512, 3, 23);
  return canvasTex(512, 512, (d, w, h) => {
    for (let i = 0; i < w * h; i++) {
      const v = 0.55 + 0.3 * n[i] - 0.25 * Math.max(0, s[i] - 0.6), c = Math.floor(150 * v + 30);
      d[i * 4] = c; d[i * 4 + 1] = c - 2; d[i * 4 + 2] = c - 6; d[i * 4 + 3] = 255;
    }
    for (let k = 0; k < 4; k++) { const y = Math.floor(w * k / 4); for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; d[i] -= 30; d[i + 1] -= 30; d[i + 2] -= 30; } }
  });
}
export function groundTexture() { // coastal scrub / sand / marsh
  const n = valueNoise(512, 512, 7, 5), m = valueNoise(512, 512, 3, 9);
  return canvasTex(512, 512, (d, w, h) => {
    for (let i = 0; i < w * h; i++) {
      const v = n[i], wet = m[i];
      let r = 52 + 40 * v, g = 64 + 38 * v, b = 38 + 16 * v;
      if (wet > 0.66) { r = r * 0.7 + 10; g = g * 0.8 + 14; b = b * 0.9 + 18; }
      if (v > 0.8) { r += 40; g += 34; b += 22; }
      d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
    }
  });
}
export function paintTexture() { // white paint with soot gradient near the base and subtle panel lines (no logos)
  const n = valueNoise(256, 1024, 6, 3);
  return canvasTex(256, 1024, (d, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, base = y / h; // v=0 top in canvas -> map with flipY
      const soot = Math.max(0, (base - 0.78) / 0.22) * (0.5 + 0.5 * n[i]) + 0.12 * n[i] * Math.max(0, base - 0.4);
      let c = 236 - 150 * Math.min(1, soot) - 6 * n[i];
      if (y % 128 < 2) c -= 18;                       // panel seams
      d[i * 4] = c; d[i * 4 + 1] = c; d[i * 4 + 2] = c + 2; d[i * 4 + 3] = 255;
    }
  });
}
export function cloudTexture() {
  const n = valueNoise(256, 256, 6, 31);
  return canvasTex(256, 256, (d, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (x - 128) / 128, dy = (y - 128) / 128, r = Math.sqrt(dx * dx + dy * dy * 1.6);
      const v = n[y * w + x], a = Math.max(0, Math.min(1, (1 - r) * 1.6 * (0.35 + v) - 0.25));
      const i = (y * w + x) * 4; const sh = 200 + 55 * v * (1 - dy * 0.5);
      d[i] = d[i + 1] = d[i + 2] = Math.min(255, sh); d[i + 3] = a * 255;
    }
  }, false);
}
// Starship: brushed 304L stainless with weld rings every ~1.8 m, streaks, soot near the engines and
// patchy frost over the cryo tanks (no logos). `rings` = number of barrel sections over the height,
// `frost` = [[from, to], ...] in 0 (bottom) .. 1 (top), `soot` = bottom fraction that is sooted.
export function steelTexture({ h = 2048, rings = 38, frost = [], soot = 0.05, seed = 41 } = {}) {
  const w = 256, n = valueNoise(w, h, 6, seed), st = valueNoise(w, h >> 3, 5, seed + 7), fr = valueNoise(w, h, 5, seed + 13);
  return canvasTex(w, h, (d, W, H) => {
    for (let y = 0; y < H; y++) {
      const v = 1 - y / H, ringPos = (v * rings) % 1, weld = Math.min(ringPos, 1 - ringPos) * H / rings;
      let f = 0; for (const [a, b] of frost) f = Math.max(f, Math.min((v - a) / 0.03, (b - v) / 0.03, 1));
      for (let x = 0; x < W; x++) {
        const i = y * W + x, streak = st[(y >> 3) * W + x];
        let c = 186 + 28 * n[i] + 26 * (streak - 0.5) + 16 * Math.sin(x / W * 6.283 * 3 + 1.3 * n[i]);   // vertical brushed highlight bands
        if (weld < 1.6) c -= 34 - weld * 12; else if (weld < 3) c += 10;     // weld bead + polished heat line
        if (x % 64 < 1) c -= 10;                                           // stringer seams
        const sootK = Math.max(0, (soot - v) / Math.max(1e-3, soot)) * (0.6 + 0.4 * n[i]);
        c = c * (1 - 0.7 * sootK);
        let r = c * 0.97, g = c * 0.995, b = c * 1.04;
        if (f > 0) { const fk = Math.max(0, Math.min(1, (fr[i] - 0.38) * 2.6)) * f; r += (236 - r) * fk; g += (240 - g) * fk; b += (246 - b) * fk; }
        d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
      }
    }
  });
}
// Starship heat shield: black hexagonal tiles with lighter grout lines (8 x 8 tiles per repeat)
export function tileTexture() {
  const S = 512, n = valueNoise(S, S, 4, 77);
  return canvasTex(S, S, (d, w, h) => {
    const cw = w / 8, ch = h / 8;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const row = Math.floor(y / ch), off = (row & 1) * cw / 2;
      const fx = ((x + off) % cw) / cw, fy = (y % ch) / ch;
      const edge = Math.min(fx, 1 - fx, fy, 1 - fy) * cw;
      const id = (Math.floor((x + off) / cw) * 7 + row * 13) % 5;
      let c = 22 + id * 3 + 10 * n[y * w + x];
      if (edge < 2.2) c = 58 + 14 * n[y * w + x];
      const i = (y * w + x) * 4; d[i] = c; d[i + 1] = c; d[i + 2] = c + 2; d[i + 3] = 255;
    }
  });
}
// grid fin lattice (alpha)
export function gridTexture() {
  return canvasTex(128, 128, (d, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = (x + y) % 16, v = (x - y + 256) % 16, frame = x < 6 || y < 6 || x > w - 7 || y > h - 7;
      const on = frame || u < 2 || v < 2, i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 150; d[i + 3] = on ? 255 : 0;
    }
  }, false);
}
