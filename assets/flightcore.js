/* Flight tracker core (pure logic, no DOM): /flight#v1.<data> link codec, flight-number parsing, route legs, geometry,
   METAR/TAF reading, SIGMETs on the route, the rules-based delay estimate, the "how much time do I have" math and the
   transport modes. Node-testable: node _src/tests/flightcore.test.js
   Link data: {v:1, fn:"DL809", d?:"YYYY-MM-DD", dep?, arr?, ndep?: ISO-8601 UTC, from?, to?: IATA/ICAO} */
(function (root) {
  const core = typeof module !== "undefined" ? require("./codec-core.js") : root.YWCore;
  // Airline IATA designator -> ICAO operator (radio callsign prefix). Major carriers only; ICAO input is used as-is.
  const IATA_ICAO = { UA:"UAL", AA:"AAL", DL:"DAL", WN:"SWA", B6:"JBU", AS:"ASA", F9:"FFT", NK:"NKS", SY:"SCX", G4:"AAY", MX:"MXY", XP:"VXP", HA:"HAL",
    OO:"SKW", MQ:"ENY", YX:"RPA", QX:"QXE", YV:"ASH", G7:"GJS", OH:"JIA", PT:"PDT", "9E":"EDV", ZW:"AWI", C5:"UCA", PD:"POE", QK:"JZA", RV:"ROU",
    AC:"ACA", WS:"WJA", TS:"TSC", AM:"AMX", Y4:"VOI", VB:"VIV", AV:"AVA", LA:"LAN", JJ:"TAM", G3:"GLO", AD:"AZU", CM:"CMP",
    BA:"BAW", VS:"VIR", AF:"AFR", KL:"KLM", LH:"DLH", LX:"SWR", OS:"AUA", SN:"BEL", IB:"IBE", VY:"VLG", EI:"EIN", TP:"TAP", AZ:"ITY", SK:"SAS",
    AY:"FIN", DY:"NAX", FI:"ICE", LO:"LOT", A3:"AEE", TK:"THY", FR:"RYR", U2:"EZY", W6:"WZZ", EW:"EWG", DE:"CFG", LS:"EXS", BY:"TOM", UX:"AEA",
    EK:"UAE", QR:"QTR", EY:"ETD", SV:"SVA", ET:"ETH", MS:"MSR", AI:"AIC", SQ:"SIA", CX:"CPA", JL:"JAL", NH:"ANA", KE:"KAL", OZ:"AAR", BR:"EVA", CI:"CAL",
    CA:"CCA", MU:"CES", CZ:"CSN", QF:"QFA", NZ:"ANZ", VA:"VOZ", PR:"PAL", TG:"THA", MH:"MAS", GA:"GIA", FX:"FDX", "5X":"UPS" };
  // Regional airlines that fly under their own callsign for a mainline brand (helps explain "not found").
  const REGIONALS = { DL:["SKW","EDV","RPA"], UA:["SKW","RPA","GJS","ASH","UCA","AWI"], AA:["ENY","JIA","PDT","RPA","SKW","ASH","AWI"], AS:["QXE","SKW"], AC:["JZA"] };

  function parseFlight(s) {
    s = String(s || "").toUpperCase().replace(/[\s\-]/g, "");
    let m;
    m = s.match(/^([A-Z0-9]{2})(\d{1,4})([A-Z]?)$/);
    if (m && /[A-Z]/.test(m[1])) { const icao = IATA_ICAO[m[1]]; if (!icao) return { fn: s, iata: m[1], num: String(+m[2]) + m[3], unknownAirline: true };
      return { fn: s, iata: m[1], icao, num: String(+m[2]) + m[3], cs: icao + (+m[2]) + m[3] }; }
    m = s.match(/^([A-Z]{3})(\d{1,4})([A-Z]?)$/);
    if (m) return { fn: s, icao: m[1], num: String(+m[2]) + m[3], cs: m[1] + (+m[2]) + m[3], iata: Object.keys(IATA_ICAO).find(k => IATA_ICAO[k] === m[1]) || "" };
    return null;
  }
  const isIso = s => typeof s === "string" && isFinite(Date.parse(s)) && /^\d{4}-\d{2}-\d{2}T/.test(s);
  const isApt = s => /^[A-Z0-9]{3,4}$/.test(s || "");
  function validate(t) {
    if (!t || t.v !== 1) throw new Error("Unsupported flight link version");
    t.fn = String(t.fn || "").toUpperCase().replace(/\s/g, "");
    if (!parseFlight(t.fn)) throw new Error("Missing flight number");
    if (!core.isDate(t.d)) delete t.d;
    for (const k of ["dep", "arr", "ndep"]) if (!isIso(t[k])) delete t[k];
    for (const k of ["from", "to"]) { if (t[k]) t[k] = String(t[k]).toUpperCase(); if (!isApt(t[k])) delete t[k]; }
    return t;
  }

  // ---------- geometry ----------
  const R = 3440.065, rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;   // R in nautical miles
  function distNm(a, b) { const dl = rad(b.lat - a.lat), dn = rad(b.lon - a.lon);
    const h = Math.sin(dl / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); }
  function bearing(a, b) { const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat)), x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
    return (deg(Math.atan2(y, x)) + 360) % 360; }
  function gcPoints(a, b, n) { const out = [], d = distNm(a, b) / R; if (d < 1e-6) return [a, b];
    for (let i = 0; i <= n; i++) { const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
      const x = A * Math.cos(rad(a.lat)) * Math.cos(rad(a.lon)) + B * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon));
      const y = A * Math.cos(rad(a.lat)) * Math.sin(rad(a.lon)) + B * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon)), z = A * Math.sin(rad(a.lat)) + B * Math.sin(rad(b.lat));
      out.push({ lat: deg(Math.atan2(z, Math.hypot(x, y))), lon: deg(Math.atan2(y, x)) }); } return out; }
  const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  function inPoly(p, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if ((yi > p.lat) !== (yj > p.lat) && p.lon < (xj - xi) * (p.lat - yi) / (yj - yi) + xi) c = !c; } return c; }

  // Point reached from p after nm nautical miles on an initial bearing (great circle).
  function destPt(p, brg, nm) { const d = nm / R, b = rad(brg), la = rad(p.lat), lo = rad(p.lon);
    const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
    return { lat: la2 * 180 / Math.PI, lon: ((lo2 * 180 / Math.PI + 540) % 360) - 180 }; }
  // Dead reckoning between live fixes: carry the last reported position forward at its reported speed and track.
  // Capped (default 90 s) so a stale fix is never stretched into a guess; on the ground we don't move it.
  function project(ac, nowMs, maxSec) {
    if (!ac || !isFinite(ac.lat) || !isFinite(ac.lon)) return null; const at = ac.seenAt || ac.fixAt || nowMs;
    const sec = Math.max(0, Math.min(maxSec || 90, (nowMs - at) / 1000));
    if (ac.alt === "ground" || !isFinite(ac.gs) || ac.gs < 40 || !isFinite(ac.track) || !sec) return { lat: ac.lat, lon: ac.lon, sec, moved: false };
    return { ...destPt(ac, ac.track, ac.gs * sec / 3600), sec, moved: true }; }

  // ---------- route legs (adsb.lol / VRS standing data, CC0) ----------
  function legs(routeJson) {
    const a = (routeJson && routeJson._airports || []).filter(x => isFinite(x.lat) && isFinite(x.lon));
    const out = []; for (let i = 0; i + 1 < a.length; i++) out.push({ from: a[i], to: a[i + 1], i }); return out;
  }
  const aptMatch = (apt, code) => !!code && !!apt && (apt.iata === code || apt.icao === code);
  // Which leg is the plane flying now? Closest to the leg line, heading roughly toward its destination.
  function liveLeg(L, ac) {
    if (!ac || !L.length) return null; let best = null;
    for (const l of L) { const p = { lat: ac.lat, lon: ac.lon }, toD = distNm(p, l.to), fromD = distNm(p, l.from), len = distNm(l.from, l.to);
      const off = toD + fromD - len, head = isFinite(ac.track) ? angDiff(ac.track, bearing(p, l.to)) : 0;
      const score = off + (head > 100 ? 400 : head * 0.5); if (!best || score < best.score) best = { leg: l, score }; }
    return best.leg;
  }
  function userLeg(L, from, to) {
    return L.find(l => (!from || aptMatch(l.from, from)) && (!to || aptMatch(l.to, to)) && (from || to)) || null;
  }

  // ---------- weather ----------
  const WX = [["TS", "thunderstorms"], ["FZRA", "freezing rain"], ["FZDZ", "freezing drizzle"], ["FZFG", "freezing fog"], ["SN", "snow"], ["PL", "ice pellets"], ["GR", "hail"],
    ["GS", "small hail"], ["FG", "fog"], ["SQ", "squalls"], ["FC", "funnel cloud"], ["VA", "volcanic ash"], ["DS", "dust storm"], ["SS", "sandstorm"], ["RA", "rain"], ["DZ", "drizzle"], ["BR", "mist"], ["HZ", "haze"], ["FU", "smoke"]];
  function wxWords(str) { const out = [];
    for (const tok of String(str || "").split(/\s+/).filter(Boolean)) { let first = true;
      for (const [c, w] of WX) if (tok.replace(/^[-+]/, "").includes(c) && !(c === "RA" && /FZRA/.test(tok)) && !(c === "DZ" && /FZDZ/.test(tok)) && !(c === "FG" && /FZFG/.test(tok))) {
        const word = (tok[0] === "+" && first ? "heavy " : "") + (/^[-+]?VC/.test(tok) ? "nearby " : "") + w; first = false;
        if (!out.some(o => o.endsWith(w))) out.push(word); } }
    return out; }
  const visNum = v => { if (v === undefined || v === null || v === "") return null; if (typeof v === "number") return v; const s = String(v).replace("+", "");
    if (/^\d+\/\d+$/.test(s)) { const [a, b] = s.split("/"); return a / b; } const n = parseFloat(s); return isFinite(n) ? n : null; };
  const ceiling = clouds => { let c = null; for (const k of clouds || []) if (/BKN|OVC|OVX|VV/.test(k.cover) && isFinite(k.base)) c = c === null ? k.base : Math.min(c, k.base); return c; };
  function fltCat(vis, ceil) { if ((vis !== null && vis < 1) || (ceil !== null && ceil < 500)) return "LIFR";
    if ((vis !== null && vis < 3) || (ceil !== null && ceil < 1000)) return "IFR"; if ((vis !== null && vis <= 5) || (ceil !== null && ceil <= 3000)) return "MVFR"; return "VFR"; }
  // Read a raw METAR string (used when only NWS observations are available).
  function readMetar(raw) {
    raw = String(raw || ""); const body = raw.split(" RMK")[0], t = body.split(/\s+/);
    let vis = null, gust = null, wind = null; const clouds = [];
    for (const x of t) { let m;
      if ((m = x.match(/^(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?KT$/))) { wind = +m[2]; gust = m[4] ? +m[4] : null; }
      else if ((m = x.match(/^(M)?(\d+)?(\/)?(\d+)?SM$/))) { vis = m[3] ? (m[2] && m[4] ? m[2] / m[4] : null) : +m[2]; if (m[1] && vis !== null) vis = Math.min(vis, 0.24); }
      else if ((m = x.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3})/))) clouds.push({ cover: m[1], base: +m[2] * 100 }); }
    const wxs = t.filter(x => /^[-+]?(VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)+$|^[-+]?(VC)?TS$/.test(x)).join(" ");
    const vis2 = / (\d+) (\d)\/(\d)SM/.exec(body); if (vis2) vis = +vis2[1] + vis2[2] / vis2[3];
    return { raw, vis, wind, gust, clouds, wxString: wxs, fltCat: fltCat(vis, ceiling(clouds)) };
  }
  function fromAwcMetar(m) { if (!m) return null; const r = readMetar(m.rawOb);
    return { raw: m.rawOb, obsTime: m.obsTime ? m.obsTime * 1000 : null, temp: m.temp, wind: m.wspd ?? r.wind, gust: m.wgst ?? r.gust, vis: visNum(m.visib) ?? r.vis,
      wxString: m.wxString || r.wxString, fltCat: m.fltCat || r.fltCat, name: m.name }; }
  // TAF periods overlapping [t0, t1] (ms). Returns the worst-case reading with plain words.
  function tafWindow(taf, t0, t1) {
    if (!taf || !Array.isArray(taf.fcsts)) return null; let words = [], worst = "VFR", gust = null, any = false, prob = false;
    const rank = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3 };
    for (const f of taf.fcsts) { const a = f.timeFrom * 1000, b = f.timeTo * 1000; if (b < t0 || a > t1) continue; any = true;
      const c = fltCat(visNum(f.visib), ceiling(f.clouds)); if (rank[c] > rank[worst]) worst = c;
      if (f.fcstChange === "PROB" || f.fcstChange === "TEMPO" || f.probability) prob = true;
      if (f.wgst) gust = Math.max(gust || 0, f.wgst); for (const w of wxWords(f.wxString)) if (!words.includes(w)) words.push(w); }
    return any ? { fltCat: worst, words, gust, possible: prob } : null;
  }
  const CAT_WORDS = { VFR: "Good visibility", MVFR: "Some low cloud or haze", IFR: "Low cloud or poor visibility", LIFR: "Very low cloud or fog" };

  // ---------- SIGMETs on the route ----------
  const HAZ = { CONVECTIVE: "thunderstorms", TS: "thunderstorms", TSGR: "thunderstorms with hail", TURB: "turbulence", ICE: "icing", VA: "volcanic ash", TC: "tropical cyclone",
    MTW: "mountain waves", IFR: "low cloud and fog", "MT OBSC": "mountains hidden in cloud", DS: "dust storm", SS: "sandstorm", RDOACT: "radioactive cloud" };
  function sigmetsOnLeg(list, leg, now, ac) {
    if (!leg || !Array.isArray(list)) return []; const pts = gcPoints(leg.from, leg.to, Math.max(20, Math.round(distNm(leg.from, leg.to) / 15)));
    const out = [];
    for (const s of list) { if (s.type && s.type !== "SIGMET") continue; if (s.to && s.to * 1000 < now) continue;
      const poly = s.coords; let hitAt = -1; for (let i = 0; i < pts.length; i++) if (inPoly(pts[i], poly)) { hitAt = i; break; }
      if (hitAt < 0) continue;
      let ahead = null; if (ac) { const done = distNm(leg.from, ac), at = distNm(leg.from, pts[hitAt]); ahead = at >= done - 20; }
      out.push({ ...s, words: HAZ[s.hazard] || String(s.hazard || "hazard").toLowerCase(), alongNm: Math.round(distNm(leg.from, pts[hitAt])), ahead }); }
    return out;
  }

  // ---------- FAA NAS (US airports only) ----------
  const faaCode = apt => apt && apt.countryiso2 === "US" ? (apt.iata || (apt.icao || "").replace(/^K/, "")) : null;
  const toMin = s => { s = String(s || ""); let m = 0, h = s.match(/(\d+)\s*hour/), mm = s.match(/(\d+)\s*minute/); if (h) m += 60 * h[1]; if (mm) m += +mm[1]; return h || mm ? m : null; };
  function nasFor(nas, apt) {
    const c = faaCode(apt); if (!nas || !c) return [];
    const out = [];
    for (const g of nas.groundStops || []) if (g.arpt === c) out.push({ kind: "stop", lvl: 2, text: `FAA ground stop at ${c}${g.reason ? ` (${g.reason})` : ""}${g.until ? `, listed until ${g.until}` : ""}.` });
    for (const g of nas.groundDelays || []) if (g.arpt === c) { const avg = toMin(g.avg);
      out.push({ kind: "gdp", lvl: avg !== null && avg >= 45 ? 2 : 1, text: `FAA ground delay program for flights into ${c}${g.reason ? ` (${g.reason})` : ""}: average ${g.avg}${g.max ? `, max ${g.max}` : ""} (FAA figures).` }); }
    for (const d of nas.delays || []) if (d.arpt === c) { const mx = toMin(d.max);
      out.push({ kind: "delay", dir: (d.type || "").toLowerCase(), lvl: mx !== null && mx >= 45 ? 2 : 1, text: `FAA reports ${(d.type || "general").toLowerCase()} delays at ${c}${d.min ? `: ${d.min}${d.max ? ` to ${d.max}` : ""}` : ""}${d.trend ? `, ${d.trend.toLowerCase()}` : ""}${d.reason ? ` (${d.reason})` : ""}.` }); }
    for (const a of nas.closures || []) if (a.arpt === c && !a.gaOnly) out.push({ kind: "closure", lvl: 2, text: `FAA lists ${c} as closed${a.reopen ? `, reopening ${a.reopen.replace(/\.$/, "")}` : ""}.` });
    return out;
  }

  // ---------- live position vs schedule ----------
  function progress(ac, leg, now) {
    if (!ac || !leg) return null; const p = { lat: ac.lat, lon: ac.lon }, toNm = distNm(p, leg.to), fromNm = distNm(p, leg.from);
    const onGround = ac.alt === "ground" || (isFinite(ac.alt) && ac.alt < 300 && (ac.gs || 0) < 60);
    const out = { toNm, fromNm, totalNm: distNm(leg.from, leg.to), onGround };
    if (onGround) out.at = toNm < 5 ? "dest" : fromNm < 5 ? "origin" : null;
    else if ((ac.gs || 0) >= 100) out.etaMs = now + toNm / ac.gs * 3600e3;   // straight line at the current ground speed
    out.phase = onGround ? "ground" : isFinite(ac.vs) && ac.vs < -500 ? "descending" : isFinite(ac.vs) && ac.vs > 500 ? "climbing" : "cruising";
    return out;
  }

  // ---------- the estimate (rules only, no AI, no made-up odds) ----------
  const LV = ["Low", "Some", "High"];
  function assess(c) {
    const R = [], todo = [], now = c.now, add = (lvl, text, src) => R.push({ lvl, text, src });
    const ap = (x, rule) => x && (x.iata || x.icao);
    for (const [apt, role] of [[c.origin, "dep"], [c.dest, "arr"]]) {
      if (!apt) continue;
      for (const n of nasFor(c.nas, apt)) { if (n.kind === "delay" && n.dir && n.dir !== "general" && ((role === "dep") !== (n.dir === "departure"))) n.lvl = Math.min(n.lvl, 1);
        add(n.lvl, n.text, "FAA");
        if (n.kind === "stop") todo.push(c.progress && !c.progress.onGround && role === "arr" ? `Ground stop at ${ap(apt)}. Planes already in the air may hold or divert. Follow your airline app.` : `Ground stop at ${ap(apt)}. Check your airline app for a new departure time or rebooking.`);
        else if (n.kind === "gdp") todo.push(`Flights into ${ap(apt)} are being held by the FAA. Check your airline app before heading to the gate.`);
        else if (n.kind === "closure") todo.push(`${ap(apt)} is listed as closed. Contact your airline about rebooking.`); }
      const w = c.wx && c.wx[apt.icao]; if (!w) continue;
      const tWin = role === "dep" ? c.depMs : c.arrMs, win = tafWindow(w.taf, (tWin || now) - 3600e3, (tWin || now) + 3600e3), cur = w.metar;
      const words = new Set([...(cur ? wxWords(cur.wxString) : []), ...(win ? win.words : [])]);
      const when = tWin ? (role === "dep" ? "around departure" : "around arrival") : "now or in the next hours";
      if ([...words].some(x => /thunder/.test(x))) { add(1, `Thunderstorms ${cur && /TS/.test(cur.wxString || "") ? "reported" : "forecast" + (win && win.possible ? " (possible)" : "")} at ${ap(apt)} ${when}.`, "NWS/AWC");
        todo.push(`Storms at ${ap(apt)} can pause ramp work and cause holding. Keep an eye on your airline app.`); }
      if ([...words].some(x => /freezing|snow|ice pellets/.test(x))) add(1, `${[...words].filter(x => /freezing|snow|ice/.test(x)).join(", ")} at ${ap(apt)} ${when}: de-icing and slower operations are common.`, "NWS/AWC");
      const cat = [cur && cur.fltCat, win && win.fltCat].filter(Boolean).sort((a, b) => ["VFR", "MVFR", "IFR", "LIFR"].indexOf(b) - ["VFR", "MVFR", "IFR", "LIFR"].indexOf(a))[0];
      if (cat === "LIFR" || (cat === "IFR" && role === "arr")) add(1, `${CAT_WORDS[cat]} at ${ap(apt)} ${when} (${cat}). Airports often space flights out in these conditions.`, "NWS/AWC");
      const g = Math.max(cur && cur.gust || 0, win && win.gust || 0); if (g >= 35) add(1, `Wind gusts to ${g} kt at ${ap(apt)} ${when}.`, "NWS/AWC");
    }
    for (const s of c.sigmets || []) { if (s.ahead === false) continue; const strong = /volcanic|tropical/.test(s.words);
      add(strong ? 2 : 1, `SIGMET for ${s.words} along the route, about ${Math.round(s.alongNm * 1.15078)} mi from ${ap(c.origin) || "the origin"}${s.ahead ? ", ahead of the plane" : ""}. Flights may reroute or hold.`, "AWC"); }
    const pr = c.progress;
    if (pr && pr.etaMs && c.arrMs) { const late = Math.round((pr.etaMs - c.arrMs) / 60e3);
      if (late > 45) add(2, `At its current speed it's about ${fmtMin(late)} behind the scheduled arrival (straight-line estimate).`, "adsb.lol");
      else if (late > 15) add(1, `At its current speed it's about ${fmtMin(late)} behind the scheduled arrival (straight-line estimate).`, "adsb.lol");
      else add(0, late < -10 ? `On its current track and speed it looks set to arrive ahead of schedule.` : `On its current track and speed it looks close to the scheduled arrival.`, "adsb.lol"); }
    if (c.inbound && c.inbound.etaMs && c.depMs) { const ready = c.inbound.etaMs + TURN_MIN * 60e3, late = Math.round((ready - c.depMs) / 60e3);
      if (late > 0) { add(late > 30 ? 2 : 1, `Your plane is still on its way in. Landing plus a typical ${TURN_MIN}-minute turnaround puts it about ${fmtMin(late)} past the scheduled departure.`, "adsb.lol");
        todo.push("Your plane is running late on its way in. Your airline app will show the official new time."); } }
    if (pr && pr.onGround && pr.at === "origin" && c.depMs && now - c.depMs > 20 * 60e3) add(1, `Scheduled to leave ${fmtMin(Math.round((now - c.depMs) / 60e3))} ago and it's still on the ground at ${ap(c.origin)}.`, "adsb.lol");
    const level = R.reduce((m, r) => Math.max(m, r.lvl), 0);
    if (!R.length) R.push({ lvl: 0, text: "No FAA programs, storms, low visibility or SIGMETs found for this flight right now.", src: "" });
    if (!todo.length) todo.push(level ? "Keep your airline app handy; it has the official times and gate." : "Nothing to do for now. Your airline app has the official times and gate.");
    return { level, label: LV[level], reasons: R.sort((a, b) => b.lvl - a.lvl), todo: [...new Set(todo)] };
  }
  const TURN_MIN = 35;   // planning assumption for a narrow-body turnaround; shown to the user as an assumption
  function fmtMin(m) { m = Math.abs(Math.round(m)); const h = Math.floor(m / 60), r = m % 60; return h ? `${h} h${r ? ` ${r} min` : ""}` : `${r} min`; }

  // ---------- "How much time do I have?" ----------
  // Transport modes are data, so new ones (e.g. eVTOL air taxis) can be switched on per airport without code changes.
  // Speeds/waits are planning assumptions (shown on the page), not routing results.
  const MODES = [
    { id: "walk", label: "Walk", icon: "🚶", kmh: 4.5, waitMin: 0, maxKm: 1.6, enabled: true },
    { id: "ride", label: "Rideshare or taxi", icon: "🚕", kmh: 35, waitMin: 10, enabled: true, links: ["uber", "lyft"] },
    { id: "transit", label: "Train or transit", icon: "🚆", kmh: null, needsStation: true, enabled: true },   // times: Google Maps only (no free timetable source wired up)
    // eVTOL air taxi: no public passenger service operates at any airport yet (checked Oct 26, 2026: Joby/Archer not launched,
    // no FAA type certificate). Turn on per airport only once a real service is selling seats there.
    { id: "evtol", label: "Air taxi (eVTOL)", icon: "🚁", kmh: null, enabled: false, airports: {} },
    // Tesla Robotaxi (Model Y / Cybercab), booked in Tesla's Robotaxi app. Checked Oct 26, 2026: public rides in Austin, Dallas,
    // Houston, Miami, Orlando and Tampa (no airport pickups in any of them; MIA/MCO zones stop short of the terminals) and a
    // supervised Bay Area service with a safety driver. The only airport that lists Tesla as an authorized app ride is SJC
    // (flysanjose.com/app-based-rideshares: pickup Terminal A Stop 1, Terminal B Stop 8; drop-off at departures curbs).
    // Off by default; shown only at airports listed here. Add an airport only when the airport or Tesla publishes it.
    { id: "robotaxi", label: "Tesla Robotaxi", icon: "🚘", kmh: null, enabled: false, url: "https://www.tesla.com/robotaxi",
      airports: { SJC: { note: "Book in the Tesla Robotaxi app. Bay Area rides have a safety driver aboard. Pickup at Terminal A Stop 1 or Terminal B Stop 8 (per SJC); drop-off at the departures curb. Check the app for its service area and price.",
        src: "https://www.flysanjose.com/app-based-rideshares", checked: "2026-10-26" } } }
  ];
  const ROAD = 1.4;   // straight-line -> road distance factor (assumption)
  const VISIT = { restaurant: 60, cafe: 25, fast_food: 25, museum: 90, attraction: 45, park: 40, cinema: 150 };
  const modesFor = apt => MODES.filter(m => m.enabled || (m.airports && apt && (m.airports[apt.iata] || m.airports[apt.icao])));
  function tripMinutes(km, mode) { if (mode.id === "walk") return Math.round(km * ROAD / mode.kmh * 60); if (!mode.kmh) return null; return Math.round(km * ROAD / mode.kmh * 60 + mode.waitMin); }
  function plan(o) {   // o: {now, depMs, boardMin, secMin, places:[{c, km}], apt}
    const backBy = o.depMs - o.boardMin * 60e3, gateMin = Math.floor((backBy - o.now) / 60e3), outMin = gateMin - o.secMin;
    const modes = modesFor(o.apt);
    const items = (o.places || []).map(p => { const visit = VISIT[p.c] || 45, walk = modes.find(m => m.id === "walk"), ride = modes.find(m => m.id === "ride");
      const mode = walk && p.km <= walk.maxKm ? walk : ride, one = tripMinutes(p.km, mode), total = one * 2 + visit, slack = outMin - total;
      return { ...p, visit, mode: mode.id, oneWay: one, total, fit: slack >= Math.max(20, total * 0.25) ? "fits" : slack >= 0 ? "tight" : "nofit" }; });
    return { backBy, gateMin, outMin, items };
  }

  const api = Object.assign(core.make("flight", validate), { validate, parseFlight, IATA_ICAO, REGIONALS, distNm, bearing, gcPoints, inPoly, destPt, project, legs, liveLeg, userLeg, aptMatch,
    wxWords, readMetar, fromAwcMetar, tafWindow, fltCat, CAT_WORDS, sigmetsOnLeg, nasFor, faaCode, toMin, progress, assess, fmtMin, TURN_MIN, MODES, ROAD, VISIT, modesFor, tripMinutes, plan, LV });
  if (typeof module !== "undefined") module.exports = api; else root.YWFlight = api;
})(this);
