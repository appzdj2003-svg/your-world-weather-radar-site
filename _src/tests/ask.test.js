// Run: node _src/tests/ask.test.js  — Ask Atlantis routing + answer matching (DOM stubbed).
const assert = require("assert"), fs = require("fs"), path = require("path");
global.YWQuick = require("../../assets/quickparse.js");
global.window = {}; eval(fs.readFileSync(path.join(__dirname, "../../assets/askdata.js"), "utf8"));
const msgs = []; const el = { set onsubmit(f) {}, appendChild: d => msgs.push(d.innerHTML), value: "" };
global.document = { getElementById: () => el, addEventListener() {}, createElement: () => ({ scrollIntoView() {} }) };
global.location = { search: "" };
const src = fs.readFileSync(path.join(__dirname, "../../assets/ask.js"), "utf8").replace("const q0", "window.__ask = ask; const q0");
eval(src);
const last = q => { window.__ask(q); return msgs[msgs.length - 1]; };
const cases = [
  ["Where should I shelter from a tornado?", "tornado-watch-vs-warning"],
  ["what's the difference between a watch and a warning", "watch-vs-warning"],
  ["how long after thunder should I wait?", "lightning-safety"],
  ["What do the radar colors mean?", "how-to-read-weather-radar"],
  ["How much water can sweep away a car?", "flood-safety-turn-around"],
  ["what category is 120 mph hurricane?", "hurricane-preparedness"],
  ["How much is Premium?", "pricing.html"],
  ["What does falling pressure mean?", "barometric-pressure-and-weather"],
  ["Hiking in Asheville, NC this Saturday", "/alert-planner/?q="],
  ["Road trip from Atlanta to Nashville Oct 30 - Nov 1", "/trip-planner/?q="],
  ["Boating on Lake Lanier Oct 24-25, warn me about wind", "/alert-planner/?q="],
  ["tell me a joke", "don't have a sourced answer"],
];
let fail = 0; for (const [q, want] of cases) { const h = last(q); if (!h.includes(want)) { fail++; console.log("FAIL", q, "->", h.slice(0, 160)); } }
assert.ok(window.YW_ASK.every(x => fs.existsSync(path.join(__dirname, "../..", x.u))), "every answer links to an existing page");
console.log(fail ? fail + " failures" : `All ${cases.length} Ask Atlantis cases passed`); process.exit(fail ? 1 : 0);
