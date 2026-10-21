"""PREVIEW ONLY (not called by build.py, outlook.py or the Outlook refresh routine).
Builds preview/jtwc-outlook/ from the live outlook.html + assets/outlook.js, adding JTWC (US Navy) typhoon /
cyclone tracking: live JTWC RSS + .tcw in the browser (JTWC sends Access-Control-Allow-Origin: *), noindex,
not in the sitemap. Re-run after outlook.html / outlook.js change:  python3 _src/jtwc_preview.py"""
import re
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "preview" / "jtwc-outlook"

JTWC_JS = r'''
/* ---- JTWC (US Navy Joint Typhoon Warning Center), public domain. PREVIEW. ----
   RSS lists active warnings; each storm's .tcw has the coded forecast (T000..T120: lat/lon, 1-min max wind kt,
   34/50/64-kt quadrant radii in nm) plus the past track. JTWC publishes wind radii, NOT a cone of uncertainty. */
const JTWC = "https://www.metoc.navy.mil/jtwc/";
const JBASIN = { WP: "Western Pacific", IO: "North Indian Ocean", SH: "Southern Hemisphere", EP: "Eastern Pacific", CP: "Central Pacific" };
function parseJtwcRss(xml) {
  const out = {}, link = /products\/([a-z]{2})(\d{2})(\d{2})\.tcw/i;
  String(xml || "").split(/<\/ul>/i).forEach(b => { const m = link.exec(b); if (!m) return;
    const pid = (m[1] + m[2] + m[3]).toLowerCase(), head = b.split(/<ul/i)[0].slice(-400);
    out[pid] = { pid, basin: m[1].toUpperCase(), final: /final warning/i.test(head), tcfa: +m[2] >= 90 || /formation alert/i.test(head) }; });
  return Object.values(out);
}
function jll(a, ns, o, ew) { const y = +a / 10 * (ns === "S" ? -1 : 1), x = +o / 10 * (ew === "W" ? -1 : 1); return (isNaN(y) || isNaN(x)) ? null : [y, x]; }
function jclass(basin, kt) { if (kt == null) return "Tropical Cyclone";
  if (basin === "WP") return kt < 34 ? "Tropical Depression" : kt < 64 ? "Tropical Storm" : kt < 130 ? "Typhoon" : "Super Typhoon";
  if (basin === "EP" || basin === "CP") return kt < 34 ? "Tropical Depression" : kt < 64 ? "Tropical Storm" : "Hurricane";
  return kt < 34 ? "Tropical Depression" : "Tropical Cyclone"; }
function parseTcw(txt, pid) {
  const t = String(txt || ""); const h = /^(\d{10})\s+(\d{2}[A-Z])\s+(\S+)\s+(\d{1,3})\s+\d+\s+(\d{3})\s+(\d{1,3})\b/m.exec(t); if (!h) return null;
  const d = h[1], fixMs = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +d.slice(8, 10));
  const basin = pid.slice(0, 2).toUpperCase(), fixes = [], seen = {};
  t.replace(/^T(\d{3})\s+(\d{1,3})([NS])\s+(\d{1,4})([EW])\s+(\d{1,3})(.*)$/gm, (_, tau, a, ns, o, ew, w, rest) => {
    const ll = jll(a, ns, o, ew); if (!ll || seen[tau]) return ""; seen[tau] = 1; const radii = {};
    rest.replace(/R0?(34|50|64)((?:\s+\d{1,3}\s+(?:NE|SE|SW|NW)\s+QD)+)/g, (__, kt, qs) => { const q = [0, 0, 0, 0];
      qs.replace(/(\d{1,3})\s+(NE|SE|SW|NW)\s+QD/g, (___, v, k) => { q[["NE", "SE", "SW", "NW"].indexOf(k)] = +v; return ""; });
      if (q.some(v => v > 0)) radii[kt] = q; return ""; });
    fixes.push({ tau: +tau, lat: ll[0], lon: ll[1], kt: +w || null, radii }); return ""; });
  fixes.sort((a, b) => a.tau - b.tau); if (!fixes.length || fixes[0].tau !== 0) return null;
  const past = [], ps = {};
  t.replace(/^\d{2}(\d{2})(\d{2})(\d{2})(\d{2})\s+(\d{1,3})([NS])\s*(\d{1,4})([EW])\s+(\d{1,3})\s*$/gm, (_, yy, mm, dd, hh, a, ns, o, ew, w) => {
    const k = yy + mm + dd + hh, ll = jll(a, ns, o, ew); if (ll && !ps[k]) { ps[k] = 1; past.push({ k, lat: ll[0], lon: ll[1], kt: +w || null }); } return ""; });
  past.sort((a, b) => a.k < b.k ? -1 : 1);
  const subj = (/SUBJ:\s+(.+?)\s+\d{2}[A-Z]\b/.exec(t) || [])[1] || "", t0 = fixes[0];
  const type = subj ? titleName(subj.replace(/\s+/g, " ").trim()) : jclass(basin, t0.kt);
  const gust = (/MAX SUSTAINED WINDS\s*-\s*\d+\s*KT,\s*GUSTS\s*(\d+)\s*KT/.exec(t) || [])[1];
  const pres = (/MINIMUM CENTRAL PRESSURE AT \d{6}Z IS (\d{3,4}) MB/.exec(t) || [])[1];
  const raw = h[3], name = (!raw || /^INVEST$/i.test(raw)) ? h[2] : titleName(raw);
  return { pid, basin, code: h[2], name, warn: +h[4], fixMs, type, kt: t0.kt, gust: gust ? +gust : null, pressure: pres ? +pres : null,
    dir: +h[5], spd: +h[6], fixes, past: past.slice(-60) };
}
function jtwcToStorm(j) {
  const mph = j.kt ? kt2mph(j.kt) : null, typhoonish = /typhoon|cyclone/i.test(j.type);
  return { src: "JTWC", name: j.name, type: j.type, badge: typhoonish ? j.type : null, cat: mph ? saffir(mph) : 0, mph, pressure: j.pressure,
    lat: j.fixes[0].lat, lon: j.fixes[0].lon, basin: (JBASIN[j.basin] || "") + " · " + j.code, move: isNaN(j.dir) ? "" : `${compass(j.dir)} at ${kt2mph(j.spd)} mph`,
    link: JTWC + "products/" + j.pid + "web.txt", updated: new Date(j.fixMs).toISOString(), jtwc: j };
}
/* NHC first; JTWC next (dropped in EP/CP when NHC already has it — NHC wins); then GDACS storms neither lists. */
function mergeStorms3(nhc, jt, gd) {
  const near = (a, b) => Math.abs(a.lat - b.lat) < 3 && Math.abs(((a.lon - b.lon + 540) % 360) - 180) < 3;
  const same = (a, b) => a.name.toLowerCase() === b.name.toLowerCase() || near(a, b);
  const j = jt.filter(s => !((s.jtwc.basin === "EP" || s.jtwc.basin === "CP") && nhc.some(n => same(n, s))));
  const first = nhc.concat(j);
  return first.concat(gd.filter(g => !first.some(s => same(s, g)))).sort((a, b) => (b.mph || 0) - (a.mph || 0));
}
/* 34-kt wind area: union of the quadrant wind shapes swept along the forecast track (SVG group opacity = union look). */
function quadRing(lat, lon, q) { const c = Math.max(Math.cos(lat * Math.PI / 180), 0.05), pts = [];
  for (let k = 0; k < 4; k++) for (let b = k * 90; b <= k * 90 + 90; b += 10) { const r = b * Math.PI / 180;
    pts.push([lon + q[k] * Math.sin(r) / (60 * c), -(lat + q[k] * Math.cos(r) / 60)]); }
  return pts; }
function unwrapFix(f) { const o = []; let prev = null; f.forEach(p => { let x = p.lon; if (prev != null) { while (x - prev > 180) x -= 360; while (x - prev < -180) x += 360; } prev = x; o.push(Object.assign({}, p, { lon: x })); }); return o; }
function windAreaRings(j, kt) {
  const fx = []; for (const f of unwrapFix(j.fixes)) { if (!f.radii[kt]) { if (fx.length) break; continue; } fx.push(f); }
  const rings = []; if (!fx.length) return rings; rings.push(quadRing(fx[0].lat, fx[0].lon, fx[0].radii[kt]));
  for (let i = 1; i < fx.length; i++) { const a = fx[i - 1], b = fx[i], n = Math.max(1, Math.min(200, Math.ceil(Math.hypot(b.lat - a.lat, b.lon - a.lon) / 0.25)));
    for (let s = 1; s <= n; s++) { const t = s / n; rings.push(quadRing(a.lat + (b.lat - a.lat) * t, a.lon + (b.lon - a.lon) * t, a.radii[kt].map((v, k) => v + (b.radii[kt][k] - v) * t))); } }
  return rings; }
const SS_HEX = ["#26A69A", "#FDD835", "#FF9800", "#F44336", "#E040FB", "#7C4DFF"];
const ptHex = kt => kt == null ? "#90A4AE" : kt < 34 ? "#5C6BC0" : SS_HEX[saffir(kt2mph(kt))];
function jtwcSvgLayers(j, scale) {
  const fx = unwrapFix(j.fixes), past = unwrapFix(j.past), s = scale || 1;
  const area = windAreaRings(j, "34").map(r => `<polygon points="${r.map(p => p[0].toFixed(2) + "," + p[1].toFixed(2)).join(" ")}"/>`).join("");
  const line = pts => pts.map(p => p.lon.toFixed(2) + "," + (-p.lat).toFixed(2)).join(" ");
  return `<g class="jt-area" fill="#FF6B35" opacity=".38">${area}</g>` +
    (past.length > 1 ? `<polyline points="${line(past)}" fill="none" stroke="#CBD5E1" stroke-width="${0.35 * s}" stroke-opacity=".9"/>` : "") +
    `<polyline points="${line(fx)}" fill="none" stroke="#fff" stroke-width="${0.45 * s}" stroke-dasharray="${1.2 * s} ${0.8 * s}"/>` +
    fx.map((p, i) => `<circle cx="${p.lon.toFixed(2)}" cy="${(-p.lat).toFixed(2)}" r="${(i ? 0.55 : 0.9) * s}" fill="${ptHex(p.kt)}" stroke="#0F172A" stroke-width="${0.15 * s}"/>`).join("");
}
function jtwcMiniMap(st) {
  const j = st.jtwc, fx = unwrapFix(j.fixes); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  fx.forEach(p => { const r = Math.max(...Object.values(p.radii).flat(), 0) / 60; x0 = Math.min(x0, p.lon - r * 1.2); x1 = Math.max(x1, p.lon + r * 1.2); y0 = Math.min(y0, -p.lat - r); y1 = Math.max(y1, -p.lat + r); });
  let w = Math.max(x1 - x0, 8) + 4, h = Math.max(y1 - y0, 6) + 4; if (w / h < 1.5) w = h * 1.5; else h = w / 1.5;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, vb = [cx - w / 2, cy - h / 2, w, h].map(v => v.toFixed(2)).join(" "), sc = w / 36;
  const base = MAPIMG ? `<image href="${E(MAPIMG)}" x="-180" y="-90" width="360" height="180" preserveAspectRatio="none"/><image href="${E(MAPIMG)}" x="180" y="-90" width="360" height="180" preserveAspectRatio="none"/>` : "";
  return `<figure class="owo-jtmap"><svg viewBox="${vb}" role="img" aria-label="JTWC forecast track and 34-kt wind area for ${E(st.name)}"><rect x="-540" y="-90" width="1080" height="180" fill="#0B1220"/>${base}${jtwcSvgLayers(j, sc)}</svg>
<figcaption><span class="sw"></span><b>Shaded: 34-kt wind area (JTWC)</b> — where JTWC forecasts tropical-storm-force winds may reach. Not a cone of uncertainty. Dashed line: JTWC forecast track (${j.fixes.length - 1} points to +${j.fixes[j.fixes.length - 1].tau} h); gray: past track.</figcaption></figure>`;
}
'''

