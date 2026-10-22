window.YW_ATL_IMG = window.YW_ATL_IMG || (() => `<img class="atl-ic" src="${(typeof window !== "undefined" && window.YW_ATLAS) || "/assets/atlas.svg"}" width="24" height="24" alt="">`);
/* Weather Trip Planner (/trip-planner/): Ask Atlas, your travel agent. Atlas turns a sentence (or the trip form) into a weather-first
   plan: NWS daily forecast + alerts for US destinations, best-weather dates, a day-by-day plan, prefilled outbound searches
   (we don't book or see prices), a packing list and the /trip#v1 app link. Runs in the browser; the only network calls are
   /assets/places.json (destination search), api.weather.gov (US forecast + alerts) and, when data-metno is set on #tp,
   MET Norway Locationforecast for other countries (directly from api.met.no, or through our caching proxy in _src/worker/). */
(function () {
  const C = window.YWTripCore, $ = id => document.getElementById(id), E = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  if (!C || !$("tp")) return;
  const ACT = [["SIGHTSEEING", "🏙️ Sightseeing"], ["HIKE", "🥾 Hiking & parks"], ["BEACH", "🏖️ Beach"], ["SKI", "⛷️ Ski & snow"], ["CAMP", "🏕️ Camping"], ["FISH", "🎣 Fishing"], ["BOAT", "⛵ Boating"], ["EVENT", "🎟️ Event"], ["BUSINESS", "💼 Business"], ["FAMILY", "👪 Family visit"]];
  const MODE = [["CAR", "🚗 Car"], ["FLY", "✈️ Flying"], ["RV", "🚐 RV"], ["MOTORCYCLE", "🏍️ Motorcycle"], ["BIKE", "🚲 Bicycle"], ["BOAT", "⛴️ Boat"], ["FOOT", "🚶 On foot"]];
  const nm = (L, k) => ((L.find(x => x[0] === k) || [k, k])[1]).replace(/^\S+\s/, "");
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const st = { v: 1, act: "SIGHTSEEING", mode: "CAR" }; let awaiting = null, rows = null, rowsP = null, pdata = null, runId = 0;
  const LS = "yw-trip-last";
  const say = (cls, html) => { const d = document.createElement("div"); d.className = "msg " + cls + (cls === "bot" ? " atl" : ""); d.innerHTML = cls === "bot" ? `<b>${window.YW_ATL_IMG()}Atlas<button type="button" class="lsay" data-say="msg" aria-label="Listen" title="Listen">🔊</button></b>${html}` : html;
    $("tlog").appendChild(d); $("tlog").scrollTop = $("tlog").scrollHeight; return d; };
  const places = () => rowsP || (rowsP = fetch("/assets/places.json").then(r => r.json()).then(j => (pdata = j, rows = j.rows)).catch(() => { rowsP = null; return rows = []; }));
  function timed(url, ms) { const ac = typeof AbortController === "function" ? new AbortController() : null, t = setTimeout(() => ac && ac.abort(), ms);
    return fetch(url, { signal: ac && ac.signal, headers: { Accept: "application/geo+json" } }).then(r => { clearTimeout(t); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }); }
  async function nws(lat, lon) {   // points -> forecast, one retry; cached 30 min in this tab
    const key = "yw-nws-" + lat + "," + lon; try { const c = JSON.parse(sessionStorage.getItem(key) || "null"); if (c && Date.now() - c.t < 18e5) return c.v; } catch (e) {}
    const get = async u => { try { return await timed(u, 9000); } catch (e) { return timed(u, 12000); } };
    const pt = await get(`https://api.weather.gov/points/${lat},${lon}`), fc = await get(pt.properties.forecast);
    let al = []; try { al = ((await timed(`https://api.weather.gov/alerts/active?point=${lat},${lon}`, 8000)).features || []).map(f => f.properties).filter(p => p && p.status === "Actual"); } catch (e) {}
    const v = { periods: fc.properties.periods, alerts: al.map(p => ({ ev: p.event, head: p.headline, sev: p.severity, ends: p.ends || p.expires })) };
    try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch (e) {} return v;
  }
  /* MET Norway (non-US): "direct" = api.met.no from the browser (identified by the Origin header, as MET's terms allow for
     low-volume sites), or our caching proxy's URL. The browser's HTTP cache honours MET's Expires/Last-Modified (If-Modified-Since). */
  const METNO = (($("tp") || {}).dataset || {}).metno || "", MET_URL = METNO === "direct" ? "https://api.met.no/weatherapi/locationforecast/2.0/complete" : METNO;
  const M = window.YWMetno;
  async function met(lat, lon) {
    const u = M.url(MET_URL, lat, lon), key = "yw-met-" + u;
    try { const c = JSON.parse(sessionStorage.getItem(key) || "null"); if (c && Date.now() < c.exp) return c.v; } catch (e) {}   // until MET's Expires
    const get = ms => { const ac = typeof AbortController === "function" ? new AbortController() : null, t = setTimeout(() => ac && ac.abort(), ms);
      return fetch(u, { signal: ac && ac.signal }).then(async r => { clearTimeout(t); if (r.status === 203) console.warn("MET Norway: this Locationforecast version is deprecated");
        if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; } return { v: await r.json(), exp: Date.parse(r.headers.get("Expires") || "") }; }); };
    let res; try { res = await get(9000); } catch (e) { if (e.status === 429 || e.status === 403) throw e; res = await get(12000); }   // never hammer MET after a 429/403
    const exp = res.exp > Date.now() ? Math.min(res.exp, Date.now() + 36e5) : Date.now() + 18e5;
    try { sessionStorage.setItem(key, JSON.stringify({ exp, v: res.v })); } catch (e) {} return res.v;
  }
  /* ---------- form <-> state ---------- */
  function toForm() { $("f-to").value = st.to || ""; $("f-from").value = st.from || ""; $("f-sd").value = st.sd || ""; $("f-ed").value = st.sd ? C.addDays(st.sd, (+st.d || 1) - 1) : ""; $("f-act").value = st.act; $("f-mode").value = st.mode; }
  function fromForm() {
    const sd = $("f-sd").value, ed = $("f-ed").value || sd;
    Object.assign(st, { to: $("f-to").value.trim(), from: $("f-from").value.trim() || undefined, sd: sd || undefined, act: $("f-act").value, mode: $("f-mode").value });
    st.d = sd ? Math.max(1, Math.min(30, C.daysBetween(sd, ed < sd ? sd : ed) + 1)) : undefined;
  }
  /* ---------- destination autocomplete (combobox) ---------- */
  function combo(inp) {
    const list = document.createElement("ul"); list.className = "tp-ac"; list.id = inp.id + "-ac"; list.setAttribute("role", "listbox"); list.hidden = true; inp.parentNode.appendChild(list);
    inp.setAttribute("role", "combobox"); inp.setAttribute("aria-autocomplete", "list"); inp.setAttribute("aria-expanded", "false"); inp.setAttribute("aria-controls", list.id);
    let items = [], hi = -1;
    const close = () => { list.hidden = true; inp.setAttribute("aria-expanded", "false"); hi = -1; };
    const choose = r => { inp.value = C.label(r); close(); inp.dispatchEvent(new Event("change")); };
    const paint = () => { list.innerHTML = items.map((r, i) => `<li role="option" id="${inp.id}-o${i}" aria-selected="${i === hi}" data-i="${i}"><b>${E(r[0])}</b><span>${E(r[1])}${r[2] === "US" && r[5] === 0 ? " · National park" : ""}</span></li>`).join("");
      list.hidden = !items.length; inp.setAttribute("aria-expanded", String(!!items.length)); inp.setAttribute("aria-activedescendant", hi >= 0 ? inp.id + "-o" + hi : ""); };
    inp.addEventListener("focus", places, { once: true });
    inp.addEventListener("input", async () => { const v = inp.value; await places(); if (inp.value !== v) return; items = C.suggest(rows || [], v, 6); hi = -1; paint(); });
    inp.addEventListener("keydown", e => { if (list.hidden) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); hi = (hi + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; paint(); }
      else if (e.key === "Enter" && hi >= 0) { e.preventDefault(); choose(items[hi]); } else if (e.key === "Escape") close(); });
    list.addEventListener("mousedown", e => { const li = e.target.closest("li"); if (li) { e.preventDefault(); choose(items[+li.dataset.i]); } });
    inp.addEventListener("blur", () => setTimeout(close, 120));
  }
  /* ---------- Ask Atlas: the travel agent conversation ---------- */
  function datesChips() { const t = today(), q = s => YWQuick.dates(s, t);
    return `<div class="parsed tp-dq">${[["This weekend", "this weekend"], ["Next weekend", "next weekend"], ["Next week", "next week for a week"]].map(([l, s]) => { const r = q(s); return r.sd ? `<button type="button" class="sug tp-date" data-sd="${r.sd}" data-d="${r.d}">${E(l)} · ${E(C.fmtRange(r.sd, r.d))}</button>` : ""; }).join("")}<button type="button" class="sug tp-pick">📅 Pick dates</button></div>`; }
  function ask(text) {
    text = String(text || "").trim().slice(0, 300); if (!text) return; say("me", `<p>${E(text)}</p>`);
    const r = YWQuick.parseTrip(text, today());
    if (C.isBookingAsk(text)) {
      if (r.to && (!st.to || r.to !== st.to)) { st.to = r.to; } if (r.sd) { st.sd = r.sd; st.d = r.d; } if (r.from) st.from = r.from;
      if (st.to && st.sd) { say("bot", `<p>I can't book trips or see live prices myself, but I've lined up searches with your trip filled in. You'll check prices and book on the site you pick.</p><p><a class="btn dark" href="#tp-book">See flights, hotels and cars ↓</a></p>`); return plan(true); }
      return say("bot", `<p>I can't book or see live prices, but tell me where and when (like “Nashville Oct 30 to Nov 1”) and I'll open flight, hotel and car searches with your trip filled in.</p>`);
    }
    const sa = awaiting ? null : C.sourcedAnswer(text, r);
    if (sa && sa.a) { const a = sa.a; return say("bot", `<p>${a.a}</p><p class="note">Source: <a href="${a.u}">${E(a.t === "More" ? "Your World Weather Radar" : a.t + " guide")}</a> · <a href="/ask.html?q=${encodeURIComponent(text)}">Ask Atlas more →</a></p>`); }
    if (sa && sa.none) return say("bot", `<p>I don't have a sourced answer for that. Tell me about your trip (like “Road trip to Nashville Oct 30 – Nov 1”) or <a href="/ask.html?q=${encodeURIComponent(text)}">ask Atlas more →</a></p>`);
    if (r.to) st.to = r.to; else if (awaiting === "to" && !r.sd) st.to = text.replace(/^(to|in)\s+/i, "");
    if (r.from) st.from = r.from; if (r.stops) st.stops = r.stops;
    if (r.sd) { st.sd = r.sd; st.d = r.d; }
    if (/\b(trip|ski|hik|beach|camp|fish|boat|wedding|game|concert|business|family|visit)/i.test(text)) st.act = r.act;
    if (/\b(rv|camper|fly|flying|flight|plane|motorcycle|bik|cycl|boat|ferry|cruise|walk|drive|driving|road trip|car)\b/i.test(text)) st.mode = r.mode;
    if (awaiting === "sd" && !r.sd) return say("bot", `<p>I didn't catch the dates. Try “Oct 30 to Nov 1”, “this weekend” or tap one:</p>${datesChips()}`);
    next();
  }
  function next() {
    toForm();
    if (!st.to) { awaiting = "to"; return say("bot", `<p>Where are you headed?</p>`); }
    if (!st.sd) { awaiting = "sd"; return say("bot", `<p>${E(st.to)}, nice. When are you going?</p>${datesChips()}`); }
    awaiting = null; plan();
  }
  /* ---------- results ---------- */
  async function plan(quiet) {
    const id = ++runId; try { document.documentElement.style.setProperty("--tp-top", (document.querySelector(".top") || {}).offsetHeight + "px"); } catch (e) {} st.d = Math.max(1, Math.min(30, +st.d || 1)); toForm();
    await places(); if (id !== runId) return;
    const place = C.resolve(rows || [], st.to), out = $("tres"); out.hidden = false; if ($("tform").parentNode.open) $("tform").parentNode.open = false;
    const dest = place ? C.label(place) : st.to;
    if (place) st.to = dest;
    try { localStorage.setItem(LS, JSON.stringify({ to: st.to, from: st.from, sd: st.sd, d: st.d, act: st.act, mode: st.mode })); } catch (e) {}
    out.innerHTML = head(dest) + `<section class="tp-sec" id="tp-wx"><h2>🌦️ Weather for your trip</h2><div class="tp-days" id="tp-days"><p class="tp-load">Checking the ${place && !C.hasNws(place) ? "MET Norway" : "National Weather Service"} forecast…</p></div></section>` + "<div id=tp-rest></div>";
    let ds = null, alerts = [], wxNote = "", metMeta = null; const tz = place && !C.hasNws(place) && METNO && M ? M.tzFor(place, rows, pdata) : null;
    if (place && C.hasNws(place)) {
      try { const v = await nws(place[3].toFixed(4).replace(/0+$/, "").replace(/\.$/, ""), place[4].toFixed(4).replace(/0+$/, "").replace(/\.$/, "")); if (id !== runId) return; ds = C.days(v.periods); alerts = v.alerts; }
      catch (e) { wxNote = `<p class="tp-warn">Couldn't reach the National Weather Service just now (weak signal?). <button type="button" class="btn" id="tp-retry">Try again</button></p>`; }
    } else if (tz) {
      try { const v = await met(place[3], place[4]); if (id !== runId) return; ds = M.days(v, tz).map(d => (d.icon = C.emoji(d.short, d.nightOnly), d.risk = C.risk(d), d)); metMeta = { at: v.properties && v.properties.meta && v.properties.meta.updated_at, tz }; if (!ds.length) throw new Error("empty"); }
      catch (e) { ds = null; wxNote = `<p class="tp-warn">Couldn't load the MET Norway forecast for ${E(dest)} just now. <button type="button" class="btn" id="tp-retry">Try again</button></p>`; }
    } else wxNote = place ? `<p class="tp-info">Day-by-day forecasts on this page cover US destinations (National Weather Service). For ${E(dest)}, open the trip in the app for the forecast.</p>`
      : `<p class="tp-info">I couldn't find “${E(st.to)}” on my map, so I can't show its forecast here. Pick a place from the suggestions in the Where box, or try the nearest town.</p>`;
    if (id !== runId) return;
    const itin = C.itinerary(st, ds, place, today()), wx = C.summary(ds, st);
    $("tp-days").innerHTML = wxNote + (ds ? (metMeta ? metCards(itin, ds, metMeta) : wxCards(itin, ds)) : "") + alertsHtml(alerts);
    $("tp-rest").innerHTML = best(ds) + days(itin) + book() + pack() + phone();
    if ($("tp-retry")) $("tp-retry").onclick = () => plan(true);
    if (window.YWTripGear) YWTripGear.mount(st, $("tp-gear"), wx);
    if (!$("tgear")) $("tp-gear").innerHTML = `<p><a href="/gear/">See weather gear for your trip →</a></p>`;
    await phoneLink();
    if (!quiet) say("bot", `<p>${E(headline(dest, itin, ds, alerts, place))}</p><p><a class="btn dark" href="#tres">See my trip plan ↓</a></p>`);
  }
  function head(dest) {
    return `<div class="tp-head"><div><span class="kicker">Your trip</span><h2>${E(dest)}</h2><p>${E(C.fmtRange(st.sd, st.d))} · ${st.d} day${st.d > 1 ? "s" : ""} · ${E(nm(ACT, st.act))} · ${E(nm(MODE, st.mode))}${st.from ? " · from " + E(st.from) : ""}</p></div><a class="btn" href="#tp">Edit trip</a></div>
<nav class="tp-jump" aria-label="Trip sections"><a href="#tp-wx">Weather</a><a href="#tp-plan">Day by day</a><a href="#tp-book">Book</a><a href="#tp-pack">Pack</a><a href="#tp-phone">Send to phone</a></nav>`;
  }
  function headline(dest, itin, ds, alerts, place) {
    const w = itin.filter(x => x.w);
    const met = !!(ds && ds[0] && ds[0].src === "metno");
    if (!w.length) return place && (C.hasNws(place) || met) ? `Here's your trip to ${dest}. Its forecast isn't out yet; it appears about ${met ? 9 : 7} days ahead. I've lined up the day-by-day plan, searches to book and a packing list.`
      : `Here's your trip to ${dest}: a day-by-day plan, searches to book and a packing list.`;
    const bad = w.filter(x => !["good", "maybe"].includes(x.w.risk.k)), g = w.filter(x => x.w.risk.k === "good");
    let s = `Here's your trip to ${dest}. `;
    s += bad.length ? `Watch ${bad.map(x => x.label.split(" ")[0] + " (" + x.w.risk.t.toLowerCase() + ")").join(", ")}. ` : g.length === w.length ? `The forecast looks good for ${w.length > 2 ? "all " + w.length + " forecast days" : w.length === 2 ? "both days" : "that day"}. ` : met ? "Mostly good, with some rain forecast. " : "Mostly good, with a chance of rain. ";
    if (alerts.length) s += `There ${alerts.length > 1 ? "are " + alerts.length + " active weather alerts" : "is an active weather alert"} there right now. `;
    return s + "Your plan, booking searches and packing list are below.";
  }
  const pill = r => `<span class="tp-risk r-${r.k}">${E(r.t)}</span>`;
  function wxCards(itin, ds) {
    const inTrip = new Set(itin.map(x => x.date));
    return `<div class="tp-strip" role="list">${ds.map(d => `<div class="tp-day${inTrip.has(d.date) ? " in" : ""}" role="listitem"><span class="dn">${E(C.fmt(d.date).split(" ")[0])}<small>${E(C.fmt(d.date).split(" ").slice(1).join(" "))}</small></span><span class="ic" aria-hidden="true">${d.icon}</span><b>${d.hi != null ? d.hi + "°" : "–"}<small>${d.lo != null ? " / " + d.lo + "°" : ""}</small></b><span class="pp">💧 ${d.pop}%</span>${pill(d.risk)}${inTrip.has(d.date) ? '<span class="tp-in">Your trip</span>' : ""}</div>`).join("")}</div>
<p class="note">Highlighted days are your trip. Forecast: <a href="https://www.weather.gov/" target="_blank" rel="noopener">National Weather Service</a>, about 7 days ahead. °F, highest rain chance of the day.</p>`;
  }
  /* MET Norway cards: only values MET gave for this place; anything missing says "not available" (never estimated). */
  const NA = '<span class="na">not available</span>';
  function metCards(itin, ds, meta) {
    const inTrip = new Set(itin.map(x => x.date)), f = M.fields(ds), miss = [!f.pop && "rain chance", !f.thunderPct && "thunder chance", !f.gust && "wind gusts"].filter(Boolean);
    const rain = d => d.pop != null ? `💧 ${d.pop}%` : d.precipIn != null ? `💧 ${d.precipIn} in` : "💧 –";
    const mine = ds.filter(d => inTrip.has(d.date));
    let at = ""; try { at = meta.at ? new Date(meta.at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : ""; } catch (e) {}
    return `<div class="tp-strip" role="list">${ds.map(d => `<div class="tp-day${inTrip.has(d.date) ? " in" : ""}" role="listitem"><span class="dn">${E(C.fmt(d.date).split(" ")[0])}<small>${E(C.fmt(d.date).split(" ").slice(1).join(" "))}</small></span><span class="ic" aria-hidden="true">${d.icon}</span><b>${d.hi != null ? d.hi + "°" : "–"}<small>${d.lo != null ? " / " + d.lo + "°" : ""}</small></b><span class="pp">${rain(d)}</span>${pill(d.risk)}${inTrip.has(d.date) ? '<span class="tp-in">Your trip</span>' : ""}</div>`).join("")}</div>
${mine.length ? `<div class="tp-metd"><h3>Your trip days in MET Norway's forecast</h3>${mine.map(d => `<div class="tp-metr"><b>${E(C.fmt(d.date))}</b><dl>${[
      ["Rain", d.precipIn != null ? d.precipIn + " in" : null], ["Rain chance", d.pop != null ? d.pop + "%" : null], ["Wind", d.wind != null ? "up to " + d.wind + " mph" : null],
      ["Gusts", d.gust != null ? "up to " + d.gust + " mph" : null], ["Thunder chance", d.thunderPct != null ? d.thunderPct + "%" : null]].map(([k, v]) => `<div><dt>${k}</dt><dd>${v != null ? E(v) : NA}</dd></div>`).join("")}</dl></div>`).join("")}</div>` : ""}
