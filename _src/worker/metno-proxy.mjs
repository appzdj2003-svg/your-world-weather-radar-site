/* MET Norway Locationforecast caching proxy for the website's Trip Planner (Cloudflare Worker, free plan). NOT DEPLOYED.
   Why: MET asks browsers/apps to use a proxy, wants a real User-Agent with contact info, and caching by Expires/Last-Modified.
   This worker: GET only; lat/lon truncated to 4 decimals (MET 403s on more); only our site's Origin; one identified upstream
   request per place per MET update (KV cache when bound, else caches.default); If-Modified-Since revalidation; serves the
   cached copy on 429/5xx; passes MET's JSON through unchanged. Visitors' IPs are not forwarded to MET. Nothing is logged by us
   beyond Cloudflare's own request metrics. Config (wrangler.toml [vars]): UA (required), ORIGINS (comma list). */
export const UPSTREAM = "https://api.met.no/weatherapi/locationforecast/2.0/complete";
export const trunc4 = x => String(Math.trunc(Number(x) * 1e4) / 1e4);

export function parseQuery(url) {
  const u = new URL(url), lat = Number(u.searchParams.get("lat")), lon = Number(u.searchParams.get("lon"));
  if (!u.searchParams.has("lat") || !u.searchParams.has("lon") || !isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: trunc4(lat), lon: trunc4(lon) };
}
const allowed = (env, origin) => (env.ORIGINS || "https://weather.yourworldapps.si").split(",").map(s => s.trim()).filter(Boolean).includes(origin);

function store(env) {   // KV survives across edge locations; caches.default is a no-op on *.workers.dev, so KV is preferred there
  if (env.METNO_KV) return {
    get: async k => { const v = await env.METNO_KV.get(k); return v ? JSON.parse(v) : null; },
    put: (k, v) => env.METNO_KV.put(k, JSON.stringify(v), { expirationTtl: 86400 }) };
  const c = typeof caches !== "undefined" && caches.default, key = k => "https://metno-cache.invalid/" + encodeURIComponent(k);
  return {
    get: async k => { if (!c) return null; const r = await c.match(key(k)); return r ? r.json() : null; },
    put: (k, v) => c ? c.put(key(k), new Response(JSON.stringify(v), { headers: { "Cache-Control": "max-age=86400" } })) : null };
}

export async function handle(req, env, fetchFn = fetch, now = Date.now()) {
  const origin = req.headers.get("Origin") || "";
  const cors = allowed(env, origin) ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {};
  const out = (status, body, extra = {}) => new Response(body, { status, headers: { "Content-Type": "application/json", ...cors, ...extra } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" } });
  if (req.method !== "GET") return out(405, '{"error":"GET only"}');
  if (!cors["Access-Control-Allow-Origin"]) return out(403, '{"error":"origin not allowed"}');
  if (!env.UA) return out(500, '{"error":"UA not configured"}');
  const q = parseQuery(req.url); if (!q) return out(400, '{"error":"lat and lon required"}');
  const k = `lf2c:${q.lat},${q.lon}`, st = store(env), hit = await st.get(k).catch(() => null);
  const send = (c, state) => out(200, c.body, { "Cache-Control": `public, max-age=${Math.max(0, Math.min(3600, Math.round((c.expires - now) / 1000)))}`, "X-Cache": state, ...(c.lastModified ? { "Last-Modified": c.lastModified } : {}) });
  if (hit && now < hit.expires) return send(hit, "HIT");
  const h = { "User-Agent": env.UA, "Accept": "application/json", "Accept-Encoding": "gzip, deflate" };
  if (hit && hit.lastModified) h["If-Modified-Since"] = hit.lastModified;
  let r; try { r = await fetchFn(`${UPSTREAM}?lat=${q.lat}&lon=${q.lon}`, { headers: h }); } catch (e) { r = null; }
  const exp = r => { const t = Date.parse(r.headers.get("Expires") || ""); return isFinite(t) && t > now ? t : now + 30 * 60e3; };
  if (r && r.status === 304 && hit) { const c = { ...hit, expires: exp(r) }; await st.put(k, c); return send(c, "REVALIDATED"); }
  if (r && (r.status === 200 || r.status === 203)) {
    if (r.status === 203) console.warn("MET Norway: Locationforecast 2.0 reports deprecation (203)");
    const c = { body: await r.text(), lastModified: r.headers.get("Last-Modified") || "", expires: exp(r) };
    await st.put(k, c); return send(c, "MISS");
  }
  if (hit) return send({ ...hit, expires: now + 5 * 60e3 }, "STALE");   // 429 / 5xx / network: keep serving what we have
  return out(r && r.status === 429 ? 429 : 502, JSON.stringify({ error: "forecast unavailable", upstream: r ? r.status : "network" }), r && r.status === 429 ? { "Retry-After": "600" } : {});
}
export default { fetch: (req, env) => handle(req, env) };
