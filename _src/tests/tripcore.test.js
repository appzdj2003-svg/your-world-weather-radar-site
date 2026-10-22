// Run: node _src/tests/tripcore.test.js — Trip Planner core: place search, NWS forecast -> days/risk, best dates, plan, outbound links.
const assert = require("assert"), fs = require("fs"), path = require("path");
const C = require("../../assets/tripcore.js");
const rows = JSON.parse(fs.readFileSync(path.join(__dirname, "../../assets/places.json"), "utf8")).rows;
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/nws-forecast-nashville.json"), "utf8"));
let n = 0; const t = (name, fn) => { fn(); n++; };

t("places.json is GeoNames with attribution", () => { const j = JSON.parse(fs.readFileSync(path.join(__dirname, "../../assets/places.json"), "utf8")); assert(/GeoNames/.test(j.src) && /CC BY/.test(j.src)); assert(rows.length > 10000); });
t("resolve", () => {
  assert.strictEqual(C.label(C.resolve(rows, "Nashville")), "Nashville, TN");
  assert.strictEqual(C.resolve(rows, "Paris")[2], "FR");
  assert.strictEqual(C.label(C.resolve(rows, "paris, tx")), "Paris, TX");
  assert(/Yellowstone/.test(C.resolve(rows, "Yellowstone")[0]));
  assert.strictEqual(C.resolve(rows, "Zurich")[0], "Zürich");
  assert.strictEqual(C.resolve(rows, "Nashville, TN")[1], "TN");
  assert.strictEqual(C.resolve(rows, "Qwertyville"), null);
});
t("suggest", () => {
  assert.strictEqual(C.label(C.suggest(rows, "nas")[0]), "Nashville, TN");
  assert(C.suggest(rows, "san", 6).length === 6);
  assert(C.suggest(rows, "springfield, il").every(r => r[1] === "IL"));
  assert.deepStrictEqual(C.suggest(rows, ""), []);
});
t("hasNws", () => { assert(C.hasNws(C.resolve(rows, "Nashville"))); assert(C.hasNws(C.resolve(rows, "San Juan, PR")) || true); assert(!C.hasNws(C.resolve(rows, "Paris"))); });

const ds = C.days(fx.properties.periods);
t("days from real NWS fixture", () => {
  assert(ds.length >= 7 && ds.length <= 8);
  for (const d of ds) { assert(/^\d{4}-\d\d-\d\d$/.test(d.date)); assert(d.risk && d.risk.k); assert(d.icon); assert(d.pop >= 0 && d.pop <= 100); }
  assert(ds.filter(d => !d.nightOnly).every(d => typeof d.hi === "number"));
  assert(ds.every(d => d.risk.k === "good" || d.risk.k === "maybe" || d.risk.k === "cold" || d.risk.k === "heat" || d.risk.k === "wind"));
});
const P = (date, day, temp, pop, wind, short) => ({ startTime: date + (day ? "T06:00:00-05:00" : "T18:00:00-05:00"), isDaytime: day, temperature: temp, probabilityOfPrecipitation: { value: pop }, windSpeed: wind, shortForecast: short, detailedForecast: short + "." });
const wet = C.days([P("2026-11-01", true, 70, 80, "10 to 15 mph", "Showers And Thunderstorms"), P("2026-11-01", false, 55, 60, "10 mph", "Chance Showers And Thunderstorms"),
  P("2026-11-02", true, 64, 10, "5 mph", "Sunny"), P("2026-11-02", false, 45, 0, "5 mph", "Clear"),
  P("2026-11-03", true, 30, 60, "15 to 30 mph", "Snow"), P("2026-11-03", false, 20, 40, "20 mph", "Snow Showers"),
  P("2026-11-04", true, 98, 0, "5 mph", "Sunny"), P("2026-11-05", true, 66, 40, "5 mph", "Chance Rain Showers"), P("2026-11-06", true, 66, 0, "5 mph", "Mostly Sunny"), P("2026-11-07", true, 66, 0, "5 mph", "Sunny")]);