<p class="note">Highlighted days are your trip, in local time at your destination. About 9 days ahead. °F; 💧 ${f.pop ? "is the highest rain chance of the day" : "is MET's forecast rain amount for the day"}; wind is the steady wind, not gusts.${miss.length ? ` MET Norway doesn't provide ${miss.length > 1 ? miss.slice(0, -1).join(", ") + " or " + miss[miss.length - 1] : miss[0]} for this location, so they show as not available.` : ""} No weather alerts are shown for this destination; check the local weather service.</p>
<p class="note tp-metattr">${M.ATTR}${at ? ` Forecast updated ${E(at)}.` : ""}</p>`;
  }
  function alertsHtml(al) {
    if (!al || !al.length) return "";
    return `<div class="tp-alerts">${al.slice(0, 4).map(a => `<div class="tp-alert"><b>⚠️ ${E(a.ev)}</b><span>${E(a.head || "")}</span></div>`).join("")}<p class="note">Active NWS alerts at your destination right now. Follow local officials.</p></div>`;
  }
  function best(ds) {
    if (!ds || ds.length < 2) return "";
    const n = Math.min(+st.d || 1, ds.length), w = C.bestWindow(ds, n); if (!w) return "";
    const mine = n === +st.d ? C.windowScore(ds, st.sd, n) : null, same = w.sd === st.sd && n === +st.d || mine != null && mine >= w.s - 5;
    const top = ds.filter(d => !d.nightOnly).map(d => [C.score(d), d]).sort((a, b) => b[0] - a[0]).slice(0, 3).map(x => x[1]).sort((a, b) => a.date < b.date ? -1 : 1);
    return `<section class="tp-sec tp-best"><h2>🏆 Best weather days</h2><p>Driest, calmest days in the current forecast for ${E(st.to)}: <b>${top.map(d => E(C.fmt(d.date))).join(", ")}</b>.</p>
