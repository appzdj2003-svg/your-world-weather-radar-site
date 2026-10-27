// Run: node _src/tests/pages-scripts.test.js — every built page's scripts must load together in ONE global scope
// (catches duplicate top-level const/let across files, which broke the Trip Planner once).
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const ROOT = path.join(__dirname, "../..");
const pages = ["index.html", "ask.html", "outlook.html", "launches/index.html", "alert-planner/index.html", "trip-planner/index.html", "guides/watch-vs-warning.html", "flight/index.html"];
let n = 0;
for (const p of pages) {
  const html = fs.readFileSync(path.join(ROOT, p), "utf8");
  const srcs = [...html.matchAll(/<script src="([^"?]+)/g)].map(m => path.join(path.dirname(path.join(ROOT, p)), m[1]));
  const ctx = vm.createContext({ window: {}, document: { readyState: "loading", addEventListener() {}, querySelector: () => null, getElementById: () => null, documentElement: { lang: "en", classList: { add() {} } } }, navigator: { userAgent: "" }, location: { search: "", hash: "" }, console });
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  for (const f of srcs) { try { vm.runInContext(fs.readFileSync(f, "utf8"), ctx, { filename: f }); } catch (e) { if (e instanceof SyntaxError || /already been declared/.test(e.message)) assert.fail(`${p}: ${path.basename(f)}: ${e.message}`); } n++; }
}
console.log(`All page script bundles load together (${n} scripts on ${pages.length} pages)`);
