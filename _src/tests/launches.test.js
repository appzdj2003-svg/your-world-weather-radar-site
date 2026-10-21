// Run: node _src/tests/launches.test.js — /launches/ page: snapshot parsing, stale/past handling, countdowns, pad weather, built HTML.
const assert = require("assert"), fs = require("fs"), path = require("path"), L = require("../../assets/launches.js");
const ROOT = path.join(__dirname, "../.."), N = Date.parse("2026-10-21T16:00:00Z");
const items = [
  { id: "a", name: "Falcon 9 Block 5 | Starlink Group 15-15", mission: "Starlink Group 15-15", rocket: "Falcon 9 Block 5", provider: "SpaceX", net: "2026-10-21T23:02:41Z",
    windowStart: "2026-10-21T21:59:00Z", windowEnd: "2026-10-22T01:59:00Z", status: "Go", orbit: "LEO", pad: "Space Launch Complex 4E", site: "Vandenberg SFB, CA, USA", precision: "SEC", country: "USA", probability: 90 },
  { id: "b", name: "Old | Never updated", net: "2026-10-21T10:00:00Z", status: "Go", site: "Cape Canaveral SFS, FL, USA" },                 // 6 h past, no update: hidden
  { id: "c", name: "Electron | Recent", net: "2026-10-21T13:00:00Z", status: "Success", provider: "Rocket Lab", site: "Rocket Lab Launch Complex 1, Mahia Peninsula, New Zealand", pad: "Rocket Lab Launch Complex 1A" }, // 3 h ago: "Launched"
  { id: "d", name: "Electron | Long ago", net: "2026-10-20T01:00:00Z", status: "Success" },                                                  // > 6 h: hidden
  { id: "e", name: "Long March 12A | Flight 2", net: "2026-10-31T00:00:00Z", status: "TBD", provider: "China Aerospace Science and Technology Corporation", site: "Jiuquan Satellite Launch Center, People's Republic of China", orbit: "N/A" },
  { id: "f", name: "Bad", net: "not a date" }, null];
const list = L.parse(items, N);
assert.deepStrictEqual(list.map(l => l.id), ["c", "a", "e"], "stale and old launches dropped, sorted by time");
assert.strictEqual(list[0].phase, "done"); assert.strictEqual(list[0].statusText, "Launched");
const nx = L.nextUp(list); assert.strictEqual(nx.id, "a", "next launch skips the one that already flew");
assert.strictEqual(L.cd(nx.ms, N, "exact"), "T−07:02:41");
assert.strictEqual(L.cd(Date.parse("2026-10-23T17:00:00Z"), N, "exact"), "T−2d 01:00:00");
assert.strictEqual(L.cd(N - 65e3, N, "exact"), "T+00:01:05");
const e = list[2]; assert.strictEqual(e.precision, "day", "TBD at midnight UTC with no precision field = date only"); assert.ok(/^in about 9 days$/.test(L.cd(e.ms, N, e.precision)));
assert.deepStrictEqual([e.country.region, e.providerShort, e.orbit], ["China", "CASC", ""]);
assert.strictEqual(L.precision({ net: "2026-10-31T00:00:00Z", status: "Go", precision: "MIN" }), "exact");
assert.strictEqual(L.precision({ net: "2026-10-31T05:00:00Z", precision: "MON" }), "day");
assert.strictEqual(L.where(list[0]), "Rocket Lab Launch Complex 1, Mahia Peninsula, New Zealand", "pad name not repeated");
assert.ok(/Window .+ \(4 h\)/.test(L.windowText(nx)));
assert.strictEqual(L.parse(null, N).length, 0); assert.strictEqual(L.nextUp([]), null);
// pad weather (METAR, same fields as the snapshot)
const pw = L.padWx({ pad: "vandenberg", city: "Vandenberg SFB, CA", station: "Vandenberg airfield", icaoId: "KVBG", temp: 16.3, wspd: 4, wdir: 60, cover: "OVC", visib: "10+", obsTime: 1792598100, match: ["Vandenberg"] });
assert.deepStrictEqual([pw.f, pw.cond, pw.wind, pw.dir, pw.vis], [61, "Overcast", 5, "ENE", "10"]);
assert.strictEqual(L.padFor(nx, [pw]), pw, "launch matched to its pad weather");
assert.strictEqual(L.padFor(e, [pw]), null);
assert.strictEqual(L.padWx({ temp: null }), null);
assert.strictEqual(L.padWx({ temp: 20, wxString: "+TSRA", cover: "BKN" }).cond, "Heavy thunderstorm");
// built page
const html = fs.readFileSync(path.join(ROOT, "launches/index.html"), "utf8");
for (const id of ['id="ln-hero"', 'id="ln-list"', 'id="pad-weather"', 'id="ln-app-h"', "The Space Devs", "check the launch provider", "G-BDB2EH3W4Z", "launches.js", "teaser.js", "utm_campaign%3Dapp-pitch"])
  assert.ok(html.includes(id), "launches page has " + id);
assert.ok(!/launch\.yourworldapps\.si/.test(html), "Launch Deck site is never linked");
assert.ok(!/ll\.thespacedevs\.com|api\.open-meteo|open-meteo/i.test(html + fs.readFileSync(path.join(ROOT, "assets/launches.js"), "utf8")), "no third-party API in the page or script");
assert.ok(!/FEEL THE LAUNCH[^<]{0,40}<span class="tag prem"/.test(html), "FEEL THE LAUNCH is not labeled Premium");
assert.ok(/<video[^>]+muted[^>]+playsinline[^>]+preload="none"/.test(html) && !/<video[^>]*\bloop\b/.test(html), "teaser is muted, inline, lazy and never loops");
const out = fs.readFileSync(path.join(ROOT, "outlook.html"), "utf8"); assert.ok(out.includes('id="launches"') && out.includes('href="launches/"'), "Outlook links to /launches/");
const home = fs.readFileSync(path.join(ROOT, "index.html"), "utf8"); assert.ok(home.includes('href="outlook.html#sun"') && home.includes('href="launches/"') && home.includes("app-sun.jpg"), "home has the Sun feature and launch teaser");
assert.ok(fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8").includes("/launches/"), "sitemap lists /launches/");
console.log("All launches page tests passed");