${same ? `<p class="tp-ok">✅ Your dates are already among the best ${n > 1 ? n + "-day stretches" : "days"} in the forecast.</p>` : `<p>Best ${n > 1 ? n + "-day stretch" : "day"} in the forecast: <b>${E(C.fmtRange(w.sd, n))}</b>.${n < +st.d ? ` (The forecast covers ${ds.length} days.)` : ""}</p>${n === +st.d ? `<button type="button" class="btn" id="tp-shift" data-sd="${w.sd}">Use these dates</button>` : ""}`}
<p class="note">Ranked by ${ds[0].src === "metno" && ds.every(d => d.pop == null) ? "rain amount, thunder, wind and temperature in the MET Norway forecast" : `rain chance, thunderstorms, wind and temperature in the ${ds[0].src === "metno" ? "MET Norway" : "NWS"} forecast`}. Forecasts change, so check again closer to the trip.</p></section>`;
  }
  function days(itin) {
    return `<section class="tp-sec" id="tp-plan"><h2>🗓️ Day by day</h2><ol class="tp-itin">${itin.map(x => `<li><div class="tp-ih"><b>Day ${x.i}</b><span>${E(x.label)}</span>${x.w ? `<span class="tp-iw">${x.w.icon} ${x.w.hi != null ? x.w.hi + "°" : ""}</span>${pill(x.w.risk)}` : ""}</div>${x.tips.map(t => `<p>${E(t)}</p>`).join("")}</li>`).join("")}</ol>
