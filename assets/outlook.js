/* Your World Weather Radar Outlook: live feeds (NWS, GDACS, NASA GIBS, EUMETView) + build-time snapshot (NHC, JTWC, METAR, launches) in assets/outlook.json.
   Real data only: when a feed fails, the section says so instead of guessing. */
(function (root) {
"use strict";
const CLS = { HU: "Hurricane", TS: "Tropical Storm", TD: "Tropical Depression", STS: "Subtropical Storm", STD: "Subtropical Depression", PTC: "Potential Tropical Cyclone", TY: "Typhoon", PC: "Post-tropical Cyclone" };
const BASIN = { AL: "Atlantic", EP: "Eastern Pacific", CP: "Central Pacific" };
const SEV = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };
const COMPASS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const compass = d => (d == null || isNaN(d)) ? "" : COMPASS[Math.round(((+d % 360) + 360) % 360 / 22.5) % 16];
const kt2mph = k => Math.round(k * 1.15078);
function saffir(mph) { return mph >= 157 ? 5 : mph >= 130 ? 4 : mph >= 111 ? 3 : mph >= 96 ? 2 : mph >= 74 ? 1 : 0; }

const ASSET_BASE = () => root.YW_ASSET || "";
function parseNhc(items) {
  return (items || []).filter(s => s && s.name).map(s => {
    const kt = +s.intensity, mph = isNaN(kt) ? null : kt2mph(kt);
    const cls = s.classification || "";
    return { src: "NHC", name: titleName(s.name), type: CLS[cls] || cls || "Tropical system", cat: cls === "HU" && mph ? saffir(mph) : 0,
      mph, pressure: +s.pressure || null, lat: s.latitudeNumeric, lon: s.longitudeNumeric,
      basin: BASIN[(s.id || "").slice(0, 2).toUpperCase()] || "", move: s.movementSpeed != null ? `${compass(s.movementDir)} at ${kt2mph(+s.movementSpeed)} mph` : "",
      cone: s.cone ? (/^https?:/.test(s.cone) ? s.cone : ASSET_BASE() + s.cone) : null, link: s.graphics || s.advisory || "https://www.nhc.noaa.gov/", updated: s.lastUpdate || null };
  }).filter(s => typeof s.lat === "number" && typeof s.lon === "number");
}
/* GDACS: severitydata is the event's PEAK wind over its life, not current intensity, so it's not shown as wind.
   Events whose last advisory (todate) is older than 18 h are stale (e.g. post-landfall remnants still flagged current) and dropped. */
function parseGdacs(fc, now) {
  const t = now || Date.now();
  return ((fc && fc.features) || []).filter(f => f.properties && String(f.properties.iscurrent) === "true" && f.properties.eventtype === "TC").map(f => {
    const p = f.properties, c = (f.geometry && f.geometry.coordinates) || [], kmh = p.severitydata && +p.severitydata.severity;
    const last = p.todate ? Date.parse(p.todate + (/[zZ]|[+-]\d\d:?\d\d$/.test(p.todate) ? "" : "Z")) : NaN;
    return { src: "GDACS", name: titleName((p.eventname || p.name || "").replace(/-\d+$/, "")),
      type: "Tropical cyclone", alert: p.alertlevel || "", mph: null, peakMph: kmh ? Math.round(kmh / 1.609) : null, lat: c[1], lon: c[0],
      where: p.country || "", link: (p.url && p.url.report) || "https://www.gdacs.org/", updated: isNaN(last) ? null : new Date(last).toISOString(), _last: last };
  }).filter(s => typeof s.lat === "number" && !isNaN(s._last) && t - s._last <= 18 * 3600e3);
}
function titleName(n) { return String(n).toLowerCase().replace(/(^|[\s-])(\w)/g, (m, a, b) => a + b.toUpperCase()); }
/* NHC first (richer), then GDACS storms NHC doesn't already list (matched by name). */
function mergeStorms(nhc, gd) {
  const seen = new Set(nhc.map(s => s.name.toLowerCase()));
  const near = g => nhc.some(n => Math.abs(n.lat - g.lat) < 3 && Math.abs(((n.lon - g.lon + 540) % 360) - 180) < 3);
  return nhc.concat(gd.filter(g => !seen.has(g.name.toLowerCase()) && !near(g))).sort((a, b) => (b.mph || 0) - (a.mph || 0));
}
function parseAlerts(fc, now) {
  const t = now || Date.now();
  const feats = ((fc && fc.features) || []).map(f => f.properties || {}).filter(p => !p.expires || Date.parse(p.expires) > t);
  const byEvent = {};
  feats.forEach(p => { byEvent[p.event] = (byEvent[p.event] || 0) + 1; });
  const top = feats.slice().sort((a, b) => (SEV[b.severity] || 0) - (SEV[a.severity] || 0) || Date.parse(b.sent || 0) - Date.parse(a.sent || 0))
    .slice(0, 5).map(p => ({ event: p.event, area: (p.areaDesc || "").split(";").slice(0, 3).join(";").trim(), severity: p.severity, expires: p.expires || p.ends || null }));
  const events = Object.entries(byEvent).sort((a, b) => b[1] - a[1]);
  return { count: feats.length, events, top };
}
const WX = [[/TS/, "⛈️", "Thunderstorms"], [/SN|SG/, "🌨️", "Snow"], [/FZ/, "🧊", "Freezing precip"], [/RA|DZ|SH/, "🌧️", "Rain"], [/FG/, "🌫️", "Fog"], [/BR|HZ|FU|DU|SA/, "🌫️", "Hazy"]];
const COVER = { CLR: ["☀️", "Clear"], SKC: ["☀️", "Clear"], CAVOK: ["☀️", "Clear"], NCD: ["☀️", "Clear"], FEW: ["🌤️", "Mostly clear"], SCT: ["⛅", "Partly cloudy"], BKN: ["🌥️", "Mostly cloudy"], OVC: ["☁️", "Overcast"], OVX: ["🌫️", "Obscured"] };
function parseMetar(r) {
  if (!r || r.temp == null) return null;
  let icon = "", cond = "";
  const wx = r.wxString || "";
  for (const [re, i, c] of WX) if (re.test(wx)) { icon = i; cond = (wx.startsWith("+") ? "Heavy " + c.toLowerCase() : wx.startsWith("-") ? "Light " + c.toLowerCase() : c); break; }
  if (!icon) { const cv = COVER[r.cover] || COVER[((r.clouds || []).slice(-1)[0] || {}).cover] || ["🌡️", "Observed"]; [icon, cond] = cv; }
  const c = Math.round(r.temp);
  return { city: r.city || r.icaoId, station: r.icaoId, c, f: Math.round(c * 9 / 5 + 32), icon, cond,
    windMph: r.wspd != null ? kt2mph(+r.wspd) : null, gustMph: r.wgst ? kt2mph(+r.wgst) : null, windDir: compass(r.wdir),
    obs: r.obsTime ? new Date(r.obsTime * 1000).toISOString() : null, lat: r.lat, lon: r.lon };
}
/* Launches in the window [now-1h, now+24h]; if none, the next 2 scheduled (flagged so the UI says "next up"). */
const LST = { Go: "Go for launch", TBC: "To be confirmed", TBD: "To be determined", Hold: "On hold", "In Flight": "In flight", Success: "Launched", Failure: "Launch failure", "Partial Failure": "Partial failure" };
function parseLaunches(items, now) {
  const t = now || Date.now(), all = (items || []).filter(l => l && l.net && !isNaN(Date.parse(l.net))).map(l => {
    const lat = parseFloat(l.lat), lon = parseFloat(l.lon), p = l.probability;
    return { name: (l.mission || (l.name || "").split("|").pop() || "").trim(), rocket: l.rocket || (l.name || "").split("|")[0].trim(), provider: l.provider || "",
      net: l.net, site: l.site || "", pad: l.pad || "", status: l.status || "", statusText: LST[l.status] || l.statusName || l.status || "",
      weatherGo: (p != null && p >= 0 && p <= 100) ? p : null, weatherConcerns: l.weatherConcerns || "", orbit: (l.orbit && l.orbit !== "N/A") ? l.orbit : "",
      lat: isNaN(lat) ? null : lat, lon: isNaN(lon) ? null : lon, ms: Date.parse(l.net) };
  }).sort((a, b) => a.ms - b.ms);
  const today = all.filter(l => l.ms >= t - 3600e3 && l.ms <= t + 24 * 3600e3 && l.status !== "Success" && l.status !== "Failure");
  return today.length ? { today: true, list: today } : { today: false, list: all.filter(l => l.ms > t && l.status !== "Success").slice(0, 2) };
}
/* EUMETSAT hourly frames: each satellite frame time maps to the clock hour (UTC) at or before it. */
const hourOf = t => new Date(Math.floor(Date.parse(t) / 3600e3) * 3600e3).toISOString().replace(".000Z", "Z");
function hourlySlots(times) { return [...new Set((times || []).map(hourOf))].sort(); }
/* Satellite frames: GIBS geostationary IR runs ~1.5-2 h behind; use 10-min slots ending 150 min ago. */
function frameTimes(now, n, stepMin, lagMin) {
  const step = (stepMin || 20) * 60000, end = Math.floor(((now || Date.now()) - (lagMin || 150) * 60000) / 600000) * 600000;
  const out = []; for (let i = (n || 8) - 1; i >= 0; i--) out.push(new Date(end - i * step).toISOString().replace(".000Z", "Z")); return out;
}
const DIRW = { N: "north", S: "south", E: "east", W: "west" };
function sayMove(m) { return m.replace(/^([NSEW]{1,3}) at (\d+) mph$/, (_, d, n) => { const w = d.split("").map(c => DIRW[c]);
  const word = w.length === 3 ? w[0] + "-" + w[1] + w[2] : w.join(""); return `${word} at ${n} miles per hour`; }); }
/* Briefing script: facts from the fetched data only; each part is skipped when its feed is missing. */
function briefingScript(d) {
  const L = [], st = d.storms, al = d.alerts, cities = (d.cities || []).filter(Boolean);
  L.push("Here's the Your World Weather Radar Outlook.");
  if (st) {
    if (!st.length) L.push("Across the tropics, no active tropical cyclones are listed right now.");
    else {
      L.push(`In the tropics, ${st.length === 1 ? "one active system is" : st.length + " active systems are"} on the map.`);
      st.slice(0, 2).forEach(s => {
        let x = `${s.type === "Hurricane" && s.cat ? "Category " + s.cat + " Hurricane" : s.type} ${s.name}`;
        x += s.basin ? ` in the ${s.basin.split(" · ")[0]}` : s.where ? ` near ${s.where}` : "";
        if (s.mph) x += `, with maximum sustained winds near ${s.mph} miles per hour`;
        if (s.move) x += `, moving ${sayMove(s.move)}`;
        L.push(x + ".");
      });
    }
  }
  if (al && al.count) {
    const ev = al.events.slice(0, 2).map(([e, n]) => `${n} ${e}${n > 1 && !/s$/.test(e) ? "s" : ""}`);
    L.push(`Across the United States, the National Weather Service has ${al.count} severe or extreme alert${al.count > 1 ? "s" : ""} in effect${ev.length ? ", led by " + ev.join(" and ") : ""}.`);
  } else if (al) L.push("Across the United States, no severe or extreme National Weather Service alerts are in effect right now.");
  if (cities.length >= 2) {
    const hot = cities.reduce((a, b) => b.f > a.f ? b : a), cold = cities.reduce((a, b) => b.f < a.f ? b : a);
    L.push(`Around the world, ${hot.city} is warmest of our cities at ${hot.f} degrees, while ${cold.city} sits at ${cold.f}.`);
    const wet = cities.find(c => /rain|thunder|snow|drizzle/i.test(c.cond));
    if (wet) L.push(`${wet.city} is reporting ${wet.cond.toLowerCase()}.`);
    const windy = cities.filter(c => c.gustMph).sort((a, b) => b.gustMph - a.gustMph)[0];
    if (windy && windy.gustMph >= 25) L.push(`And it's breezy in ${windy.city}, with gusts to ${windy.gustMph}.`);
  }
  const la = d.launches;
  if (la && la.list.length) {
    const f = Object.assign({}, la.list[0]); if (/unknown/i.test(f.name)) f.name = "an undisclosed payload"; const when = d.fmtTime ? d.fmtTime(f.net) : "";
    if (la.today) L.push(`Looking up: ${la.list.length === 1 ? "one rocket launch is" : la.list.length + " rocket launches are"} scheduled in the next 24 hours. First, a ${f.rocket} carrying ${f.name}${f.site ? " from " + f.site.split(",")[0] : ""}${when ? " at " + when : ""}${f.weatherGo != null ? ", with forecasters giving a " + f.weatherGo + " percent chance of favorable launch weather" : ""}.`);
    else L.push(`No rocket launches are scheduled in the next 24 hours. Next up is a ${f.rocket} carrying ${f.name}.`);
  }
  L.push("Want this for your own backyard? Your World Weather Radar writes AI storm briefings for your exact location, from right now out to ten days.");
  return L;
}

/* ---- JTWC (US Navy Joint Typhoon Warning Center), public domain. Build-time snapshot in outlook.json (see _src/outlook.py). ----
   RSS lists active warnings; each storm's .tcw has the coded forecast (T000..T120: lat/lon, 1-min max wind kt,
   34/50/64-kt quadrant radii in nm) plus the past track. JTWC publishes wind radii, NOT a cone of uncertainty. */
const JTWC = "https://www.metoc.navy.mil/jtwc/";
const JBASIN = { WP: "Western Pacific", IO: "North Indian Ocean", SH: "Southern Hemisphere", EP: "Eastern Pacific", CP: "Central Pacific" };
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

/* Snapshot items -> storm cards; warnings older than 24 h are dropped. */
function parseJtwc(items, now) { const t = now || Date.now();
  return (items || []).map(i => { try { return parseTcw(i.tcw, i.pid); } catch (e) { return null; } }).filter(j => j && t - j.fixMs < 24 * 3600e3).map(jtwcToStorm); }
const api = { parseTcw, parseJtwc, jtwcToStorm, mergeStorms3, windAreaRings, hourOf, hourlySlots, parseLaunches, parseNhc, parseGdacs, mergeStorms, parseAlerts, parseMetar, frameTimes, briefingScript, saffir, compass };
if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
root.YWOutlook = api;

/* ---------------- browser ---------------- */
const $ = id => document.getElementById(id), E = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const ASSET = (document.currentScript && document.currentScript.src.replace(/outlook\.js.*$/, "")) || "assets/"; root.YW_ASSET = ASSET;
const MAPIMG = (document.querySelector("#owo-map .owo-base") || {}).src || "";
if (!document.getElementById("owo-jtcss")) { const st = document.createElement("style"); st.id = "owo-jtcss"; st.textContent = ".owo-jtlayer{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.owo-jtmap{margin:0;border-radius:12px;overflow:hidden;background:#0B1220;box-shadow:var(--shadow)}.owo-jtmap svg{display:block;width:100%;height:auto;aspect-ratio:3/2}.owo-jtmap figcaption{font-size:.78rem;line-height:1.35;padding:8px 10px;color:#CBD5E1}.owo-jtmap .sw{display:inline-block;width:12px;height:12px;border-radius:3px;background:rgba(255,107,53,.6);vertical-align:-2px;margin-right:6px}"; document.head.appendChild(st); }
const ago = iso => { if (!iso) return ""; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 60 ? `${Math.max(m, 1)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const local = iso => iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
const getJSON = (u, ms) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms || 15000);
  return fetch(u, { signal: c.signal, headers: { Accept: "application/geo+json, application/json" } }).then(r => { clearTimeout(t); if (!r.ok) throw new Error(r.status); return r.json(); }); };
const state = { storms: null, alerts: null, cities: null, launches: null, fmtTime: iso => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) };
function renderLaunches(la, fetchedAt) {
  const out = $("owo-launch"); if (!out) return;
  if (!la) { out.innerHTML = `<p class="owo-empty">The launch schedule isn't available right now. See <a href="https://thespacedevs.com/" target="_blank" rel="noopener">The Space Devs</a>.</p>`; return; }
  if (!la.list.length) { out.innerHTML = `<p class="owo-empty">No upcoming launches listed.</p>`; return; }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " ");
  out.innerHTML = (la.today ? "" : `<p class="owo-note">No launches in the next 24 hours. Next up:</p>`) + la.list.slice(0, 6).map(l => `<div class="owo-launch s-${E(l.status.replace(/\W/g, ""))}">
<div class="owo-lt"><b>${E(new Date(l.net).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</b><small>${E(new Date(l.net).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }))}</small><span class="owo-cd" data-t="${l.ms}"></span></div>
<div class="owo-lb"><span class="owo-lstat">${E(l.statusText)}</span><h3>🚀 ${E(l.name)}</h3><p>${E(l.rocket)}${l.provider ? " · " + E(l.provider) : ""}${l.orbit ? " · " + E(l.orbit) : ""}</p><p class="dim">${E(l.pad)}${l.site ? ", " + E(l.site) : ""}</p>
${l.weatherGo != null ? `<p class="owo-lw">🌤️ ${l.weatherGo}% chance of favorable launch weather${l.weatherConcerns ? " · watching: " + E(l.weatherConcerns) : ""}</p>` : ""}</div></div>`).join("") +
  `<p class="owo-attr">Times in your zone (${E(tz)}). Schedule as of ${E(new Date(fetchedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}; launch times often slip. Data: <a href="https://thespacedevs.com/llapi" target="_blank" rel="noopener">Launch Library 2 by The Space Devs</a>. Launch-weather odds are from official launch weather forecasts when published.</p>`;
  const tick = () => out.querySelectorAll(".owo-cd").forEach(c => { const d = +c.dataset.t - Date.now(), a = Math.abs(d), h = Math.floor(a / 3600e3), m = Math.floor(a % 3600e3 / 60000);
    c.textContent = d > 0 ? `T−${h ? h + "h " : ""}${m}m` : `T+${h ? h + "h " : ""}${m}m`; });
  tick(); setInterval(tick, 30000);
}

