// Browser resilience checks for /flight (needs Chrome): node _src/tests/e2e/flight-resilience.e2e.mjs [CALLSIGN]
// Runs the LOCAL assets/flight.js on the live page and injects faults. Exit 1 on any failure.
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
const CS = process.argv[2] || "JBU1166", ALT = "AAL893";
const ROOT = process.env.SITE_ROOT || new URL("../../../", import.meta.url).pathname;
const JS = readFileSync(ROOT + "assets/flight.js", "utf8"), CORE = readFileSync(ROOT + "assets/flightcore.js", "utf8");
const b = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
let fails = 0;
async function run(name, { fault = () => null, setup, w = 1280, wait = 9000, expect, inject }) {
  const ctx = await b.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: w, height: 1000 }); await p.emulateTimezone("America/New_York");
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.setRequestInterception(true);
  p.on("request", r => { const u = r.url();
    if (/\/assets\/flightcore\.js/.test(u)) return r.respond({ status: 200, contentType: "application/javascript", body: CORE });
    if (/\/assets\/flight\.js/.test(u)) return r.respond({ status: 200, contentType: "application/javascript", body: inject ? inject(JS) : JS });
    const f = fault(u); if (f === "hang") return; if (f === "500") return r.respond({ status: 500, body: "x", headers: { "Access-Control-Allow-Origin": "*" } });
    if (f === "neterr") return r.abort("failed"); r.continue(); });
  await p.goto("https://weather.yourworldapps.si/flight/", { waitUntil: "domcontentloaded" });
  if (setup) await setup(p); else await p.evaluate(cs => { location.hash = cs; }, CS);
  await new Promise(r => setTimeout(r, wait));
  const txt = (await p.evaluate(() => document.getElementById("fl-status").innerText)).replace(/\s+/g, " ");
  const wx = (await p.evaluate(() => { document.getElementById("fl-seg-weather").click(); return document.getElementById("fl-panel-weather").innerText; })).replace(/\s+/g, " ").trim();
  const ok = expect(txt) && wx.length > 20;
  if (!(wx.length > 20)) console.log("  weather tab blank"); if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} [${w}] :: ${txt.slice(0, 150)}${errs.length ? " :: pageerror " + errs[0] : ""}`);
  await ctx.close();
}
const route = t => /RSW/.test(t) && /BOS/.test(t);
const noOtherLegs = t => route(t) && !/NAS|CLT|MIA|DFW/.test(t);
const submit = async (p, cs) => p.evaluate(cs => { const f = document.getElementById("f-fn"); f.value = cs; ["f-from","f-to","f-dep","f-ndep","f-arr"].forEach(i => document.getElementById(i).value = ""); document.getElementById("fform").requestSubmit(); }, cs);
await run("fresh", { expect: route });
await run("fresh phone", { w: 390, expect: route });
for (const d of [100, 400, 1500]) await run(`switch flight mid-load ${d}ms`, { setup: async p => { await p.evaluate(a => { location.hash = a; }, ALT); await new Promise(r => setTimeout(r, d)); await submit(p, CS); }, wait: 12000, expect: noOtherLegs });
await run("relay hangs (route still shows, watchdog message)", { fault: u => /workers\.dev\/flight/.test(u) ? "hang" : null, wait: 23000, expect: t => route(t) && /not reachable yet/.test(t) && !/Checking live tracking/.test(t) });
await run("returning visitor: stored state, old flight + what-if, then relay down", { fault: u => /workers\.dev\/flight/.test(u) ? "neterr" : null, setup: async p => {
  await p.evaluate(cs => { localStorage.setItem("yw-fl-pos:" + cs, JSON.stringify({ ac: { lat: 30, lon: -80, alt: 30000, gs: 400 }, seenAt: Date.now() - 36e5 * 5, fn: cs })); sessionStorage.setItem("x", "1"); location.hash = "AAL893"; }, CS);
  await new Promise(r => setTimeout(r, 2500)); await p.evaluate(() => { const c = document.querySelector('[data-whatif="180"]'); c && c.click(); }); await submit(p, CS); }, wait: 12000, expect: route });
await run("old flight's From/To left in the form", { setup: async p => { await p.evaluate(() => { location.hash = "AAL893"; }); await new Promise(r => setTimeout(r, 3000));
  await p.evaluate(cs => { document.getElementById("f-from").value = "MIA"; document.getElementById("f-to").value = "DFW"; document.getElementById("fform").requestSubmit(); }, CS);
  await new Promise(r => setTimeout(r, 2000)); await p.evaluate(cs => { const f = document.getElementById("f-fn"); f.value = cs; document.getElementById("fform").requestSubmit(); }, CS); }, wait: 12000, expect: t => route(t) && !/couldn't confirm/.test(t) });
await run("relay 500", { fault: u => /workers\.dev\/flight/.test(u) ? "500" : null, expect: route });
await run("relay network error", { fault: u => /workers\.dev\/flight/.test(u) ? "neterr" : null, expect: route });
await run("adsbdb + wx + nas + sigmet + route-wx + places hang", { fault: u => /adsbdb|\/wx\?|\/nas|\/sigmet|route-wx|\/places/.test(u) ? "hang" : null, expect: t => route(t) && /In the air|ground|Landed|Not in the air|reachable/.test(t) });
await run("standing route hangs, adsbdb answers", { fault: u => /vrs-standing-data/.test(u) ? "hang" : null, wait: 16000, expect: route });
await run("render throws (guard shows basics)", { inject: js => js.replace("function renderMain() {", "function renderMain() { if (S.ac || S.leg) throw new Error('boom');"), expect: route });
console.log(fails ? `${fails} FAILED` : "all passed"); await b.close(); process.exit(fails ? 1 : 0);
