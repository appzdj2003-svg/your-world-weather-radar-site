// Run: node _src/tests/trip-atlas.test.js — Trip Planner Ask Atlas: trip sentences fill the trip, questions get sourced answers,
// booking/price asks are recognised (Atlas never books or quotes prices).
const fs = require("fs"), path = require("path"), A = f => fs.readFileSync(path.join(__dirname, "../../assets", f), "utf8");
global.window = global; global.YWQuick = require("../../assets/quickparse.js");
eval(A("askdata.js")); global.document = { getElementById: () => null }; global.location = { search: "" }; eval(A("ask.js"));
const C = require("../../assets/tripcore.js");
const cases = [
  ["Road trip from Atlanta to Nashville Oct 30 - Nov 1", null],
  ["Flying to Denver next Friday for a 5 day ski trip", null],
  ["beach trip to Gulf Shores, AL tomorrow for a week", null],
  ["How much water can sweep away a car?", "flood-safety-turn-around"],
  ["What do the radar colors mean?", "how-to-read-weather-radar"],
  ["When is hurricane season?", "hurricane-preparedness"],
  ["What's the meaning of life?", "none"],
];
let fail = 0;
for (const [q, want] of cases) { const h = C.sourcedAnswer(q, YWQuick.parseTrip(q), window.YWAsk);
  const ok = want === null ? h === null : want === "none" ? h && h.none : (h && h.a && h.a.u.includes(want));
  if (!ok) { fail++; console.log("FAIL", q, "->", JSON.stringify(h).slice(0, 140)); } }
const book = [["Book me a hotel in Nashville", true], ["How much are flights to Denver?", true], ["cheapest rental car in Miami", true], ["Road trip to Nashville this weekend", false], ["What do the radar colors mean?", false]];
for (const [q, want] of book) if (C.isBookingAsk(q) !== want) { fail++; console.log("FAIL booking", q); }
// the trip.js UI must never claim to book, hold or price anything
const ui = A("trip.js");
for (const bad of [/\byou'?re booked\b/i, /\bbooked for you\b/i, /\bwe('ll| will) book\b/i, /\bbest price\b/i, /\blowest price\b/i, /\bguarantee/i, /\$\d/])
  if (bad.test(ui)) { fail++; console.log("FAIL overpromise in trip.js:", bad); }
if (!/can't book trips or see live prices/.test(ui) || !/We don't sell travel, see prices/.test(ui)) { fail++; console.log("FAIL honest booking copy missing"); }
const n = cases.length + book.length + 1;
console.log(fail ? fail + " failures" : `All ${n} trip Ask Atlas cases passed`); process.exit(fail ? 1 : 0);
