// Run: node _src/tests/tripgear.test.js — Trip Planner gear card rules map trip details to existing gear images/anchors.
const assert = require("assert"), fs = require("fs"), path = require("path");
const G = require("../../assets/tripgear.js"), ROOT = path.join(__dirname, "../..");
const gear = fs.existsSync(path.join(ROOT, "gear/index.html")) ? fs.readFileSync(path.join(ROOT, "gear/index.html"), "utf8") : "";
const ks = o => G.pick(o).map(x => x.k);
assert(ks({ act: "CAMP", mode: "CAR", sd: "2026-07-10", d: 3 }).includes("lantern"));
assert(ks({ act: "HIKE", mode: "CAR", sd: "2026-07-10" }).includes("lightning"));
assert(!ks({ act: "HIKE", mode: "CAR", sd: "2026-11-10" }).includes("lightning"));
assert(ks({ act: "BEACH", mode: "FLY", sd: "2026-08-01" }).includes("drybag"));
assert(ks({ act: "SKI", mode: "FLY", sd: "2027-01-10" }).includes("thermo"));
assert(ks({ act: "SIGHTSEEING", mode: "CAR", from: "Atlanta", sd: "2026-10-30", d: 3 }).includes("kit"));
assert(ks({ act: "SIGHTSEEING", mode: "MOTORCYCLE", sd: "2026-10-30" }).includes("rainsuit"));
let n = 0;
for (const a of ["SIGHTSEEING","HIKE","BEACH","SKI","CAMP","FISH","BOAT","EVENT","BUSINESS","FAMILY"]) for (const m of ["CAR","RV","FLY","BOAT","MOTORCYCLE","BIKE","FOOT"]) for (const sd of ["2026-01-05","2026-07-05","2026-10-05"]) {
  const r = G.pick({ act: a, mode: m, sd, d: 4, from: "X" }); assert(r.length >= 1 && r.length <= 6);
  for (const { k } of r) { assert(G.ITEMS[k], k); assert(fs.existsSync(path.join(ROOT, "assets/items", k + ".webp")), k + ".webp");
    if (gear) assert(gear.includes(`id="g-${k}"`), "missing gear anchor g-" + k); }
  assert(!/\$\d/.test(G.html({ act: a, mode: m, sd })), "no prices"); n++; }
console.log(`All ${n} trip gear combos map to real gear images${gear ? " and anchors" : ""}`);
