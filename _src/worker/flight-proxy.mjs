/* Flight tracker relay for the website's /flight page (Cloudflare Worker, free plan). Deployed as yw-flight (https://yw-flight.yourworldapps.workers.dev), approved by Aaron Oct 26 2026.
   Why: adsb.lol, aviationweather.gov and FAA NAS Status send no CORS headers, so a browser page can't read them directly.
   This worker: GET only; only our site's Origin; short caches so many visitors share one upstream call; serves the last good copy
   when an upstream fails; trims replies to what the page shows. Visitors' IPs are not forwarded. Keys: none (all sources are free).
   Routes:  /flight?cs=DAL809   live aircraft for an ICAO callsign (adsb.lol, ODbL)    cache 30-120 s, daily cap
            /wx?ids=KATL,KSJC    METAR + TAF, up to 4 airports (aviationweather.gov, public domain)      cache 5 min
            /nas                 FAA NAS airport status XML -> JSON (public domain)                       cache 60 s
            /sigmet              US + international SIGMETs incl. convective (aviationweather.gov)        cache 5 min
            /route-wx?olat=&olon=&dlat=&dlon=  METAR samples along GC route + ends (AWC, public domain)  cache 5 min
            /places?lat=&lon=    named places near an airport from OpenStreetMap via Nominatim (ODbL)     cache 7 days
                                 (one request per category, 1.1 s apart, per Nominatim's 1 req/s policy)
   Config (wrangler [vars]): UA (required), ORIGINS (comma list). KV binding FLIGHT_KV (adsb.lol cache + daily budget, places). */
const NOMI = "https://nominatim.openstreetmap.org/search";
export const PLACE_CATS = [["restaurant", 15], ["cafe", 6], ["fast_food", 6], ["museum", 6], ["attraction", 6], ["park", 6], ["cinema", 4], ["station", 8]];
const ADSB = "https://api.adsb.lol/v2/callsign/", AWC = "https://aviationweather.gov/api/data/", NAS = "https://nasstatus.faa.gov/api/airport-status-information";
const allowed = (env, origin) => (env.ORIGINS || "https://weather.yourworldapps.si").split(",").map(s => s.trim()).filter(Boolean).includes(origin);
const mem = new Map();
// Memory (per isolate) first; KV only for the adsb.lol cache + daily budget and the 7-day places cache, so KV writes stay
// well inside the free plan's 1,000/day. (The Cache API does nothing on workers.dev, so it isn't used.)
function store(env, persist) {
  const kv = persist && env.FLIGHT_KV;
  return { get: async k => { const m = mem.get(k); if (m) return m; if (!kv) return null; const v = await kv.get(k); const o = v ? JSON.parse(v) : null; if (o) mem.set(k, o); return o; },
    put: async (k, v, ttlSec = 3600) => { mem.set(k, v); if (mem.size > 500) mem.delete(mem.keys().next().value); if (kv) await kv.put(k, JSON.stringify(v), { expirationTtl: Math.max(60, ttlSec) }); } };
}
// adsb.lol asks for light use (about 500 requests a day per IP). Every visitor shares this budget; the cache time per
// callsign grows as the day's count rises, and past the cap we serve the last copy or say live tracking is paused.
export const ADSB_DAILY_CAP = 300;
export const flightTtl = used => used < ADSB_DAILY_CAP * 0.5 ? 30e3 : used < ADSB_DAILY_CAP * 0.8 ? 60e3 : 120e3;