def main():
    html = (ROOT / "outlook.html").read_text()
    js = (ROOT / "assets" / "outlook.js").read_text()
    # ---- JS: same Outlook code + JTWC; NHC / GDACS parsing untouched.
    js = js.replace('const api = { hourOf,', JTWC_JS + '\nconst api = { parseJtwcRss, parseTcw, mergeStorms3, windAreaRings, hourOf,', 1)
    js = js.replace('const ASSET = (document.currentScript && document.currentScript.src.replace(/outlook\\.js.*$/, "")) || "assets/";',
                    'const ASSET = "/assets/";', 1)
    js = js.replace('const ago = iso =>', 'const MAPIMG = (document.querySelector("#owo-map .owo-base") || {}).src || "";\nconst ago = iso =>', 1)
    js = js.replace('if (map) { map.innerHTML = ""; list.forEach(s => pin(map, s)); }',
                    'if (map) { map.innerHTML = ""; const jl = list.filter(s => s.jtwc); if (jl.length) map.insertAdjacentHTML("afterbegin", `<svg class="owo-jtlayer" viewBox="-180 -90 360 180" preserveAspectRatio="none" aria-hidden="true">${jl.map(s => jtwcSvgLayers(s.jtwc, 1.6)).join("")}</svg>`); list.forEach(s => pin(map, s)); }', 1)
    js = js.replace('<span class="owo-badge">${s.cat ? "Cat " + s.cat : E(s.type)}</span>', '<span class="owo-badge">${s.badge ? E(s.badge) : s.cat ? "Cat " + s.cat : E(s.type)}</span>', 1)
    js = js.replace('<p>${E([s.cat ? s.type : "", s.basin || s.where].filter(Boolean).join(" · "))}</p>', '<p>${E([s.cat && !s.badge ? s.type : "", s.basin || s.where].filter(Boolean).join(" · "))}</p>', 1)
    js = js.replace('<p class="owo-src">${s.src}', '<p class="owo-src">${s.src === "JTWC" ? "JTWC (US Navy) · 1-min winds" : s.src}', 1)
    js = js.replace('alt="NHC 5-day forecast cone for ${E(s.name)}" onerror="this.parentNode.remove()"><span>🔍 Tap to enlarge</span></a>` : ""}</div>`).join("")',
                    'alt="NHC 5-day forecast cone for ${E(s.name)}" onerror="this.parentNode.remove()"><span>🔍 Tap to enlarge</span></a>` : s.jtwc ? jtwcMiniMap(s) : ""}</div>`).join("")', 1)
    js = js.replace('No active tropical cyclones listed by NHC or GDACS right now.', 'No active tropical cyclones listed by NHC, JTWC or GDACS right now.', 1)
    js = js.replace('''  Promise.all([snap, gd]).then(([s, g]) => {
    const fresh = s.nhc && Date.now() - Date.parse(s.nhc.fetchedAt) < 12 * 3600e3;
    const n = fresh ? parseNhc(s.nhc.items) : [];
    state.storms = (g || fresh) ? mergeStorms(n, g || []) : null;''', '''  const fetchText = (u, ms) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms || 15000);
    return fetch(u, { signal: c.signal, cache: "no-cache" }).then(r => { clearTimeout(t); if (!r.ok) throw new Error(r.status); return r.text(); }); };
  const jt = fetchText(JTWC + "rss/jtwc.rss").then(x => Promise.all(parseJtwcRss(x).filter(e => !e.final && !e.tcfa).slice(0, 8)
      .map(e => fetchText(JTWC + "products/" + e.pid + ".tcw").then(t => parseTcw(t, e.pid)).catch(() => null))))
    .then(a => a.filter(j => j && Date.now() - j.fixMs < 24 * 3600e3).map(jtwcToStorm)).catch(() => null);
  Promise.all([snap, gd, jt]).then(([s, g, j]) => {
    const fresh = s.nhc && Date.now() - Date.parse(s.nhc.fetchedAt) < 12 * 3600e3;
    const n = fresh ? parseNhc(s.nhc.items) : [];
    state.storms = (g || fresh || j) ? mergeStorms3(n, j || [], g || []) : null;''', 1)
    assert js.count("mergeStorms3(") >= 2 and "jtwcMiniMap(s)" in js and "owo-jtlayer" in js and 'const ASSET = "/assets/";' in js, "outlook.js changed; update the preview patch"

    css = '''<style>.owo-preview{background:#7C2D12;color:#FFEDD5;padding:10px 14px;border-radius:12px;margin:14px 0;font-weight:600}
.owo-jtlayer{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.owo-jtmap{margin:0;border-radius:12px;overflow:hidden;background:#0B1220;box-shadow:var(--shadow)}.owo-jtmap svg{display:block;width:100%;height:auto;aspect-ratio:3/2}
.owo-jtmap figcaption{font-size:.78rem;line-height:1.35;padding:8px 10px;color:#CBD5E1}.owo-jtmap .sw{display:inline-block;width:12px;height:12px;border-radius:3px;background:rgba(255,107,53,.6);vertical-align:-2px;margin-right:6px}</style>'''
    h = html
    h = h.replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><base href="/">', 1)
    h = re.sub(r'<link rel="canonical" href="[^"]*">', '<link rel="canonical" href="https://weather.yourworldapps.si/preview/jtwc-outlook/">', h, count=1)
    h = h.replace('<title>Your World Weather Radar Outlook</title>', '<title>PREVIEW · Outlook with JTWC typhoon tracking</title>', 1)
    h = h.replace('</head>', css + '</head>', 1)
    h = re.sub(r'<script src="assets/outlook\.js\?v=[0-9a-f]+"></script>', '<script src="/preview/jtwc-outlook/outlook-jtwc.js"></script>', h, count=1)
    h = h.replace('<div class="owo">', '<div class="owo-preview">PREVIEW — not live. Adds worldwide typhoon and cyclone tracking from the U.S. Navy\'s Joint Typhoon Warning Center (JTWC). The live Outlook is unchanged.</div><div class="owo">', 1)
    h = h.replace('Loading NHC and GDACS…', 'Loading NHC, JTWC and GDACS…', 1)
    h = h.replace('(global, live; European Commission JRC &amp; UN OCHA). Always follow official advisories.</p>',
                  '(global, live; European Commission JRC &amp; UN OCHA). Typhoon data: <a href="https://www.metoc.navy.mil/jtwc/jtwc.html" target="_blank" rel="noopener">JTWC (US Navy)</a>, public domain (Western Pacific, Indian Ocean, Southern Hemisphere; live). JTWC shading is the 34-kt wind area, not a cone of uncertainty. Not an official local warning: always follow official advisories and your local weather service.</p>', 1)
    h = h.replace('Storm pins: NHC and GDACS.', 'Storm pins: NHC, JTWC and GDACS.', 1)
    assert "outlook-jtwc.js" in h and "noindex" in h and "JTWC (US Navy)</a>, public domain" in h, "outlook.html changed; update the preview patch"
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "index.html").write_text(h)
    (OUT / "outlook-jtwc.js").write_text(js)
    print("preview written:", OUT)

if __name__ == "__main__":
    main()
