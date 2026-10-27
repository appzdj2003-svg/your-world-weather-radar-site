// Run: node _src/tests/flightcore.test.js — /flight page logic: flight parsing, legs, weather words, FAA, SIGMETs, the rules-based estimate, time planning.
const assert = require("assert"), path = require("path");
global.YWCore = require(path.join(__dirname, "../../assets/codec-core.js"));
const F = require(path.join(__dirname, "../../assets/flightcore.js"));
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error("FAIL", name); throw e; } };
const ATL = { iata: "ATL", icao: "KATL", countryiso2: "US", lat: 33.6367, lon: -84.4281 }, SFO = { iata: "SFO", icao: "KSFO", countryiso2: "US", lat: 37.619, lon: -122.375 };
const SJC = { iata: "SJC", icao: "KSJC", countryiso2: "US", lat: 37.3626, lon: -121.929 };
const L = F.legs({ _airports: [ATL, SFO, ATL] }), NOW = Date.parse("2026-10-27T00:30:00Z");

t("flight numbers: IATA -> ICAO callsign, ICAO kept, leading zeros dropped, unknown airline flagged", () => {
  assert.strictEqual(F.parseFlight("dl 0681").cs, "DAL681"); assert.strictEqual(F.parseFlight("UA-12").cs, "UAL12");
  assert.strictEqual(F.parseFlight("DAL681").cs, "DAL681"); assert.strictEqual(F.parseFlight("5X100").cs, "UPS100");
  assert(F.parseFlight("ZZ123").unknownAirline); assert.strictEqual(F.parseFlight("hello"), null); assert.strictEqual(F.parseFlight("123"), null);
});
t("legs and leg picking: user from/to, and live plane geometry", () => {
  assert.strictEqual(L.length, 2); assert.strictEqual(F.userLeg(L, "SFO", "ATL").i, 1); assert.strictEqual(F.userLeg(L, "KATL", null).i, 0);
  assert.strictEqual(F.liveLeg(L, { lat: 34.6, lon: -88, track: 285 }).i, 0); assert.strictEqual(F.liveLeg(L, { lat: 34.6, lon: -88, track: 100 }).i, 1);
});
t("weather words: heavy only for +, nearby for VC, freezing rain not also 'rain'", () => {
  assert.deepStrictEqual(F.wxWords("+TSRA"), ["heavy thunderstorms", "rain"]); assert.deepStrictEqual(F.wxWords("-RA BR"), ["rain", "mist"]);
  assert.deepStrictEqual(F.wxWords("FZRA"), ["freezing rain"]); assert.deepStrictEqual(F.wxWords("VCTS"), ["nearby thunderstorms"]);
  const m = F.readMetar("KATL 270052Z 27015G38KT 1/2SM +TSRA OVC004 18/17 A2990 RMK AO2"); assert.strictEqual(m.gust, 38); assert.strictEqual(m.vis, 0.5); assert.strictEqual(m.fltCat, "LIFR");
});
const nas = { groundStops: [], groundDelays: [{ arpt: "SFO", reason: "wind", avg: "1 hour and 6 minutes", max: "2 hours" }], delays: [], closures: [{ arpt: "ATL", reason: "NON SKED TRANSIENT GA", gaOnly: true }] };
t("FAA: GDP avg >= 45 min is high, GA-only closures ignored, non-US airports get nothing", () => {
  assert.strictEqual(F.toMin("1 hour and 6 minutes"), 66); const s = F.nasFor(nas, SFO); assert.strictEqual(s.length, 1); assert.strictEqual(s[0].lvl, 2);
  assert.strictEqual(F.nasFor(nas, ATL).length, 0); assert.strictEqual(F.nasFor(nas, { iata: "LHR", icao: "EGLL", countryiso2: "GB" }).length, 0);
});
t("SIGMETs: only ones crossing the leg and still valid", () => {
  const box = [[38, -100], [38, -96], [33, -96], [33, -100], [38, -100]];
  const hit = F.sigmetsOnLeg([{ type: "SIGMET", hazard: "CONVECTIVE", to: NOW / 1000 + 3600, coords: box }], L[0], NOW, null);
  assert.strictEqual(hit.length, 1); assert.strictEqual(hit[0].words, "thunderstorms");
  assert.strictEqual(F.sigmetsOnLeg([{ type: "SIGMET", hazard: "TURB", to: NOW / 1000 - 60, coords: box }], L[0], NOW, null).length, 0);
  assert.strictEqual(F.sigmetsOnLeg([{ type: "SIGMET", hazard: "TURB", to: NOW / 1000 + 60, coords: [[50, 10], [51, 10], [51, 11], [50, 10]] }], L[0], NOW, null).length, 0);
  assert.strictEqual(F.sigmetsOnLeg([{ type: "AIRMET", hazard: "TURB", coords: box }], L[0], NOW, null).length, 1);
});
t("estimate: Low with nothing found, High with a big FAA program, every reason has a source", () => {
  const a0 = F.assess({ now: NOW, origin: ATL, dest: SFO, nas: { groundStops: [], groundDelays: [], delays: [], closures: [] }, wx: {}, sigmets: [] });
  assert.strictEqual(a0.level, 0); assert.strictEqual(a0.label, "Low");
  const a2 = F.assess({ now: NOW, origin: ATL, dest: SFO, nas, wx: {}, sigmets: [] }); assert.strictEqual(a2.level, 2); assert(a2.reasons.every(r => r.src)); assert(a2.todo.length);
});
t("estimate: inbound plane landing + turnaround past departure raises risk; live ETA vs schedule", () => {
  const dep = NOW + 60 * 60e3, a = F.assess({ now: NOW, origin: SFO, dest: ATL, depMs: dep, inbound: { etaMs: dep + 10 * 60e3 }, wx: {}, sigmets: [] });
  assert.strictEqual(a.level, 2); assert(/turnaround/.test(a.reasons.map(r => r.text).join(" ")));
  const b = F.assess({ now: NOW, origin: ATL, dest: SFO, arrMs: NOW + 3600e3, progress: { etaMs: NOW + 3600e3 + 25 * 60e3 }, wx: {}, sigmets: [] }); assert.strictEqual(b.level, 1);
});
t("time planning: back-by = departure - boarding; fits / tight / won't fit; walk only when close", () => {
  const P = F.plan({ now: NOW, depMs: NOW + 4 * 3600e3, boardMin: 40, secMin: 45, apt: ATL, places: [{ c: "restaurant", km: 1 }, { c: "restaurant", km: 8 }, { c: "cinema", km: 30 }] });
  assert.strictEqual(P.gateMin, 200); assert.strictEqual(P.outMin, 155);
  assert.deepStrictEqual(P.items.map(i => i.mode), ["walk", "ride", "ride"]); assert.deepStrictEqual(P.items.map(i => i.fit), ["fits", "fits", "nofit"]);
});
t("transport modes are data-driven: eVTOL never shown; Tesla Robotaxi only at airports listed (SJC today)", () => {
  const ids = a => F.modesFor(a).map(m => m.id);
  assert(!ids(ATL).includes("evtol") && !ids(SJC).includes("evtol"));
  assert(ids(SJC).includes("robotaxi")); for (const a of [ATL, SFO, { iata: "AUS", icao: "KAUS" }, { iata: "MIA", icao: "KMIA" }, { iata: "MCO" }]) assert(!ids(a).includes("robotaxi"));
  assert(F.MODES.every(m => m.id !== "ride" || !("fare" in m)), "no fares in config");
});
t("smooth plane: dead reckoning at reported speed, capped at 90 s, never on the ground or when slow", () => {
  const ac = { lat: 34, lon: -90, gs: 480, track: 90, alt: 34000, seenAt: 1e12 };
  const a = F.project(ac, 1e12 + 60e3); assert(a.moved); assert(Math.abs(F.distNm(ac, a) - 8) < 0.05);
  const b = F.project(ac, 1e12 + 600e3); assert(Math.abs(F.distNm(ac, b) - 12) < 0.05, "capped at 90 s");
  assert(!F.project({ ...ac, alt: "ground" }, 1e12 + 60e3).moved); assert(!F.project({ ...ac, gs: 20 }, 1e12 + 60e3).moved);
  const d = F.destPt({ lat: 0, lon: 0 }, 0, 60); assert(Math.abs(d.lat - 1) < 0.01 && Math.abs(d.lon) < 1e-9);
});
t("position ETA: approach buffer; airborne live track primary over FAA; AI read has Low/Medium/High", () => {
  const mid = { lat: 35.5, lon: -100, gs: 450, alt: 34000, vs: 0 };
  const pr = F.progress(mid, L[0], NOW);
  assert(pr.etaMs && pr.bufferMin >= 12);
  const lateish = F.delayEstimate({ now: NOW, arrMs: NOW + 3600e3, progress: { ...pr, etaMs: NOW + 3600e3 + 50 * 60e3, onGround: false }, origin: ATL, dest: SFO, nas: { groundStops: [], groundDelays: [], delays: [], closures: [] } });
  assert.strictEqual(lateish.liveMin, 50); assert.strictEqual(lateish.source, "live track"); assert(lateish.airborne);
  // Airborne with modest live delay + big FAA program: live stays primary, FAA becomes capped spacing cushion
  const livePlusFaa = F.delayEstimate({ now: NOW, arrMs: NOW + 3600e3, progress: { etaMs: NOW + 3600e3 + 10 * 60e3, onGround: false }, origin: ATL, dest: SFO, nas });
  assert.strictEqual(livePlusFaa.source, "live track + FAA spacing");
  assert.strictEqual(livePlusFaa.lateMin, 10);
  assert(livePlusFaa.faaAddMin && livePlusFaa.faaAddMin[1] <= 30);
  // Pre-takeoff (no solid airborne ETA): FAA still wins normally
  const faaWins = F.delayEstimate({ now: NOW, arrMs: NOW + 3600e3, progress: null, origin: ATL, dest: SFO, nas });
  assert.strictEqual(faaWins.source, "FAA"); assert(faaWins.lateMin >= 60);
  const fog = F.assess({ now: NOW, origin: ATL, dest: SFO, arrMs: NOW + 3600e3,
    progress: { etaMs: NOW + 3600e3 + 40 * 60e3, bufferMin: 18, onGround: false },
    wx: { KSFO: { metar: { fltCat: "LIFR", vis: 0.25, wxString: "FG", gust: 0, clouds: [{ cover: "VV", base: 100 }] }, taf: null } },
    nas: { groundStops: [], groundDelays: [], delays: [], closures: [] }, sigmets: [] });
  assert.strictEqual(fog.label, "High"); assert(fog.read); assert(/Fog|LIFR|visibility|behind|late/i.test(fog.read.headline));
  assert.strictEqual(fog.read.disclaimer, "AI estimate, not the airline's official status");
  assert.deepStrictEqual(F.LV, ["Low", "Medium", "High"]);
});
t("DEN fog: airborne early live ETA is primary; FAA arrival delay only as capped spacing; headline agrees with projected arrival", () => {
  const DEN = { iata: "DEN", icao: "KDEN", countryiso2: "US", lat: 39.8561, lon: -104.6737, name: "Denver International Airport" };
  const RIW = { iata: "RIW", icao: "KRIW", countryiso2: "US", lat: 43.0642, lon: -108.4597, name: "Riverton Regional" };
  const arrMs = Date.parse("2026-10-27T15:08:00Z"); // 9:08 AM MT
  const etaMs = Date.parse("2026-10-27T14:59:00Z"); // 8:59 AM — ~9 min early
  const nasDen = { groundStops: [], groundDelays: [],
    delays: [{ arpt: "DEN", reason: "WX:FG", min: "42 minutes", max: "1 hour and 44 minutes", trend: "increasing", type: "Arrival" }],
    closures: [] };
  const de = F.delayEstimate({ now: NOW, arrMs, progress: { etaMs, bufferMin: 18, onGround: false }, origin: RIW, dest: DEN, nas: nasDen });
  assert(de.airborne); assert.strictEqual(de.liveMin, -9); assert.strictEqual(de.lateMin, -9);
  assert.strictEqual(de.etaMs, etaMs); assert.notStrictEqual(de.source, "FAA");
  assert(de.faaAddMin && de.faaAddMin[0] >= 5 && de.faaAddMin[1] <= 30);
  const a = F.assess({ now: NOW, origin: RIW, dest: DEN, arrMs,
    progress: { etaMs, bufferMin: 18, onGround: false },
    wx: { KDEN: { metar: { fltCat: "LIFR", vis: 0.25, wxString: "FG", gust: 0, clouds: [{ cover: "VV", base: 100 }] }, taf: null } },
    nas: nasDen, sigmets: [] });
  assert.strictEqual(a.read.lateMin, -9);
  assert.strictEqual(a.read.etaMs, etaMs);
  assert.strictEqual(a.read.rangeKind, "spacing");
  assert(a.read.range[1] <= 30, "spacing cushion capped");
  assert(/Tracking about on time|early/i.test(a.read.headline), a.read.headline);
  assert(/Fog|FAA spacing/i.test(a.read.headline), a.read.headline);
  assert(!/Likely 42 min|1 h 44|Likely .* late/i.test(a.read.headline), "must not claim FAA-wide late when live is early: " + a.read.headline);
  // Headline uses {ETA} placeholder; UI fills it from the same etaMs as Projected arrival / live tick
  assert(a.read.headline.includes("{ETA}"), `headline should use {ETA} placeholder: ${a.read.headline}`);
  assert(!/\d{1,2}:\d{2}/.test(a.read.headline.replace("{ETA}", "")), "must not bake a clock into the headline");
});
t("liveEtaMs matches progress.etaMs (shared ETA for headline, projected, countdown)", () => {
  const DEN = { iata: "DEN", icao: "KDEN", lat: 39.8561, lon: -104.6737 };
  const RIW = { iata: "RIW", icao: "KRIW", lat: 43.0642, lon: -108.4597 };
  const ac = { lat: 41.0, lon: -106.5, gs: 420, alt: 32000, track: 140 };
  const leg = { from: RIW, to: DEN };
  const pr = F.progress(ac, leg, NOW);
  assert(pr && pr.etaMs);
  assert.strictEqual(F.liveEtaMs(ac, leg, NOW), pr.etaMs);
  assert.strictEqual(F.liveEtaMs(null, leg, NOW), null);
});


(async () => {
  const tok = await F.encode({ v: 1, fn: "DL681", from: "SFO", to: "ATL", dep: "2026-10-27T03:45:00.000Z" });
  assert(/^v1\./.test(tok)); const back = await F.decode(tok); assert.strictEqual(back.fn, "DL681"); assert.strictEqual(back.from, "SFO"); n++;
  let bad = false; try { const r = await F.decode("v1.garbage"); bad = !r; } catch (e) { bad = true; } assert(bad);
  console.log(`flightcore: ${n} tests passed`);
})().catch(e => { console.error(e); process.exit(1); });