${itin.some(x => x.w && x.w.risk.k === "storm") ? `<p class="note">Storms in the forecast: read <a href="/guides/lightning-safety.html">lightning safety</a>.</p>` : ""}</section>`;
  }
  function book() {
    const L = C.links(st);
    return `<section class="tp-sec" id="tp-book"><h2>🧳 Book your trip</h2><p class="dim">Each button opens a search on that site with your destination${st.from ? ", starting point" : ""} and dates filled in where the site supports it. We don't sell travel, see prices or earn anything from these links. Double-check dates and details before you book.</p>
<div class="tp-bk">${L.map(l => `<a class="tp-b" href="${E(l.href)}" target="_blank" rel="noopener" data-partner="${E(l.k)}"><span class="ic" aria-hidden="true">${l.ico}</span><span><b>${E(l.t)}</b><small>on ${E(l.site)} ↗</small></span></a>`).join("")}</div></section>`;
  }
  const pack = () => `<section class="tp-sec" id="tp-pack"><h2>🎒 Pack for the weather</h2><div id="tp-gear"></div></section>`;
  const phone = () => `<section class="tp-sec" id="tp-phone"><h2>📱 Take it on your phone</h2><div id="tp-ph" class="tp-ph"></div></section>`;
  async function phoneLink() {
    const box = $("tp-ph"); if (!box) return;
    let tok; try { tok = await YWTrip.encode({ v: 1, from: st.from, to: st.to, sd: st.sd, d: st.d, act: st.act, mode: st.mode, stops: st.stops }); } catch (e) { box.innerHTML = `<p class="err">${E(e.message)}</p>`; return; }
    const url = YWTrip.webUrl(tok), android = /Android/i.test(navigator.userAgent);
    box.innerHTML = `<p>Open this trip in Your World Weather Radar for the full forecast, radar and alerts along the way.</p>
