/* Trip Planner core logic (no DOM). Destination search over assets/places.json (GeoNames, CC BY 4.0), NWS forecast -> daily
   weather + risk, best-weather dates, day-by-day plan, prefilled outbound searches, and Ask Atlas intents.
   Everything runs in the browser. Tests: node _src/tests/tripcore.test.js */
(function (root) {
  const pad = n => String(n).padStart(2, "0");
  const iso = d => d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  const addDays = (s, n) => iso(new Date(Date.parse(s + "T00:00:00Z") + n * 864e5));
  const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
  const DOWS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmt = s => { const d = new Date(s + "T00:00:00Z"); return `${DOWS[d.getUTCDay()]} ${MONS[d.getUTCMonth()]} ${d.getUTCDate()}`; };
  const fmtRange = (sd, d) => d > 1 ? `${fmt(sd)} – ${fmt(addDays(sd, d - 1))}` : fmt(sd);
  const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[‘’'`.]/g, "").replace(/[^a-z0-9,]+/g, " ").replace(/\s*,\s*/g, ",").trim();

  /* ---------- places ---------- */
  const label = r => r[0] + ", " + r[1];
  const rank = r => (r[5] || 60000) * (r[2] === "US" ? 4 : 1);   // parks have no population; US places first for a US audience
  function split(q) { const n = norm(q), i = n.indexOf(","); return i < 0 ? [n, ""] : [n.slice(0, i).trim(), n.slice(i + 1).trim()]; }
  function regionOk(r, reg) { if (!reg) return true; const a = norm(r[1]), c = r[2].toLowerCase();
    return a.startsWith(reg) || c === reg || (reg === "usa" || reg === "us" || reg === "united states") && r[2] === "US"; }
  function suggest(rows, q, n = 6) {
    const [city, reg] = split(q); if (city.length < 2) return [];
    const out = [], seen = new Set();
    for (const r of rows) {
      const a = norm(r[0]), b = r[6] ? norm(r[6]) : "";
      if (!(a.startsWith(city) || b.startsWith(city)) || !regionOk(r, reg)) continue;
      const k = label(r); if (seen.has(k)) continue; seen.add(k); out.push(r);
    }
    const exact = r => (norm(r[0]) === city || (r[6] && norm(r[6]) === city)) ? 1 : 0;
    return out.sort((x, y) => exact(y) - exact(x) || rank(y) - rank(x)).slice(0, n);
  }
  function resolve(rows, text) {   // free text -> best exact match (or "<name> National Park"), else null
    const [city, reg] = split(text); if (!city) return null;
    const names = [city, city + " national park", city.replace(/ national park$/, "") + " national park"];
    let best = null;
    for (const r of rows) {
      const a = norm(r[0]), b = r[6] ? norm(r[6]) : "";
      if (!(names.includes(a) || (b && names.includes(b))) || !regionOk(r, reg)) continue;
      if (!best || rank(r) > rank(best)) best = r;
    }
    return best;
  }
  const NWS_CC = ["US", "PR", "GU", "VI", "AS", "MP"];
  const hasNws = r => !!r && NWS_CC.includes(r[2]);

  /* ---------- NWS forecast -> days ---------- */
  const mph = s => Math.max(0, ...String(s || "").match(/\d+/g)?.map(Number) || [0]);
  function emoji(t, night) { t = String(t).toLowerCase();
    if (/thunder|t-storm/.test(t)) return "⛈️"; if (/snow|flurr|blizzard/.test(t)) return "🌨️"; if (/sleet|freezing|ice/.test(t)) return "🧊";
    if (/rain|shower|drizzle/.test(t)) return "🌧️"; if (/fog|haze|smoke/.test(t)) return "🌫️"; if (/wind|breezy|blustery/.test(t)) return "💨";
    if (/partly|mostly sunny|mostly clear/.test(t)) return night ? "☁️" : "⛅"; if (/cloud|overcast/.test(t)) return "☁️";
    if (/sunny|clear|fair/.test(t)) return night ? "🌙" : "☀️"; return "🌤️"; }
  function days(periods) {
    const by = {};
    for (const p of periods || []) {
      const date = String(p.startTime).slice(0, 10), d = by[date] = by[date] || { date, pop: 0, wind: 0, texts: [] };
      const pr = (p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value) || 0;
      d.pop = Math.max(d.pop, pr); d.wind = Math.max(d.wind, mph(p.windSpeed)); d.texts.push(p.shortForecast || "");
      if (p.isDaytime) { d.hi = p.temperature; d.short = p.shortForecast; d.detail = p.detailedForecast; d.name = p.name; }
      else { d.lo = p.temperature; if (!d.short) { d.short = p.shortForecast; d.detail = p.detailedForecast; d.name = p.name; d.nightOnly = true; } }
    }
    return Object.values(by).sort((a, b) => a.date < b.date ? -1 : 1).map(d => {
      const all = d.texts.join(" ").toLowerCase();
      d.thunder = /thunder|t-storm/.test(all); d.snow = /snow|flurr|blizzard|sleet|freezing/.test(all); d.icon = emoji(d.short, d.nightOnly);
      d.risk = risk(d); delete d.texts; return d;
    });
  }
  function risk(d) {
    if (d.pop == null) {   // MET Norway outside the Nordics: no rain chance, so use MET's own symbols and rain amount (never a made-up %)
      const mm = d.precipMm || 0;
      if (d.thunder) return { k: "storm", t: "Thunder in the forecast" };
      if (d.snow && mm >= 1) return { k: "snow", t: "Snow or sleet forecast" };
      if (mm >= 5) return { k: "rain", t: "Rain forecast" };
      if (mm >= 1) return { k: "maybe", t: "Some rain forecast" };
    }
    else if (d.thunder && d.pop >= 20) return { k: "storm", t: "Storms possible" };
    if (d.pop != null && d.snow && d.pop >= 30) return { k: "snow", t: "Snow or ice possible" };
    if (d.pop != null && d.pop >= 50) return { k: "rain", t: "Rain likely" };
    if (d.pop != null && d.pop >= 30) return { k: "maybe", t: "Chance of rain" };
    if (d.hi != null && d.hi >= 95) return { k: "heat", t: "Very hot" };
    if (d.lo != null && d.lo <= 25 || d.hi != null && d.hi <= 32) return { k: "cold", t: "Freezing" };
    if (d.wind >= 25) return { k: "wind", t: "Windy" };
    return { k: "good", t: "Looks good" };
  }
  function score(d) {   // 0..100, higher is better for being outside
    let s = 100 - (d.pop != null ? d.pop * 0.8 : Math.min(80, (d.precipMm || 0) * 5));   // MET without rain chance: ranked by MET's rain amount
    if (d.thunder) s -= 20; if (d.snow) s -= 10; if (d.wind >= 20) s -= (d.wind - 15);
    if (d.hi != null) { if (d.hi >= 92) s -= (d.hi - 88) * 2; if (d.hi <= 40) s -= (45 - d.hi); }
    return Math.max(0, Math.min(100, Math.round(s)));
  }
  function bestWindow(ds, n) {   // best run of n consecutive forecast days (n capped to what's available)
    const full = ds.filter(d => !d.nightOnly); n = Math.max(1, Math.min(n, full.length)); if (!full.length) return null;
    let best = null;
    for (let i = 0; i + n <= full.length; i++) {
      const run = full.slice(i, i + n); if (daysBetween(run[0].date, run[n - 1].date) !== n - 1) continue;
      const s = run.reduce((a, d) => a + score(d), 0) / n;
      if (!best || s > best.s) best = { sd: run[0].date, d: n, s: Math.round(s) };
    }
    return best;
  }

  function windowScore(ds, sd, n) {   // average score of the trip's own days that are in the forecast, or null
    const end = addDays(sd, Math.max(1, n) - 1), w = (ds || []).filter(d => !d.nightOnly && d.date >= sd && d.date <= end);
    return w.length === Math.max(1, n) ? Math.round(w.reduce((a, d) => a + score(d), 0) / w.length) : null;
  }

  const rainTxt = w => w.pop != null ? `${w.pop}% chance` : w.precipIn != null ? `about ${w.precipIn} in of rain forecast` : "rain forecast";
  /* ---------- day-by-day plan ---------- */
  const OUTDOOR = ["HIKE", "BEACH", "SKI", "CAMP", "FISH", "BOAT", "EVENT", "SIGHTSEEING"];
  const ACT_TXT = { SIGHTSEEING: "sightseeing", HIKE: "a hike", BEACH: "the beach", SKI: "the slopes", CAMP: "camp", FISH: "fishing", BOAT: "the water", EVENT: "your event", BUSINESS: "meetings", FAMILY: "family time" };
  function itinerary(st, ds, place, todayIso) {
    const out = [], byDate = {}; (ds || []).forEach(d => byDate[d.date] = d);
    const n = Math.max(1, +st.d || 1), lastFc = ds && ds.length ? ds[ds.length - 1].date : null;
    for (let i = 0; i < n; i++) {
      const date = addDays(st.sd, i), w = byDate[date] || null, tips = [];
      if (i === 0 && st.from) tips.push(st.mode === "FLY" ? `Travel day from ${st.from}. Check your flight status before you leave.`
        : ["CAR", "RV", "MOTORCYCLE", "BIKE"].includes(st.mode) ? `Travel day: ${["MOTORCYCLE", "BIKE"].includes(st.mode) ? "ride" : "drive"} from ${st.from}. Check the radar along your route before you go.` : `Travel day from ${st.from}.`);
      else if (i === 0 && st.mode === "FLY") tips.push("Travel day. Check your flight status before you leave.");
      if (w) {
        const k = w.risk.k, a = ACT_TXT[st.act] || "your plans", outside = OUTDOOR.includes(st.act);
        if (k === "storm") tips.push(`${w.short}. Keep outdoor time flexible, and head indoors at the first rumble of thunder.`);
        else if (k === "snow") tips.push(`${w.short}. Allow extra time on the roads.`);
        else if (k === "rain") tips.push(`${w.short} (${rainTxt(w)}). ${outside ? "Have an indoor backup for " + a + "." : "Pack the umbrella."}`);
        else if (k === "maybe") tips.push(`${w.short} (${w.pop != null ? w.pop + "% chance of rain" : rainTxt(w)}). ${outside ? "A good day for " + a + ", with a rain layer handy." : "Bring a rain layer."}`);
        else if (k === "heat") tips.push(`Hot, up to ${w.hi}°F. ${outside ? "Go early, take breaks in the shade and bring plenty of water." : "Stay hydrated."}`);
        else if (k === "cold") tips.push(`Cold, ${w.lo != null ? "down to " + w.lo + "°F" : "near freezing"}. Dress in warm layers.`);
        else if (k === "wind") tips.push(`Windy, winds up to about ${w.wind} mph${st.act === "BOAT" || st.act === "FISH" || st.mode === "BOAT" ? ". Check the marine forecast before heading out" : ""}.`);
        else tips.push(`${w.short}. ${outside ? "A good day for " + a + "." : "Nice weather for getting around."}`);
      } else if (place && !hasNws(place) && !lastFc) tips.push("Open the trip in the app for this day's forecast.");
      else if (lastFc && date > lastFc || !lastFc && todayIso && daysBetween(todayIso, date) > 6) { const h = ds && ds.length && ds[0].src === "metno" ? 9 : 7; tips.push(`The forecast for this day appears about ${h} days ahead, from around ${fmt(addDays(date, -h))}.`); }
      if (i === n - 1 && n > 1) tips.push(st.from ? `Heading home to ${st.from}.` : "Last day of the trip.");
      out.push({ i: i + 1, date, label: fmt(date), w, tips });
    }
    return out;
  }

  /* ---------- outbound searches (no partnerships; plain prefilled links) ---------- */
  const q = encodeURIComponent;
  function links(st) {
    const to = st.to, from = st.from || "", sd = st.sd, n = Math.max(1, +st.d || 1), out = addDays(sd, Math.max(1, n - 1));
    const L = [];
    const flight = { k: "flights", ico: "✈️", t: "Flights", site: "Google Flights", href: "https://www.google.com/travel/flights?q=" + q(`Flights to ${to}${from ? " from " + from : ""} on ${sd}${n > 1 ? " through " + out : " oneway"}`) };
    const stays = { k: "stays", ico: "🏨", t: "Hotels", site: "Booking.com", href: `https://www.booking.com/searchresults.html?ss=${q(to)}&checkin=${sd}&checkout=${out}&group_adults=2&no_rooms=1` };
    const ghotels = { k: "hotels", ico: "🛏️", t: "Compare hotels", site: "Google Hotels", href: "https://www.google.com/travel/search?q=" + q(`Hotels in ${to}`) };
    const homes = { k: "homes", ico: "🏡", t: "Vacation rentals", site: "Airbnb", href: `https://www.airbnb.com/s/${q(to)}/homes?checkin=${sd}&checkout=${out}` };
    const cars = { k: "cars", ico: "🚗", t: "Rental cars", site: "Kayak", href: `https://www.kayak.com/cars/${q(to.replace(/,\s*/g, ",")).replace(/%2C/g, ",")}/${sd}/${out}` };
    const drive = { k: "directions", ico: "🧭", t: "Directions", site: "Google Maps", href: `https://www.google.com/maps/dir/?api=1&origin=${q(from)}&destination=${q(to)}&travelmode=${st.mode === "BIKE" ? "bicycling" : st.mode === "FOOT" ? "walking" : "driving"}` };
    const todo = { k: "todo", ico: "📍", t: "Things to do", site: "Google Maps", href: "https://www.google.com/maps/search/?api=1&query=" + q(`Things to do in ${to}`) };
    if (st.mode === "FLY") L.push(flight, stays, cars, homes, ghotels, todo);
    else if (from && ["CAR", "RV", "MOTORCYCLE", "BIKE", "FOOT"].includes(st.mode)) L.push(drive, stays, homes, ghotels, todo, flight);
    else L.push(stays, homes, flight, ghotels, cars, todo);
    return L;
  }

  /* ---------- Ask Atlas intents ---------- */
  const isBookingAsk = s => /\b(book|booking|reserve|reservation|buy|purchase|price|prices|cost|how much|cheap|cheapest|deal|deals|fare|fares)\b/i.test(s)
    && /\b(flight|flights|fly|plane|airfare|ticket|tickets|hotel|hotels|room|rooms|stay|airbnb|rental|car|cars|motel|resort)\b/i.test(s);
  function sourcedAnswer(text, parsed, ask) {   // non-trip weather question -> curated answer (from askdata) or a "no sourced answer" reply
    ask = ask || root.YWAsk; if (!ask || !String(text).trim()) return null;
    const tripish = (parsed.to || parsed.sd) && !ask.isQuestion(text); if (tripish) return null;
    const m = ask.best(text);
    if (!m.length) return ask.isQuestion(text) || !parsed.to ? { none: true } : null;
    return { a: m[0][1] };
  }
  function summary(ds, st) {   // weather across the trip's forecast days, for the packing list
    const inTrip = (ds || []).filter(d => d.date >= st.sd && d.date <= addDays(st.sd, Math.max(1, +st.d || 1) - 1));
    if (!inTrip.length) return null;
    const max = k => Math.max(...inTrip.map(d => d[k] == null ? -999 : d[k])), min = k => Math.min(...inTrip.map(d => d[k] == null ? 999 : d[k]));
    const hasPop = inTrip.some(d => d.pop != null), mm = inTrip.some(d => d.precipMm != null) ? max("precipMm") : null;
    const r = { n: inTrip.length, pop: hasPop ? max("pop") : null, thunder: inTrip.some(d => d.thunder),
      snow: inTrip.some(d => d.snow && (d.pop != null ? d.pop >= 30 : (d.precipMm || 0) >= 1)), hi: max("hi"), lo: min("lo"), wind: max("wind") };
    if (mm != null) { r.rainMm = mm; r.rainIn = Math.round(mm / 25.4 * 100) / 100; }   // MET Norway's daily rain amount (NWS gives a chance instead)
    return r;
  }
  const api = { windowScore, summary, iso, addDays, daysBetween, fmt, fmtRange, norm, label, suggest, resolve, hasNws, days, risk, score, bestWindow, itinerary, links, isBookingAsk, sourcedAnswer, emoji };
  root.YWTripCore = api; if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : this);