const num = v => (typeof v === "number" && isFinite(v) ? v : null);
export function trimAircraft(j) {
  const ac = (j && Array.isArray(j.ac) ? j.ac : []).filter(a => num(a.lat) !== null && num(a.lon) !== null);
  return { now: num(j && j.now), ac: ac.slice(0, 5).map(a => ({ hex: a.hex, flight: String(a.flight || "").trim(), reg: a.r || "", type: a.t || "",
    lat: a.lat, lon: a.lon, alt: a.alt_baro === "ground" ? "ground" : num(a.alt_baro), gs: num(a.gs), track: num(a.track),
    vs: num(a.baro_rate) ?? num(a.geom_rate), squawk: a.squawk || "", seen: num(a.seen_pos) ?? num(a.seen) })) };
}
// FAA NAS Status XML is small and flat; a tolerant regex reader is enough and avoids a dependency.
const tag = (s, t) => { const m = s.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? m[1].trim() : ""; };
const all = (s, t) => [...s.matchAll(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, "g"))].map(m => m[1]);
export function parseNas(xml) {
  const out = { updated: tag(xml, "Update_Time"), groundStops: [], groundDelays: [], delays: [], closures: [] };
  for (const p of all(xml, "Program")) if (tag(p, "ARPT")) out.groundStops.push({ arpt: tag(p, "ARPT"), reason: tag(p, "Reason"), until: tag(p, "End_Time") });
  for (const g of all(xml, "Ground_Delay")) out.groundDelays.push({ arpt: tag(g, "ARPT"), reason: tag(g, "Reason"), avg: tag(g, "Avg"), max: tag(g, "Max") });
  for (const d of all(xml, "Delay")) { if (!tag(d, "ARPT")) continue;
    const ad = [...d.matchAll(/<Arrival_Departure\s+Type="([^"]+)">([\s\S]*?)<\/Arrival_Departure>/g)];
    for (const m of ad.length ? ad : [[null, "", d]]) out.delays.push({ arpt: tag(d, "ARPT"), reason: tag(d, "Reason"), type: m[1], min: tag(m[2], "Min"), max: tag(m[2], "Max"), trend: tag(m[2], "Trend") }); }
  for (const a of all(xml, "Airport")) if (tag(a, "ARPT")) { const r = tag(a, "Reason");
    out.closures.push({ arpt: tag(a, "ARPT"), reason: r, start: tag(a, "Start"), reopen: tag(a, "Reopen"), gaOnly: /NON SKED|TRANSIENT GA|\bGA ACFT|\bPPR\b/i.test(r) }); }
  return out;
}
export function trimSigmets(list, kind) {
  return (Array.isArray(list) ? list : []).filter(s => Array.isArray(s.coords) && s.coords.length > 2).map(s => ({ kind, hazard: s.hazard || "", qualifier: s.qualifier || "",
    type: s.airSigmetType || "SIGMET", from: num(s.validTimeFrom), to: num(s.validTimeTo), base: num(s.altitudeLow1) ?? num(s.base), top: num(s.altitudeHi1) ?? num(s.top),
    fir: s.firName || s.firId || "", raw: String(s.rawAirSigmet || s.rawSigmet || "").slice(0, 600),
    coords: s.coords.map(c => [Math.round(+c.lat * 1000) / 1000, Math.round(+c.lon * 1000) / 1000]) }));
}