${android ? `<div class="btns"><a class="btn primary" href="${E(YWTrip.intentUrl(tok))}">Open in the app</a></div>` : `<div class="tp-qrw"><div class="qr" id="qr"></div><p class="note">Scan with your Android phone to open it there.</p></div>`}
<p class="note">Your link (everything is inside the link itself; nothing is uploaded):</p><div class="linkbox" id="lk">${E(url)}</div>
<div class="btns"><button class="btn" id="copy">Copy link</button>${navigator.share ? `<button class="btn" id="share">Share</button>` : ""}<a class="btn dark" href="${E(YWTrip.PLAY)}" target="_blank" rel="noopener">Get the app on Google Play</a></div>
<p class="note">Open on your Android phone with Your World Weather Radar installed. If the app isn't installed yet, the link opens this page with a Google Play button.</p>`;
    if (!android && window.qrcode) { const q = qrcode(0, "L"); q.addData(url); q.make(); $("qr").innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); }
    $("copy").onclick = () => navigator.clipboard.writeText(url).then(() => $("copy").textContent = "Copied ✓");
    if ($("share")) $("share").onclick = () => navigator.share({ title: "My weather trip", url });
    history.replaceState(null, "", "#" + tok);
  }
  /* ---------- wire up ---------- */
  $("f-act").innerHTML = ACT.map(([k, t]) => `<option value="${k}">${E(t)}</option>`).join(""); $("f-mode").innerHTML = MODE.map(([k, t]) => `<option value="${k}">${E(t)}</option>`).join("");
  $("f-sd").min = today(); $("f-ed").min = today(); toForm(); combo($("f-to"));
  $("f-sd").addEventListener("change", () => { if (!$("f-ed").value || $("f-ed").value < $("f-sd").value) $("f-ed").value = $("f-sd").value; $("f-ed").min = $("f-sd").value; });
  $("tform").addEventListener("submit", e => { e.preventDefault(); fromForm(); const miss = !st.to ? "f-to" : !st.sd ? "f-sd" : null;
    if (miss) { $("terr").textContent = miss === "f-to" ? "Where are you headed?" : "Pick your dates."; $(miss).focus(); return; } $("terr").textContent = ""; awaiting = null;
    say("me", `<p>${E(st.to)}, ${E(C.fmtRange(st.sd, st.d))}</p>`); plan(); });
  $("qgo").onclick = () => { ask($("qtext").value); $("qtext").value = ""; };
  $("qtext").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); $("qgo").click(); } };
  document.addEventListener("click", e => {
    const t = e.target.closest && e.target.closest("button, a"); if (!t) return;
    if (t.classList.contains("tp-sug")) ask(t.dataset.q || t.textContent);
    else if (t.classList.contains("tp-date")) { st.sd = t.dataset.sd; st.d = +t.dataset.d; say("me", `<p>${E(t.textContent)}</p>`); awaiting = null; next(); }
    else if (t.classList.contains("tp-pick")) { $("f-sd").focus(); try { $("f-sd").showPicker(); } catch (x) {} }
    else if (t.id === "tp-shift") { st.sd = t.dataset.sd; say("bot", `<p>Moved your trip to ${E(C.fmtRange(st.sd, st.d))}, the best stretch in the forecast.</p>`); plan(true); }
    else if (t.dataset && t.dataset.partner && window.gtag) gtag("event", "trip_outbound", { partner: t.dataset.partner });
  });
  let last = null; try { last = JSON.parse(localStorage.getItem(LS) || "null"); } catch (e) {}   // remembered on this device only
  if (last && last.to && last.sd >= today() && !location.hash && !location.search)
    $("tsugg").insertAdjacentHTML("afterbegin", `<button type="button" class="sug tp-last">↩ Last trip: ${E(last.to)}, ${E(C.fmtRange(last.sd, last.d))}</button>`);
  $("tsugg").addEventListener("click", e => { if (e.target.closest(".tp-last")) { Object.assign(st, last); awaiting = null; say("me", `<p>${E(last.to)}, ${E(C.fmtRange(last.sd, last.d))}</p>`); plan(); } });
  if (location.hash.startsWith("#v1.")) YWTrip.decode(location.hash).then(o => { Object.assign(st, o); say("bot", `<p>Here's the trip from your link.</p>`); plan(true); }).catch(() => {});
  else { const q = new URLSearchParams(location.search).get("q"); if (q) ask(q); }
})();
