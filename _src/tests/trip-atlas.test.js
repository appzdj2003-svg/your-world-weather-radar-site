// Run: node _src/tests/trip-atlas.test.js — trip.html Ask Atlas box: trip sentences fill the trip, questions get inline answers.
const assert = require("assert"), fs = require("fs"), path = require("path"), A = f => fs.readFileSync(path.join(__dirname, "../../assets", f), "utf8");
global.window = global; global.YWQuick = require("../../assets/quickparse.js");
eval(A("askdata.js")); global.document = { getElementById: () => null }; global.location = { search: "" }; eval(A("ask.js"));
let cfg; global.YWWizard = { run: c => cfg = c, E: s => String(s) }; global.YWTrip = {}; eval(A("trip.js"));
const cases = [
  ["Road trip from Atlanta to Nashville Oct 30 - Nov 1", null],
  ["Flying to Denver next Friday for a 5 day ski trip", null],
  ["beach trip to Gulf Shores, AL tomorrow for a week", null],
  ["How much water can sweep away a car?", "flood-safety-turn-around"],
  ["What do the radar colors mean?", "how-to-read-weather-radar"],
  ["When is hurricane season?", "hurricane-preparedness"],
  ["What's the meaning of life?", "don't have a sourced answer"],
];
let fail = 0;
for (const [q, want] of cases) { const h = cfg.preQuick(q);
  const ok = want === null ? h === null : (h && h.includes(want) && h.includes("ask.html?q="));
  if (!ok) { fail++; console.log("FAIL", q, "->", String(h).slice(0, 140)); } }
console.log(fail ? fail + " failures" : `All ${cases.length} trip Ask Atlas cases passed`); process.exit(fail ? 1 : 0);
