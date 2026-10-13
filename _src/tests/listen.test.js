// Run: node _src/tests/listen.test.js — guide Listen helpers: sentence chunking, table rows read as "Header: cell", voice pick.
const assert = require("assert"), L = require("../../assets/listen.js");
const c = L.chunk("One. Two is longer! " + "word ".repeat(80) + "end.", 120);
assert.ok(c.length >= 3 && c.every(x => x.length <= 120), "chunks <= max");
const el = (tag, kids) => ({ tagName: tag, nodeType: 1, children: kids, childNodes: kids, matches: () => false });
const txt = t => ({ nodeType: 3, nodeValue: t });
const th = t => el("TH", [txt(t)]), td = t => el("TD", [txt(t)]);
const head = el("TR", [th("Alert"), th("Meaning")]), row = el("TR", [td("Watch"), td("Conditions are favorable")]);
const table = { querySelector: () => head }; head.closest = row.closest = () => table;
assert.strictEqual(L.rowText(head), "", "header row not read");
assert.strictEqual(L.rowText(row), "Alert: Watch. Meaning: Conditions are favorable.");
const v = L.pickVoice([{ name: "X", lang: "fr-FR" }, { name: "Google US English", lang: "en-US" }, { name: "Basic", lang: "en-US", default: true }], "en");
assert.strictEqual(v.name, "Google US English");
assert.ok(/\.sources/.test(L.SKIP) && /\.hunt-promo/.test(L.SKIP) && /tr/.test(L.READ));
console.log("Listen tests passed");