function initMap() {
  const box = $("owo-map"); if (!box) return;
  const W = 1440, H = 720, GIBS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&SRS=EPSG:4326&BBOX=-180,-90,180,90&WIDTH=" + W + "&HEIGHT=" + H + "&FORMAT=image/png&TRANSPARENT=true";
  const IR = "GOES-East_ABI_Band13_Clean_Infrared,GOES-West_ABI_Band13_Clean_Infrared,Himawari_AHI_Band13_Clean_Infrared";
  const lite = box.dataset.lite === "1" || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const times = frameTimes(Date.now(), lite ? 1 : 8, 20, 150), frames = [], stamp = $("owo-time");
  let loaded = 0, failed = 0, i = 0;
  times.forEach(t => { const im = new Image(); im.alt = ""; im.className = "owo-frame"; im.decoding = "async";
    im.onload = () => { loaded++; frames.push({ t, im }); frames.sort((a, b) => a.t < b.t ? -1 : 1); if (loaded === 1) { im.classList.add("on"); stamp.textContent = "Satellite " + local(t); box.classList.add("ready"); } };
    im.onerror = () => { failed++; if (failed === times.length) { box.classList.add("ready", "failed"); stamp.textContent = "Satellite imagery is unavailable right now"; } };
    im.src = GIBS + "&LAYERS=" + IR + "&TIME=" + t; box.querySelector(".owo-frames").appendChild(im); });
  /* Europe/Africa/Indian Ocean: EUMETSAT EUMETView WMS, top-of-hour frames only (EUMETSAT "Hourly Data" = Core, CC BY 4.0). */
  const EV = "https://view.eumetsat.int/geoserver/ows?service=WMS&request=GetMap&version=1.1.1&srs=EPSG:4326&bbox=-180,-90,180,90&width=" + W + "&height=" + H + "&format=image/png&transparent=true";
  const evFrames = {};
  hourlySlots(times).forEach(h => [["mtg", "mtg_fd:ir105_hrfi", "mtg_fd:mtg_fd_ir105_hrfi_style_02"], ["iodc", "msg_iodc:ir108", ""]].forEach(([k, layer, style]) => {
    const g = new Image(); g.alt = ""; g.className = "owo-ev owo-ev-" + k; g.decoding = "async";
    g.onload = () => { (evFrames[h] = evFrames[h] || []).push(g); box.classList.add("gap-filled"); showEv(cur()); };
    g.src = EV + "&layers=" + layer + "&styles=" + style + "&time=" + h; box.querySelector(".owo-base").after(g); }));
  const cur = () => frames.length ? frames[i % frames.length].t : times[times.length - 1];
  function showEv(t) { const h = hourOf(t), keys = Object.keys(evFrames).sort(), use = evFrames[h] ? h : keys.filter(k => k <= h).pop() || keys[0];
    box.querySelectorAll(".owo-ev").forEach(x => x.classList.toggle("on", (evFrames[use] || []).includes(x)));
    const n = $("owo-ev-t"); if (n && use) n.textContent = local(use); }
  if (!lite) setInterval(() => { if (frames.length < 2 || document.hidden) return; frames[i % frames.length].im.classList.remove("on"); i = (i + 1) % frames.length;
    frames[i].im.classList.add("on"); showEv(frames[i].t); stamp.textContent = "Satellite " + local(frames[i].t) + (i === frames.length - 1 ? " · latest" : ""); }, 650);
}
function pin(box, s) {
  const x = (s.lon + 180) / 360 * 100, y = (90 - s.lat) / 180 * 100, el = document.createElement("a");
  el.className = "owo-pin c" + (s.cat || 0); el.href = s.link; el.target = "_blank"; el.rel = "noopener";
  el.style.left = x + "%"; el.style.top = y + "%"; el.title = `${s.type} ${s.name}`; el.innerHTML = `<i></i><span>${E(s.name)}</span>`; box.appendChild(el);
}
function renderStorms(list, note) {
  const out = $("owo-storms"); if (!out) return; const map = document.querySelector("#owo-map .owo-pins");
  if (!list) { out.innerHTML = `<p class="owo-empty">Storm feeds didn't load. See <a href="https://www.nhc.noaa.gov/" target="_blank" rel="noopener">nhc.noaa.gov</a>, <a href="https://www.metoc.navy.mil/jtwc/jtwc.html" target="_blank" rel="noopener">JTWC</a> and <a href="https://www.gdacs.org/" target="_blank" rel="noopener">gdacs.org</a>.</p>`; return; }
  if (map) { map.innerHTML = ""; const jl = list.filter(s => s.jtwc); if (jl.length) map.insertAdjacentHTML("afterbegin", `<svg class="owo-jtlayer" viewBox="-180 -90 360 180" preserveAspectRatio="none" aria-hidden="true">${jl.map(s => jtwcSvgLayers(s.jtwc, 1.6)).join("")}</svg>`); list.forEach(s => pin(map, s)); }
  const n = $("owo-storm-n"); if (n) n.textContent = list.length;
  if (!list.length) { out.innerHTML = `<p class="owo-empty">🌤️ No active tropical cyclones listed by NHC, JTWC or GDACS right now.</p>`; return; }
  const lim = +out.dataset.limit || 50;
  out.innerHTML = list.slice(0, lim).map(s => `<div class="owo-sw"><a class="owo-storm c${s.cat || 0}" href="${E(s.link)}" target="_blank" rel="noopener">
<div class="owo-sicon" aria-hidden="true"><svg viewBox="0 0 48 48"><path fill="currentColor" d="M24 18a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm14-12c-6 0-12 3-15 7a12 12 0 0 1 13 12 12 12 0 0 1-2 6c4-3 7-9 7-15 0-4-1-7-3-10zM10 42c6 0 12-3 15-7a12 12 0 0 1-13-12 12 12 0 0 1 2-6c-4 3-7 9-7 15 0 4 1 7 3 10z"/></svg></div>
<div class="owo-sbody"><span class="owo-badge">${s.badge ? E(s.badge) : s.cat ? "Cat " + s.cat : E(s.type)}</span><h3>${E(s.name)}</h3>
<p>${E([s.cat && !s.badge ? s.type : "", s.basin || s.where].filter(Boolean).join(" · "))}</p>
<div class="owo-stats">${s.mph ? `<b>${s.mph}<small> mph</small></b>` : s.peakMph ? `<b><small>peak</small> ${s.peakMph}<small> mph</small></b>` : ""}${s.pressure ? `<b>${s.pressure}<small> mb</small></b>` : ""}${s.move ? `<b><small>moving</small> ${E(s.move)}</b>` : ""}</div>
<p class="owo-src">${s.src === "JTWC" ? "JTWC (US Navy) · 1-min winds" : s.src}${s.alert ? " · " + E(s.alert) + " impact alert" : ""}${s.updated ? " · updated " + ago(s.updated) : ""}</p></div>
</a>${s.cone ? `<a class="owo-cone" href="${E(s.cone)}" target="_blank" rel="noopener" title="Open full-size NHC cone"><img src="${E(s.cone)}" alt="NHC 5-day forecast cone for ${E(s.name)}" onerror="this.parentNode.remove()"><span>🔍 Tap to enlarge</span></a>` : s.jtwc ? jtwcMiniMap(s) : ""}</div>`).join("") + (note ? `<p class="owo-note">${note}</p>` : "");
}
function renderAlerts(a) {
  const out = $("owo-alerts"), n0 = $("owo-alert-n"); if (n0 && a) n0.textContent = a.count; if (!out) return;
  if (!a) { out.innerHTML = `<p class="owo-empty">NWS alerts didn't load. See <a href="https://www.weather.gov/" target="_blank" rel="noopener">weather.gov</a>.</p>`; return; }
  const n = $("owo-alert-n"); if (n) n.textContent = a.count;
  out.innerHTML = `<div class="owo-count"><b>${a.count}</b><span>severe or extreme NWS alerts in effect</span></div>` +
    (a.events.length ? `<div class="owo-chips">${a.events.slice(0, 5).map(([e, c]) => `<span>${E(e)} <b>${c}</b></span>`).join("")}</div>` : "") +
    (a.top.length ? `<ul class="owo-alist">${a.top.slice(0, +out.dataset.limit || 4).map(t => `<li class="s-${E(t.severity)}"><b>${E(t.event)}</b><span>${E(t.area)}</span>${t.expires ? `<small>until ${E(new Date(t.expires).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }))}</small>` : ""}</li>`).join("")}</ul>` : `<p class="owo-empty">All quiet: no severe NWS alerts right now.</p>`);
}
function renderCities(list, fetchedAt) {
  const out = $("owo-cities"); if (!out) return;
  if (!list || !list.length) { out.innerHTML = `<p class="owo-empty">City observations aren't available right now.</p>`; return; }
  out.innerHTML = list.map(c => `<div class="owo-city"><div class="owo-ci">${c.icon}</div><h4>${E(c.city)}</h4><div class="owo-t">${c.f}°<small>F</small> <span>${c.c}°C</span></div><p>${E(c.cond)}</p>
<p class="owo-w">${c.windMph != null ? (c.windMph ? `💨 ${E(c.windDir)} ${c.windMph} mph${c.gustMph ? `, gusts ${c.gustMph}` : ""}` : "💨 Calm") : ""}</p><small>${E(c.station)} · ${c.obs ? local(c.obs) : ""}</small></div>`).join("");
  const s = $("owo-cities-at"); if (s && fetchedAt) s.textContent = `Airport observations (METAR) as of ${new Date(fetchedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`;
}
/* ---- spoken briefing ---- */
function pickVoice() {
  const vs = (speechSynthesis.getVoices() || []).filter(v => /^en(-|_)US/i.test(v.lang) || /^en/i.test(v.lang));
  const score = v => (/^en(-|_)US/i.test(v.lang) ? 10 : 0) + (/natural|neural|online/i.test(v.name) ? 8 : 0) + (/google us english/i.test(v.name) ? 6 : 0) + (/samantha|aria|jenny|guy|ava|allison/i.test(v.name) ? 5 : 0) + (v.localService ? 0 : 1);
  return vs.sort((a, b) => score(b) - score(a))[0] || null;
}
function initBriefing() {
  const btn = $("owo-play"), cap = $("owo-cap"); if (!btn) return;
  const ok = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  let playing = false;
  const stop = () => { playing = false; if (ok) speechSynthesis.cancel(); btn.classList.remove("on"); btn.querySelector("span").textContent = "Play live briefing"; cap.querySelectorAll("p").forEach(p => p.classList.remove("now")); };
  btn.onclick = () => {
    if (playing) return stop();
    const lines = briefingScript(state); cap.hidden = false;
    cap.innerHTML = lines.map(l => `<p>${E(l)}</p>`).join("");
    if (!ok) { cap.insertAdjacentHTML("afterbegin", `<p class="owo-nosp">Your browser can't read aloud, so here's the briefing as text.</p>`); return; }
    playing = true; btn.classList.add("on"); btn.querySelector("span").textContent = "Stop";
    speechSynthesis.cancel(); const v = pickVoice(), ps = cap.querySelectorAll("p");
    lines.forEach((l, k) => { const u = new SpeechSynthesisUtterance(l); if (v) u.voice = v; u.lang = (v && v.lang) || "en-US"; u.rate = 0.96; u.pitch = 1.02;
      u.onstart = () => { ps.forEach(p => p.classList.remove("now")); ps[k].classList.add("now"); ps[k].scrollIntoView({ block: "nearest", behavior: "smooth" }); };
      if (k === lines.length - 1) u.onend = stop; u.onerror = e => { if (e.error !== "interrupted" && e.error !== "canceled") stop(); };
      speechSynthesis.speak(u); });
  };
  if (ok && speechSynthesis.onvoiceschanged !== undefined) speechSynthesis.onvoiceschanged = () => {};
  addEventListener("pagehide", stop);
}
function start() {
  initMap(); initBriefing();
  const snap = fetch(ASSET + "outlook.json", { cache: "no-cache" }).then(r => r.json()).catch(() => ({}));
  const gd = getJSON("https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC").then(parseGdacs).catch(() => null);
  Promise.all([snap, gd]).then(([s, g]) => {
    const fresh = s.nhc && Date.now() - Date.parse(s.nhc.fetchedAt) < 12 * 3600e3;
    const n = fresh ? parseNhc(s.nhc.items) : [];
    const jf = s.jtwc && Date.now() - Date.parse(s.jtwc.fetchedAt) < 12 * 3600e3, j = jf ? parseJtwc(s.jtwc.items) : [];
    state.storms = (g || fresh || jf) ? mergeStorms3(n, j, g || []) : null;
    renderStorms(state.storms, !fresh && g ? "NHC details refresh with each site update; showing the live GDACS list." : "");
    state.cities = ((s.metar && s.metar.items) || []).map(parseMetar).filter(Boolean);
    renderCities(state.cities, s.metar && s.metar.fetchedAt);
    const lf = s.launches && Date.now() - Date.parse(s.launches.fetchedAt) < 36 * 3600e3;
    state.launches = lf ? parseLaunches(s.launches.items) : null; renderLaunches(state.launches, lf && s.launches.fetchedAt);
  });
  getJSON("https://api.weather.gov/alerts/active?status=actual&message_type=alert,update&severity=Extreme,Severe", 20000)
    .then(j => { state.alerts = parseAlerts(j); renderAlerts(state.alerts); }).catch(() => renderAlerts(null));
}
document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", start) : start();
})(typeof window !== "undefined" ? window : globalThis);
