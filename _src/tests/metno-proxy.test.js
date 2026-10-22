// Run: node _src/tests/metno-proxy.test.js — the (undeployed) MET Norway caching proxy in _src/worker/, with a mocked upstream.
const assert = require("assert"), fs = require("fs"), path = require("path");
(async () => {
  const W = await import(path.join(__dirname, "../worker/metno-proxy.mjs"));
  const body = fs.readFileSync(path.join(__dirname, "fixtures/metno-paris.json"), "utf8");
  const kv = () => { const m = new Map(); return { get: async k => m.get(k) || null, put: async (k, v) => { m.set(k, v); } }; };
  const env = { UA: "YourWorldWeatherRadar/1.0 https://weather.yourworldapps.si support@yourworldapps.si", ORIGINS: "https://weather.yourworldapps.si,http://localhost:8765", METNO_KV: kv() };
  const req = (q, origin = "https://weather.yourworldapps.si", method = "GET") => new Request("https://yw-metno.example.workers.dev/?" + q, { method, headers: origin ? { Origin: origin } : {} });
  let calls = [], reply = () => new Response(body, { status: 200, headers: { "Last-Modified": "Thu, 22 Oct 2026 19:30:00 GMT", "Expires": new Date(T0 + 30 * 60e3).toUTCString() } });
  const T0 = Date.parse("2026-10-22T19:53:00Z");
  const up = async (u, o) => { calls.push({ u, h: o.headers }); return reply(); };
  let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error("FAIL", name); throw e; } };

  await t("first request goes upstream with UA, gzip and 4-decimal coordinates; JSON passed through", async () => {
    const r = await W.handle(req("lat=48.853412&lon=2.348812"), env, up, T0);
    assert.strictEqual(r.status, 200); assert.strictEqual(await r.text(), body); assert.strictEqual(r.headers.get("X-Cache"), "MISS");
    assert.strictEqual(r.headers.get("Access-Control-Allow-Origin"), "https://weather.yourworldapps.si");
    assert.strictEqual(calls.length, 1); assert.strictEqual(calls[0].u, "https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=48.8534&lon=2.3488");
    assert.strictEqual(calls[0].h["User-Agent"], env.UA); assert(/gzip/.test(calls[0].h["Accept-Encoding"])); assert(!calls[0].h["If-Modified-Since"]);
    assert(!("X-Forwarded-For" in calls[0].h) && !("Origin" in calls[0].h));
  });
  await t("served from cache until MET's Expires (no upstream call)", async () => {
    const r = await W.handle(req("lat=48.85349&lon=2.34889"), env, up, T0 + 10 * 60e3);
    assert.strictEqual(r.headers.get("X-Cache"), "HIT"); assert.strictEqual(calls.length, 1); assert(+r.headers.get("Cache-Control").match(/max-age=(\d+)/)[1] <= 1200);
  });
  await t("after Expires: revalidates with If-Modified-Since; 304 keeps the cached body", async () => {
    reply = () => new Response(null, { status: 304, headers: { "Expires": new Date(T0 + 70 * 60e3).toUTCString() } });
    const r = await W.handle(req("lat=48.8534&lon=2.3488"), env, up, T0 + 40 * 60e3);
    assert.strictEqual(calls.length, 2); assert.strictEqual(calls[1].h["If-Modified-Since"], "Thu, 22 Oct 2026 19:30:00 GMT");
    assert.strictEqual(r.status, 200); assert.strictEqual(r.headers.get("X-Cache"), "REVALIDATED"); assert.strictEqual(await r.text(), body);
  });
  await t("429 from MET: serve the cached copy, never retry in a loop", async () => {
    reply = () => new Response("slow down", { status: 429 });
    const r = await W.handle(req("lat=48.8534&lon=2.3488"), env, up, T0 + 80 * 60e3);
    assert.strictEqual(calls.length, 3); assert.strictEqual(r.status, 200); assert.strictEqual(r.headers.get("X-Cache"), "STALE");
    const r2 = await W.handle(req("lat=1&lon=2"), env, up, T0 + 80 * 60e3); assert.strictEqual(r2.status, 429); assert.strictEqual(calls.length, 4);
  });
  await t("other origins, missing coords, non-GET and missing UA are refused before calling MET", async () => {
    const before = calls.length;
    assert.strictEqual((await W.handle(req("lat=1&lon=2", "https://evil.example"), env, up, T0)).status, 403);
    assert.strictEqual((await W.handle(req("lat=1&lon=2", null), env, up, T0)).status, 403);
    assert.strictEqual((await W.handle(req("lat=1", "https://weather.yourworldapps.si"), env, up, T0)).status, 400);
    assert.strictEqual((await W.handle(req("lat=91&lon=2"), env, up, T0)).status, 400);
    assert.strictEqual((await W.handle(req("lat=1&lon=2", "https://weather.yourworldapps.si", "POST"), env, up, T0)).status, 405);
    assert.strictEqual((await W.handle(req("lat=1&lon=2"), { ...env, UA: "" }, up, T0)).status, 500);
    assert.strictEqual(calls.length, before);
  });
  await t("localhost only when listed in ORIGINS", async () => {
    assert.strictEqual((await W.handle(req("lat=48.8534&lon=2.3488", "http://localhost:8765"), env, up, T0)).headers.get("Access-Control-Allow-Origin"), "http://localhost:8765");
    assert.strictEqual((await W.handle(req("lat=48.8534&lon=2.3488", "http://localhost:8765"), { ...env, ORIGINS: "" }, up, T0)).status, 403);
  });
  await t("wrangler.toml is not wired to a real account and sends an identifying UA", async () => {
    const w = fs.readFileSync(path.join(__dirname, "../worker/wrangler.toml"), "utf8");
    assert(!/^account_id/m.test(w)); assert(/UA = ".*weather\.yourworldapps\.si.*@/.test(w));
  });
  console.log(`All ${n} MET Norway proxy test groups passed`);
})().catch(e => { console.error(e); process.exit(1); });
