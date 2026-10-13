// Run: node _src/tests/outlook.test.js  — World Weather Outlook parsers + briefing script (no network).
const assert = require("assert"), O = require("../../assets/outlook.js");
const nhc = O.parseNhc([{ id: "ep202026", name: "Simon", classification: "HU", intensity: "80", pressure: "977", latitudeNumeric: 20.4, longitudeNumeric: -107.2, movementDir: 285, movementSpeed: 3, cone: "c.png", graphics: "g" },
  { id: "al012026", name: "Bad" }]);
assert.strictEqual(nhc.length, 1); assert.deepStrictEqual([nhc[0].mph, nhc[0].cat, nhc[0].basin, nhc[0].move, nhc[0].type], [92, 1, "Eastern Pacific", "WNW at 3 mph", "Hurricane"]);
const gd = O.parseGdacs({ features: [
  { geometry: { coordinates: [-107.2, 20.6] }, properties: { eventtype: "TC", iscurrent: "true", eventname: "SIMON-26", alertlevel: "Orange", country: "Mexico", severitydata: { severity: 250 }, url: { report: "r" } } },
  { geometry: { coordinates: [130, 15] }, properties: { eventtype: "TC", iscurrent: "true", eventname: "FUNG-WONG-26", severitydata: { severity: 160.9 } } },
  { geometry: { coordinates: [1, 1] }, properties: { eventtype: "TC", iscurrent: "false", eventname: "OLD-25" } }] });
assert.deepStrictEqual(gd.map(g => g.name), ["Simon", "Fung-Wong"]); assert.strictEqual(gd[1].mph, 100);
const all = O.mergeStorms(nhc, gd); assert.deepStrictEqual(all.map(s => s.src + ":" + s.name), ["GDACS:Fung-Wong", "NHC:Simon"]);
const now = Date.parse("2026-10-13T14:00:00Z");
const al = O.parseAlerts({ features: [
  { properties: { event: "Flood Warning", severity: "Severe", areaDesc: "A; B; C; D", expires: "2026-10-13T20:00:00Z" } },
  { properties: { event: "Tornado Warning", severity: "Extreme", areaDesc: "X", expires: "2026-10-13T15:00:00Z" } },
  { properties: { event: "Flood Warning", severity: "Severe", areaDesc: "Y", expires: "2026-10-13T16:00:00Z" } },
  { properties: { event: "Expired", severity: "Severe", expires: "2026-10-13T10:00:00Z" } }] }, now);
assert.strictEqual(al.count, 3); assert.strictEqual(al.top[0].event, "Tornado Warning"); assert.deepStrictEqual(al.events[0], ["Flood Warning", 2]); assert.strictEqual(al.top[1].area, "A; B; C");
const m = O.parseMetar({ icaoId: "EGLL", city: "London", temp: 20, wspd: 18, wgst: 30, wdir: 280, cover: "CLR", obsTime: 1791899400 });
assert.deepStrictEqual([m.f, m.cond, m.windMph, m.gustMph, m.windDir], [68, "Clear", 21, 35, "W"]);
assert.strictEqual(O.parseMetar({ icaoId: "X", temp: 5, wxString: "-RA BR", cover: "OVC" }).cond, "Light rain");
assert.strictEqual(O.parseMetar({ icaoId: "X", temp: null }), null);
const ft = O.frameTimes(now, 3, 20, 150); assert.deepStrictEqual(ft, ["2026-10-13T10:50:00Z", "2026-10-13T11:10:00Z", "2026-10-13T11:30:00Z"]);
const cities = [m, O.parseMetar({ icaoId: "Y", city: "Dubai", temp: 34, cover: "FEW" })];
const s = O.briefingScript({ storms: nhc, alerts: al, cities }).join(" ");
for (const w of ["Category 1 Hurricane Simon", "92 miles per hour", "west-northwest", "3 severe or extreme", "2 Flood Warnings", "Dubai is warmest", "gusts to 35", "AI storm briefings"]) assert.ok(s.includes(w), "script has " + w + ": " + s);
const bare = O.briefingScript({ storms: null, alerts: null, cities: [] });
assert.strictEqual(bare.length, 2, "failed feeds -> only intro + teaser, nothing invented");
assert.ok(O.briefingScript({ storms: [], alerts: { count: 0, events: [], top: [] }, cities: [] }).join(" ").includes("no active tropical cyclones"));
assert.ok(s.split(/\s+/).length < 170, "script stays ~1 minute");
console.log("All World Weather Outlook tests passed");
// launches
{ const N = Date.parse("2026-10-13T14:00:00Z"), L = O.parseLaunches([
  { name: "Falcon 9 Block 5 | Starlink 1", rocket: "Falcon 9 Block 5", mission: "Starlink 1", net: "2026-10-14T02:00:00Z", status: "Go", probability: 80, weatherConcerns: "Cumulus Cloud Rule", site: "Cape Canaveral SFS, FL, USA", lat: "28.5", lon: "-80.5" },
  { name: "Old", net: "2026-10-13T10:00:00Z", status: "Success" },
  { name: "Zhuque-2E | Unknown Payload", net: "2026-10-16T11:40:00Z", status: "Go", probability: -1 }], N);
  assert.ok(L.today); assert.strictEqual(L.list.length, 1); assert.deepStrictEqual([L.list[0].name, L.list[0].weatherGo, L.list[0].statusText, L.list[0].lat], ["Starlink 1", 80, "Go for launch", 28.5]);
  const nx = O.parseLaunches([{ name: "Zhuque-2E | Unknown Payload", net: "2026-10-16T11:40:00Z", status: "Go", probability: -1 }], N);
  assert.ok(!nx.today); assert.strictEqual(nx.list[0].weatherGo, null); assert.strictEqual(nx.list[0].rocket, "Zhuque-2E");
  const sc = O.briefingScript({ storms: null, alerts: null, cities: [], launches: L, fmtTime: () => "10:00 PM" }).join(" ");
  assert.ok(sc.includes("one rocket launch is scheduled") && sc.includes("80 percent") && sc.includes("from Cape Canaveral SFS at 10:00 PM"), sc);
  assert.strictEqual(O.parseLaunches(null, N).list.length, 0);
  console.log("Launch parser tests passed"); }
{ const x = '<Layer><Dimension name="time" default="x" units="ISO8601">2026-10-13T05:00:00.000Z,2026-10-13T06:00:00.000Z,2026-10-13T07:00:00.000Z,2026-10-13T12:00:00.000Z,2026-10-13T13:00:00.000Z</Dimension></Layer>';
  const t = O.parseWmsTimes(x); assert.strictEqual(t.length, 5); assert.strictEqual(O.latestSynoptic(t), "2026-10-13T12:00:00.000Z");
  assert.strictEqual(O.latestSynoptic(["2026-10-13T13:00:00Z"]), null); assert.deepStrictEqual(O.parseWmsTimes("junk"), []);
  console.log("GMGSI time tests passed"); }
