// Run: node _src/tests/flight-proxy.test.js — the (undeployed) /flight relay in _src/worker/, with a mocked upstream.
const assert = require("assert"), path = require("path");
(async () => {
  const W = await import(path.join(__dirname, "../worker/flight-proxy.mjs"));
  const kv = () => { const m = new Map(); return { get: async k => m.get(k) || null, put: async (k, v) => { m.set(k, v); } }; };
  const env = { UA: "YourWorldWeatherRadar/1.0 support@yourworldapps.si", ORIGINS: "https://weather.yourworldapps.si", FLIGHT_KV: kv() };
  const req = (p, origin = "https://weather.yourworldapps.si", method = "GET") => new Request("https://yw-flight.example.workers.dev" + p, { method, headers: origin ? { Origin: origin } : {} });
  const T0 = Date.parse("2026-10-26T23:00:00Z");
  const adsb = { now: T0, ac: [{ hex: "a719c4", flight: "DAL681  ", r: "N557DN", t: "A21N", lat: 34.8, lon: -89.2, alt_baro: 34000, gs: 430, track: 287, baro_rate: 0, squawk: "3325", seen: 0.3, extra: "dropped" }] };
  let calls = [], reply = () => new Response(JSON.stringify(adsb), { status: 200 });
  const up = async (u, o) => { calls.push({ u, h: o.headers }); return reply(); };
  let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error("FAIL", name); throw e; } };

  await t("other origins, non-GET and bad routes are refused without an upstream call", async () => {
    assert.strictEqual((await W.handle(req("/flight?cs=DAL681", "https://evil.example"), env, up, T0)).status, 403);
    assert.strictEqual((await W.handle(req("/flight?cs=DAL681", undefined, "POST"), env, up, T0)).status, 405);
    assert.strictEqual((await W.handle(req("/flight?cs=bad callsign!!"), env, up, T0)).status, 400);
    assert.strictEqual(calls.length, 0);
  });
  await t("live aircraft: our UA, trimmed reply, no visitor IP forwarded", async () => {
    const r = await W.handle(req("/flight?cs=DAL681"), env, up, T0);
    assert.strictEqual(r.status, 200); assert.strictEqual(r.headers.get("X-Cache"), "MISS");
    const j = await r.json(); assert.strictEqual(j.ac[0].flight, "DAL681"); assert.strictEqual(j.ac[0].reg, "N557DN"); assert(!("extra" in j.ac[0]));
    assert(calls[0].u.startsWith("https://api.adsb.lol/v2/callsign/DAL681")); assert.strictEqual(calls[0].h["User-Agent"], env.UA); assert(!("X-Forwarded-For" in calls[0].h));
  });
  await t("15 s cache shared by visitors, then refetched", async () => {
    assert.strictEqual((await W.handle(req("/flight?cs=DAL681"), env, up, T0 + 10e3)).headers.get("X-Cache"), "HIT"); assert.strictEqual(calls.length, 1);
    await W.handle(req("/flight?cs=DAL681"), env, up, T0 + 16e3); assert.strictEqual(calls.length, 2);
  });
  await t("upstream down: last good copy served as STALE; nothing cached gives 502, rate limit gives 429", async () => {
    reply = () => new Response("oops", { status: 503 });
    const r = await W.handle(req("/flight?cs=DAL681"), env, up, T0 + 40e3); assert.strictEqual(r.headers.get("X-Cache"), "STALE");
    assert.strictEqual((await W.handle(req("/flight?cs=UAL1"), env, up, T0)).status, 502);
    reply = () => new Response("slow down", { status: 429 });
    const z = await W.handle(req("/flight?cs=AAL2"), env, up, T0); assert.strictEqual(z.status, 429); assert.strictEqual(z.headers.get("Retry-After"), "60");
  });
  await t("FAA NAS XML becomes JSON ground stops and delay programs", async () => {
    reply = () => new Response(`<AIRPORT_STATUS_INFORMATION><Update_Time>Mon Oct 26 22:58:00 2026 GMT</Update_Time><Delay_type><Name>Ground Stop Programs</Name><Program_List><Program><ARPT>SFO</ARPT><Reason>thunderstorms</Reason><End_Time>11:30 pm EDT</End_Time></Program></Program_List></Delay_type><Delay_type><Ground_Delay_List><Ground_Delay><ARPT>EWR</ARPT><Reason>volume</Reason><Avg>57 minutes</Avg><Max>2 hours</Max></Ground_Delay></Ground_Delay_List></Delay_type></AIRPORT_STATUS_INFORMATION>`, { status: 200 });
    const j = await (await W.handle(req("/nas"), env, up, T0)).json();
    assert.strictEqual(j.groundStops[0].arpt, "SFO"); assert.strictEqual(j.groundDelays[0].arpt, "EWR"); assert.strictEqual(j.groundDelays[0].avg, "57 minutes");
  });
  await t("places: one Nominatim call per category, spaced by the 1 req/s policy", async () => {
    calls = []; const waits = []; reply = () => new Response("[]", { status: 200 });
    const r = await W.handle(req("/places?lat=37.6189&lon=-122.3750"), env, up, T0, async ms => { waits.push(ms); });
    assert.strictEqual(r.status, 200); assert.strictEqual(calls.length, W.PLACE_CATS.length); assert(waits.length === calls.length - 1 && waits.every(ms => ms >= 1000));
    assert(calls.every(c => c.u.startsWith("https://nominatim.openstreetmap.org/search")));
  });
  console.log(`flight-proxy: ${n} tests passed`);
})().catch(e => { console.error(e); process.exit(1); });
