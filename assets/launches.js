/* Your World Weather Radar: /launches/ page. Reads ONLY our own build-time snapshot (assets/outlook.json: LL2 launches by
   The Space Devs + METAR pad weather from NOAA's Aviation Weather Center). The browser never calls LL2 or any other API. */
(function (G) {
"use strict";
const COUNTRY = { USA: ["USA", "🇺🇸", "United States"], CHN: ["China", "🇨🇳", "China"], IND: ["India", "🇮🇳", "India"], NZL: ["New Zealand", "🇳🇿", "New Zealand"],
  GUF: ["Europe", "🇬🇫", "French Guiana"], FRA: ["Europe", "🇬🇫", "French Guiana"], KAZ: ["Russia", "🇰🇿", "Kazakhstan"], RUS: ["Russia", "🇷🇺", "Russia"],
  JPN: ["Japan", "🇯🇵", "Japan"], KOR: ["Other", "🇰🇷", "South Korea"], IRN: ["Other", "🇮🇷", "Iran"], ISR: ["Other", "🇮🇱", "Israel"], AUS: ["Other", "🇦🇺", "Australia"],
  GBR: ["Europe", "🇬🇧", "United Kingdom"], NOR: ["Europe", "🇳🇴", "Norway"], SWE: ["Europe", "🇸🇪", "Sweden"], BRA: ["Other", "🇧🇷", "Brazil"], PRK: ["Other", "🇰🇵", "North Korea"] };
const BY_NAME = [[/USA|United States/i, "USA"], [/China/i, "CHN"], [/India/i, "IND"], [/New Zealand/i, "NZL"], [/French Guiana/i, "GUF"], [/Kazakhstan/i, "KAZ"],
  [/Russia/i, "RUS"], [/Japan/i, "JPN"], [/Korea/i, "KOR"], [/Iran/i, "IRN"], [/Israel/i, "ISR"], [/Australia/i, "AUS"], [/United Kingdom|Scotland|England/i, "GBR"], [/Norway/i, "NOR"], [/Sweden/i, "SWE"], [/Brazil/i, "BRA"]];
const ST = { Go: ["Go for launch", "go"], TBC: ["To be confirmed", "tbc"], TBD: ["Date not firm (TBD)", "tbd"], Hold: ["On hold", "hold"], "In Flight": ["In flight", "fly"],
  Success: ["Launched", "done"], Failure: ["Launch failure", "fail"], "Partial Failure": ["Partial failure", "fail"] };
const SHORT = { "China Aerospace Science and Technology Corporation": "CASC", "Indian Space Research Organization": "ISRO", "United Launch Alliance": "ULA",
  "Russian Federal Space Agency (ROSCOSMOS)": "Roscosmos", "Japan Aerospace Exploration Agency": "JAXA", "Mitsubishi Heavy Industries": "MHI", "China Aerospace Science and Industry Corporation": "CASIC" };
const ORBIT = { LEO: "Low Earth orbit", SSO: "Sun-synchronous orbit", GTO: "Geostationary transfer orbit", GEO: "Geostationary orbit", MEO: "Medium Earth orbit", PO: "Polar orbit",
  LO: "Lunar orbit", HEO: "Highly elliptical orbit", "Sub": "Suborbital", ISS: "International Space Station", TLI: "Trans-lunar injection", "Helio-N/A": "Heliocentric" };
const SRC = (typeof document !== "undefined" && document.currentScript && document.currentScript.src) || "";
const E = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STALE_H = 36;           // snapshot older than this: say so plainly
const LAUNCHED_H = 6;         // a launch the data marks Success/Failure stays visible this long, labeled
const PAST_GRACE_H = 2;       // a launch whose time passed with no status update yet: shown as "awaiting update" this long

function country(l) {
  let c = (l.country || "").toUpperCase();
  if (!COUNTRY[c]) { const m = BY_NAME.find(([re]) => re.test(l.site || "")); c = m ? m[1] : ""; }
  const v = COUNTRY[c] || ["Other", "🌐", ((l.site || "").split(",").pop() || "").trim()];
  return { code: c, region: v[0], flag: v[1], name: v[2] };
}
/* exact = to the minute or second; anything coarser (hour, day, month...) is a target, not a countdown to trust. */
function precision(l) {
  const p = (l.precision || "").toUpperCase();
  if (p === "SEC" || p === "MIN") return "exact";
  if (p === "HR" || p === "HR6" || p === "HR12") return "hour";
  if (p) return "day";
  return (/T00:00:00Z$/.test(l.net || "") && (l.status === "TBD" || l.status === "TBC")) ? "day" : "exact";  // older snapshots had no precision field
}
function parse(items, now) {
  const t = now || Date.now(), out = [];
  for (const l of items || []) {
    if (!l || !l.net) continue; const ms = Date.parse(l.net); if (isNaN(ms)) continue;
    const done = l.status === "Success" || l.status === "Failure" || l.status === "Partial Failure";
    if (done && t - ms > LAUNCHED_H * 3600e3) continue;
    if (!done && l.status !== "In Flight" && t - ms > PAST_GRACE_H * 3600e3) continue;   // stale: time passed long ago, never updated
    const parts = (l.name || "").split("|"), st = ST[l.status] || [l.statusName || l.status || "Status unknown", "tbd"], c = country(l), p = l.probability;
    out.push({ id: l.id, mission: (l.mission || parts.slice(1).join("|") || l.name || "").trim(), rocket: (l.rocket || parts[0] || "").trim(), provider: l.provider || "",
      providerShort: SHORT[l.provider] || l.provider || "", pad: l.pad && l.pad !== "Unknown Pad" ? l.pad : "", site: l.site || "", country: c,
      orbit: l.orbit && l.orbit !== "N/A" ? l.orbit : "", orbitName: ORBIT[l.orbit] || "", status: l.status || "", statusText: st[0], statusCls: st[1],
      net: l.net, ms, windowStart: l.windowStart || null, windowEnd: l.windowEnd || null, precision: precision(l),
      weatherGo: p != null && p >= 0 && p <= 100 ? p : null, weatherConcerns: l.weatherConcerns || "",
      phase: done ? "done" : l.status === "In Flight" ? "flight" : ms <= t ? "passed" : "upcoming" });
  }
  out.sort((a, b) => a.ms - b.ms);
  return out;
}
function nextUp(list) { return list.find(l => l.phase === "upcoming" || l.phase === "flight") || null; }
function cd(ms, now, prec) {
  const d = ms - now, a = Math.abs(d), D = Math.floor(a / 864e5), h = Math.floor(a % 864e5 / 36e5), m = Math.floor(a % 36e5 / 6e4), s = Math.floor(a % 6e4 / 1e3), p = n => String(n).padStart(2, "0");
  if (prec === "day") return d > 0 ? `in about ${Math.max(1, Math.round(d / 864e5))} day${Math.round(d / 864e5) === 1 ? "" : "s"}` : "date passed";
  const body = (D ? D + "d " : "") + p(h) + ":" + p(m) + ":" + p(s);
  return (d > 0 ? "T−" : "T+") + (prec === "hour" ? "~" : "") + body;
}
const fmtDate = (iso, prec) => { const d = new Date(iso);
  if (prec === "day") return "No earlier than " + d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) + " (time TBD)";
  return d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };
const fmtTime = iso => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function windowText(l) {
  if (l.precision === "day" || !l.windowStart || !l.windowEnd) return "";
  const a = Date.parse(l.windowStart), b = Date.parse(l.windowEnd); if (isNaN(a) || isNaN(b)) return "";
  if (b - a < 60e3) return "Instantaneous window";
  const mins = Math.round((b - a) / 6e4);
  return `Window ${fmtTime(l.windowStart)} – ${fmtTime(l.windowEnd)} (${mins >= 120 ? Math.round(mins / 60) + " h" : mins + " min"})`;
}
/* "Pad, Site" without repeating the same name twice (e.g. "Rocket Lab Launch Complex 1A, Rocket Lab Launch Complex 1, Mahia ..."). */
function where(l) { const w = s => s.toLowerCase().split(/\s+/).slice(0, 3).join(" ");
  return !l.pad ? l.site : (l.site.toLowerCase().includes(l.pad.toLowerCase()) || w(l.pad) === w(l.site)) ? l.site : l.pad + ", " + l.site; }
const phaseLabel = l => l.phase === "done" ? l.statusText : l.phase === "flight" ? "In flight" : l.phase === "passed" ? "Liftoff time passed · awaiting update" : l.statusText;
const ago = (iso, now) => { const m = Math.round(((now || Date.now()) - Date.parse(iso)) / 6e4); return m < 60 ? `${Math.max(m, 1)} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

/* METAR -> plain words (same rules as the Outlook city cards). */
const COVER = { CLR: "Clear", SKC: "Clear", CAVOK: "Clear", FEW: "Mostly clear", SCT: "Partly cloudy", BKN: "Mostly cloudy", OVC: "Overcast", OVX: "Sky obscured" };
const WX = [[/TS/, "⛈️", "Thunderstorm"], [/SN/, "🌨️", "Snow"], [/RA|DZ/, "🌧️", "Rain"], [/FG/, "🌫️", "Fog"], [/BR|HZ/, "🌫️", "Mist / haze"]];
const ICON = { Clear: "☀️", "Mostly clear": "🌤️", "Partly cloudy": "⛅", "Mostly cloudy": "🌥️", Overcast: "☁️", "Sky obscured": "🌫️" };
const kt = v => v == null ? null : Math.round(+v * 1.15078);
const DIRS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
function padWx(r) {
  if (!r || r.temp == null) return null;
  const wx = r.wxString || ""; let icon = "", cond = "";
  for (const [re, i, c] of WX) if (re.test(wx)) { icon = i; cond = wx.startsWith("+") ? "Heavy " + c.toLowerCase() : wx.startsWith("-") ? "Light " + c.toLowerCase() : c; break; }
  if (!cond) { const cv = r.cover || ((r.clouds || []).slice(-1)[0] || {}).cover; cond = COVER[cv] || "Observed"; icon = ICON[cond] || "🌡️"; }
  const c = Math.round(r.temp), wd = r.wdir != null && !isNaN(+r.wdir) && +r.wspd > 0 ? DIRS[Math.round(+r.wdir / 22.5) % 16] : "";
  return { pad: r.pad, name: r.city, station: r.station, id: r.icaoId, c, f: Math.round(c * 9 / 5 + 32), icon, cond, wind: kt(r.wspd), gust: r.wgst ? kt(r.wgst) : null, dir: wd,
    vis: r.visib != null ? String(r.visib).replace("+", "") : null, obs: r.obsTime ? new Date(r.obsTime * 1000).toISOString() : null, match: r.match || [] };
}
const padFor = (l, pads) => (pads || []).find(p => p.match.some(w => (l.site + " " + l.pad).toLowerCase().includes(w.toLowerCase()))) || null;

/* ---------- rendering ---------- */
const $ = id => document.getElementById(id);
function heroHTML(l, now, pads) {
  if (!l) return `<p class="ln-empty">No upcoming launches are listed right now. Check back after the next site update.</p>`;
  const w = windowText(l), pw = padFor(l, pads);
  return `<div class="ln-next"><span class="ln-stat s-${l.statusCls}">${E(phaseLabel(l))}</span>
<h2 class="ln-mission">${E(l.mission)}</h2>
<div class="ln-cd" data-ms="${l.ms}" data-p="${l.precision}" aria-live="off">${E(cd(l.ms, now, l.precision))}</div>
<p class="ln-when">${E(fmtDate(l.net, l.precision))}${l.precision === "hour" ? " (approximate)" : ""}</p>
<dl class="ln-facts"><div><dt>Rocket</dt><dd>${E(l.rocket)}</dd></div><div><dt>Provider</dt><dd>${E(l.provider)}</dd></div>
<div><dt>Pad</dt><dd>${E(l.pad || "Pad not announced")}</dd></div><div><dt>Location</dt><dd>${l.country.flag} ${E(l.site)}</dd></div>
${l.orbit ? `<div><dt>Orbit</dt><dd>${E(l.orbitName || l.orbit)}</dd></div>` : ""}${w ? `<div><dt>Window</dt><dd>${E(w.replace(/^Window /, ""))}</dd></div>` : ""}</dl>
${l.weatherGo != null ? `<p class="ln-lw">🌤️ ${l.weatherGo}% chance of favorable launch weather (official launch forecast)${l.weatherConcerns ? ". Watching: " + E(l.weatherConcerns) : ""}</p>` : ""}
${pw ? `<p class="ln-padnow">Right now near the pad: ${pw.icon} ${pw.f}°F, ${E(pw.cond.toLowerCase())}${pw.wind != null ? ", wind " + (pw.wind ? (pw.dir ? pw.dir + " " : "") + pw.wind + " mph" : "calm") : ""}. <a href="#pad-weather">Pad weather</a></p>` : ""}</div>`;
}
function cardHTML(l, now) {
  const w = windowText(l);
  return `<article class="ln-card s-${l.statusCls}" data-region="${E(l.country.region)}" data-prov="${E(l.providerShort)}">
<div class="ln-ct"><b>${E(l.precision === "day" ? new Date(l.net).toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" }) : fmtTime(l.net))}</b>
<small>${E(l.precision === "day" ? "time TBD" : new Date(l.net).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }))}</small>
<span class="ln-cd sm" data-ms="${l.ms}" data-p="${l.precision}">${E(cd(l.ms, now, l.precision))}</span></div>
<div class="ln-cb"><span class="ln-stat s-${l.statusCls}">${E(phaseLabel(l))}</span><h3>${E(l.mission)}</h3>
<p>${E(l.rocket)} · ${E(l.providerShort)}${l.orbit ? ` · <abbr title="${E(l.orbitName)}">${E(l.orbit)}</abbr>` : ""}</p>
<p class="dim">${l.country.flag} ${E(where(l))}</p>${w ? `<p class="dim">${E(w)}</p>` : ""}
${l.weatherGo != null ? `<p class="ln-lw">🌤️ ${l.weatherGo}% favorable launch weather</p>` : ""}</div></article>`;
}
function padHTML(p, list, now) {
  const nx = list.find(l => l.phase === "upcoming" && padFor(l, [p]));
  return `<div class="ln-pad"><h3>${E(p.name)}</h3><div class="ln-pnow"><span class="ln-pi" aria-hidden="true">${p.icon}</span><b>${p.f}°F</b><span class="dim">${p.c}°C</span></div>
<p class="ln-pc">${E(p.cond)}</p><ul><li>Wind: ${p.wind == null ? "n/a" : p.wind ? (p.dir ? p.dir + " " : "") + p.wind + " mph" + (p.gust ? `, gusts ${p.gust}` : "") : "calm"}</li>${p.vis ? `<li>Visibility: ${E(p.vis)} mi</li>` : ""}</ul>
<p class="ln-pnext">${nx ? `Next from here: <b>${E(nx.mission)}</b>, ${E(nx.precision === "day" ? fmtDate(nx.net, "day").replace("No earlier than ", "NET ") : fmtDate(nx.net))}` : "No launch from here in the current list."}</p>
<p class="ln-pst">${E(p.station)} (${E(p.id)})${p.obs ? ", observed " + E(ago(p.obs, now)) : ""}</p></div>`;
}
function filters(list) {
  const reg = {}, prov = {};
  list.forEach(l => { reg[l.country.region] = (reg[l.country.region] || 0) + 1; prov[l.providerShort] = (prov[l.providerShort] || 0) + 1; });
  const order = ["USA", "China", "India", "Europe", "New Zealand", "Russia", "Japan", "Other"];
  const chips = [`<button type="button" class="ln-chip on" data-f="all" aria-pressed="true">All <i>${list.length}</i></button>`]
    .concat(order.filter(r => reg[r]).map(r => `<button type="button" class="ln-chip" data-f="${E(r)}" aria-pressed="false">${E(r)} <i>${reg[r]}</i></button>`)).join("");
  const opts = Object.keys(prov).sort((a, b) => prov[b] - prov[a] || a.localeCompare(b)).map(p => `<option value="${E(p)}">${E(p)} (${prov[p]})</option>`).join("");
  return `<div class="ln-chips" role="group" aria-label="Filter by region">${chips}</div><label class="ln-sel">Provider <select id="ln-prov"><option value="">All providers</option>${opts}</select></label>`;
}
function render(snap, now) {
  now = now || Date.now();
  const la = snap && snap.launches, at = la && la.fetchedAt, age = at ? (now - Date.parse(at)) / 36e5 : Infinity;
  const list = parse(la && la.items, now), pads = ((snap && snap.pads && snap.pads.items) || []).map(padWx).filter(Boolean);
  const nx = nextUp(list), rest = list.filter(l => l !== nx).slice(0, 24);
  if ($("ln-hero")) $("ln-hero").innerHTML = heroHTML(nx, now, pads);
  if ($("ln-age")) $("ln-age").innerHTML = at ? `Schedule snapshot from ${E(ago(at, now))} (${E(new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}). Times shown in your time zone${age > STALE_H ? `. <b>This copy is out of date</b>: check the provider for the latest times` : ""}.` : "Schedule not available right now.";
  if ($("ln-filters")) $("ln-filters").innerHTML = rest.length ? filters(rest) : "";
  if ($("ln-list")) $("ln-list").innerHTML = rest.length ? rest.map(l => cardHTML(l, now)).join("") + `<p class="ln-none" hidden>No launches match this filter.</p>` : `<p class="ln-empty">No other upcoming launches in this snapshot.</p>`;
  if ($("ln-pads")) $("ln-pads").innerHTML = pads.length ? pads.map(p => padHTML(p, list, now)).join("") : `<p class="ln-empty">Pad weather isn't available in this update.</p>`;
  if ($("ln-pads-at") && snap && snap.pads && snap.pads.fetchedAt) $("ln-pads-at").textContent = `Fetched ${ago(snap.pads.fetchedAt, now)}. `;
  bindFilters();
  return { list, next: nx, pads };
}
function bindFilters() {
  const box = $("ln-filters"), lst = $("ln-list"); if (!box || !lst) return;
  let reg = "all", prov = "";
  const apply = () => { let n = 0; lst.querySelectorAll(".ln-card").forEach(c => { const ok = (reg === "all" || c.dataset.region === reg) && (!prov || c.dataset.prov === prov); c.hidden = !ok; n += ok; });
    const none = lst.querySelector(".ln-none"); if (none) none.hidden = n > 0; };
  box.querySelectorAll(".ln-chip").forEach(b => b.onclick = () => { reg = b.dataset.f; box.querySelectorAll(".ln-chip").forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); }); apply(); });
  const sel = $("ln-prov"); if (sel) sel.onchange = () => { prov = sel.value; apply(); };
}
function tick() { const now = Date.now(); document.querySelectorAll(".ln-cd[data-ms]").forEach(c => { const t = cd(+c.dataset.ms, now, c.dataset.p); if (c.textContent !== t) c.textContent = t; }); }
function start() {
  if (!$("ln-hero")) return;
  fetch(new URL("outlook.json", SRC || location.origin + "/assets/"), { cache: "no-cache" }).then(r => r.json()).then(s => { render(s); tick(); setInterval(tick, 1000);
    let last = Date.now(); setInterval(() => { if (Date.now() - last > 600e3) { last = Date.now(); render(s); } }, 60e3);  // re-sort as launches pass
  }).catch(() => { tick(); setInterval(tick, 1000); if ($("ln-age")) $("ln-age").textContent = "Couldn't load the latest schedule snapshot; showing the copy built into this page."; });
}
const API = { where, parse, nextUp, cd, precision, country, padWx, padFor, render, windowText };
if (typeof module !== "undefined" && module.exports) module.exports = API;
if (typeof document !== "undefined" && document.addEventListener) { G.YWLaunches = API; const go = () => start(); document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", go) : go(); }
})(typeof window !== "undefined" ? window : globalThis);