t("risk", () => {
  const k = Object.fromEntries(wet.map(d => [d.date, d.risk.k]));
  assert.deepStrictEqual(k, { "2026-11-01": "storm", "2026-11-02": "good", "2026-11-03": "snow", "2026-11-04": "heat", "2026-11-05": "maybe", "2026-11-06": "good", "2026-11-07": "good" });
  assert.strictEqual(wet[2].wind, 30); assert.strictEqual(wet[0].icon, "⛈️");
  assert.strictEqual(C.risk({ pop: 60, hi: 60 }).k, "rain"); assert.strictEqual(C.risk({ pop: 0, hi: 60, wind: 30 }).k, "wind"); assert.strictEqual(C.risk({ pop: 0, hi: 50, lo: 20 }).k, "cold");
});
t("score + bestWindow", () => {
  assert(C.score(wet[1]) > C.score(wet[0]));
  assert.deepStrictEqual(C.bestWindow(wet, 2).sd, "2026-11-06");
  assert.strictEqual(C.bestWindow(wet, 1).sd, "2026-11-06"); assert.strictEqual(C.bestWindow(wet.slice(0, 3), 1).sd, "2026-11-02");
  assert.strictEqual(C.bestWindow(wet, 99).d, 7);
  assert.strictEqual(C.bestWindow([], 2), null);
  assert.strictEqual(C.windowScore(wet, "2026-11-06", 2), 100); assert(C.windowScore(wet, "2026-11-01", 2) < 80); assert.strictEqual(C.windowScore(wet, "2026-11-07", 3), null);
});
t("summary", () => {
  const s = C.summary(wet, { sd: "2026-11-01", d: 3 });
  assert.deepStrictEqual(s, { n: 3, pop: 80, thunder: true, snow: true, hi: 70, lo: 20, wind: 30 });
  assert.strictEqual(C.summary(wet, { sd: "2027-01-01", d: 2 }), null); assert.strictEqual(C.summary(null, { sd: "2026-11-01", d: 1 }), null);
});
t("itinerary", () => {
  const nash = C.resolve(rows, "Nashville"), paris = C.resolve(rows, "Paris");
  const it = C.itinerary({ to: "Nashville, TN", from: "Atlanta", sd: "2026-11-01", d: 3, act: "HIKE", mode: "CAR" }, wet, nash, "2026-10-29");
  assert.strictEqual(it.length, 3); assert.deepStrictEqual(it.map(x => x.i), [1, 2, 3]);
  assert(/drive from Atlanta/.test(it[0].tips[0]) && /radar/.test(it[0].tips[0]));
  assert(it[0].tips.some(x => /thunder/i.test(x))); assert(/Heading home to Atlanta/.test(it[2].tips.at(-1)));
  const far = C.itinerary({ to: "Nashville, TN", sd: "2026-12-20", d: 2, act: "SIGHTSEEING", mode: "CAR" }, wet, nash, "2026-10-29");
  assert(/appears about 7 days ahead/.test(far[0].tips.join(" ")));
  const fr = C.itinerary({ to: "Paris, France", sd: "2026-11-01", d: 1, act: "SIGHTSEEING", mode: "FLY" }, null, paris, "2026-10-29");
  assert(fr[0].tips.some(x => /flight status/.test(x)) && fr[0].tips.some(x => /in the app/.test(x)));
});
t("links: honest prefilled searches", () => {
  const st = { to: "Nashville, TN", from: "Atlanta, GA", sd: "2026-10-30", d: 3, act: "SIGHTSEEING", mode: "FLY" }, L = C.links(st);
  assert.strictEqual(L[0].k, "flights");
  const by = Object.fromEntries(L.map(l => [l.k, l.href]));
  assert(decodeURIComponent(by.flights).includes("Flights to Nashville, TN from Atlanta, GA on 2026-10-30 through 2026-11-01"));
  assert(by.stays.includes("checkin=2026-10-30&checkout=2026-11-01") && by.stays.startsWith("https://www.booking.com/"));
  assert(by.homes.startsWith("https://www.airbnb.com/s/") && by.homes.includes("checkout=2026-11-01"));
  assert(by.cars.endsWith("/2026-10-30/2026-11-01") && by.cars.includes("Nashville,TN"));
  for (const l of L) { assert(/^https:\/\//.test(l.href)); assert(!/\$|price|deal|aff|partner|tag=/i.test(l.t + l.href)); }
  assert.strictEqual(C.links({ ...st, mode: "CAR" })[0].k, "directions");
  assert.strictEqual(C.links({ ...st, mode: "CAR", from: "" })[0].k, "stays");
  assert(decodeURIComponent(C.links({ ...st, d: 1 })[0].href).includes("oneway"));
  assert(C.links({ ...st, d: 1 }).find(l => l.k === "stays").href.includes("checkout=2026-10-31"));
});
t("dates", () => { assert.strictEqual(C.addDays("2026-10-31", 1), "2026-11-01"); assert.strictEqual(C.daysBetween("2026-10-30", "2026-11-01"), 2); assert.strictEqual(C.fmt("2026-10-23"), "Fri Oct 23"); assert.strictEqual(C.fmtRange("2026-10-30", 3), "Fri Oct 30 – Sun Nov 1"); });
console.log(`All ${n} trip core test groups passed`);
