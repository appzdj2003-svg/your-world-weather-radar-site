/* /flight page UI. Data: adsb.lol live aircraft (ODbL) + adsb.lol/VRS routes (CC0); day-of route cross-check via api.adsbdb.com
   (browser, free, no key — not the adsb.lol budget); METAR/TAF and SIGMETs from aviationweather.gov,
   FAA NAS Status, OpenStreetMap places (Nominatim, ODbL) through our relay (data-api); NWS observations directly as a fallback.
   No keys, no AI. Everything that's an estimate says so. */
(function () {
  const F = window.YWFlight, $ = id => document.getElementById(id), root = $("fl");
  if (!F || !root) return;
  const API = (root.dataset.api || "").replace(/\/+$/, ""), PLAY = root.dataset.play || "";
  const ROUTES = "https://vrs-standing-data.adsb.lol/routes/";
  const ADSBDB = "https://api.adsbdb.com/v0/callsign/";
  const E = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const mi = nm => Math.round(nm * 1.15078), kmToMi = km => km / 1.609344;
  const tz = (() => { try { return new Intl.DateTimeFormat([], { timeZoneName: "short" }).formatToParts(new Date()).find(p => p.type === "timeZoneName").value; } catch (e) { return ""; } })();
  const tm = ms => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const tmd = ms => { const d = new Date(ms), same = d.toDateString() === new Date().toDateString(); return (same ? "" : d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + ", ") + tm(ms); };
  // Same minute string the AI headline clock uses — must match the time portion of tmd/tm for a given etaMs.
  const clockOnly = ms => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const ago = s => s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h`;
  const S = { t: null, route: null, legs: [], leg: null, ac: null, acAt: 0, acErr: "", acStale: false, retryAfterMs: 0, liveBackoff: 15e3, nextLiveAt: 0, liveTimer: null, wx: {}, routeWx: [], nas: null, sig: null, places: null, timers: [], fetched: {}, open: {}, tab: "dinner", alertsOn: false, prev: null, rot: null, estKey: "", pulse: false };
  // Live trip view embeds this page in an iframe (?embed=1). One poller; parent listens via postMessage.
  const EMBED = /(?:^|[?&])embed=1(?:&|$)/.test(location.search);
  if (EMBED) {
    const mark = () => { try { document.documentElement.classList.add("fl-embed"); if (document.body) document.body.classList.add("fl-embed"); } catch (_) {} };
    mark();
    if (!document.body) document.addEventListener("DOMContentLoaded", mark, { once: true });
  }

  // Every lookup gets a timeout so one slow source can never hold up the route or the plane.
  async function fetchT(url, opt, ms = 10e3) {
    const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
    const tm = ac ? setTimeout(() => ac.abort(), ms) : null;
    try { return await fetch(url, ac ? { ...(opt || {}), signal: ac.signal } : opt); } finally { if (tm) clearTimeout(tm); }
  }
  async function getJSON(url, opt, ms) {
    const r = await fetchT(url, opt, ms);
    if (!r.ok) {
      const err = Object.assign(new Error("HTTP " + r.status), { status: r.status });
      const ra = r.headers.get("Retry-After");
      if (ra) {
        const n = +ra;
        err.retryAfterMs = isFinite(n) && n >= 0 ? n * 1000 : Math.max(0, Date.parse(ra) - Date.now());
      }
      throw err;
    }
    return r.json();
  }
  const api = p => getJSON(API + p);

  // ---------- form & link ----------
  const toLocalInput = iso => { if (!iso) return ""; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const fromLocalInput = v => v ? new Date(v).toISOString() : undefined;
  function readForm() {
    const t = { v: 1, fn: $("f-fn").value.trim().toUpperCase().replace(/\s/g, ""), d: $("f-d").value || undefined,
      dep: fromLocalInput($("f-dep").value), arr: fromLocalInput($("f-arr").value), ndep: fromLocalInput($("f-ndep").value),
      from: $("f-from").value.trim().toUpperCase() || undefined, to: $("f-to").value.trim().toUpperCase() || undefined };
    return F.validate(t);
  }
  function fillForm(t) { $("f-fn").value = t.fn || ""; $("f-d").value = t.d || ""; $("f-dep").value = toLocalInput(t.dep); $("f-arr").value = toLocalInput(t.arr);
    $("f-ndep").value = toLocalInput(t.ndep); $("f-from").value = t.from || ""; $("f-to").value = t.to || ""; mirrorTimes(); }
  // The Delayed panel has its own departure-time box (the form fields are hidden once tracking); keep both in sync.
  function mirrorTimes() { const a = $("s-dep"), b = $("s-ndep"); if (a && document.activeElement !== a) a.value = $("f-dep").value; if (b && document.activeElement !== b) b.value = $("f-ndep").value; }
  ["f-dep", "f-ndep"].forEach(id => { const el = $(id); if (el) el.addEventListener("input", mirrorTimes); });
  $("f-tz").textContent = tz ? `Times are in your time zone (${tz}).` : "Times are in your device's time zone.";
  $("fform").addEventListener("submit", async e => { e.preventDefault(); $("ferr").textContent = "";
    let t; try { t = dropCarriedOver(readForm()); } catch (x) { $("ferr").textContent = "Enter a flight number like DL1234 or UA 512."; return; }
    try { const tok = await F.encode(t); history.replaceState(null, "", "#" + tok); } catch (x) {}
    start(t); if (window.gtag) gtag("event", "flight_track", { airline: (F.parseFlight(t.fn) || {}).icao || "" }); });

  // A new flight number must not inherit the previous flight's airports or times (they sat in hidden fields).
  function dropCarriedOver(t) {
    const old = S.t; if (!old || !t || t.fn === old.fn) return t;
    const out = { ...t };
    for (const k of ["from", "to", "dep", "arr", "ndep"]) if (out[k] && old[k] && out[k] === old[k]) delete out[k];
    fillForm(out); return out;
  }
  // ---------- data loading ----------
  async function loadRoute(cs) {
    try { const j = await getJSON(`${ROUTES}${cs.slice(0, 2)}/${cs}.json`); return j && j._airports ? j : null; } catch (e) { return null; }
  }
  // Day-of route from adsbdb (same source the Android app uses). Browser CORS *; no relay, no adsb.lol budget.
  async function loadAdsbdb(cs) {
    if (!cs) return null;
    try {
      const j = await getJSON(ADSBDB + encodeURIComponent(cs));
      return F.fromAdsbdb(j);
    } catch (e) { return null; }
  }
  function reindexLegs(L) { return (L || []).map((l, i) => ({ from: l.from, to: l.to, i })); }
  // Standing data is typical for the flight number and can be wrong on the day (airlines reuse numbers).
  // Prefer a leg the live plane actually fits; fall back to adsbdb; never keep a route we know is wrong.
  async function resolveRoute(cs) {
    S.routeUnconfirmed = false;
    S.routeSrc = S.route && S.route._src ? S.route._src : (S.route ? "standing" : "");
    const standing = reindexLegs(S.legs);
    const ac = S.ac && isFinite(S.ac.lat) && isFinite(S.ac.lon) ? S.ac : null;
    let standingFit = ac && standing.length ? F.liveLeg(standing, ac) : null;
    const needAlt = !standing.length || (ac && !standingFit) || !ac;
    if (!needAlt) return;
    const gen = S.gen, alt = await loadAdsbdb(cs);
    if (gen !== S.gen) return;
    const altLegs = alt ? reindexLegs(F.legs(alt)) : [];
    // Both sources name the same leg: mark it so the fit check allows a normal airway bend.
    for (const x of altLegs) for (const l of S.legs.concat(standing)) if (F.sameEndpoints(l, x)) { l.agreed = true; x.agreed = true; }
    standingFit = ac && standing.length ? F.liveLeg(standing, ac) : null;
    const altFit = ac && altLegs.length ? F.liveLeg(altLegs, ac) : null;
    if (ac) {
      if (altFit) {
        S.route = alt; S.legs = altLegs; S.routeSrc = "adsbdb"; return;
      }
      if (standingFit) return;
      // Live plane exists but matches neither source — show the plane, not a wrong city pair.
      S.route = null; S.legs = []; S.routeSrc = ""; S.routeUnconfirmed = true; return;
    }
    // No live plane: cross-check. If sources disagree, offer both so we don't auto-pick a stale leg.
    if (!altLegs.length) return;
    if (!standing.length) { S.route = alt; S.legs = altLegs; S.routeSrc = "adsbdb"; return; }
    if (standing.length === 1 && altLegs.length === 1 && F.sameEndpoints(standing[0], altLegs[0])) return;
    const merged = [];
    const seen = new Set();
    for (const l of standing.concat(altLegs)) {
      const k = [(l.from.icao || l.from.iata || ""), (l.to.icao || l.to.iata || "")].join(">");
      if (seen.has(k)) continue;
      seen.add(k); merged.push(l);
    }
    S.legs = reindexLegs(merged);
    S.routeSrc = "mixed";
  }
  function posKey(fn) { return "yw-fl-pos:" + String(fn || "").toUpperCase(); }
  function savePos(ac, fn) {
    if (!ac || !isFinite(ac.lat) || !isFinite(ac.lon) || !fn) return;
    const payload = { ac: { lat: ac.lat, lon: ac.lon, alt: ac.alt, gs: ac.gs, track: ac.track, vs: ac.vs, type: ac.type, reg: ac.reg, hex: ac.hex, flight: ac.flight, seen: ac.seen, seenAt: ac.seenAt }, seenAt: ac.seenAt || Date.now(), savedAt: Date.now(), fn };
    try { sessionStorage.setItem(posKey(fn), JSON.stringify(payload)); } catch (e) {}
    try { localStorage.setItem(posKey(fn), JSON.stringify(payload)); } catch (e) {}
  }
  function loadPos(fn) {
    for (const store of [sessionStorage, localStorage]) {
      try {
        const raw = store.getItem(posKey(fn)); if (!raw) continue;
        const j = JSON.parse(raw);
        if (j && j.ac && isFinite(j.ac.lat) && isFinite(j.ac.lon) && j.seenAt) return j;
      } catch (e) {}
    }
    return null;
  }
  function restoreLastPos() {
    if (S.ac && isFinite(S.ac.lat)) { S.acStale = true; return true; }
    const cached = loadPos(S.t && S.t.fn); if (!cached) return false;
    S.ac = cached.ac; if (!S.ac.seenAt) S.ac.seenAt = cached.seenAt; S.acStale = true; return true;
  }
  async function loadLive(gen = S.gen) {
    const p = F.parseFlight(S.t.fn); if (!API || !p || !p.cs) return;
    try {
      const r = await fetchT(API + `/flight?cs=${encodeURIComponent(p.cs)}`, undefined, 12e3);
      if (gen !== S.gen) return;
      if (!r.ok) {
        const err = Object.assign(new Error("HTTP " + r.status), { status: r.status });
        const ra = r.headers.get("Retry-After");
        if (ra) { const n = +ra; err.retryAfterMs = isFinite(n) && n >= 0 ? n * 1000 : Math.max(0, Date.parse(ra) - Date.now()); }
        throw err;
      }
      const j = await r.json();
      if (gen !== S.gen) return;   // a newer flight was entered meanwhile: never write this answer into it
      const cache = (r.headers.get("X-Cache") || "").toUpperCase();
      S.ac = (j.ac || [])[0] || null; S.acAt = Date.now(); S.acErr = ""; S.retryAfterMs = 0;
      if (S.ac) {
        const base = j.now ? (j.now > 1e12 ? j.now : j.now * 1000) : Date.now();
        S.ac.seenAt = Math.min(Date.now(), base - (S.ac.seen || 0) * 1000);
        const xf = r.headers.get("X-Fetched");
        if (cache === "STALE" && xf) { const ft = Date.parse(xf); if (isFinite(ft)) S.ac.seenAt = Math.min(S.ac.seenAt || ft, ft); }
        S.acStale = cache === "STALE";
        savePos(S.ac, S.t.fn);
      } else { S.acStale = false; }
    } catch (e) {
      if (gen !== S.gen) return;
      S.acErr = e.status === 503 ? "budget" : e.status === 429 ? "busy" : "down";
      S.retryAfterMs = Math.max(0, e.retryAfterMs || 0);
      restoreLastPos();
    }
  }
  function forceBusySim() {
    // Preview-only: calm 429 / last-seen state without inventing a live fix.
    if (!S.ac && S.leg) {
      const a = S.leg.from, b = S.leg.to;
      S.ac = { lat: a.lat * 0.4 + b.lat * 0.6, lon: a.lon * 0.4 + b.lon * 0.6, alt: 34000, gs: 430, track: 45, type: "B738", hex: "SIMBUSY", flight: S.t.fn, seen: 125 };
    }
    if (S.ac) { S.ac.seenAt = Date.now() - 125 * 1000; S.acStale = true; savePos(S.ac, S.t.fn); }
    S.acErr = "busy"; S.acAt = Date.now() - 5e3; S.retryAfterMs = 20e3;
  }
  // State-aware poll interval: 20 s airborne, 1 min taxiing, 2-5 min parked / not found / landed.
  function livePoll() {
    const pr = S.ac && S.leg ? F.progress(S.ac, S.leg) : null, { depMs } = times();
    return F.livePollMs(S.ac, pr, depMs, Date.now());
  }
  function clearLiveTimer() { if (S.liveTimer) { clearTimeout(S.liveTimer); S.liveTimer = null; } }
  function scheduleLive() {
    clearLiveTimer();
    let wait = 20e3;
    if (S.acErr === "busy" || S.acErr === "down") {
      wait = S.retryAfterMs > 0 ? Math.min(Math.max(S.retryAfterMs, 5e3), 300e3) : Math.min((S.liveBackoff || 15e3) * 1.6, 120e3);
      S.liveBackoff = wait;
    } else if (S.acErr === "budget") {
      wait = S.retryAfterMs > 0 ? Math.min(Math.max(S.retryAfterMs, 60e3), 3600e3) : 15 * 60e3;
    } else { S.liveBackoff = 15e3; wait = livePoll(); }
    S.nextLiveAt = Date.now() + wait;
    S.liveTimer = setTimeout(async () => {
      if (!S.t) return;
      if (document.hidden) { scheduleLive(); return; }
      if (S.sim === "busy") { forceBusySim(); pickLeg(); render(); scheduleLive(); return; }
      const gen = S.gen; await loadLive(gen); if (gen !== S.gen) return;
      const p2 = F.parseFlight(S.t.fn);
      if (p2 && p2.cs && (S.routeUnconfirmed || !S.legs.length || (S.ac && !F.liveLeg(S.legs, S.ac)))) {
        if (!S.legs.length) { const rt = await loadRoute(p2.cs); if (gen !== S.gen) return; if (rt) { S.route = rt; S.legs = F.legs(rt); } }
        await resolveRoute(p2.cs); if (gen !== S.gen) return;
      }
      pickLeg(); render(); scheduleLive();
    }, wait);
  }
  async function loadWx() {
    const apts = airports(); if (!apts.length) return; const ids = [...new Set(apts.map(a => a.icao))];
    if (API) { try { const j = await api(`/wx?ids=${ids.join(",")}`);
        S.fetched.wx = Date.now(); for (const id of ids) S.wx[id] = { metar: F.fromAwcMetar((j.metar || []).find(m => m.icaoId === id)), taf: (j.taf || []).find(t => t.icaoId === id) || null, src: "awc" };
        return; } catch (e) {} }
    for (const a of apts) { if (a.countryiso2 !== "US") continue;   // NWS observations (US only) read directly: no relay needed
      try { const j = await getJSON(`https://api.weather.gov/stations/${a.icao}/observations/latest`, { headers: { Accept: "application/geo+json" } }); const p = j.properties || {};
        if (p.rawMessage) { const m = F.readMetar(p.rawMessage); S.wx[a.icao] = { metar: { ...m, obsTime: Date.parse(p.timestamp), temp: p.temperature && p.temperature.value }, taf: null, src: "nws" }; } } catch (e) {} }
  }
  async function loadNas() { if (!API) return; try { S.nas = await api("/nas"); S.fetched.nas = Date.now(); } catch (e) { S.nas = S.nas || null; } }
  async function loadSig() { if (!API) return; try { S.sig = (await api("/sigmet")).sigmets || []; } catch (e) {} }
  // Weather along the route (METAR samples). Needs Worker /route-wx; silent no-op if not deployed yet.
  async function loadRouteWx() {
    if (!API || !S.leg) { S.routeWx = []; return; }
    const a = S.leg.from, b = S.leg.to;
    try {
      const j = await api(`/route-wx?olat=${a.lat}&olon=${a.lon}&dlat=${b.lat}&dlon=${b.lon}`);
      S.routeWx = j.metar || []; S.fetched.routeWx = Date.now();
    } catch (e) { S.routeWx = S.routeWx || []; }
  }
  async function loadPlaces() { const o = S.leg && S.leg.from; if (!API || !o || S.places) return;
    try { S.places = (await api(`/places?lat=${o.lat}&lon=${o.lon}`)).places || []; } catch (e) { S.places = null; S.placesErr = true; } }
  // No confirmed leg: use the airport nearest the plane so the Weather tab still has real weather to show.
  function nearPlaneApt() {
    const ac = S.ac; if (S.leg || !ac || !isFinite(ac.lat) || !S.airportsNa) return null;
    let best = null, bd = Infinity;
    for (const a of S.airportsNa) { if (!a.icao || a.icao.length !== 4 || !isFinite(a.lat)) continue; const d = F.distNm(ac, a); if (d < bd) { bd = d; best = a; } }
    return best && bd < 150 ? { ...best, _nm: Math.round(bd) } : null;
  }
  const airports = () => { if (S.leg) return [S.leg.from, S.leg.to]; const n = nearPlaneApt(); return n ? [n] : []; };
  // Fetch weather whenever the airport set changes (e.g. route resolved after the first paint).
  function ensureWx() {
    const ids = airports().map(a => a.icao).join(","); if (!ids || ids === S.wxIds) return;
    S.wxIds = ids; const gen = S.gen;
    const rk = S.leg ? S.leg.from.icao + ">" + S.leg.to.icao : "";
    if (rk && rk !== S.rwxKey) { S.rwxKey = rk; loadRouteWx().then(() => { if (gen === S.gen) render(); }).catch(() => {}); }
    loadWx().then(() => { if (gen === S.gen) render(); }).catch(() => {});
  }

  function pickLeg() {
    const L = S.legs; let leg = F.userLeg(L, S.t.from, S.t.to);
    const live = F.liveLeg(L, S.ac);
    if (!leg && !(S.t.from || S.t.to)) {
      // Sole standing/adsbdb leg is OK only when there is no plane, or the plane fits it.
      const sole = L.length === 1 ? L[0] : null;
      const soleOk = sole && (!S.ac || F.legFits(S.ac, sole));
      leg = live || (soleOk ? sole : null);
    }
    // From/To that match none of this flight's legs (typo, old value) must not hide a leg the live plane is clearly flying.
    if (!leg && (S.t.from || S.t.to) && live) leg = live;
    // Share link named both airports but standing route JSON missing: still build a leg for canceled/drive options.
    if (!leg && S.t && S.t.from && S.t.to && S.airportsNa) {
      const by = {};
      for (const a of S.airportsNa) {
        if (a.iata) by[a.iata] = a;
        if (a.icao) by[a.icao] = a;
      }
      const o = by[S.t.from] || by["K" + S.t.from], d = by[S.t.to] || by["K" + S.t.to];
      if (o && d && isFinite(o.lat) && isFinite(d.lat)) leg = { from: o, to: d, i: 0 };
    }
    S.leg = leg; S.liveLeg = live;
    // The live plane may be flying the leg before yours (it's your inbound aircraft).
    S.inbound = leg && live && live !== leg && F.aptMatch(live.to, leg.from.icao) ? live : null;
  }

  async function start(t) {
    S.liveSlow = false; S.timers.forEach(clearInterval); S.timers = []; clearLiveTimer(); Object.assign(S, { t, route: null, legs: [], leg: null, ac: null, wx: {}, routeWx: [], nas: null, sig: null, places: null, placesErr: false, acErr: "", acStale: false, retryAfterMs: 0, liveBackoff: 15e3, nextLiveAt: 0, whatIfMin: 0, prev: null, rot: null, landedAt: null, mapKey: "", tip: null, fetched: {}, estKey: "", pulse: false, canceled: false, peers: null, peersErr: "", nearbyLive: null, airportsNa: S.airportsNa || null, routePeers: S.routePeers || null, routeSrc: "", routeUnconfirmed: false, wxIds: "", rwxKey: "" });
    syncWhatIf();
    const cpanel = $("fl-canceled");
    if (cpanel) { cpanel.open = false; }
    const p = F.parseFlight(t.fn); $("fl-out").hidden = false; document.body.classList.add("fl-tracking");
    const mini = $("fl-track-mini"); if (mini) { mini.hidden = false; mini.querySelector("[data-fn]").textContent = t.fn; }
    $("fl-status").innerHTML = `<p class="fl-big">Looking up ${E(t.fn)}…</p>`;
    if (p && p.unknownAirline) { $("fl-status").innerHTML = `<p class="fl-big">We don't know airline code ${E(p.iata)} yet.</p><p>Try the 3-letter airline code (for example DAL for Delta) followed by the number.</p>`; return; }
    // Preview sim: paint the AI card immediately so ?sim=high works even if live lookups are slow.
    if (S.sim) { pickLeg(); render(); }
    // Each start() owns a generation; an older lookup that finishes late must not touch the new flight.
    const gen = S.gen = (S.gen || 0) + 1, alive = () => S.gen === gen;
    if (S.watchdog) clearTimeout(S.watchdog);
    S.watchdog = setTimeout(() => { if (alive() && !S.acAt) { S.liveSlow = true; render(); } }, 20e3);
    // Route and live plane load in parallel and paint first; weather, FAA, SIGMETs, places fill in after.
    const routeP = loadAirportsNa().then(() => loadRoute(p.cs)).then(rt => { if (alive()) { S.route = rt; S.legs = F.legs(rt); pickLeg(); render(); } });
    await Promise.all([routeP, loadLive(gen)]); if (!alive()) return;
    pickLeg(); render();
    await resolveRoute(p.cs); if (!alive()) return; pickLeg();
    if (S.sim === "busy") forceBusySim();
    render(); scheduleLive();
    await Promise.all([loadNas(), loadSig()]); if (!alive()) return;   // airport + route weather: ensureWx() on render
    render(); loadPlaces().then(() => alive() && renderStuck());
    const every = (ms, fn) => S.timers.push(setInterval(() => { if (!document.hidden) fn(); }, ms));
    every(5 * 60e3, async () => { await loadWx(); await loadSig(); await loadRouteWx(); render(); });
    every(2 * 60e3, async () => { await loadNas(); render(); });
    every(30e3, () => { try { renderStuck(); } catch (e) { try { console.error("delayed panel failed", e); } catch (_) {} } });
    S.onVis && document.removeEventListener("visibilitychange", S.onVis);
    S.onVis = async () => { if (document.hidden || !S.t) return; const now = Date.now();
      if (S.sim === "busy") { forceBusySim(); pickLeg(); }
      else if (now - S.acAt > livePoll()) {
        const gen = S.gen; await loadLive(gen); if (gen !== S.gen) return;
        const p2 = F.parseFlight(S.t.fn);
        if (p2 && p2.cs && (S.routeUnconfirmed || (S.ac && !F.liveLeg(S.legs, S.ac)))) await resolveRoute(p2.cs);
        pickLeg();
      }
      scheduleLive();
      if (now - (S.fetched.wx || 0) > 5 * 60e3) await Promise.all([loadWx(), loadSig(), loadRouteWx()]);
      if (now - (S.fetched.nas || 0) > 2 * 60e3) await loadNas(); render(); };
    document.addEventListener("visibilitychange", S.onVis);
  }

  // ---------- render ----------
  const times = () => { const t = S.t; return { depMs: t.ndep ? Date.parse(t.ndep) : t.dep ? Date.parse(t.dep) : null, arrMs: t.arr ? Date.parse(t.arr) : null }; };
  function context() {
    const now = Date.now(), { depMs, arrMs } = times(), onLeg = S.ac && S.leg && S.liveLeg === S.leg;
    const pr = onLeg ? F.progress(S.ac, S.leg, now) : null, inb = S.inbound ? F.progress(S.ac, S.inbound, now) : null;
    const wx = {}; for (const a of airports()) if (S.wx[a.icao]) wx[a.icao] = S.wx[a.icao];
    const sig = S.sig ? F.sigmetsOnLeg(S.sig, S.leg, now, onLeg && !(pr && pr.onGround) ? S.ac : null) : [];
    let c = { now, depMs, arrMs, origin: S.leg && S.leg.from, dest: S.leg && S.leg.to, nas: S.nas, wx, routeWx: S.routeWx || [], sigmets: sig, progress: pr, inbound: inb };
    if (S.sim) c = applySim(c, S.sim);
    return c;
  }
  // Preview-only sims (?sim=high|landed|busy). Clearly labelled in the UI.
  function applySim(c, kind) {
    if (kind !== "high" && kind !== "landed") return c;
    const dest = c.dest || { iata: "DEN", icao: "KDEN", name: "Denver", countryiso2: "US", lat: 39.86, lon: -104.67 };
    const origin = c.origin || { iata: "ATL", icao: "KATL", name: "Atlanta", countryiso2: "US", lat: 33.64, lon: -84.43 };
    const wx = { ...(c.wx || {}) };
    if (kind === "high") {
      wx[dest.icao] = { metar: { raw: "METAR KDEN SIM 00000KT 1/4SM FG VV001 03/03", vis: 0.25, fltCat: "LIFR", wxString: "FG", gust: 0, clouds: [{ cover: "VV", base: 100 }] }, taf: null, src: "sim" };
      const nas = { updated: "sim", groundStops: [], groundDelays: [{ arpt: dest.iata || "DEN", reason: "WX: Fog", avg: "1 hour and 15 minutes", max: "2 hours" }], delays: [], closures: [] };
      const arrMs = c.arrMs || (c.now + 45 * 60e3);
      const progress = c.progress && !c.progress.onGround ? { ...c.progress, etaMs: arrMs + 55 * 60e3, bufferMin: 18 } :
        { toNm: 80, fromNm: 400, totalNm: 480, onGround: false, phase: "cruising", bufferMin: 18, etaMs: arrMs + 55 * 60e3 };
      return { ...c, origin, dest, wx, nas, progress, arrMs, routeWx: [{ icaoId: "KBJC", fltCat: "LIFR", visib: "1/4", wxString: "FG", clouds: [{ cover: "VV", base: 100 }] }] };
    }
    // landed
    wx[dest.icao] = { metar: { raw: "METAR KDEN SIM 14008KT 10SM FEW080 18/02", vis: 10, fltCat: "VFR", wxString: "", gust: 0, clouds: [{ cover: "FEW", base: 8000 }] }, taf: null, src: "sim" };
    wx[origin.icao] = wx[origin.icao] || { metar: { raw: "METAR KATL SIM 09006KT 10SM CLR 22/10", vis: 10, fltCat: "VFR", wxString: "", gust: 0, clouds: [] }, taf: null, src: "sim" };
    S.landedAt = S.landedAt || c.now - 4 * 60e3;
    return { ...c, origin, dest, wx, nas: c.nas || { updated: "sim", groundStops: [], groundDelays: [], delays: [], closures: [] },
      progress: { toNm: 0, fromNm: 480, totalNm: 480, onGround: true, at: "dest", phase: "landed", bufferMin: 0, etaMs: c.now - 4 * 60e3 },
      arrMs: c.arrMs || (c.now - 10 * 60e3) };
  }
  function statusLine(c) {
    const pr = c.progress, ac = S.ac, code = a => a.iata || a.icao;
    if (!API) return { big: "Live position isn't connected on this preview yet.", sub: "Route, weather and the delay estimate below still work." };
    if (S.acErr === "budget" && !ac) return { big: "Live position is paused for now.", sub: "We use a free live-data source with a daily limit, and today's share is used up. Weather, FAA status and the delay estimate below still work." };
    // Calm busy / rate-limit / STALE: keep last known spot + real age (never invented).
    if (ac && (S.acStale || S.acErr === "busy" || S.acErr === "down") && (ac.seenAt || S.acAt)) {
      return { big: "Live position updating, last seen {LAST}", sub: "Keeping that spot on the map until a fresh fix arrives.", lastSeenMs: ac.seenAt || S.acAt, calmBusy: true };
    }
    if (!ac && !S.acAt && !S.acErr && !S.liveSlow) return { big: S.leg ? `${code(S.leg.from)} → ${code(S.leg.to)}` : `Looking up ${S.t.fn}…`, sub: "Checking live tracking…" };
    if (!ac && S.liveSlow && !S.acAt) return { big: S.leg ? `${code(S.leg.from)} → ${code(S.leg.to)} · live position not reachable yet` : "Live position not reachable yet.", sub: "We couldn't reach live tracking just now and will keep trying on our own. The route below is from schedule data.", calmBusy: true };
    if (S.acErr && !ac) return { big: "Live position will appear shortly.", sub: "The plane may not be airborne yet or out of receiver range.", calmBusy: true };
    if (!S.leg && S.legs.length > 1) return { big: "This flight number flies more than one leg.", sub: "Pick yours below." };
    if (S.inbound && c.inbound) { const ib = c.inbound;
      return { big: ib.onGround ? `Your plane is on the ground at ${code(S.inbound.from)}` : `Your plane is on its way in to ${code(S.leg.from)}`,
        sub: ib.etaMs ? `{IDIST} mi out · lands about {IETA} at its current speed (straight line)` : "It flies the leg before yours." }; }
    if (pr) {
      if (pr.onGround) return { big: pr.at === "dest" ? `Landed at ${code(S.leg.to)}` : pr.at === "origin" ? `On the ground at ${code(S.leg.from)}` : "On the ground", sub: ac && ac.gs > 5 ? "Taxiing" : "" };
      const alt = ac && isFinite(ac.alt) ? `${Math.round(ac.alt / 100) * 100 >= 18000 ? "FL" + Math.round(ac.alt / 100) : ac.alt.toLocaleString() + " ft"}` : "";
      const dest = S.leg ? code(S.leg.to) : (c.dest ? code(c.dest) : "");
      return { big: dest ? `In the air · {DIST} mi to ${dest}` : "In the air", sub: [F.phaseLabel(pr.phase), alt, ac && ac.gs ? `${Math.round(ac.gs * 1.15078)} mph` : ""].filter(Boolean).join(" · ") };
    }
    if (ac && !S.leg) return { big: "In the air", sub: "We couldn't confirm this flight's route." };
    return { big: "Not in the air right now", sub: "We don't see this flight on live tracking. It may not have left yet, may have landed, or may be outside receiver coverage." };
  }
  // Page-level guard: if any render step throws, still show the route and the plane in plain text.
  function render() {
    try { renderMain(); }
    catch (e) {
      try { console.error("flight render failed", e); } catch (_) {}
      try { if (window.gtag) gtag("event", "flight_render_error", { msg: String(e && e.message || e).slice(0, 90) }); } catch (_) {}
      try { $("fl-status").innerHTML = fallbackCard(); } catch (_) {}
      // Never leave the Weather tab blank: try the airports box on its own, else say what happened.
      try { ensureWx(); renderAirports(context()); } catch (_) {}
      try { const w = $("fl-apts"); if (w && !w.textContent.trim()) w.innerHTML = `<div class="fl-apt"><h3>Weather</h3><p>Weather for this flight couldn't be shown just now. It refreshes on its own.</p></div>`; } catch (_) {}
    }
  }
  function fallbackCard() {
    const code = x => x.iata || x.icao, ac = S.ac, l = S.leg, fn = E(S.t ? S.t.fn : "");
    const route = l ? `<p class="fl-big">${E(code(l.from))} → ${E(code(l.to))}</p>` : S.legs.length ? `<p>${S.legs.map(x => E(code(x.from) + " → " + code(x.to))).join(" · ")}</p>` : "";
    const plane = ac && isFinite(ac.lat) ? `<p>${ac.alt === "ground" || ac.alt === 0 ? "On the ground" : "In the air"}${isFinite(ac.alt) ? ` · ${Math.round(ac.alt).toLocaleString()} ft` : ""}${ac.gs ? ` · ${Math.round(ac.gs * 1.15078)} mph` : ""}</p>` : `<p>Live position not available yet.</p>`;
    return `<p class="fl-kicker">${fn}</p>${route}${plane}<p class="dim">Part of this page hit a problem, so we're showing the basics. It refreshes on its own.</p>`;
  }
  function renderMain() {
    ensureWx();
    const c = context(), st = statusLine(c), a = F.assess(c), code = x => x.iata || x.icao;
    watch(c, a);
    if (EMBED && window.parent && window.parent !== window) {
      try {
        const late = a && a.delay && (a.delay.lateMin != null ? a.delay.lateMin : a.delay.liveMin);
        parent.postMessage({
          type: "yw-flight-live",
          level: a && a.level,
          label: a && a.label,
          lateMin: late != null ? late : null,
          range: a && a.read && a.read.range,
          headline: a && a.read && a.read.headline,
          etaMs: (a && a.delay && a.delay.etaMs) || (c.progress && c.progress.etaMs) || c.arrMs || null,
          arrMs: c.arrMs || null,
          from: c.origin && (c.origin.iata || c.origin.icao) || "",
          to: c.dest && (c.dest.iata || c.dest.icao) || "",
          canceled: !!S.canceled,
          disclaimer: "AI estimate, not the airline's official status"
        }, location.origin);
      } catch (_) {}
    }
    const pr = c.progress, ib = c.inbound;
    let eta = "";
    if (pr && pr.etaMs) eta = `<div class="fl-eta"><div><span>ETA</span><b data-live="eta">${tmd(pr.etaMs)}</b><small>live + buffer</small></div>${c.arrMs ? `<div><span>Scheduled</span><b>${tmd(c.arrMs)}</b><small>${pr.etaMs - c.arrMs > 5 * 60e3 ? fmtLate(pr.etaMs - c.arrMs) + " later" : c.arrMs - pr.etaMs > 5 * 60e3 ? fmtLate(c.arrMs - pr.etaMs) + " earlier" : "on time"}</small></div>` : ""}</div>`;
    else if (c.depMs || c.arrMs) eta = `<div class="fl-eta">${c.depMs ? `<div><span>${S.t.ndep ? "Updated depart" : "Depart"}</span><b>${tmd(c.depMs)}</b></div>` : ""}${c.arrMs ? `<div><span>Arrive</span><b>${tmd(c.arrMs)}</b></div>` : ""}</div>`;
    const legPick = !S.leg && S.legs.length > 1 ? `<div class="fl-legs">${S.legs.map(l => `<button type="button" class="btn" data-leg="${l.i}">${E(code(l.from))} → ${E(code(l.to))}</button>`).join("")}</div>` : "";
    const nonUS = S.leg && [S.leg.from, S.leg.to].some(x => x.countryiso2 !== "US");
    const live = (k, v) => `<span data-live="${k}">${v}</span>`;
    const lastHtml = st.lastSeenMs ? `<span data-ago="${st.lastSeenMs}">${ago((Date.now() - st.lastSeenMs) / 1000)} ago</span>` : "";
    const big = E(st.big).replace("{DIST}", live("dist", pr ? mi(pr.toNm).toLocaleString() : "")).replace("{LAST}", lastHtml);
    const sub = E(st.sub || "").replace("{IDIST}", live("idist", ib ? mi(ib.toNm).toLocaleString() : "")).replace("{IETA}", live("ieta", ib && ib.etaMs ? tm(ib.etaMs) : ""));
    const busyCls = st.calmBusy ? " fl-calm-busy" : "";
    const pct = pr && !pr.onGround ? Math.max(2, Math.min(98, 100 * pr.fromNm / Math.max(1, pr.fromNm + pr.toNm))) : pr && pr.at === "dest" ? 100 : 0;
    const pass = S.leg ? `<div class="fl-pass"><div class="fl-pa"><b>${E(code(S.leg.from))}</b><span>${E(city(S.leg.from))}</span></div>
<div class="fl-track" aria-hidden="true"><i class="fl-bar" style="width:${pct}%"></i><i class="fl-dot" style="left:${pct}%">✈</i></div>
<div class="fl-pa r"><b>${E(code(S.leg.to))}</b><span>${E(city(S.leg.to))}</span></div></div>` : "";
    const landed = pr && pr.onGround && pr.at === "dest" ? `<div class="fl-landed${S.justLanded ? " pop" : ""}"><b>Landed!</b><span>${S.landedAt ? `On the ground at ${E(code(S.leg.to))} at ${tm(S.landedAt)}` : `On the ground at ${E(code(S.leg.to))}`}. Gate and baggage in the airline app.</span></div>` : "";
    const pill = statusPill(a, pr, st);
    const phase = flightPhase(pr, c);
    $("fl-status").innerHTML = `<div class="fl-top"><p class="fl-head">${E(S.t.fn)}${S.ac && S.ac.type ? ` <span class="dim">· ${E(S.ac.type)}</span>` : ""}</p><span class="fl-top-right">${pill}<span class="fl-acts"><button type="button" class="fl-chip" id="fl-alert" aria-pressed="${S.alertsOn ? "true" : "false"}" title="Alert me">${S.alertsOn ? "🔔" : "🔔"}</button><button type="button" class="fl-chip" id="fl-share" title="Share">↗</button></span></span></div>
${pass}${landed}<p class="fl-big${busyCls}">${big}</p>${sub ? `<p class="fl-sub${busyCls}">${sub}</p>` : ""}
${eta}${legPick}
<p class="fl-fresh" id="fl-fresh"></p>`;
    const nums = pr && !pr.onGround && S.ac ? `<div class="fl-nums"><div><span>Altitude</span><b>${isFinite(S.ac.alt) ? Math.round(S.ac.alt).toLocaleString() + " ft" : "–"}</b></div><div><span>Speed</span><b>${S.ac.gs ? Math.round(S.ac.gs * 1.15078) + " mph" : "–"}</b></div><div><span>To go</span><b>${live("dist2", mi(pr.toNm).toLocaleString())} mi</b></div></div>` : "";
    const ov = $("fl-overview-extra");
    if (ov) ov.innerHTML = `${nums}${API ? "" : `<p class="dim small">FAA status, airport forecasts and route hazards need our relay, which isn't connected on this preview.</p>`}${nonUS ? `<p class="dim small">FAA delay programs cover US airports only.</p>` : ""}`;
    const aiHost = $("fl-ai-host");
    if (aiHost) aiHost.innerHTML = `${aiCard(a, c)}${S.sim ? `<p class="fl-sim-tag">SIMULATED ${E(S.sim)} — preview only</p>` : ""}`;
    const acts = $("fl-acts-bar");
    if (acts) acts.innerHTML = appOpenBtn() || "";
    $("fl-status").querySelectorAll("[data-leg]").forEach(b => b.onclick = () => { const l = S.legs[+b.dataset.leg]; S.t.from = l.from.iata || l.from.icao; S.t.to = l.to.iata || l.to.icao; fillForm(S.t); pickLeg(); loadWx().then(render); loadPlaces().then(renderStuck); render(); });
    renderMap(c); renderAirports(c); renderHazards(c); renderStuck(a);
    const late = a.read && a.read.lateMin, likely = a.level >= 1 || (late != null && late >= 20) || !!S.whatIfMin;
    const stuck = $("fl-stuck");
    if (stuck) {
      stuck.classList.toggle("hot", !!(a.level >= 1 || (late != null && late >= 20) || S.whatIfMin));
      if (!stuck.dataset.user) stuck.open = likely;
      else if (likely && !stuck.dataset.userClosed) stuck.open = true;
    }
    preferSeg(phase, likely, !!landed);
    S.level = a.level; S.justLanded = false; tick();
    syncWhatIf();
  }
  function flightPhase(pr, c) {
    if (pr && pr.onGround && pr.at === "dest") return "landed";
    if (pr && !pr.onGround) return "air";
    if (pr && pr.onGround && pr.at === "origin") return "pre";
    if (c.depMs && c.now < c.depMs) return "pre";
    return "pre";
  }
  function statusPill(a, pr, st) {
    let label = "Tracking", cls = "neutral";
    if (pr && pr.onGround && pr.at === "dest") { label = "Landed"; cls = "good"; }
    else if (a && a.level >= 2) { label = "Delayed est."; cls = "bad"; }
    else if (a && a.level >= 1) { label = "Watch"; cls = "warn"; }
    else if (pr && !pr.onGround) { label = "On time"; cls = "good"; }
    else if (st && /Not in the air|on the ground at/i.test(st.big || "")) { label = "Pre-departure"; cls = "neutral"; }
    return `<span class="fl-pill-status ${cls}">${E(label)}</span>`;
  }
  function preferSeg(phase, likely, landed) {
    if (S.segUser) return;
    // Stay on Overview so status + map + AI fill the first screen; hint via pill / hot stuck.
    let seg = "overview";
    if (landed) seg = "nearby";
    setSeg(seg, false);
    // Soft badge on Plans when delay is likely
    const plansBtn = document.querySelector('#fl-seg [data-seg="plans"]');
    if (plansBtn) plansBtn.classList.toggle("fl-seg-hot", !!likely && !landed);
  }
  function setSeg(seg, user) {
    if (user) S.segUser = true;
    const tabs = document.querySelectorAll("#fl-seg [data-seg]");
    const panels = document.querySelectorAll(".fl-panel");
    tabs.forEach(b => {
      const on = b.dataset.seg === seg;
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    panels.forEach(p => { p.hidden = p.id !== "fl-panel-" + seg; });
  }
  const city = a => String(a.name || "").replace(/\b(International|Intl\.?|Regional|Municipal)\b.*$/i, "").replace(/\bAirport\b.*$/i, "").trim() || a.name || "";
  const fmtLate = ms => F.fmtMin(ms / 60e3);

  
  function aiCard(a, c) {
    const r = a.read || {}, late = r.lateMin, [lo, hi] = r.range || [0, 0];
    // One shared ETA for headline clock + projected arrival (tick refreshes both from the same value).
    const etaMs = r.etaMs || (c.progress && c.progress.etaMs) || null;
    if (etaMs) S.etaMs = etaMs;
    const meter = `<div class="fl-meter" aria-label="Delay risk ${E(r.label || a.label)}"><i class="on"></i><i class="${a.level >= 1 ? "on" : ""}"></i><i class="${a.level >= 2 ? "on" : ""}"></i><span>${E(r.label || a.label)}</span></div>`;
    const spacing = r.rangeKind === "spacing" || r.faaAddMin;
    const range = spacing ? `<p class="fl-range"><b>${lo && hi ? `${E(F.fmtMin(lo))}–${E(F.fmtMin(hi))}` : "—"}</b> spacing on top of ETA</p>`
      : (late != null && late > 5) || a.level >= 1 ? `<p class="fl-range"><b>${lo && hi ? `${E(F.fmtMin(lo))}–${E(F.fmtMin(hi))}` : "—"}</b> likely delay</p>` : `<p class="fl-range"><b>On time band</b></p>`;
    const why = (r.why && r.why.length ? r.why : a.reasons.filter(x => x.lvl >= 1).map(x => x.text)).slice(0, 5);
    const headRaw = r.headline || a.label + " delay risk";
    const head = headRaw.includes("{ETA}") && etaMs
      ? E(headRaw).replace("{ETA}", `<span data-live="eta-clock">${E(clockOnly(etaMs))}</span>`)
      : E(headRaw);
    // Auto-reset pulse when the estimate fingerprint changes
    const key = [a.level, late, lo, hi, headRaw.slice(0, 40), etaMs].join("|");
    if (S.estKey && S.estKey !== key) { S.pulse = true; setTimeout(() => { S.pulse = false; const el = $("fl-ai"); if (el) el.classList.remove("pulse"); }, 1800); }
    S.estKey = key;
    // ETA lives in the status header; keep the AI summary compact for the first screen.
    return `<div class="fl-risk fl-ai lv${a.level}${S.pulse ? " pulse" : ""}" id="fl-ai"><div class="fl-risk-h"><b>AI delay read</b><span>${E(r.disclaimer || "AI estimate · not airline status")}</span></div>
${meter}<p class="fl-headline">${head}</p>${range}
${S.pulse ? `<span class="fl-updated">Updated</span>` : ""}
<details class="fl-more-why"><summary>Details · what to do & signals</summary>
<div class="fl-todo"><b>What to do</b>${a.todo.map(x => `<p>${E(x)}</p>`).join("")}</div>
${why.length ? `<ul class="fl-why">${why.map(w => `<li>${E(w)}</li>`).join("")}</ul>` : ""}
<ul>${a.reasons.map(x => `<li class="r${x.lvl}">${E(x.text)}${x.src ? ` <small>${E(x.src)}</small>` : ""}</li>`).join("")}</ul>
</details></div>`;
  }

// ---------- live watch: alerts when something changes (only while this page is open) ----------
  const chime = () => { if (!S.alertsOn) return; try { const A = window.AudioContext || window.webkitAudioContext; S.ac0 = S.ac0 || new A(); const x = S.ac0, o = x.createOscillator(), g = x.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(880, x.currentTime); o.frequency.setValueAtTime(1320, x.currentTime + 0.12); g.gain.setValueAtTime(0.0001, x.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, x.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, x.currentTime + 0.5); o.connect(g).connect(x.destination); o.start(); o.stop(x.currentTime + 0.55); } catch (e) {} };
  function alertMe(kind, title, text) {
    const box = $("fl-alerts"), el = document.createElement("div"); el.className = `fl-al ${kind}`; el.setAttribute("role", "status");
    el.innerHTML = `<b>${E(title)}</b><span>${E(text)}</span><small>${tm(Date.now())}</small><button type="button" aria-label="Dismiss">×</button>`;
    el.querySelector("button").onclick = () => el.remove(); box.prepend(el); while (box.children.length > 3) box.lastChild.remove();
    setTimeout(() => el.classList.add("fade"), 45e3); setTimeout(() => el.remove(), 60e3);
    chime(); if (navigator.vibrate && S.alertsOn) navigator.vibrate(kind === "good" ? [60, 40, 60] : 120);
    if (S.alertsOn && document.hidden && window.Notification && Notification.permission === "granted") { try { new Notification(`${S.t.fn}: ${title}`, { body: text, tag: "yw-flight-" + kind, icon: "../assets/icon-192.png" }); } catch (e) {} }
    if (window.gtag) gtag("event", "flight_alert_shown", { alert_type: kind, airport: S.leg ? (S.leg.from.iata || S.leg.from.icao) : "" });
  }
  // Compares this refresh with the last one. The first look sets the baseline (no alerts for things that were already true).
  function watch(c, a) {
    const pr = c.progress, code = x => x ? x.iata || x.icao : "", now = Date.now();
    const st = { level: a.level, phase: pr ? (pr.onGround ? "ground:" + (pr.at || "") : pr.phase) : null,
      stops: a.reasons.filter(r => /ground stop|closed/.test(r.text)).map(r => r.text).join("|"), storms: a.reasons.filter(r => /Thunderstorm|SIGMET/.test(r.text)).length,
      inb: c.inbound ? (c.inbound.onGround ? "ground" : "air") : null };
    const p = S.prev; S.prev = st; if (!p || p.key !== legKey()) { st.key = legKey(); if (pr && !pr.onGround) S.seenAir = true; return; } st.key = p.key;
    if (st.level > p.level) alertMe("bad", `Delay risk is now ${F.LV[st.level]}`, a.reasons.filter(r => r.lvl >= 1).map(r => r.text)[0] || "Conditions changed.");
    else if (st.level < p.level) alertMe("good", `Delay risk dropped to ${F.LV[st.level]}`, "Things look better than a few minutes ago. Still check your airline app.");
    if (st.stops && st.stops !== p.stops) alertMe("bad", "FAA ground stop or closure", st.stops.split("|")[0]);
    if (st.storms > p.storms) alertMe("bad", "Storm near your route or airport", a.reasons.find(r => /Thunderstorm|SIGMET/.test(r.text)).text);
    if (st.phase !== p.phase && st.phase) {
      if (p.phase === "ground:origin" && !/^ground/.test(st.phase)) alertMe("info", "Took off", `${S.t.fn} is in the air from ${code(c.origin)} (live tracking).`);
      if (/^(descending|approach|final)$/.test(st.phase) && /^(cruising|climbing)$/.test(p.phase || "")) alertMe("info", "Starting descent", `${S.t.fn} is descending toward ${code(c.dest)}. Landing is usually 20 to 40 minutes away.`);
      if (st.phase === "ground:dest" && !/^ground/.test(p.phase || "ground")) { S.landedAt = now; S.justLanded = true; alertMe("good", "Landed!", `${S.t.fn} is on the ground at ${code(c.dest)} (live tracking).`); confetti(); }
    }
    if (st.inb === "ground" && p.inb === "air") alertMe("good", "Your plane has landed", `Your inbound plane is on the ground at ${code(c.origin)}. Turnaround usually takes 30 to 60 minutes.`);
  }
  const legKey = () => S.t.fn + "|" + (S.leg ? S.leg.i : "") + "|" + (S.inbound ? "in" : "");
  function confetti() { if (matchMedia("(prefers-reduced-motion: reduce)").matches) return; const host = $("fl-status"), cols = ["#F59E0B", "#38BDF8", "#22C55E", "#F472B6", "#FFFFFF"];
    for (let i = 0; i < 28; i++) { const s = document.createElement("i"); s.className = "fl-conf"; s.style.left = (10 + Math.random() * 80) + "%"; s.style.background = cols[i % cols.length];
      s.style.setProperty("--dx", (Math.random() * 160 - 80) + "px"); s.style.animationDelay = (Math.random() * 0.25) + "s"; host.appendChild(s); setTimeout(() => s.remove(), 2600); } }

  // ---------- share ----------
  async function share() {
    let tok = ""; try { tok = await F.encode(S.t); } catch (e) { tok = encodeURIComponent(S.t.fn); }
    // Share the plain website link so recipients stay in the browser and follow along.
    // /flight/open is only for the gated "Follow in the app" button (App Links).
    const url = `${location.origin}/flight/?utm_source=share_flight&utm_medium=social&utm_campaign=flight#${tok}`;
    const code = x => x.iata || x.icao, text = S.leg ? `Follow my flight live — ${S.t.fn} ${code(S.leg.from)} → ${code(S.leg.to)}` : `Follow my flight live — ${S.t.fn}`;
    let method = "copy";
    try { if (navigator.share) { await navigator.share({ title: "Follow my flight live", text, url }); method = "native"; } else { await navigator.clipboard.writeText(url); toast("Link copied. Send it to family so they can follow along on the website."); } }
    catch (e) { if (e && e.name === "AbortError") return; try { await navigator.clipboard.writeText(url); toast("Link copied."); } catch (x) { prompt("Copy this link:", url); method = "prompt"; } }
    if (window.gtag) gtag("event", "share", { method, content_type: "flight", item_id: S.t.fn });
  }
  function toast(msg) { const t = $("fl-toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(S.toastT); S.toastT = setTimeout(() => t.classList.remove("on"), 3200); }
  async function toggleAlerts() {
    if (S.alertsOn) { S.alertsOn = false; render(); return; }
    S.alertsOn = true; try { const A = window.AudioContext || window.webkitAudioContext; S.ac0 = S.ac0 || new A(); S.ac0.resume && S.ac0.resume(); } catch (e) {}
    if (window.Notification && Notification.permission === "default") { try { await Notification.requestPermission(); } catch (e) {} }
    const n = window.Notification ? Notification.permission : "unsupported";
    toast(n === "granted" ? "Alerts on. We'll chime and notify you while this page stays open." : "Alerts on. We'll chime and show a banner while this page stays open.");
    if (window.gtag) gtag("event", "flight_alerts_on", { notif: n }); render();
  }

  // Gated "Follow in the app" — FLIGHT_APP_OPEN=1 when Production-ready, or tester override ?app=1 / localStorage yw_app_beta=1.
  function appOpenEnabled() {
    try {
      if (new URLSearchParams(location.search).get("app") === "1") {
        localStorage.setItem("yw_app_beta", "1");
        return true;
      }
    } catch (e) {}
    try { if (localStorage.getItem("yw_app_beta") === "1") return true; } catch (e) {}
    return ($("fl") || {}).dataset?.appOpen === "1";
  }
  function appOpenBtn() {
    if (!appOpenEnabled()) return "";
    return `<div class="fl-app-cta"><button type="button" class="fl-chip fl-open-app" id="fl-open-app">Follow in the app</button><span class="fl-app-sub">Opens your plane on the Weather Radar map</span></div>`;
  }
  async function openInApp() {
    if (!S || !S.t) return;
    const p = F.parseFlight(S.t.fn) || {};
    const ac = S.ac || {};
    const payload = { v: 1, fn: S.t.fn };
    if (p.cs) payload.cs = p.cs;
    else if (ac.flight) payload.cs = String(ac.flight).toUpperCase().replace(/\s/g, "");
    if (isFinite(ac.lat) && isFinite(ac.lon)) { payload.lat = +ac.lat; payload.lon = +ac.lon; }
    if (ac.alt === "ground") payload.alt = 0;
    else if (isFinite(ac.alt)) payload.alt = +ac.alt;
    const tok = await F.encode(payload);
    // Prefer the verified https App Link (/flight/open); intent:// still available as F.intentUrl.
    const url = F.webUrl(tok);
    if (window.gtag) gtag("event", "select_content", { content_type: "flight_open_app", item_id: S.t.fn });
    location.href = url;
  }
  const onActClick = e => { const b = e.target.closest("button"); if (!b) return; if (b.id === "fl-share") share(); else if (b.id === "fl-alert") toggleAlerts(); else if (b.id === "fl-open-app") openInApp(); };
  $("fl-status").addEventListener("click", onActClick);
  const actsBar = $("fl-acts-bar"); if (actsBar) actsBar.addEventListener("click", onActClick);
  const seg = $("fl-seg");
  if (seg) seg.addEventListener("click", e => { const b = e.target.closest("[data-seg]"); if (b) setSeg(b.dataset.seg, true); });
  const changeBtn = $("fl-change");
  if (changeBtn) changeBtn.addEventListener("click", () => {
    document.body.classList.remove("fl-tracking");
    const mini = $("fl-track-mini"); if (mini) mini.hidden = true;
    const hero = document.querySelector(".fl-hero"); if (hero) hero.scrollIntoView({ block: "start" });
    const fn = $("f-fn"); if (fn) fn.focus();
  });
  document.addEventListener("click", e => { const j = e.target.closest("[data-jump-seg]"); if (j) { setSeg(j.dataset.jumpSeg, true); const st = $("fl-stuck"); if (st) { st.open = true; st.scrollIntoView({ block: "nearest" }); } } });

  // ---------- 1-second tick: smooth plane, live numbers, freshness, countdowns ----------
  function tick() {
    if (!S.t) return; const now = Date.now(), ac = S.ac;
    const hold = !!(S.acStale || (S.acErr && (S.acErr === "busy" || S.acErr === "down")));
    const x = ac ? (hold ? { lat: ac.lat, lon: ac.lon, moved: false, sec: 0 } : F.project(ac, now, 90)) : null, lg = S.liveLeg;
    if (x && S.proj) { const pl = $("fl-pl"); if (pl) pl.style.transform = `translate(${S.proj.X(x.lon).toFixed(1)}px,${S.proj.Y(x.lat).toFixed(1)}px) rotate(${S.rot || 0}deg) scale(1.6)`; }
    if (x && x.moved && lg) { const to = F.distNm(x, lg.to), gs = ac.gs; const set = (k, v) => document.querySelectorAll(`[data-live="${k}"]`).forEach(el => el.textContent = v);
      // Shared ETA: same liveEtaMs (GC + approach buffer) for projected arrival, headline clock, and countdown.
      const etaMs = F.liveEtaMs({ ...ac, lat: x.lat, lon: x.lon }, lg, now);
      if (S.liveLeg === S.leg) {
        set("dist", mi(to).toLocaleString()); set("dist2", mi(to).toLocaleString());
        if (etaMs) {
          S.etaMs = etaMs; set("eta", tmd(etaMs)); set("eta-clock", clockOnly(etaMs));
          document.querySelectorAll("[data-until-eta]").forEach(el => { el.dataset.until = String(etaMs); });
        }
      }
      if (S.inbound && S.liveLeg === S.inbound) { set("idist", mi(to).toLocaleString()); set("ieta", etaMs ? tm(etaMs) : tm(now + to / gs * 3600e3)); } }
    const fr = $("fl-fresh");
    if (fr) { if (!API) fr.innerHTML = `<i class="dot off"></i> Live position isn't connected on this preview.`;
      else if (!S.acAt && S.liveSlow) { const n = S.nextLiveAt ? Math.max(0, Math.ceil((S.nextLiveAt - now) / 1000)) : 0;
        fr.innerHTML = `<i class="dot off"></i> Live tracking isn't answering yet${n ? ` · trying again in ${n} s` : " · still trying"}`; }
      else if (!S.acAt) fr.innerHTML = `<i class="dot off"></i> Checking live tracking…`;
      else {
        const heard = ac && ac.seenAt ? (now - ac.seenAt) / 1000 : null;
        const nextAt = S.nextLiveAt || (S.acAt + 20e3);
        const next = Math.max(0, Math.ceil((nextAt - now) / 1000));
        const nextTxt = document.hidden ? "when you're back" : next > 90 ? `in ${Math.ceil(next / 60)} min` : `in ${next} s`;
        if (hold && ac) {
          fr.innerHTML = `<i class="dot warn"></i> Last seen ${ago(heard || 0)} ago · next check ${nextTxt}`;
        } else if (S.acErr && !ac) {
          fr.innerHTML = `<i class="dot off"></i> Waiting for a live position · next check ${nextTxt}`;
        } else {
          const cls = heard === null ? "off" : heard <= 30 ? "ok" : heard <= 120 ? "warn" : "off";
          fr.innerHTML = `<i class="dot ${cls}"></i> ${ac ? `Position heard ${ago(heard || 0)} ago${x && x.moved && x.sec > 2 ? " · moving it forward at its reported speed until the next fix" : ""}` : `Checked ${ago((now - S.acAt) / 1000)} ago`} · next check ${nextTxt}`;
        }
      } }
    document.querySelectorAll("[data-until]").forEach(el => {
      const ms = +el.dataset.until - now;
      if (ms > 0) el.textContent = hms(ms) + " left";
      else if (el.hasAttribute("data-until-eta")) el.textContent = "now";
      else if (el.dataset.est === "1") el.textContent = "Confirm boarding in your airline app";
      else el.textContent = "Time's up: head to the gate";
      el.classList.toggle("late", ms < 15 * 60e3);
    });
    document.querySelectorAll("[data-ago]").forEach(el => { el.textContent = ago((now - +el.dataset.ago) / 1000) + " ago"; });
  }
  const hms = ms => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(r).padStart(2, "0"); };
  setInterval(() => { if (!document.hidden) tick(); }, 1000);

  // ---------- map: NASA GIBS Blue Marble (public domain) + SVG overlay ----------
  function renderMap(c) {
    const box = $("fl-map"), leg = S.leg || S.liveLeg; if (!leg && !S.ac) { box.innerHTML = ""; box.hidden = true; S.mapKey = ""; S.proj = null; return; } box.hidden = false;
    const sig = c.sigmets || [], acIn = S.ac && S.proj && S.proj.inside(S.ac);
    const key = [leg ? leg.i : "", S.leg ? S.leg.i : "", S.inbound ? S.inbound.i : "", sig.map(s => s.raw ? s.raw.length : s.hazard).join(","), S.ac ? (acIn ? "in" : Math.round(S.ac.lat) + "," + Math.round(S.ac.lon)) : "-", (S.acStale || S.acErr === "busy" || S.acErr === "down") ? "stale" : "live"].join("|");
    if (key !== S.mapKey) { S.mapKey = key;
      const pts = []; if (leg) pts.push(leg.from, leg.to); if (S.inbound) pts.push(S.inbound.from); if (S.ac) pts.push({ lat: S.ac.lat, lon: S.ac.lon });
      let n = Math.max(...pts.map(p => p.lat)), s = Math.min(...pts.map(p => p.lat)), w = Math.min(...pts.map(p => p.lon)), e = Math.max(...pts.map(p => p.lon));
      const pad = Math.max(1.2, (n - s) * 0.18, (e - w) * 0.12); n += pad; s -= pad; w -= pad; e += pad;
      const k = Math.cos((n + s) / 2 * Math.PI / 180), W = 1000; let H = Math.round(W * (n - s) / ((e - w) * k));
      if (H < 420) { const need = 420 / W * (e - w) * k - (n - s); n += need / 2; s -= need / 2; H = 420; }
      if (H > 760) { const need = (n - s) / (760 / W * k) - (e - w); e += need / 2; w -= need / 2; H = 760; }
      n = Math.min(89, n); s = Math.max(-89, s);
      const X = lon => (lon - w) / (e - w) * W, Y = lat => (n - lat) / (n - s) * H;
      S.proj = { X, Y, inside: p => p.lat < n - 0.3 && p.lat > s + 0.3 && p.lon > w + 0.3 && p.lon < e - 0.3 };
      const img = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&SRS=EPSG:4326&BBOX=${w.toFixed(3)},${s.toFixed(3)},${e.toFixed(3)},${n.toFixed(3)}&WIDTH=${W}&HEIGHT=${H}&FORMAT=image/jpeg&LAYERS=BlueMarble_ShadedRelief_Bathymetry,Reference_Features_15m`;
      const line = (a, b, cls, id) => `<polyline${id ? ` id="${id}"` : ""} class="${cls}" points="${F.gcPoints(a, b, 64).map(p => X(p.lon).toFixed(1) + "," + Y(p.lat).toFixed(1)).join(" ")}"/>`;
      let svg = "";
      sig.forEach((sg, i) => { svg += `<polygon class="fl-sig" data-tip="sig:${i}" tabindex="0" points="${sg.coords.map(([la, lo]) => X(lo).toFixed(1) + "," + Y(la).toFixed(1)).join(" ")}"/>`; });
      if (S.inbound) svg += line(S.inbound.from, S.inbound.to, "fl-rt in");
      if (leg) { svg += line(leg.from, leg.to, "fl-rt"); svg += `<polyline id="fl-done" class="fl-rt done" points=""/>`; }
      const apts = leg ? [leg.from, leg.to] : []; if (S.inbound) apts.unshift(S.inbound.from);
      apts.forEach((a, i) => { svg += `<g class="fl-apt" data-tip="apt:${E(a.icao)}" tabindex="0"><circle class="hit" cx="${X(a.lon)}" cy="${Y(a.lat)}" r="30"/><circle cx="${X(a.lon)}" cy="${Y(a.lat)}" r="9"/><text x="${X(a.lon)}" y="${Y(a.lat) - 16}">${E(a.iata || a.icao)}</text></g>`; });
      const planeStale = !!(S.ac && (S.acStale || S.acErr === "busy" || S.acErr === "down"));
      if (S.ac) svg += `<g id="fl-pl" class="fl-plane${planeStale ? " stale" : ""}" data-tip="plane" tabindex="0"><circle class="halo" r="26"/><circle class="hit" r="34"/><path d="M0,-22 L4,-8 L20,2 L20,6 L4,1 L3,14 L9,19 L9,22 L0,19 L-9,22 L-9,19 L-3,14 L-4,1 L-20,6 L-20,2 L-4,-8 Z"/>${planeStale ? `<text class="fl-last" x="0" y="38" text-anchor="middle">last seen</text>` : ""}</g>`;
      box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of the route${S.ac ? (planeStale ? " and the plane's last seen position" : " and the plane's live position") : ""}. Tap the plane, an airport or a red area for details."><image href="${img}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>${svg}</svg>
<div class="fl-pop" id="fl-pop" hidden></div>
<p class="fl-legend">${S.ac ? (planeStale ? "✈️ last seen · " : "✈️ live position · ") : ""}${leg ? '<span class="k rt"></span> route' : "position only"}${S.inbound ? ' · <span class="k in"></span> your plane\'s inbound leg' : ""}${sig.length ? ' · <span class="k sg"></span> SIGMET area' : ""} · <span class="dim">tap for details</span></p>`;
      const pl = $("fl-pl"); if (pl) { pl.style.transition = "none"; requestAnimationFrame(() => { pl.style.transition = ""; }); }
    }
    // Every refresh: rotate toward the new track the short way round, extend the flown part to the plane.
    if (S.ac && isFinite(S.ac.track)) { const cur = S.rot == null ? S.ac.track : S.rot, d = ((S.ac.track - cur) % 360 + 540) % 360 - 180; S.rot = cur + d; }
    const done = $("fl-done"); if (done && S.proj) done.setAttribute("points", S.ac && S.liveLeg === leg ? F.gcPoints(leg.from, { lat: S.ac.lat, lon: S.ac.lon }, 48).map(p => S.proj.X(p.lon).toFixed(1) + "," + S.proj.Y(p.lat).toFixed(1)).join(" ") : "");
    const pop = $("fl-pop"); if (pop && !pop.hidden && S.tip) showTip(S.tip);
  }
  function tipHtml(t) {
    const code = a => a.iata || a.icao;
    if (t === "plane" && S.ac) { const a = S.ac; return `<b>${E(S.t.fn)}${a.flight && a.flight !== S.t.fn ? ` (${E(a.flight)})` : ""}</b><span>${E([a.type, a.reg].filter(Boolean).join(" · "))}</span>
<span>${a.alt === "ground" ? "On the ground" : isFinite(a.alt) ? Math.round(a.alt).toLocaleString() + " ft" : ""}${a.gs ? ` · ${Math.round(a.gs * 1.15078)} mph` : ""}${isFinite(a.track) ? ` · heading ${Math.round(a.track)}°` : ""}${isFinite(a.vs) && Math.abs(a.vs) > 300 ? ` · ${a.vs > 0 ? "climbing" : "descending"} ${Math.abs(Math.round(a.vs / 100) * 100).toLocaleString()} ft/min` : ""}</span>
<small>${S.acStale || S.acErr === "busy" || S.acErr === "down" ? "Last seen position · " : "adsb.lol live data · "}hex ${E(a.hex || "")}</small>`; }
    if (t.startsWith("apt:")) { const id = t.slice(4), a = [S.leg && S.leg.from, S.leg && S.leg.to, S.inbound && S.inbound.from].find(x => x && x.icao === id); if (!a) return "";
      const w = S.wx[id], m = w && w.metar, faa = F.nasFor(S.nas, a);
      return `<b>${E(code(a))} · ${E(a.name)}</b>${m ? `<span>${E(F.CAT_WORDS[m.fltCat] || "")}${F.wxWords(m.wxString).length ? " · " + E(F.wxWords(m.wxString).join(", ")) : ""}</span>` : ""}
<span>${F.faaCode(a) && S.nas ? (faa.length ? E(faa[0].text) : "✓ No FAA delay programs") : ""}</span><a href="#apt-${E(id)}">Airport details ↓</a>`; }
    if (t.startsWith("sig:")) { const s = (context().sigmets || [])[+t.slice(4)]; if (!s) return "";
      return `<b>SIGMET: ${E(s.words)}</b><span>${s.top ? `Up to ${s.top >= 18000 ? "FL" + Math.round(s.top / 100) : s.top + " ft"} · ` : ""}${s.to ? `valid until ${tm(s.to * 1000)}` : ""}</span><span>${s.ahead ? "Ahead of the plane on the straight route." : "Crosses the straight route."}</span><small>aviationweather.gov</small>`; }
    return "";
  }
  function showTip(t) { const pop = $("fl-pop"), h = tipHtml(t); if (!h) { pop.hidden = true; S.tip = null; return; } S.tip = t; pop.innerHTML = h + `<button type="button" class="x" aria-label="Close">×</button>`; pop.hidden = false; }
  $("fl-map").addEventListener("click", e => { const x = e.target.closest("[data-tip]"); if (e.target.closest(".fl-pop .x") || !x) { const p = $("fl-pop"); if (p && !e.target.closest(".fl-pop a")) { p.hidden = true; S.tip = null; } return; }
    showTip(x.dataset.tip); if (window.gtag) gtag("event", "flight_map_tap", { target: x.dataset.tip.split(":")[0] }); });
  $("fl-map").addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.dataset && e.target.dataset.tip) { e.preventDefault(); showTip(e.target.dataset.tip); } });

  // ---------- airports ----------
  function renderAirports(c) {
    const box = $("fl-apts"); if (!S.leg) { box.innerHTML = noRouteWx(); return; }
    box.querySelectorAll("details[data-apt]").forEach(d => { S.open[d.dataset.apt] = d.open; });
    box.innerHTML = [[S.leg.from, "Departure", c.depMs], [S.leg.to, "Arrival", c.arrMs || (c.progress && c.progress.etaMs)]].map(([a, role, t]) => {
      const w = S.wx[a.icao], m = w && w.metar, faa = F.nasFor(S.nas, a), win = w && w.taf ? F.tafWindow(w.taf, (t || Date.now()) - 3600e3, (t || Date.now()) + 3600e3) : null;
      const words = m ? F.wxWords(m.wxString) : [];
      const now = m ? `<div class="fl-cat c${E(m.fltCat)}"><b>${E(F.CAT_WORDS[m.fltCat] || "")}</b>${words.length ? ` · ${E(words.join(", "))}` : ""}</div>
<p>${isFinite(m.temp) && m.temp !== null ? `${Math.round(m.temp * 9 / 5 + 32)}°F (${Math.round(m.temp)}°C) · ` : ""}${m.wind ? `Wind ${Math.round(m.wind * 1.15078)} mph${m.gust ? `, gusts ${Math.round(m.gust * 1.15078)}` : ""}` : "Calm wind"}${m.vis !== null && m.vis !== undefined ? ` · Visibility ${m.vis >= 10 ? "10+" : m.vis} mi` : ""}</p>
<p class="dim small">Observed ${m.obsTime ? tm(m.obsTime) : ""} · ${w.src === "nws" ? "National Weather Service" : "aviationweather.gov"}</p>` : `<p class="dim">${a.countryiso2 === "US" || API ? "No current report." : "Current weather for airports outside the US needs our relay (not connected on this preview)."}</p>`;
      const fc = win ? `<p><b>${t ? (role === "Departure" ? "Around departure" : "Around arrival") : "Next hours"}:</b> ${E(F.CAT_WORDS[win.fltCat])}${win.words.length ? `, ${E(win.words.join(", "))}${win.possible ? " possible" : ""}` : ""}${win.gust ? `, gusts to ${Math.round(win.gust * 1.15078)} mph` : ""}</p>` : "";
      const f = !F.faaCode(a) || !S.nas ? "" : faa.length ? faa.map(x => `<p class="fl-faa r${x.lvl}">⚠️ ${E(x.text)}</p>`).join("") : `<p class="fl-faa ok">✓ No FAA delay programs or ground stops</p>`;
      const pill = faa.length ? `<i class="fl-pill r${Math.max(...faa.map(x => x.lvl))}">FAA</i>` : m ? `<i class="fl-pill c${E(m.fltCat)}">${E(m.fltCat)}</i>` : "";
      const upd = [S.fetched.wx ? `weather checked <span data-ago="${S.fetched.wx}"></span>` : "", S.fetched.nas && F.faaCode(a) ? `FAA checked <span data-ago="${S.fetched.nas}"></span>` : ""].filter(Boolean).join(" · ");
      return `<details class="card fl-apt-c" id="apt-${E(a.icao)}" data-apt="${E(a.icao)}"${S.open[a.icao] === false ? "" : " open"}><summary><span class="fl-role">${role}</span><h3>${E(a.iata || a.icao)} <small>${E(a.name)}</small></h3>${pill}</summary>${f}${now}${fc}
${m || (w && w.taf) ? `<details><summary>Raw reports</summary>${m ? `<code>${E(m.raw)}</code>` : ""}${w.taf ? `<code>${E(w.taf.rawTAF)}</code>` : ""}</details>` : ""}${upd ? `<p class="dim small">${upd} · refreshes automatically</p>` : ""}</details>`; }).join("");
  }
  function noRouteWx() {
    const n = nearPlaneApt(), w = n && S.wx[n.icao], m = w && w.metar;
    const head = S.legs.length > 1 && !S.ac ? "Pick your leg to see weather at both airports." : S.t && S.t.fn ? "We haven't confirmed this flight's airports yet, so airport weather isn't shown." : "Track a flight to see airport weather.";
    const near = n ? `<div class="card fl-apt-c"><span class="fl-role">Near the plane now</span><h3>${E(n.iata || n.icao)} <small>${E(n.name || "")} · about ${n._nm} nm away</small></h3>${m ? `<div class="fl-cat c${E(m.fltCat)}"><b>${E(F.CAT_WORDS[m.fltCat] || "")}</b></div><p>${isFinite(m.temp) && m.temp !== null ? `${Math.round(m.temp * 9 / 5 + 32)}°F · ` : ""}${m.wind ? `Wind ${Math.round(m.wind * 1.15078)} mph` : "Calm wind"}${m.vis != null ? ` · Visibility ${m.vis >= 10 ? "10+" : m.vis} mi` : ""}</p><p class="dim small">Observed ${m.obsTime ? tm(m.obsTime) : ""}</p>` : `<p class="dim">Loading the latest report…</p>`}</div>` : "";
    return `<div class="card"><h2>Weather</h2><p>${head}</p><p class="dim">Add the airports under Change flight → From and To to see departure and arrival weather.</p></div>${near}`;
  }
  function renderHazards(c) {
    const box = $("fl-haz"); if (!S.leg || !API) { box.innerHTML = S.leg ? `<h2>Along the route</h2><p class="dim">Route hazard alerts (SIGMETs) need our relay, which isn't connected on this preview.</p>` : ""; return; }
    const L = c.sigmets || [];
    box.innerHTML = `<h2>Along the route</h2>${L.length ? `<ul class="fl-hz">${L.map(s => `<li><b>${E(s.words[0].toUpperCase() + s.words.slice(1))}</b> · about ${Math.round(s.alongNm * 1.15078)} mi from ${E(S.leg.from.iata || S.leg.from.icao)}${s.ahead ? " · ahead of the plane" : ""}${s.top ? ` · up to ${s.top >= 18000 ? "FL" + Math.round(s.top / 100) : s.top + " ft"}` : ""}${s.to ? ` · until ${tm(s.to * 1000)}` : ""}<details><summary>SIGMET text</summary><code>${E(s.raw)}</code></details></li>`).join("")}</ul>`
      : `<p>✓ No SIGMETs (thunderstorms, turbulence, icing, ash) cross the straight route right now.</p>`}<p class="dim small">Planes don't fly exactly straight lines, so this is a guide.</p>`;
  }

  // ---------- Stuck with a delay? ----------
  const LINK = {
    gmaps: (q, lat, lon) => `https://www.google.com/maps/search/${encodeURIComponent(q)}/@${lat},${lon},13z`,
    dir: (o, d, mode) => `https://www.google.com/maps/dir/?api=1&origin=${o.lat},${o.lon}&destination=${d.lat},${d.lon}&travelmode=${mode}`,
    uber: (o, d, name) => `https://m.uber.com/ul/?action=setPickup&pickup[latitude]=${o.lat}&pickup[longitude]=${o.lon}&pickup[nickname]=${encodeURIComponent(o.iata || "Airport")}&dropoff[latitude]=${d.lat}&dropoff[longitude]=${d.lon}&dropoff[nickname]=${encodeURIComponent(name)}`,
    lyft: (o, d) => `https://lyft.com/ride?id=lyft&pickup[latitude]=${o.lat}&pickup[longitude]=${o.lon}&destination[latitude]=${d.lat}&destination[longitude]=${d.lon}`,
    osm: id => `https://www.openstreetmap.org/${id}`
  };
  // GA4 outbound-click tagging. gtag runs under the site's Consent Mode v2 defaults (analytics_storage denied until the
  // visitor agrees in consent regions), so these events are only stored when consent allows. No personal data, just
  // link type, provider, airport code and place category.
  const ev = (cat, prov, apt, pc) => ` data-ev="${E(cat)}" data-prov="${E(prov)}" data-apt="${E(apt || "")}"${pc ? ` data-pc="${E(pc)}"` : ""}`;
  document.addEventListener("click", e => { const a = e.target.closest && e.target.closest("a[data-ev]"); if (!a || !window.gtag) return;
    const sec = a.closest("[data-sec]"), apt = a.dataset.apt || (S.leg && (S.leg.from.iata || S.leg.from.icao)) || "";
    gtag("event", "flight_outbound_click", { link_category: a.dataset.ev, provider: a.dataset.prov || "", airport: apt, place_category: a.dataset.pc || "",
      section: sec ? sec.dataset.sec : "", risk_level: S.level != null ? F.LV[S.level] : "", link_domain: (a.hostname || "").replace(/^www\./, ""), transport_type: "beacon" }); }, true);
  // Site-wide Play links on this page (sticky bar, footer, nav) get the same click event, labelled by where they sit.
  document.querySelectorAll('a[href*="play.google.com"]:not([data-ev])').forEach(a => { a.dataset.ev = "play_store"; a.dataset.prov = "google_play";
    if (!a.closest("[data-sec]")) a.dataset.sec = a.closest("footer") ? "footer" : a.closest("header,nav") ? "nav" : a.closest('[class*="playbar"]') ? "playbar" : "other"; });
  const CATN = { restaurant: "Restaurant", cafe: "Café", fast_food: "Quick bite", museum: "Museum", attraction: "Attraction", park: "Park", cinema: "Cinema" };
  // Route not known yet (no live plane, several standing legs): the countdown still only needs your departure time.
  function clockNoLeg() {
    const now = Date.now(), { depMs } = times(), boardMin = +$("s-board").value || 35, secMin = +$("s-sec").value || 45;
    const removeWhatIf = `<button type="button" class="fl-wi-x" data-whatif="0">Remove what-if</button>`;
    const note = `<p class="dim small">Nearby places appear once we know your departure airport: pick your leg, or add it under Change flight → From.</p>`;
    if (!depMs) return `<p class="fl-clock-miss">Enter your departure time in the box at the top of this panel to see how much time you have left. It works whether or not your flight is delayed.${S.whatIfMin ? ` The ${F.fmtMin(S.whatIfMin)} what-if will be added once you enter a time. ${removeWhatIf}` : ""}</p>` + note;
    let dep = depMs, wi = null;
    const baseWord = S.t.ndep ? `your updated ${tm(depMs)} departure` : `the scheduled ${tm(depMs)} departure`;
    if (S.whatIfMin) { dep = Math.max(depMs, now) + S.whatIfMin * 60e3; wi = { min: S.whatIfMin, baseWord: depMs < now ? `the current time (${tm(now)})` : baseWord, at: dep }; }
    if (dep <= now) return `<p class="fl-clock-miss">Departure time has passed. Check your airline app for the new time and enter it under “New time if delayed” at the top of this panel.</p>` + note;
    const P = F.plan({ now, depMs: dep, boardMin, secMin, places: [], apt: null });
    const basisLine = wi ? `Based on ${wi.baseWord} plus a ${F.fmtMin(wi.min)} what-if (${tm(wi.at)}), minus ${boardMin} min for boarding and ${secMin} min for security. This is a what-if, not a real delay. ${removeWhatIf}`
      : `Based on ${baseWord}, minus ${boardMin} min for boarding and ${secMin} min for security.`;
    const outBit = P.gateMin > 0 ? ` Leaving the airport? That leaves about <b>${F.fmtMin(Math.max(0, P.outMin))}</b> out and back.` : "";
    return `<div class="fl-clock${wi ? " fl-clock-wi" : ""}">${wi ? `<em class="fl-wi-tag">What-if: +${F.fmtMin(wi.min)} delay</em>` : ""}<span>${wi ? "If it were delayed, be back at the gate by" : "Be back at the gate by"}</span><b>${tm(P.backBy)}</b><span class="fl-cd" data-until="${P.backBy}"${wi ? ' data-est="1"' : ""}>${P.gateMin > 0 ? `${F.fmtMin(P.gateMin)} from now` : wi ? "Confirm boarding in your airline app" : "Time's up: head to the gate"}</span>
<small>${basisLine}${outBit}</small></div>` + note;
  }
  function renderStuck(a) {
    const box = $("fl-stuck-b"); if (!S.t) { box.innerHTML = `<p class="dim">Track a flight to see options near the airport.</p>`; return; }
    if (!S.leg) { box.innerHTML = clockNoLeg(); S.stuckKey = ""; return; }
    const o = S.leg.from, code = o.iata || o.icao, now = Date.now(), c = context();
    let dep = c.depMs, basis = S.t.ndep ? "your updated departure" : "the scheduled departure";
    if (c.inbound && c.inbound.etaMs && dep) { const ready = c.inbound.etaMs + F.TURN_MIN * 60e3; if (ready > dep) { dep = ready; basis = `your inbound plane landing about ${tm(c.inbound.etaMs)} plus a ${F.TURN_MIN}-min turnaround (assumption)`; } }
    // Auto-reset countdown from the AI delay read (take the later of schedule vs estimated)
    const a0 = F.assess(c), dLate = a0.delay && a0.delay.lateMin;
    if (dep && dLate != null && dLate > 0 && a0.delay.source !== "live track" && !(a0.delay.airborne && dLate <= 10)) { /* FAA holds push departure (pre-takeoff) */ dep = Math.max(dep, c.now + dLate * 60e3); basis = `AI delay read (${a0.delay.source || "estimate"}): about ${F.fmtMin(dLate)} late`; }
    else if (dep && dLate != null && dLate > 0) { dep = dep + dLate * 60e3; basis = `AI delay read from ${a0.delay.basis || "live track"}`; }
    // What-if chip: say plainly what it is added to, so "+3 h" on top of a typed 8:25 PM never looks like a wrong time.
    let whatIf = null;
    if (S.whatIfMin && dep) {
      const base = dep, baseNow = base < c.now, baseWord = baseNow ? `the current time (${tm(c.now)})` : basis === "the scheduled departure" ? `the scheduled ${tm(base)} departure` : basis === "your updated departure" ? `your updated ${tm(base)} departure` : `the estimated ${tm(base)} departure`;
      dep = Math.max(base, c.now) + S.whatIfMin * 60e3; basis = `what-if ${F.fmtMin(S.whatIfMin)} delay (not a real delay)`;
      whatIf = { min: S.whatIfMin, baseWord, at: dep };
    }
    const removeWhatIf = `<button type="button" class="fl-wi-x" data-whatif="0">Remove what-if</button>`;
    const boardMin = +$("s-board").value || 35, secMin = +$("s-sec").value || 45;
    const near = (S.places || []).map(p => ({ ...p, km: F.distNm(o, p) * 1.852 })).filter(p => p.c !== "station");
    const station = (S.places || []).filter(p => p.c === "station").map(p => ({ ...p, km: F.distNm(o, p) * 1.852 })).sort((x, y) => x.km - y.km)[0];
    let clock = "";
    // Estimated when AI delay / inbound / what-if pushed departure past the typed schedule.
    const estimated = !!(dLate != null && dLate > 0) || !!S.whatIfMin || !!(c.inbound && c.inbound.etaMs);
    if (dep && dep > now) {
      const P = F.plan({ now, depMs: dep, boardMin, secMin, places: near, apt: o }); S.plan = P;
      const basisLine = whatIf
        ? `Based on ${whatIf.baseWord} plus a ${F.fmtMin(whatIf.min)} what-if (${tm(whatIf.at)}), minus ${boardMin} min for boarding and ${secMin} min for security. This is a what-if, not a real delay. ${removeWhatIf}`
        : estimated
        ? `Based on an estimated departure of ${tm(dep)}, minus ${boardMin} min for boarding and ${secMin} min for security.`
        : S.t.ndep
          ? `Based on your updated departure of ${tm(dep)}, minus ${boardMin} min for boarding and ${secMin} min for security.`
          : `Based on the scheduled departure of ${tm(dep)}, minus ${boardMin} min for boarding and ${secMin} min for security.`;
      const outBit = P.gateMin > 0 ? ` Leaving the airport? That leaves about <b>${F.fmtMin(Math.max(0, P.outMin))}</b> out and back.` : "";
      const upMsg = estimated ? "Confirm boarding in your airline app" : "Time's up: head to the gate";
      clock = `<div class="fl-clock${S.pulse ? " pulse" : ""}${whatIf ? " fl-clock-wi" : ""}">${whatIf ? `<em class="fl-wi-tag">What-if: +${F.fmtMin(whatIf.min)} delay</em>` : ""}<span>${whatIf ? "If it were delayed, be back at the gate by" : "Be back at the gate by"}</span><b>${tm(P.backBy)}</b><span class="fl-cd" data-until="${P.backBy}"${estimated ? ' data-est="1"' : ""}>${P.gateMin > 0 ? `${F.fmtMin(P.gateMin)} from now` : upMsg}</span>
<small>${basisLine}${outBit}</small></div>`;
    } else if (dep && estimated) {
      clock = `<p class="fl-clock-miss">Estimated departure window may have started. Confirm the time and gate in your airline app, and enter it under “New time if delayed” at the top of this panel.</p>`;
    } else clock = `<p class="fl-clock-miss">${dep ? "Departure time has passed. Check your airline app for the new time and enter it under “New time if delayed” at the top of this panel." : "Enter your departure time in the box at the top of this panel to see how much time you have left. It works whether or not your flight is delayed."}${S.whatIfMin && !dep ? ` The ${F.fmtMin(S.whatIfMin)} what-if will be added once you enter a time. ${removeWhatIf}` : ""}</p>`;
    const warn = `<p class="fl-warn">Delays can change quickly. Confirm times in your airline app — this is an estimate.</p>`;
    const P = S.plan && dep && dep > now ? S.plan : null, short = !P || P.outMin < 60;
    const airside = `<div class="fl-opt fl-air"><b>Stay inside the airport</b><span>Food, shops and lounges past security — no re-screening. ${short ? "Best when time is short." : ""}</span>
<a${ev("food_airside", "google_maps", code)} href="${LINK.gmaps(`restaurants inside ${code} airport`, o.lat, o.lon)}" target="_blank" rel="noopener">Food in ${E(code)} on Maps</a></div>`;
    const item = p => { const it = P ? P.items.find(x => x.osm === p.osm) : null, m = kmToMi(p.km), d = { lat: p.lat, lon: p.lon };
      const fit = it ? `<span class="fl-fit ${it.fit}">${it.fit === "fits" ? "fits" : it.fit === "tight" ? "tight" : "won't fit"}</span>` : "";
      const how = it ? (it.mode === "walk" ? `🚶 about ${it.oneWay} min walk each way` : `🚕 about ${it.oneWay} min by car each way`) + ` · allow ${it.visit} min there · <b>about ${F.fmtMin(it.total)} total</b>` : "";
      return `<li class="fl-place"><div><b>${E(p.n)}</b> <span class="dim">${E(CATN[p.c] || "")} · ${m < 0.95 ? m.toFixed(1) : Math.round(m)} mi away</span> ${fit}</div>${how ? `<p class="small">${how}</p>` : ""}
<p class="fl-links"><a${ev("place_map", "osm", code, p.c)} href="${LINK.osm(p.osm)}" target="_blank" rel="noopener">Map</a><a${ev("place_directions", "google_maps", code, p.c)} href="${LINK.dir(o, d, m < 1 ? "walking" : "driving")}" target="_blank" rel="noopener">Directions</a>${station ? `<a${ev("transit", "google_maps", code, p.c)} href="${LINK.dir(o, d, "transit")}" target="_blank" rel="noopener">Transit</a>` : ""}<a${ev("rideshare", "uber", code, p.c)} href="${LINK.uber(o, d, p.n)}" target="_blank" rel="noopener">Uber</a><a${ev("rideshare", "lyft", code, p.c)} href="${LINK.lyft(o, d)}" target="_blank" rel="noopener">Lyft</a></p></li>`; };
    const by = (cats, n) => near.filter(p => cats.includes(p.c)).sort((x, y) => x.km - y.km).slice(0, n);
    const list = (title, arr) => arr.length ? `<h3>${title}</h3><ul class="fl-pl">${arr.map(item).join("")}</ul>` : "";
    const TABS = [["dinner", `Dinner near ${code}`, by(["restaurant"], 8)], ["coffee", "Coffee & quick bites", by(["cafe", "fast_food"], 6)], ["todo", "Things to do", by(["museum", "attraction", "park", "cinema"], 8)]].filter(t => t[2].length);
    if (!TABS.some(t => t[0] === S.tab) && TABS.length) S.tab = TABS[0][0];
    const places = S.places ? (TABS.length ? `<h3>Near ${E(code)}</h3><div class="fl-tabs" role="tablist">${TABS.map(t => `<button type="button" role="tab" data-tab="${t[0]}" aria-selected="${t[0] === S.tab}">${E(t[1])} <small>${t[2].length}</small></button>`).join("")}</div>
<ul class="fl-pl fl-swipe" id="fl-swipe">${(TABS.find(t => t[0] === S.tab) || TABS[0])[2].map(item).join("")}</ul><p class="dim small fl-swipe-h">Sorted by distance · OpenStreetMap (no ratings)</p>` : `<p class="dim">No named places near ${E(code)} in OpenStreetMap.</p>`)
      : `<p class="dim">${API ? (S.placesErr ? "Could not load nearby places from OpenStreetMap." : "Loading nearby places…") : "Nearby places need our relay, which is not connected on this preview."}</p><p class="fl-links"><a${ev("food_nearby", "google_maps", code)} href="${LINK.gmaps(`restaurants near ${code} airport`, o.lat, o.lon)}" target="_blank" rel="noopener">Restaurants near ${E(code)} on Maps</a></p>`;
    const transport = `<h3>Getting around</h3><ul class="fl-modes">${F.modesFor(o).map(md => md.id === "walk" ? `<li><b>Walk</b> — places within about 1 mile.</li>`
        : md.id === "ride" ? `<li><b>Rideshare or taxi</b> — check the fare in Uber or Lyft; we do not show prices.</li>`
        : md.id === "transit" ? (station ? `<li><b>Train</b> — <b>${E(station.n)}</b> ${kmToMi(station.km) < 1 ? "at the airport" : `${kmToMi(station.km).toFixed(1)} mi away`} (OpenStreetMap). Use Transit for times.</li>` : "")
        : md.airports && (md.airports[o.iata] || md.airports[o.icao]) ? (x => `<li><b>${E(md.label)}</b> — ${E(x.note)} <a${ev("rideshare", md.id, code)} href="${E(md.url)}" target="_blank" rel="noopener">${E(md.label)}</a> · <a href="${E(x.src)}" target="_blank" rel="noopener">airport info</a></li>`)(md.airports[o.iata] || md.airports[o.icao])
        : `<li><b>${E(md.label)}</b></li>`).join("")}</ul>`;
    const stay = `<h3>If you are staying overnight</h3><div class="fl-opt"><b>Hotels near ${E(code)}</b><span>Compare rates, then book where you prefer. Your airline may cover a hotel when the delay is its fault.</span>
<p class="fl-links"><a${ev("hotel", "google_travel", code)} href="https://www.google.com/travel/search?q=${encodeURIComponent(`hotels near ${code} airport`)}" target="_blank" rel="noopener">Compare prices</a><a${ev("hotel", "google_maps", code)} href="${LINK.gmaps(`hotels near ${code} airport`, o.lat, o.lon)}" target="_blank" rel="noopener">Map</a></p></div>
<div class="fl-opt"><b>Rental cars at ${E(code)}</b><span>Useful when driving is a better option than waiting for a new flight.</span>
<p class="fl-links"><a${ev("car_rental", "google_search", code)} href="https://www.google.com/search?q=${encodeURIComponent(`rental cars ${code} airport`)}" target="_blank" rel="noopener">Compare prices</a><a${ev("car_rental", "google_maps", code)} href="${LINK.gmaps(`car rental ${code} airport`, o.lat, o.lon)}" target="_blank" rel="noopener">Map</a></p></div>`;
    // Big top-pick cards (eye-catching) — same affiliate links as the lists below
    const dinner0 = by(["restaurant"], 1)[0], todo0 = by(["museum", "attraction", "park", "cinema"], 1)[0];
    const pick = (cls, title, body, links) => `<div class="fl-pick ${cls}"><b>${title}</b><span>${body}</span><p class="fl-links">${links}</p></div>`;
    const picks = `<div class="fl-stuck-picks" aria-label="Top picks while you wait">
${pick("air", "Stay inside the airport", short ? "Best when time is short — food and shops past security, no re-screening." : "Food, shops and lounges past security so you do not risk missing the new time.",
  `<a${ev("food_airside", "google_maps", code)} href="${LINK.gmaps(`restaurants inside ${code} airport`, o.lat, o.lon)}" target="_blank" rel="noopener">Food in ${E(code)}</a>`)}
${dinner0 ? pick("food", `Dining near ${E(code)}`, `${E(dinner0.n)} · ${kmToMi(dinner0.km) < 0.95 ? kmToMi(dinner0.km).toFixed(1) : Math.round(kmToMi(dinner0.km))} mi away`,
  `<a${ev("place_map", "osm", code, dinner0.c)} href="${LINK.osm(dinner0.osm)}" target="_blank" rel="noopener">Map</a><a${ev("place_directions", "google_maps", code, dinner0.c)} href="${LINK.dir(o, { lat: dinner0.lat, lon: dinner0.lon }, "driving")}" target="_blank" rel="noopener">Directions</a><a${ev("rideshare", "uber", code, dinner0.c)} href="${LINK.uber(o, { lat: dinner0.lat, lon: dinner0.lon }, dinner0.n)}" target="_blank" rel="noopener">Uber</a>`)
  : pick("food", `Dining near ${E(code)}`, "Restaurants near the airport on the map.",
  `<a${ev("food_nearby", "google_maps", code)} href="${LINK.gmaps(`restaurants near ${code} airport`, o.lat, o.lon)}" target="_blank" rel="noopener">Restaurants on Maps</a>`)}
${todo0 ? pick("todo", "Things to do", `${E(todo0.n)} · ${E(CATN[todo0.c] || "Nearby")}`,
  `<a${ev("place_map", "osm", code, todo0.c)} href="${LINK.osm(todo0.osm)}" target="_blank" rel="noopener">Map</a><a${ev("place_directions", "google_maps", code, todo0.c)} href="${LINK.dir(o, { lat: todo0.lat, lon: todo0.lon }, "driving")}" target="_blank" rel="noopener">Directions</a>`)
  : pick("todo", "Things to do", "Museums, parks and attractions near the airport.",
  `<a${ev("food_nearby", "google_maps", code)} href="${LINK.gmaps(`things to do near ${code} airport`, o.lat, o.lon)}" target="_blank" rel="noopener">Explore on Maps</a>`)}
${pick("hotel", `Hotels near ${E(code)}`, "Compare rates if you need to stay overnight. Your airline may cover a hotel when the delay is its fault.",
  `<a${ev("hotel", "google_travel", code)} href="https://www.google.com/travel/search?q=${encodeURIComponent(`hotels near ${code} airport`)}" target="_blank" rel="noopener">Compare prices</a><a${ev("hotel", "google_maps", code)} href="${LINK.gmaps(`hotels near ${code} airport`, o.lat, o.lon)}" target="_blank" rel="noopener">Map</a>`)}
${pick("ride", "Rides", "Uber, Lyft or taxi — check the fare in the app. We do not show prices.",
  `<a${ev("rideshare", "uber", code)} href="${LINK.uber(o, o, code + " airport")}" target="_blank" rel="noopener">Uber</a><a${ev("rideshare", "lyft", code)} href="${LINK.lyft(o, o)}" target="_blank" rel="noopener">Lyft</a>`)}
</div>`;
    // Overnight / canceled mode: hotels and rides first, then the rest.
    const overnight = S.canceled
      ? (stay + `<div class="fl-stuck-picks" aria-label="Overnight picks">${pick("hotel", `Hotels near ${E(code)}`, "Rates near the airport for tonight.",
  `<a${ev("hotel", "google_travel", code)} href="https://www.google.com/travel/search?q=${encodeURIComponent(`hotels near ${code} airport`)}" target="_blank" rel="noopener">Compare prices</a><a${ev("hotel", "google_maps", code)} href="${LINK.gmaps(`hotels near ${code} airport`, o.lat, o.lon)}" target="_blank" rel="noopener">Map</a>`)}
${pick("ride", "Rides", "Uber, Lyft or taxi to a hotel or alternate airport — check the fare in the app.",
  `<a${ev("rideshare", "uber", code)} href="${LINK.uber(o, o, code + " airport")}" target="_blank" rel="noopener">Uber</a><a${ev("rideshare", "lyft", code)} href="${LINK.lyft(o, o)}" target="_blank" rel="noopener">Lyft</a>`)}</div>` + transport + airside + places)
      : (picks + airside + places + transport + stay);
    const html = clock + warn + overnight;
    const key = html.replace(/data-until="\d+"/g, ""); if (key === S.stuckKey && box.firstChild) return; S.stuckKey = key;
    const sl = $("fl-swipe") ? $("fl-swipe").scrollLeft : 0;
    const mphCar = Math.round(F.MODES[1].kmh * 0.621371), mphWalk = Math.round(F.MODES[0].kmh * 0.621371);
    box.innerHTML = html +
      `<details class="fl-how-est"><summary>How we estimate</summary><p>Travel times are approximate: straight-line distance × ${F.ROAD} at about ${mphCar} mph by car (plus ${F.MODES[1].waitMin} min to get a ride) or about ${mphWalk} mph on foot. Time on site is a planning allowance, not a measurement. “Fits” leaves at least 20 minutes spare. Places © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors (ODbL), listed by distance (no ratings). Airport status: <a href="https://nasstatus.faa.gov" target="_blank" rel="noopener">FAA NAS Status</a>.</p></details>`;
    const sw = $("fl-swipe"); if (sw) sw.scrollLeft = sl; tick();
    const nearBox = $("fl-nearby");
    if (nearBox) {
      const pickEl = box.querySelector(".fl-stuck-picks");
      const swipeEl = box.querySelector(".fl-swipe");
      const scrub = html => html.replace(/\bid="[^"]*"/g, "");
      nearBox.innerHTML = (pickEl ? scrub(pickEl.outerHTML) : "") + (swipeEl ? `<h3 class="fl-swipe-h">More nearby</h3>` + scrub(swipeEl.outerHTML) : (pickEl ? "" : `<p class="dim">Open Delayed under If plans change for countdown and nearby options, or track a flight first.</p>`));
      // Tab chips in the Nearby mirror jump to Delayed so filters stay single-source.
      nearBox.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => {
        S.tab = b.dataset.tab; S.stuckKey = ""; setSeg("plans", true); const st = $("fl-stuck"); if (st) st.open = true; renderStuck();
      }));
    }
  }
  const stuckB = $("fl-stuck-b"); if (stuckB) stuckB.addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (!b) return; S.tab = b.dataset.tab; S.stuckKey = ""; renderStuck(); const sw = $("fl-swipe"); if (sw) sw.scrollLeft = 0; });
  // Typing a time in the Delayed panel: update the form, the tracked flight and the share link, then restart the countdown now.
  ["s-dep", "s-ndep"].forEach(id => { const el = $(id); if (!el) return;
    const apply = async () => {
      const f = id === "s-dep" ? "f-dep" : "f-ndep"; $(f).value = el.value;
      if (!S.t) return;
      const v = el.value ? fromLocalInput(el.value) : undefined, key = id === "s-dep" ? "dep" : "ndep";
      if (v === S.t[key] || (!v && !S.t[key])) return;
      S.t = { ...S.t }; if (v) S.t[key] = v; else delete S.t[key];
      if (key === "dep" && v && !S.t.d) { const d = new Date(v); S.t.d = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; $("f-d").value = S.t.d; }
      try { const tok = await F.encode(S.t); history.replaceState(null, "", "#" + tok); } catch (x) {}
      S.stuckKey = ""; S.plan = null; render(); renderStuck();
    };
    el.addEventListener("input", apply); el.addEventListener("change", apply); });
  ["s-board", "s-sec"].forEach(id => { const el = $(id); if (el) el.addEventListener("change", () => renderStuck()); });
  const stuckEl = $("fl-stuck");
  if (stuckEl) stuckEl.addEventListener("toggle", () => {
    stuckEl.dataset.user = "1";
    if (!stuckEl.open) stuckEl.dataset.userClosed = "1";
    else delete stuckEl.dataset.userClosed;
  });
  function syncWhatIf() {
    document.querySelectorAll("[data-whatif]").forEach(b => {
      const v = +b.dataset.whatif;
      b.setAttribute("aria-pressed", v && S.whatIfMin === v ? "true" : "false");
    });
  }
  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest("[data-whatif]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const v = +b.dataset.whatif;
    S.whatIfMin = v > 0 ? v : 0;
    S.stuckKey = "";
    const stuck = $("fl-stuck");
    if (v > 0) { stuck.open = true; stuck.classList.add("hot"); delete stuck.dataset.userClosed; }
    stuck.dataset.user = "1";
    syncWhatIf(); renderStuck();
  }, true);


  // ---------- Flight canceled? ----------
  async function loadRoutePeers() {
    if (S.routePeers) return S.routePeers;
    try {
      const r = await fetch("/assets/route-peers.json.gz", { credentials: "omit" });
      if (!r.ok) throw new Error("peers " + r.status);
      let json;
      if (typeof DecompressionStream !== "undefined") {
        const ds = new DecompressionStream("gzip");
        json = await new Response(r.body.pipeThrough(ds)).json();
      } else {
        // Fallback: also ship uncompressed only if gz fails — try .json
        const r2 = await fetch("/assets/route-peers.json", { credentials: "omit" });
        json = await r2.json();
      }
      S.routePeers = json; return json;
    } catch (e) { S.peersErr = "peers"; return null; }
  }
  async function loadAirportsNa() {
    if (S.airportsNa) return S.airportsNa;
    try {
      const j = await getJSON("/assets/airports-na.json", { credentials: "omit" }, 8e3);
      S.airportsNa = j; return j;
    } catch (e) { return []; }
  }
  async function loadNearbyLive(apt) {
    if (!API || !apt || !isFinite(apt.lat)) return [];
    try {
      const j = await api(`/nearby?lat=${apt.lat}&lon=${apt.lon}&nm=80`);
      S.nearbyLive = j.ac || []; return S.nearbyLive;
    } catch (e) { return S.nearbyLive || []; }
  }
  function peerLabel(p) {
    const rb = F.rebookFor({ icao: p.airline }) || F.rebookFor({ iata: Object.keys(F.IATA_ICAO).find(k => F.IATA_ICAO[k] === p.airline) || "" });
    const iata = (rb && rb.iata) || Object.keys(F.IATA_ICAO).find(k => F.IATA_ICAO[k] === p.airline) || "";
    const name = (rb && rb.name) || p.name || p.airline;
    const num = p.cs.replace(/^[A-Z]{3}/, "");
    const fn = iata ? `${iata}${num}` : p.cs;
    return { name, fn, cs: p.cs };
  }
  async function renderCanceled() {
    const box = $("fl-canceled-b"); if (!box) return;
    if (!S.t || !S.leg) { box.innerHTML = `<p class="dim">Track a flight to see rebooking options for this route.</p>`; return; }
    const o = S.leg.from, d = S.leg.to, oi = o.icao, di = d.icao;
    const oa = o.iata || oi, da = d.iata || di;
    box.innerHTML = `<p class="dim">Looking up ${E(oa)} → ${E(da)}…</p>`;
    const [idx, apts, live] = await Promise.all([loadRoutePeers(), loadAirportsNa(), loadNearbyLive(o)]);
    const peers = F.peersForPair(idx || {}, oi, di).filter(p => p.cs !== (F.parseFlight(S.t.fn) || {}).cs);
    const matched = F.matchLivePeers(peers, live);
    // Prefer currently airborne, then any with a live hit, then the rest (cap list)
    matched.sort((a, b) => {
      const sa = a.live && a.live.airborne ? 0 : a.live ? 1 : 2;
      const sb = b.live && b.live.airborne ? 0 : b.live ? 1 : 2;
      return sa - sb || a.cs.localeCompare(b.cs);
    });
    const show = matched.slice(0, 12);
    const peerHtml = show.length
      ? `<ul class="fl-peers">${show.map(p => {
          const L = peerLabel(p);
          const tag = p.live && p.live.airborne ? `<span class="tag air">Airborne</span>`
            : p.live ? `<span class="tag gnd">On ground</span>` : `<span class="tag">Typical</span>`;
          return `<li class="fl-peer"><b>${E(L.name)} ${E(L.fn)}</b><span class="dim">${E(L.cs)}</span>${tag}</li>`;
        }).join("")}</ul>
<p class="dim small">From adsb.lol standing route data (CC0) — not a schedule or seat inventory. “Airborne” means that callsign was near ${E(oa)} on the last live check.</p>`
      : `<p class="dim">No other flights found for ${E(oa)} → ${E(da)} in our route data. Use airline rebooking or a fare search below.</p>`;

    const parsed = F.parseFlight(S.t.fn);
    const rb = F.rebookFor(parsed || {});
    const rebook = rb
      ? `<p class="fl-links"><a${ev("rebook", rb.iata.toLowerCase(), oa)} href="${E(rb.url)}" target="_blank" rel="noopener">Manage booking on ${E(rb.name)}</a></p>`
      : `<p class="dim">No direct rebooking link for this airline — use the airline app or website.</p>`;
    const tip = `<div class="fl-canceled-tip">Rebook in the airline app or by phone while you wait. If you decline a new flight, you are usually owed a refund under the <a${ev("dot_refunds", "dot", oa)} href="${E(F.DOT_REFUNDS)}" target="_blank" rel="noopener">US DOT refunds rule</a>.</div>`;

    const date = (S.t.d || new Date().toISOString().slice(0, 10));
    const gf = F.googleFlightsUrl(oa, da, date);
    const alts = F.nearbyAirports(o, apts || [], 100);
    const altLinks = alts.length
      ? `<p class="dim small">Alternate airports within about 100 mi:</p><ul class="fl-peers">${alts.map(a => {
          const url = F.googleFlightsUrl(a.iata, da, date);
          return `<li class="fl-peer"><b>${E(a.iata)}</b> <span class="dim">${E(a.name || "")} · ${Math.round(a.nm)} mi</span>
<a${ev("fare_search_alt", "google_flights", a.iata)} href="${E(url)}" target="_blank" rel="noopener">${E(a.iata)} → ${E(da)}</a></li>`;
        }).join("")}</ul>`
      : `<p class="dim small">No alternate airports within about 100 miles in our list.</p>`;

    const fares = `<p class="fl-links"><a${ev("fare_search", "google_flights", oa)} href="${E(gf)}" target="_blank" rel="noopener">${E(oa)} → ${E(da)} on Google Flights</a></p>${altLinks}`;

    const stay = `<div class="fl-opt"><b>Hotels near ${E(oa)}</b><span>Compare rates near the airport for tonight. Your airline may cover a hotel when the cancellation is its fault.</span>
<p class="fl-links"><a${ev("hotel", "google_travel", oa)} href="https://www.google.com/travel/search?q=${encodeURIComponent(`hotels near ${oa} airport`)}" target="_blank" rel="noopener">Compare prices</a><a${ev("hotel", "google_maps", oa)} href="${LINK.gmaps(`hotels near ${oa} airport`, o.lat, o.lon)}" target="_blank" rel="noopener">Map</a></p></div>
<div class="fl-opt"><b>Rides</b><span>Uber, Lyft or taxi to a hotel or alternate airport — check the fare in the app.</span>
<p class="fl-links"><a${ev("rideshare", "uber", oa)} href="${LINK.uber(o, o, oa + " airport")}" target="_blank" rel="noopener">Uber</a><a${ev("rideshare", "lyft", oa)} href="${LINK.lyft(o, o)}" target="_blank" rel="noopener">Lyft</a></p></div>
<div class="fl-opt"><b>Rental cars at ${E(oa)}</b><span>When driving is a better option than waiting for a new flight. One-way rentals are often available — confirm drop-off fees on the rental site.</span>
<p class="fl-links"><a${ev("car_rental", "google_search", oa)} href="https://www.google.com/search?q=${encodeURIComponent(`rental cars ${oa} airport`)}" target="_blank" rel="noopener">Compare prices</a><a${ev("car_rental", "google_maps", oa)} href="${LINK.gmaps(`car rental ${oa} airport`, o.lat, o.lon)}" target="_blank" rel="noopener">Map</a></p></div>`;

    // Private & semi-private: both ends of a real route near origin AND dest; else optional "Gets you closer".
    const routed = F.carriersForRoute(o, d, F.SEMI_PRIVATE, apts || [], 60);
    const charters = F.charterNear(o, d, apts || [], 60);
    const fmtCarrier = (c, kindLabel) => {
      const near = c.via ? ` · ${E(c.via)}` : (c.nearest ? ` · near ${E(c.nearest.code)}` : "");
      const closer = c.role === "closer" && c.land ? ` · lands ${E(c.land.code)}, ~${c.cutPct}% closer` : "";
      return `<li class="fl-peer"><b>${E(c.name)}</b> <span class="dim">${E(kindLabel)}${near}${closer}</span>
<a${ev(c.role === "closer" ? "semi_closer" : "semi_private", c.id, oa)} href="${E(c.url)}" target="_blank" rel="noopener">Check ${E(c.name)}</a></li>`;
    };
    const matchItems = routed.match.map(c => fmtCarrier(c, c.kind === "semi-private" ? "Semi-private" : "Regional"));
    const closerItems = routed.closer.map(c => fmtCarrier(c, "Gets you closer"));
    const charterItems = charters.map(c => `<li class="fl-peer"><b>${E(c.name)}</b> <span class="dim">${E(c.blurb || "Charter")}</span>
<a${ev("charter", c.id, oa)} href="${E(c.url)}" target="_blank" rel="noopener">${c.id === "charter_search" ? "Search charters" : `Check ${E(c.name)}`}</a></li>`);
    const scheduledNote = matchItems.length || closerItems.length
      ? ""
      : `<p class="dim small">No scheduled regional service between these cities.</p>`;
    const closerBlock = closerItems.length
      ? `<p class="dim small" style="margin-top:8px">Gets you closer</p><ul class="fl-peers">${closerItems.join("")}</ul>`
      : "";
    const privateSec = `<div data-sec="canceled_private"><h3>Private &amp; semi-private</h3>
<p class="dim small">Availability and fares are shown on each carrier's site.</p>
${scheduledNote}
${matchItems.length ? `<ul class="fl-peers">${matchItems.join("")}</ul>` : ""}
${closerBlock}
<ul class="fl-peers">${charterItems.join("")}</ul>
</div>`;

    // Drive instead? GC × 1.25 at 60 mph vs assumed rebook wait + flight + airport overhead.
    const DRV_NOTE = `great-circle × ${F.DRIVE_ROAD} at ~${F.DRIVE_MPH} mph average`;
    const nextWait = show.length && show.some(p => p.live && p.live.airborne) ? 180 : null; // rough: airborne peer → ~3 h assumed next option; else 4–6 h mid
    const drv = F.driveVsFly(o, d, { nextFlightWaitMin: nextWait });
    let driveSec = "";
    if (drv && !drv.hide) {
      const am = F.amtrakFor(o, d);
      if (drv.showDrive) {
        const train = am.route
          ? `<div class="fl-opt"><b>Train (Amtrak)</b><span>${E(am.cityA)} and ${E(am.cityB)} are on Amtrak’s ${E(am.route)}. Check times and seats on Amtrak — we do not sell tickets.</span>
<p class="fl-links"><a${ev("amtrak", "amtrak", oa)} href="${E(am.searchUrl)}" target="_blank" rel="noopener">Search Amtrak</a></p></div>`
          : `<div class="fl-opt"><b>Train (Amtrak)</b><span>See whether Amtrak serves this trip. Availability is on their site.</span>
<p class="fl-links"><a${ev("amtrak", "amtrak", oa)} href="${E(am.searchUrl)}" target="_blank" rel="noopener">Search Amtrak</a></p></div>`;
        driveSec = `<div class="fl-drive-card">
<b>Driving may be faster: about ${E(F.fmtMin(drv.driveMin))}</b>
<span>About ${drv.roadMi} road miles (estimate: ${DRV_NOTE}). Waiting for a rebooked flight is often ${E(F.fmtMin(drv.waitMin))} plus ~${E(F.fmtMin(drv.flightMin))} in the air and 1.5 h airport time (~${E(F.fmtMin(drv.flyTotal))} total).</span>
<p class="fl-links"><a${ev("drive_maps", "google_maps", oa)} href="${E(drv.mapsUrl)}" target="_blank" rel="noopener">See route in Google Maps</a></p>
<div class="fl-opt"><b>One-way rental car</b><span>Compare rentals at ${E(oa)}. Confirm one-way / drop-off fees on the rental site.</span>
<p class="fl-links"><a${ev("car_rental", "google_search", oa)} href="https://www.google.com/search?q=${encodeURIComponent(`one way rental car ${oa} to ${da}`)}" target="_blank" rel="noopener">Compare one-way rentals</a><a${ev("car_rental", "google_maps", oa)} href="${LINK.gmaps(`car rental ${oa} airport`, o.lat, o.lon)}" target="_blank" rel="noopener">Map</a></p></div>
<div class="fl-opt"><b>Rides</b><span>Uber or Lyft for shorter hops — check the fare in the app (we do not show prices).</span>
<p class="fl-links"><a${ev("rideshare", "uber", oa)} href="${LINK.uber(o, d, da)}" target="_blank" rel="noopener">Uber</a><a${ev("rideshare", "lyft", oa)} href="${LINK.lyft(o, d)}" target="_blank" rel="noopener">Lyft</a></p></div>
${train}
</div>`;
      } else {
        driveSec = `<p class="fl-drive-skip dim small">Flying is still faster on this route: driving is about ${E(F.fmtMin(drv.driveMin))} (${drv.roadMi} mi estimate) vs roughly ${E(F.fmtMin(drv.flyTotal))} including a typical rebooking wait. <a${ev("drive_maps", "google_maps", oa)} href="${E(drv.mapsUrl)}" target="_blank" rel="noopener">See route in Google Maps</a></p>`;
      }
    }
    box.innerHTML = `<h3>Rebook with your airline</h3>${rebook}${tip}
<h3>Alternate flights on this route</h3>${peerHtml}
<h3>Search fares</h3>${fares}
${privateSec}
${driveSec}
<h3>If you're staying overnight</h3>${stay}
<p class="fl-canceled-attr">Flight data: adsb.lol (CC0). Places © OpenStreetMap (ODbL). Refunds: <a${ev("dot_refunds", "dot", oa)} href="${E(F.DOT_REFUNDS)}" target="_blank" rel="noopener">US DOT</a>.</p>`;
  }

  async function openCanceled(on) {
    const next = !!on;
    const panel = $("fl-canceled"), stuck = $("fl-stuck");
    S.canceled = next;
    if (panel && panel.open !== next) panel.open = next;
    if (next && stuck) { stuck.open = true; stuck.classList.add("hot"); delete stuck.dataset.userClosed; stuck.dataset.user = "1"; }
    S.stuckKey = "";
    renderStuck();
    if (next) await renderCanceled();
  }
  const cancelPanel = $("fl-canceled");
  if (cancelPanel) cancelPanel.addEventListener("toggle", () => {
    if (cancelPanel.open !== S.canceled) openCanceled(cancelPanel.open);
  });

  // ---------- boot from #link ----------
  async function boot() {
    const h = location.hash.slice(1); if (!h) return; let t = null;
    if (h.startsWith("v1.")) { try { t = await F.decode(h); } catch (e) { $("ferr").textContent = "That flight link couldn't be read. Enter the flight below."; } }
    else if (F.parseFlight(decodeURIComponent(h))) t = F.validate({ v: 1, fn: decodeURIComponent(h) });
    if (t) { fillForm(t); start(t); }
  }
  try { const from = sessionStorage.getItem("yw-flight-from"); if (from) { sessionStorage.removeItem("yw-flight-from");   // the Trip Planner's "Track my flight" card
    if (window.gtag && /^[a-z_]{1,30}$/.test(from)) gtag("event", "flight_page_click", { section: from }); } } catch (e) {}
  // Sticky Play bar: on /flight while tracking, don't cover the AI delay card on the first screen.
  // Show it only after the visitor scrolls past the AI card (still dismissible via ×).
  (function wirePlaybarDefer() {
    const bar = document.getElementById("playbar"); if (!bar) return;
    const sync = () => {
      if (bar.hidden) { bar.classList.remove("fl-play-defer", "fl-play-show"); return; }
      if (!document.body.classList.contains("fl-tracking")) {
        bar.classList.remove("fl-play-defer", "fl-play-show");
        return;
      }
      bar.classList.add("fl-play-defer");
      const ai = $("fl-ai-host");
      let show = true;
      if (ai) {
        // Past the AI card = its bottom has scrolled off the top of the viewport.
        show = ai.getBoundingClientRect().bottom < 12;
      }
      bar.classList.toggle("fl-play-show", show);
    };
    window.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    document.addEventListener("visibilitychange", sync);
    const mo = new MutationObserver(sync);
    mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    const aiHost = $("fl-ai-host");
    if (aiHost) mo.observe(aiHost, { childList: true, subtree: true });
    setTimeout(sync, 0);
    setInterval(sync, 1000);
  })();

  try { const sim = new URLSearchParams(location.search).get("sim"); if (sim) S.sim = sim; } catch (e) {}
  boot(); window.addEventListener("hashchange", boot);
})();