export function trimWx(metar, taf) {
  const pick = (o, ks) => Object.fromEntries(ks.filter(k => o[k] !== undefined && o[k] !== null).map(k => [k, o[k]]));
  return { metar: (metar || []).map(m => pick(m, ["icaoId", "name", "obsTime", "rawOb", "fltCat", "temp", "wdir", "wspd", "wgst", "visib", "wxString", "clouds"])),
    taf: (taf || []).map(t => ({ ...pick(t, ["icaoId", "issueTime", "rawTAF", "validTimeFrom", "validTimeTo"]),
      fcsts: (t.fcsts || []).map(f => pick(f, ["timeFrom", "timeTo", "fcstChange", "probability", "wdir", "wspd", "wgst", "visib", "wxString", "clouds"])) })) };
}
export function trimPlaces(texts) {
  const seen = new Set(), out = [];
  texts.forEach((t, i) => { let a; try { a = JSON.parse(t || "[]"); } catch (e) { a = []; }
    for (const x of Array.isArray(a) ? a : []) { const n = String(x.name || "").trim(), id = `${x.osm_type}/${x.osm_id}`;
      if (!n || seen.has(id) || !isFinite(+x.lat) || !isFinite(+x.lon)) continue; seen.add(id);
      out.push({ n: n.slice(0, 80), c: PLACE_CATS[i] ? PLACE_CATS[i][0] : x.type, lat: Math.round(+x.lat * 1e5) / 1e5, lon: Math.round(+x.lon * 1e5) / 1e5, osm: id }); } });
  return out;
}
export function route(url) {
  const u = new URL(url), p = u.pathname.replace(/\/+$/, "");
  if (p === "/flight") { const cs = (u.searchParams.get("cs") || "").toUpperCase().trim();
    return /^[A-Z]{3}[0-9]{1,4}[A-Z]{0,2}$/.test(cs) ? { key: "f:" + cs, ttl: 30e3, up: [ADSB + cs], kind: "flight" } : null; }
  if (p === "/wx") { const ids = [...new Set((u.searchParams.get("ids") || "").toUpperCase().split(",").map(s => s.trim()).filter(Boolean))];
    if (!ids.length || ids.length > 4 || !ids.every(s => /^[A-Z0-9]{4}$/.test(s))) return null; const q = ids.sort().join(",");
    return { key: "w:" + q, ttl: 5 * 60e3, up: [`${AWC}metar?ids=${q}&format=json`, `${AWC}taf?ids=${q}&format=json`], kind: "wx" }; }
  if (p === "/places") { const lat = Number(u.searchParams.get("lat")), lon = Number(u.searchParams.get("lon"));
    if (!u.searchParams.has("lat") || !isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
    const la = Math.round(lat * 100) / 100, lo = Math.round(lon * 100) / 100, dy = 0.12, dx = Math.min(1, 0.12 / Math.cos(la * Math.PI / 180));
    const vb = [lo - dx, la + dy, lo + dx, la - dy].map(v => v.toFixed(3)).join(",");
    return { key: `p:${la},${lo}`, ttl: 7 * 864e5, up: PLACE_CATS.map(([c, n]) => `${NOMI}?amenity=${c}&viewbox=${vb}&bounded=1&format=jsonv2&limit=${n}`), kind: "places", serial: 1100 }; }
  if (p === "/nas") return { key: "nas", ttl: 60e3, up: [NAS], kind: "nas" };
  if (p === "/sigmet") return { key: "sig", ttl: 5 * 60e3, up: [`${AWC}airsigmet?format=json`, `${AWC}isigmet?format=json`], kind: "sigmet" };
  if (p === "/route-wx") {
    // Sample METARs along the great-circle route (origin, ~3 midpoints, dest). AWC bbox query — free, no key.
    const olat = Number(u.searchParams.get("olat")), olon = Number(u.searchParams.get("olon"));
    const dlat = Number(u.searchParams.get("dlat")), dlon = Number(u.searchParams.get("dlon"));
    if (![olat, olon, dlat, dlon].every(isFinite) || Math.abs(olat) > 90 || Math.abs(dlat) > 90) return null;
    const pad = 1.5; // degrees around the corridor
    const minLat = Math.min(olat, dlat) - pad, maxLat = Math.max(olat, dlat) + pad;
    const minLon = Math.min(olon, dlon) - pad, maxLon = Math.max(olon, dlon) + pad;
    const bbox = [minLat, minLon, maxLat, maxLon].map(v => Math.round(v * 100) / 100).join(",");
    // Also pull G-AIRMET (free AWC) for icing/IFR/turb along the corridor when available
    return { key: "rwx:" + bbox, ttl: 5 * 60e3,
      up: [`${AWC}metar?bbox=${bbox}&format=json`, `${AWC}gairmet?format=json`], kind: "route-wx", bbox }; }
  return null;
}
async function build(r, texts) {
  if (r.kind === "flight") return trimAircraft(JSON.parse(texts[0]));
  if (r.kind === "wx") return trimWx(JSON.parse(texts[0] || "[]"), JSON.parse(texts[1] || "[]"));
  if (r.kind === "places") return { places: trimPlaces(texts) };
  if (r.kind === "nas") return parseNas(texts[0]);
  if (r.kind === "route-wx") {
    const metar = JSON.parse(texts[0] || "[]");
    // Cap samples so the page stays light; prefer LIFR/IFR and stormy first, then nearest to corridor mid.
    const trim = trimWx(metar, []).metar;
    const score = m => (m.fltCat === "LIFR" ? 4 : m.fltCat === "IFR" ? 3 : /TS|FG|FZ|SN/.test(m.wxString || "") ? 2 : 1);
    trim.sort((a, b) => score(b) - score(a));
    let gair = [];
    try { gair = JSON.parse(texts[1] || "[]"); } catch (e) { gair = []; }
    const gairmet = (Array.isArray(gair) ? gair : []).slice(0, 40).map(g => ({
      product: g.product || g.hazard || "", hazard: g.hazard || "", dueTo: g.dueTo || "",
      from: num(g.validTimeFrom), to: num(g.validTimeTo),
      coords: Array.isArray(g.coords) ? g.coords.slice(0, 24).map(c => [Math.round(+c.lat * 1000) / 1000, Math.round(+c.lon * 1000) / 1000]) : []
    })).filter(g => g.coords.length > 2);
    return { metar: trim.slice(0, 12), gairmet, bbox: r.bbox };
  }
  return { sigmets: [...trimSigmets(JSON.parse(texts[0] || "[]"), "us"), ...trimSigmets(JSON.parse(texts[1] || "[]"), "intl")] };
}

export async function handle(req, env, fetchFn = fetch, now = Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms))) {
  const origin = req.headers.get("Origin") || "";
  const cors = allowed(env, origin) ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {};
  const out = (status, body, extra = {}) => new Response(body, { status, headers: { "Content-Type": "application/json", ...cors, ...extra } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" } });
  if (req.method !== "GET") return out(405, '{"error":"GET only"}');
  if (!cors["Access-Control-Allow-Origin"]) return out(403, '{"error":"origin not allowed"}');
  if (!env.UA) return out(500, '{"error":"UA not configured"}');
  const r = route(req.url); if (!r) return out(400, '{"error":"bad request"}');
  const st = store(env, r.kind === "flight" || r.kind === "places"), hit = await st.get(r.key).catch(() => null);
  const send = (c, state) => out(200, c.body, { "Cache-Control": `public, max-age=${Math.max(0, Math.round((c.exp - now) / 1000))}`, "X-Cache": state, "X-Fetched": new Date(c.at).toISOString() });
  if (hit && now < hit.exp) return send(hit, "HIT");
  let bkey, used = 0;
  if (r.kind === "flight") { bkey = "b:" + new Date(now).toISOString().slice(0, 10); const m = mem.get(bkey), kb = env.FLIGHT_KV ? await env.FLIGHT_KV.get(bkey).then(v => v && JSON.parse(v)).catch(() => null) : null;
    used = Math.max(m ? m.n : 0, kb ? kb.n : 0);   // other isolates count too: take the higher of ours and the shared one
    if (used >= ADSB_DAILY_CAP) return hit ? send({ ...hit, exp: now + 120e3 }, "STALE") : out(503, '{"error":"daily live-data budget used"}', { "Retry-After": "3600" });
    r.ttl = flightTtl(used); try { await st.put(bkey, { n: used + 1 }, 2 * 86400); } catch (e) {} }
  try {
    const one = async (u, i) => {
      const res = await fetchFn(u, { headers: { "User-Agent": env.UA, "Accept": r.kind === "nas" ? "application/xml" : "application/json" } });
      if (res.status === 204 && i > 0) return "";
      if (!res.ok) throw Object.assign(new Error("upstream " + res.status), { status: res.status });
      return res.text();
    };
    let texts;
    if (r.serial) { texts = []; for (let i = 0; i < r.up.length; i++) { if (i && sleep) await sleep(r.serial); texts.push(await one(r.up[i], i)); } }
    else texts = await Promise.all(r.up.map(one));
    const c = { body: JSON.stringify(await build(r, texts)), at: now, exp: now + r.ttl };
    try { await st.put(r.key, c, r.kind === "places" ? 8 * 86400 : 3600); } catch (e) { console.warn("cache write failed", String(e)); }
    return send(c, "MISS");
  } catch (e) {
    if (hit) return send({ ...hit, exp: now + Math.min(r.ttl, 60e3) }, "STALE");
    const s = e.status === 429 ? 429 : 502;
    return out(s, JSON.stringify({ error: "upstream unavailable", upstream: e.status || "network" }), s === 429 ? { "Retry-After": "60" } : {});
  }
}
export default { fetch: (req, env) => handle(req, env) };
