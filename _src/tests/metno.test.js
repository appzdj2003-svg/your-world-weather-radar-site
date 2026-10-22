// Run: node _src/tests/metno.test.js — MET Norway Locationforecast -> trip days, using real saved responses (Oct 22, 2026).
const assert = require("assert"), fs = require("fs"), path = require("path");
const M = require("../../assets/metno.js"), C = require("../../assets/tripcore.js");
const fx = c => JSON.parse(fs.readFileSync(path.join(__dirname, `fixtures/metno-${c}.json`), "utf8"));
const places = JSON.parse(fs.readFileSync(path.join(__dirname, "../../assets/places.json"), "utf8"));
const TZ = { paris: "Europe/Paris", tokyo: "Asia/Tokyo", manila: "Asia/Manila", oslo: "Europe/Oslo" };
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error("FAIL", name); throw e; } };

t("coordinates truncated to at most 4 decimals", () => {
  assert.strictEqual(M.coord(48.85341), "48.8534"); assert.strictEqual(M.coord(-33.868799), "-33.8687"); assert.strictEqual(M.coord(2.3488), "2.3488"); assert.strictEqual(M.coord(10), "10");
  const u = M.url("https://api.met.no/weatherapi/locationforecast/2.0/complete", 35.689487, 139.691706);
  assert.strictEqual(u, "https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=35.6894&lon=139.6917");
  for (const m of u.match(/-?\d+\.\d+/g)) assert(m.split(".")[1].length <= 4);
});
t("places.json carries an IANA time zone per row", () => {
  assert.strictEqual(places.z.length, places.rows.length);
  const tz = name => M.tzFor(C.resolve(places.rows, name), places.rows, places);
  assert.strictEqual(tz("Paris"), "Europe/Paris"); assert.strictEqual(tz("Tokyo"), "Asia/Tokyo"); assert.strictEqual(tz("Manila"), "Asia/Manila"); assert.strictEqual(tz("Oslo"), "Europe/Oslo");
});
t("Paris, Tokyo, Manila: MET gives no rain chance, thunder chance or gusts -> null (never estimated)", () => {
  for (const c of ["paris", "tokyo", "manila"]) {
    const ds = M.days(fx(c), TZ[c]); assert(ds.length >= 8, c);
    assert.deepStrictEqual(M.fields(ds), { pop: false, thunderPct: false, gust: false, precip: true }, c);
    for (const d of ds) { assert.strictEqual(d.pop, null); assert.strictEqual(d.thunderPct, null); assert.strictEqual(d.gust, null); assert.strictEqual(d.src, "metno");
      assert(typeof d.precipMm === "number" && d.precipMm >= 0); assert(d.hi == null || d.lo == null || d.hi >= d.lo); }
  }
});
t("Oslo: MET gives rain chance, thunder chance and gusts, and they are passed through", () => {
  const ds = M.days(fx("oslo"), TZ.oslo); assert.deepStrictEqual(M.fields(ds), { pop: true, thunderPct: true, gust: true, precip: true });
  assert(ds.some(d => d.pop > 0)); assert(ds.every(d => d.pop == null || (d.pop >= 0 && d.pop <= 100)));
});
t("days are grouped by the destination's local date", () => {
  const j = fx("tokyo"), ds = M.days(j, TZ.tokyo), first = j.properties.timeseries[0].time;
  assert.strictEqual(ds[0].date, M.local(first, TZ.tokyo).date);
  assert.strictEqual(M.local("2026-10-22T16:00:00Z", "Asia/Tokyo").date, "2026-10-23");   // 01:00 next day in Tokyo
  assert.strictEqual(M.local("2026-10-22T16:00:00Z", "Europe/Paris").date, "2026-10-22");
  const dates = ds.map(d => d.date); assert.deepStrictEqual(dates, [...dates].sort()); assert.strictEqual(new Set(dates).size, dates.length);
});
t("daily rain = MET's own amounts, without double counting 1h and 6h blocks", () => {
  const j = fx("paris"), ds = M.days(j, TZ.paris);
  const all1h = j.properties.timeseries.reduce((s, p) => s + ((p.data.next_1_hours || {}).details || {}).precipitation_amount || 0, 0);
  const tot = ds.reduce((s, d) => s + d.precipMm, 0); assert(tot >= all1h - 0.05, "at least the hourly total");
  assert(tot < all1h + j.properties.timeseries.reduce((s, p) => s + (((p.data.next_6_hours || {}).details || {}).precipitation_amount || 0), 0));
});
t("symbols use MET's legend text and drive thunder/snow flags", () => {
  assert.strictEqual(M.symText("heavyrainandthunder"), "Heavy rain and thunder"); assert.strictEqual(M.symText("partlycloudy_day"), "Partly cloudy");
  const fake = { properties: { meta: {}, timeseries: [
    { time: "2026-11-02T11:00:00Z", data: { instant: { details: { air_temperature: 20, wind_speed: 3 } }, next_6_hours: { summary: { symbol_code: "rainandthunder" }, details: { air_temperature_max: 22, air_temperature_min: 15, precipitation_amount: 6 } } } }] } };
  const d = M.days(fake, "UTC")[0]; assert.strictEqual(d.thunder, true); assert.strictEqual(d.pop, null); assert.strictEqual(C.risk(d).k, "storm");
});
t("risk and score without a rain chance use rain amount", () => {
  const base = { pop: null, thunder: false, snow: false, hi: 68, lo: 55, wind: 8 };
  assert.strictEqual(C.risk({ ...base, precipMm: 0 }).k, "good");
  assert.strictEqual(C.risk({ ...base, precipMm: 2 }).k, "maybe");
  assert.strictEqual(C.risk({ ...base, precipMm: 9 }).k, "rain");
  assert.strictEqual(C.risk({ ...base, snow: true, precipMm: 3 }).k, "snow");
  assert(C.score({ ...base, precipMm: 0 }) > C.score({ ...base, precipMm: 9 }));
  assert(/in of rain/.test(C.risk({ ...base, precipMm: 9 }).t) || C.risk({ ...base, precipMm: 9 }).t === "Rain forecast");
});
t("summary carries MET rain amount, not a made-up chance", () => {
  const ds = M.days(fx("manila"), TZ.manila); ds.forEach(d => d.risk = C.risk(d));
  const s = C.summary(ds, { sd: ds[1].date, d: 3 }); assert.strictEqual(s.pop, null); assert(s.rainMm > 0 && s.rainIn > 0);
  const itin = C.itinerary({ sd: ds[1].date, d: 3, act: "city", mode: "fly" }, ds, null, ds[0].date);
  assert(itin.every(x => x.w)); assert(!JSON.stringify(itin).includes("% chance"));
});
t("attribution credits MET Norway with licence link, and no Yr branding", () => {
  assert(/MET Norway/.test(M.ATTR) && /creativecommons\.org\/licenses\/by\/4\.0/.test(M.ATTR) && /summarized by us/.test(M.ATTR)); assert(!/\bYr\b/.test(M.ATTR));
});
console.log(`All ${n} MET Norway test groups passed`);
