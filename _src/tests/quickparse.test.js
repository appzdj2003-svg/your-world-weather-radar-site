// Run: node _src/tests/quickparse.test.js   (today pinned to Mon 2026-10-12)
const { parsePlan, parseTrip } = require("../../assets/quickparse.js"), assert = require("assert"), T = "2026-10-12";
const plan = [
 ["Hiking in Asheville, NC this Saturday, warn me about lightning", { loc: "Asheville, NC", sd: "2026-10-17", d: 1, act: "HIKE", al: ["LIGHTNING"] }],
 ["Boating on Lake Lanier Oct 24-25", { loc: "Lake Lanier", sd: "2026-10-24", d: 2, act: "BOAT", al: ["SEVERE","WIND","MARINE","LIGHTNING"] }],
 ["Outdoor wedding in Charleston, SC on Nov 7, alert me for rain and wind", { loc: "Charleston, SC", sd: "2026-11-07", d: 1, act: "EVENT", al: ["RAIN","WIND"] }],
 ["beach weekend near Myrtle Beach, rip currents and heat", { loc: "Myrtle Beach", sd: "2026-10-17", d: 2, act: "BEACH", al: ["HEAT","MARINE"] }],
 ["camping tomorrow for 3 nights in Shenandoah", { loc: "Shenandoah", sd: "2026-10-13", d: 4, act: "CAMP" }],
 ["Fishing near Destin, FL 11/14-11/16, tell me about storms", { loc: "Destin, FL", sd: "2026-11-14", d: 3, act: "FISH", al: ["SEVERE"] }],
 ["frost alerts for my garden in Denver next week", { loc: "Denver", sd: "2026-10-19", act: "GARDEN", al: ["COLD"] }],
 ["hurricane watch for Tampa, FL", { loc: "Tampa, FL", al: ["HURRICANE"], missing: ["sd"] }],
 ["snow and ice for my commute", { act: "COMMUTE", al: ["SNOW"], missing: ["loc","sd"] }],
 ["picnic Friday", { act: "EVENT", sd: "2026-10-16", missing: ["loc"] }],
 ["Football game at Neyland Stadium Saturday", { loc: "Neyland Stadium", sd: "2026-10-17" }],
 ["Kayak trip on the Outer Banks Dec 30 - Jan 2", { loc: "Outer Banks", sd: "2026-12-30", d: 4, act: "BOAT" }],
];
const trip = [
 ["Road trip from Atlanta to Nashville Oct 30 - Nov 1", { from: "Atlanta", to: "Nashville", sd: "2026-10-30", d: 3, mode: "CAR" }],
 ["Flying to Denver next Friday for a 5 day ski trip", { to: "Denver", sd: "2026-10-16", d: 5, mode: "FLY", act: "SKI" }],
 ["RV trip to Yellowstone National Park this weekend", { to: "Yellowstone National Park", sd: "2026-10-17", d: 2, mode: "RV", act: "HIKE" }],
 ["Drive from Boston, MA to Bar Harbor, ME via Portland and Camden on 10/23 for 3 days", { from: "Boston, MA", to: "Bar Harbor, ME", stops: ["Portland","Camden"], sd: "2026-10-23", d: 3 }],
 ["family visit to Orlando Thanksgiving week", { to: "Orlando", act: "FAMILY", missing: ["sd"] }],
 ["beach trip to Gulf Shores, AL tomorrow for a week", { to: "Gulf Shores, AL", sd: "2026-10-13", d: 7, act: "BEACH" }],
 ["going somewhere", { missing: ["to","sd"] }],
 ["motorcycle ride to Deals Gap on Saturday", { to: "Deals Gap", mode: "MOTORCYCLE", sd: "2026-10-17" }],
];
let fail = 0;
function check(fn, [txt, exp]) { const got = fn(txt, T);
  for (const k in exp) { try { assert.deepStrictEqual(got[k], exp[k]); } catch (e) { fail++; console.log("FAIL", JSON.stringify(txt), k, "got", JSON.stringify(got[k]), "want", JSON.stringify(exp[k])); } } }
plan.forEach(c => check(parsePlan, c)); trip.forEach(c => check(parseTrip, c));
// codec round trip
(async () => {
  const P = require("../../assets/plancodec.js"), R = require("../../assets/tripcodec.js");
  const p = { v: 1, loc: "Asheville, NC", act: "HIKE", sd: "2026-10-17", d: 2, al: ["LIGHTNING", "BOGUS"] };
  const tp = await P.encode(p); assert.ok(tp.startsWith("v1.")); const dp = await P.decode(tp);
  assert.deepStrictEqual(dp.al, ["LIGHTNING"]); assert.strictEqual(dp.loc, "Asheville, NC");
  const tt = await R.encode({ v: 1, from: "Atlanta", to: "Nashville", sd: "2026-10-30", d: 3, act: "EVENT", mode: "CAR" });
  assert.strictEqual((await R.decode(R.webUrl(tt).split("#")[1])).to, "Nashville");
  await assert.rejects(P.decode("v2.x")); await assert.rejects(R.encode({ v: 1, sd: "2026-10-30" }));
  console.log(fail ? `${fail} failures` : `All ${plan.length + trip.length} parser cases + codec round trips passed`);
  process.exit(fail ? 1 : 0);
})();
