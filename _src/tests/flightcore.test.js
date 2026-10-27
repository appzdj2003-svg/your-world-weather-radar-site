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
t("liveLeg returns null when the plane is far off every standing leg (stale reuse)", () => {
  const MIA = { iata: "MIA", icao: "KMIA", countryiso2: "US", lat: 25.7932, lon: -80.290604 };
  const DFW = { iata: "DFW", icao: "KDFW", countryiso2: "US", lat: 32.896801, lon: -97.038002 };
  const NAS = { iata: "NAS", icao: "MYNN", countryiso2: "BS", lat: 25.039, lon: -77.4662 };
  const CLT = { iata: "CLT", icao: "KCLT", countryiso2: "US", lat: 35.214, lon: -80.9431 };
  const stale = F.legs({ _airports: [MIA, DFW] });
  const today = F.legs({ _airports: [NAS, CLT] });
  const ac = { lat: 34.064667, lon: -80.019369, alt: 20275, gs: 373.9, track: 333.98 }; // AAL893 near Florence SC
  assert.strictEqual(F.liveLeg(stale, ac), null);
  assert(!F.legFits(ac, stale[0]));
  assert(F.legFits(ac, today[0]));
  assert.strictEqual(F.liveLeg(today, ac).i, 0);
  assert(F.legScore(ac, stale[0]) > F.LEG_FIT_MAX);
  assert(F.legScore(ac, today[0]) < 20);
});
t("fromAdsbdb normalizes callsign JSON into standing-data shape", () => {
  const j = { response: { flightroute: {
    callsign: "AAL893", callsign_icao: "AAL893",
    origin: { country_iso_name: "BS", iata_code: "NAS", icao_code: "MYNN", latitude: 25.039, longitude: -77.4662, municipality: "Nassau", name: "Lynden Pindling International Airport", elevation: 16 },
    destination: { country_iso_name: "US", iata_code: "CLT", icao_code: "KCLT", latitude: 35.214, longitude: -80.9431, municipality: "Charlotte", name: "Charlotte Douglas International Airport", elevation: 748 }
  }}};
  const r = F.fromAdsbdb(j);
  assert(r && r._src === "adsbdb");
  const L = F.legs(r);
  assert.strictEqual(L.length, 1);
  assert.strictEqual(L[0].from.iata, "NAS");
  assert.strictEqual(L[0].to.iata, "CLT");
  assert.strictEqual(F.fromAdsbdb({ response: "unknown callsign" }), null);
  assert(F.sameEndpoints(L[0], L[0]));
  assert(!F.sameEndpoints(L[0], F.legs({ _airports: [{ iata: "MIA", icao: "KMIA", lat: 25.7, lon: -80.2 }, { iata: "DFW", icao: "KDFW", lat: 32.9, lon: -97 }] })[0]));
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

t("canceled helpers: peers, rebook, nearby airports, Google Flights URL", () => {
  const idx = { "KFSD-KDEN": ["SKW5701", "FFT1629"], "KDEN-KFSD": ["SKW5229"] };
  const peers = F.peersForPair(idx, "KFSD", "KDEN");
  assert.strictEqual(peers.length, 3);
  assert(peers.some(p => p.cs === "SKW5701"));
  const live = F.matchLivePeers(peers, [{ flight: "SKW5701 ", alt: 22000, gs: 400, lat: 42, lon: -100 }, { flight: "FFT1629", alt: "ground", gs: 0 }]);
  assert.strictEqual(live.find(p => p.cs === "SKW5701").live.airborne, true);
  assert.strictEqual(live.find(p => p.cs === "FFT1629").live.airborne, false);
  assert.strictEqual(live.find(p => p.cs === "SKW5229").live, null);
  const rb = F.rebookFor({ iata: "UA", icao: "UAL" });
  assert.strictEqual(rb.iata, "UA"); assert(/united\.com/i.test(rb.url));
  const skw = F.rebookFor({ icao: "SKW", iata: "OO" });
  assert(skw && skw.iata === "UA", "SkyWest maps to a mainline rebook page");
  assert(/transportation\.gov.*refund/i.test(F.DOT_REFUNDS));
  const DEN = { iata: "DEN", icao: "KDEN", lat: 39.856, lon: -104.674 };
  const near = F.nearbyAirports(DEN, [
    { iata: "COS", icao: "KCOS", lat: 38.806, lon: -104.7, name: "Colorado Springs" },
    { iata: "CYS", icao: "KCYS", lat: 41.155, lon: -104.81, name: "Cheyenne" },
    { iata: "LAX", icao: "KLAX", lat: 33.94, lon: -118.41, name: "Los Angeles" },
    { iata: "DEN", icao: "KDEN", lat: 39.856, lon: -104.674, name: "Denver" }
  ], 100);
  assert(near.some(a => a.iata === "COS"));
  assert(!near.some(a => a.iata === "LAX" || a.iata === "DEN"));
  const url = F.googleFlightsUrl("FSD", "DEN", "2026-10-27");
  assert(/google\.com\/travel\/flights/.test(url) && /FSD/.test(decodeURIComponent(url)) && /DEN/.test(decodeURIComponent(url)));
});

(async () => {
  const tok = await F.encode({ v: 1, fn: "DL681", from: "SFO", to: "ATL", dep: "2026-10-27T03:45:00.000Z" });
  assert(/^v1\./.test(tok)); const back = await F.decode(tok); assert.strictEqual(back.fn, "DL681"); assert.strictEqual(back.from, "SFO"); n++;
  let bad = false; try { const r = await F.decode("v1.garbage"); bad = !r; } catch (e) { bad = true; } assert(bad);
  console.log(`flightcore: ${n} tests passed`);
})().catch(e => { console.error(e); process.exit(1); });

t("polish2: FAA why uses place names + neat durations, All signals keep center codes", () => {
  const DEN = { iata: "DEN", icao: "KDEN", countryiso2: "US", lat: 39.86, lon: -104.67, name: "Denver International Airport" };
  const ATL = { iata: "ATL", icao: "KATL", countryiso2: "US", lat: 33.64, lon: -84.43, name: "Hartsfield-Jackson Atlanta International" };
  const nas = { groundStops: [], groundDelays: [],
    delays: [{ arpt: "DEN", reason: "ZDV / WX:Fog", min: "1 hour and 1 minute", max: "1 hour and 15 minutes", trend: "increasing", type: "Arrival" }],
    closures: [] };
  const a = F.assess({ now: NOW, origin: ATL, dest: DEN, nas, wx: {}, sigmets: [] });
  const why = a.read.why.join(" | ");
  assert(/Denver/i.test(why), "why should name Denver: " + why);
  assert(!/\bZDV\b/.test(why), "why must drop ARTCC code: " + why);
  assert(/1 h 1 min to 1 h 15 min/.test(why), "why neat duration: " + why);
  const all = a.reasons.map(r => r.text).join(" | ");
  assert(/\bZDV\b/.test(all), "All signals keep ZDV: " + all);
  assert(/\bDEN\b/.test(all), "All signals keep DEN: " + all);
});
t("polish2: route fog only when visibility under 3 mi; names not ICAO", () => {
  const flags = F.routeWxFlags([
    { icaoId: "KMDS", name: "Madison Muni, SD, US", fltCat: "LIFR", visib: "10+", wxString: null, clouds: [{ cover: "VV", base: 200 }] },
    { icaoId: "KMVE", name: "Montevideo/Chippewa Cnty, MN, US", fltCat: "LIFR", visib: "2.5", wxString: "BR", clouds: [{ cover: "VV", base: 100 }] },
  ]);
  // 2.5 mi BR is mist, not fog: poor-visibility flag with the town name, never "fog".
  assert.strictEqual(flags.filter(f => f.kind === "fog").length, 0, "mist is not fog: " + JSON.stringify(flags));
  const mve = flags.find(f => /Montevideo/i.test(f.text));
  assert(mve && /poor visibility/i.test(mve.text) && !/fog/i.test(mve.text), JSON.stringify(mve));
  assert(!/\bKMVE\b/.test(mve.text), mve.text);
  const ceil = flags.filter(f => /Madison/i.test(f.text));
  assert(ceil.length >= 1, "Madison low ceiling still noted");
  assert(!/fog/i.test(ceil[0].text), "Madison must not claim fog with 10+ mi: " + ceil[0].text);
});

t("fog only when visibility supports it (AAL893 / CLT 10 SM regression)", () => {
  const NAS = { icao: "MYNN", iata: "NAS", name: "Lynden Pindling International Airport", lat: 25.039, lon: -77.4662 };
  const CLT = { icao: "KCLT", iata: "CLT", countryiso2: "US", name: "Charlotte Douglas International Airport", lat: 35.214, lon: -80.9431 };
  const none = { groundStops: [], groundDelays: [], delays: [], closures: [] };
  const clt10 = { KCLT: { metar: { fltCat: "VFR", vis: 10, wxString: "", gust: 0, clouds: [{ cover: "FEW", base: 25000 }] }, taf: null } };
  const base = { now: NOW, origin: NAS, dest: CLT, progress: { etaMs: NOW + 15 * 60e3, onGround: false }, nas: none, sigmets: [] };
  // Real Oct 27 trigger: St. Augustine route sample IFR, 5 SM haze, BKN009 — CLT itself 10 SM VFR.
  const a = F.assess({ ...base, wx: clt10, routeWx: [{ icaoId: "KSGJ", name: "St Augustine Arpt, FL, US", fltCat: "IFR", visib: 5, wxString: "HZ", clouds: [{ cover: "BKN", base: 900 }] }] });
  assert(!/fog/i.test(a.read.headline), a.read.headline);
  assert.strictEqual(a.level, 0, "en-route haze must not raise risk: " + a.read.headline);
  assert(a.reasons.some(r => /St Augustine|KSGJ/.test(r.text)), "still listed in All signals");
  // Ceiling-only IFR / LIFR at the destination with 10 SM: low ceilings, never "fog".
  for (const fltCat of ["IFR", "LIFR"]) {
    const b = F.assess({ ...base, arrMs: NOW + 20 * 60e3, wx: { KCLT: { metar: { fltCat, vis: 10, wxString: "", gust: 0, clouds: [{ cover: "OVC", base: 300 }] }, taf: null } } });
    assert(!/fog/i.test(b.read.headline), fltCat + ": " + b.read.headline);
    assert(!b.reasons.some(r => r.kind === "fog"), fltCat + " no fog reason");
  }
  // BR (mist) with 10 SM is nothing; FG with 10 SM (bad obs) is nothing.
  for (const wxString of ["BR", "FG"]) {
    const c = F.assess({ ...base, wx: { KCLT: { metar: { fltCat: "VFR", vis: 10, wxString, gust: 0, clouds: [] }, taf: null } } });
    assert.strictEqual(c.level, 0, wxString); assert(!/fog/i.test(c.read.headline), c.read.headline);
  }
  // Real fog (1/4 SM FG) still reads as fog.
  const d = F.assess({ ...base, wx: { KCLT: { metar: { fltCat: "LIFR", vis: 0.25, wxString: "FG", gust: 0, clouds: [{ cover: "VV", base: 100 }] }, taf: null } } });
  assert(/^Fog at CLT \(visibility 0\.25 miles\)/.test(d.read.headline), d.read.headline);
  assert(F.isFogVis(0.5) && !F.isFogVis(1) && !F.isLowVis(10));
  const rf = F.routeWxFlags([{ icaoId: "KAAA", name: "Alpha", fltCat: "LIFR", visib: "1/4", wxString: "FG", clouds: [{ cover: "VV", base: 100 }] }]);
  assert(rf.some(f => f.kind === "fog" && /^Fog near Alpha/.test(f.text)), JSON.stringify(rf));
});

t("canceled_private: both-ends BOS-HYA / BUR-LAS; LAX-JFK no scheduled; drive/Amtrak", () => {
  const BOS = { iata: "BOS", icao: "KBOS", lat: 42.364, lon: -71.005, name: "Boston" };
  const HYA = { iata: "HYA", icao: "KHYA", lat: 41.669, lon: -70.280, name: "Hyannis" };
  const DAL = { iata: "DAL", icao: "KDAL", lat: 32.847, lon: -96.852, name: "Dallas Love" };
  const AUS = { iata: "AUS", icao: "KAUS", lat: 30.194, lon: -97.670, name: "Austin" };
  const LAX = { iata: "LAX", icao: "KLAX", lat: 33.943, lon: -118.408, name: "Los Angeles" };
  const JFK = { iata: "JFK", icao: "KJFK", lat: 40.640, lon: -73.779, name: "JFK" };
  const BUR = { iata: "BUR", icao: "KBUR", lat: 34.201, lon: -118.359, name: "Burbank" };
  const LAS = { iata: "LAS", icao: "KLAS", lat: 36.080, lon: -115.152, name: "Las Vegas" };
  const apts = [BOS, HYA, DAL, AUS, LAX, JFK, BUR, LAS];
  const bosHya = F.carriersForRoute(BOS, HYA, F.SEMI_PRIVATE, apts, 60);
  assert(bosHya.match.some(c => c.id === "cape_air"), "Cape Air both-ends BOS-HYA: " + bosHya.match.map(c => c.id));
  const burLas = F.carriersForRoute(BUR, LAS, F.SEMI_PRIVATE, apts, 60);
  assert(burLas.match.some(c => c.id === "jsx"), "JSX both-ends BUR-LAS: " + burLas.match.map(c => c.id));
  const laxJfk = F.carriersForRoute(LAX, JFK, F.SEMI_PRIVATE, apts, 60);
  assert.strictEqual(laxJfk.match.length, 0, "no scheduled match LAX-JFK: " + laxJfk.match.map(c => c.id));
  assert.strictEqual(laxJfk.closer.length, 0, "no closer LAX-JFK: " + laxJfk.closer.map(c => c.id));
  // One-end proximity must NOT promote Cape Air on LAX-JFK via carriersForRoute
  const legacy = F.carriersNear(LAX, JFK, F.SEMI_PRIVATE, apts, 60);
  assert(legacy.some(c => c.id === "cape_air"), "carriersNear still one-end (Blade-style)");
  const DEN = { iata: "DEN", icao: "KDEN", lat: 39.862, lon: -104.673, name: "Denver" };
  const SEA = { iata: "SEA", icao: "KSEA", lat: 47.450, lon: -122.309, name: "Seattle" };
  const none = F.carriersForRoute(DEN, SEA, F.SEMI_PRIVATE.filter(c => c.id === "cape_air"), apts.concat([DEN, SEA]), 60);
  assert.strictEqual(none.match.length + none.closer.length, 0, "Cape Air should not match DEN-SEA");
  const ch = F.charterNear(JFK, BOS, apts, 60);
  assert(ch.some(c => c.id === "blade"), "Blade near JFK");
  assert(ch.some(c => c.id === "charter_search"), "general charter always");
  const short = F.driveVsFly(BOS, HYA, { nextFlightWaitMin: 300 });
  assert(short && short.showDrive, "BOS-HYA drive should show: " + JSON.stringify(short));
  assert(short.roadMi > 50 && short.roadMi < 120, "road mi sane: " + short.roadMi);
  const long = F.driveVsFly(LAX, JFK, {});
  assert(long && (long.hide || !long.showDrive), "LAX-JFK should not promote drive");
  const am = F.amtrakFor(BOS, JFK);
  assert.strictEqual(am.route, "Northeast Corridor");
  const am2 = F.amtrakFor(HYA, DAL);
  assert(!am2.route, "no false Amtrak claim");
  assert(am2.searchUrl.includes("amtrak.com"));
});
