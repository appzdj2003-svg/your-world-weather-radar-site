// Route-fit checks: real JBU1166 (RSW→BOS) positions inland of the great circle must fit; AAL893 on stale MIA–DFW must not.
const assert = require("assert");
const F = require("../../assets/flightcore.js");
const ap = require("../../assets/airports-na.json");
const A = c => ap.find(a => a.icao === c);
const RSW_BOS = { from: A("KRSW"), to: A("KBOS"), i: 0 }, MIA_DFW = { from: A("KMIA"), to: A("KDFW"), i: 0 }, NAS_CLT = { from: { iata: "NAS", icao: "MYNN", lat: 25.039, lon: -77.466 }, to: A("KCLT"), i: 1 };
let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok -", name); };
// Real adsb.lol fixes for JBU1166 on 2026-10-27 (a349be, FL370): 4:46 PM EDT over SC hdg 038, and ~4:57 PM EDT.
const jbu = [{ lat: 33.9, lon: -80.6, track: 38, alt: 37000 }, { lat: 34.970507, lon: -78.170586, track: 37.73, alt: 37000 }];
t("JBU1166 real fixes fit RSW–BOS", () => jbu.forEach(ac => { assert.ok(F.legFits(ac, RSW_BOS)); assert.strictEqual(F.liveLeg([RSW_BOS], ac), RSW_BOS); }));
t("inland by ~200 nm on a 1,087 nm leg fits only when both sources agree", () => {
  const ac = { lat: 35, lon: -86.5, track: 45 };
  assert.ok(!F.legFits(ac, RSW_BOS));
  assert.ok(F.legFits(ac, RSW_BOS, undefined, true));
  assert.strictEqual(F.liveLeg([{ ...RSW_BOS, agreed: true }], ac).from.icao, "KRSW");
});
t("cap scales with leg length (150 floor, 20%, 400 max)", () => {
  assert.strictEqual(F.legCap({ from: A("KATL"), to: A("KCLT") }), 150);
  assert.ok(Math.abs(F.legCap(RSW_BOS) - 217) < 3);
  assert.strictEqual(F.legCap({ from: A("KBOS"), to: A("KSEA") }), 400 > F.distNm(A("KBOS"), A("KSEA")) * 0.2 ? F.distNm(A("KBOS"), A("KSEA")) * 0.2 : 400);
});
t("AAL893 between Nassau and Charlotte still rejects stale MIA–DFW", () => {
  const ac = { lat: 30.4, lon: -78.6, track: 335, alt: 33000 };
  assert.ok(!F.legFits(ac, MIA_DFW));
  assert.strictEqual(F.liveLeg([MIA_DFW, NAS_CLT], ac), NAS_CLT);
  assert.strictEqual(F.liveLeg([MIA_DFW], ac), null);
});
t("heading away from destination is rejected even when agreed", () => {
  assert.ok(!F.legFits({ lat: 33.9, lon: -80.6, track: 218 }, RSW_BOS, undefined, true));
});
console.log(`${n} legfit tests passed`);
