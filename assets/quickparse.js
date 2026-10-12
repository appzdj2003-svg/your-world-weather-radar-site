/* Quick Plan: one sentence -> plan or trip fields. Rule-based, runs in the browser, nothing is sent anywhere.
   Tests: node _src/tests/quickparse.test.js */
(function (root) {
  const MON = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11 };
  const DOW = { sun:0,mon:1,tue:2,tues:2,wed:3,thu:4,thur:4,thurs:4,fri:5,sat:6 };
  const pad = n => String(n).padStart(2, "0");
  const iso = d => d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  const day = s => new Date(s + "T00:00:00Z");
  const add = (d, n) => new Date(d.getTime() + n * 864e5);
  const diff = (a, b) => Math.round((b - a) / 864e5);
  function future(today, m, dd) { let d = new Date(Date.UTC(today.getUTCFullYear(), m, dd)); if (d < today) d = new Date(Date.UTC(today.getUTCFullYear() + 1, m, dd)); return d; }
  const MRX = "(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*\\.?";
  function dates(s, today) {
    let m, sd = null, ed = null, d = null;
    if ((m = s.match(new RegExp("\\b" + MRX + "\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|–|to|through|thru|until)\\s*(?:" + MRX + "\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\b")))) {
      sd = future(today, MON[m[1]], +m[2]); const em = m[3] ? MON[m[3]] : MON[m[1]];
      ed = new Date(Date.UTC(sd.getUTCFullYear() + (em < MON[m[1]] ? 1 : 0), em, +m[4]));
    } else if ((m = s.match(/\b(\d{1,2})\/(\d{1,2})\s*(?:-|–|to)\s*(?:(\d{1,2})\/)?(\d{1,2})\b/))) {
      sd = future(today, +m[1] - 1, +m[2]); const em = m[3] ? +m[3] - 1 : +m[1] - 1;
      ed = new Date(Date.UTC(sd.getUTCFullYear() + (em < +m[1] - 1 ? 1 : 0), em, +m[4]));
    } else if ((m = s.match(new RegExp("\\b" + MRX + "\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b")))) sd = future(today, MON[m[1]], +m[2]);
    else if ((m = s.match(/\b(\d{1,2})\/(\d{1,2})\b/))) sd = future(today, +m[1] - 1, +m[2]);
    else if (/\btoday|tonight|this (morning|afternoon|evening)\b/.test(s)) sd = today;
    else if (/\btomorrow\b/.test(s)) sd = add(today, 1);
    else if ((m = s.match(/\b(this|next)\s+weekend\b/)) || /\bweekend\b/.test(s)) {
      const dow = today.getUTCDay(); let toSat = (6 - dow + 7) % 7; if (dow === 0) toSat = -1;
      sd = add(today, toSat + (m && m[1] === "next" ? 7 : 0)); d = dow === 0 && !(m && m[1] === "next") ? 1 : 2;
      if (dow === 0 && m && m[1] === "next") sd = add(today, 6);
    } else if (/\bnext week\b/.test(s)) sd = add(today, ((8 - today.getUTCDay()) % 7) || 7);
    else if ((m = s.match(/\b(?:(next|this)\s+)?(sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)[a-z]*\b/))) {
      let n = (DOW[m[2]] - today.getUTCDay() + 7) % 7; if (n === 0) n = 7; sd = add(today, n);
    }
    if (ed) d = diff(sd, ed) + 1;
    if ((m = s.match(/\b(?:for\s+)?(\d{1,2}|a|one|two|three|four|five|six|seven)\s*(?:-\s*)?(day|night|week)s?\b/))) {
      const w = { a:1, one:1, two:2, three:3, four:4, five:5, six:6, seven:7 }; let n = w[m[1]] || +m[1];
      if (m[2] === "week") n *= 7; else if (m[2] === "night") n += 1; d = n;
    }
    return { sd: sd ? iso(sd) : null, d: d || (sd ? 1 : null) };
  }
  const STOP = "(?=\\s*(?:,|;|\\.|\\bon\\b|\\bfrom\\b|\\bfor\\b|\\bwith\\b|\\bby\\b|\\bthis\\b|\\bnext\\b|\\btoday\\b|\\btomorrow\\b|\\btonight\\b|\\bstarting\\b|\\bduring\\b|\\bvia\\b|\\bto\\b|\\b(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*day\\b|\\bthanksgiving|\\bchristmas|\\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s+\\d|\\d{1,2}\\/|\\balert|\\bwarn|\\bwatch|\\bnotify|\\btell|\\bdriv|\\bflying|$))";
  const PLACE = "([A-Za-z][A-Za-z .'-]*?(?:,\\s*[A-Za-z][A-Za-z .]*?)?)";
  const BAD = /^(my|me|us|a|an|our|your|this|next|that|some|weekend|week|day|days|night)\b/i;
  function grab(raw, words) {
    const rx = new RegExp("\\b(?:" + words + ")\\s+(?:the\\s+)?" + PLACE + STOP, "gi"), all = []; let m;
    while ((m = rx.exec(raw))) { const x = tidy(m[1]); if (x && !BAD.test(x)) all.push(x); rx.lastIndex = m.index + 2; }
    const pick = all.find(x => /^[A-Z]/.test(x)) || all[0] || null;
    if (!pick) return null;
    const [a, b] = pick.split(/,\s*/);   // keep "City, ST" but drop trailing clauses like ", rip currents"
    return b && /^[A-Z][A-Za-z.]*(?: [A-Z][a-z]+)?$/.test(b) ? a + ", " + b : a;
  }
  function tidy(p) { p = p.replace(/\s+/g, " ").trim().replace(/[ ,.]+$/, ""); return p.replace(/\b(the)\b\s*$/i, "").trim() || null; }
  function kw(s, table) { const out = []; for (const [k, rx] of table) if (rx.test(s) && !out.includes(k)) out.push(k); return out; }
  const PLAN_ACT = [["HIKE",/\b(hik|trail|backpack|climb|summit)/],["BOAT",/\b(boat|sail|kayak|paddl|canoe)/],["FISH",/\bfish/],["BEACH",/\b(beach|surf|swim)/],
    ["CAMP",/\bcamp/],["EVENT",/\b(wedding|game|concert|festival|party|bbq|picnic|parade|event|graduation)/],["COMMUTE",/\b(commut|drive to work|school run)/],["FLY",/\b(fly|flight|airport)/],["GARDEN",/\b(garden|plant|mow|lawn)/]];
  const ALERT = [["SEVERE",/\b(severe|storm|tornado|thunder)/],["RAIN",/\brain/],["LIGHTNING",/\blightning|thunder/],["WIND",/\bwind|gust/],["HEAT",/\bheat|hot\b/],["COLD",/\bcold|freez|frost/],
    ["SNOW",/\bsnow|ice\b|icy|winter storm/],["FLOOD",/\bflood/],["HURRICANE",/\bhurricane|tropical/],["MARINE",/\b(marine|small craft|wave|surf|rip current)/],["AIR",/\b(air quality|smoke|aqi)/]];
  const DEF = { GENERAL:["SEVERE","RAIN"], HIKE:["SEVERE","LIGHTNING","RAIN","HEAT"], BOAT:["SEVERE","WIND","MARINE","LIGHTNING"], FISH:["SEVERE","WIND","LIGHTNING"], BEACH:["SEVERE","LIGHTNING","MARINE","HEAT"],
    CAMP:["SEVERE","LIGHTNING","RAIN","COLD"], EVENT:["SEVERE","RAIN","LIGHTNING"], COMMUTE:["SEVERE","SNOW","FLOOD"], FLY:["SEVERE","SNOW","WIND"], GARDEN:["COLD","RAIN","HEAT"] };
  function parsePlan(text, todayIso) {
    const raw = String(text || ""), s = raw.toLowerCase(), today = day(todayIso || iso(new Date()));
    const act = kw(s, PLAN_ACT)[0] || "GENERAL", dt = dates(s, today);
    const named = kw(s, ALERT), al = named.length ? named : DEF[act];
    const loc = grab(raw, "in|near|at|around|on|over|for");
    const out = { act, al, alNamed: named.length > 0 };
    if (loc && !/^(the )?(weekend|week|day|days)$/i.test(loc)) out.loc = loc;
    if (dt.sd) { out.sd = dt.sd; out.d = dt.d; }
    out.missing = ["loc", "sd"].filter(k => !out[k]);
    return out;
  }
  const TRIP_ACT = [["SKI",/\b(ski|snowboard)/],["HIKE",/\b(hik|trail|backpack|national park)/],["BEACH",/\bbeach/],["CAMP",/\bcamp/],["FISH",/\bfish/],["BOAT",/\b(boat|cruise|sail)/],
    ["EVENT",/\b(wedding|game|concert|festival|reunion)/],["BUSINESS",/\b(business|work trip|conference|meeting)/],["FAMILY",/\b(family|grandma|grandparents|kids|visit(ing)? (mom|dad|my))/]];
  const MODE = [["RV",/\b(rv|camper|motorhome)\b/],["FLY",/\b(fly|flying|flight|plane)\b/],["MOTORCYCLE",/\b(motorcycle|bike ride on|harley)\b/],["BIKE",/\b(bik(e|ing)|cycl)/],["BOAT",/\b(boat|sail|ferry|cruise)\b/],["FOOT",/\b(walk|on foot|backpack)/],["CAR",/\b(driv|car|road trip)/]];
  function parseTrip(text, todayIso) {
    const raw = String(text || ""), s = raw.toLowerCase(), today = day(todayIso || iso(new Date()));
    const out = { act: kw(s, TRIP_ACT)[0] || "SIGHTSEEING", mode: kw(s, MODE)[0] || "CAR" };
    const dt = dates(s, today);
    const from = grab(raw, "from"), to = grab(raw, "to|in|into|at|near|around");
    const via = raw.match(/\bvia\s+([^.;]+?)(?=\s+(?:on|for|this|next|from|by)\b|[.;]|$)/i);
    if (to) out.to = to; if (from && from !== to) out.from = from;
    if (via) { const parts = via[1].split(/\s+and\s+|;\s*/).map(tidy).filter(Boolean); out.stops = parts; }
    if (dt.sd) { out.sd = dt.sd; out.d = dt.d; }
    out.missing = ["to", "sd"].filter(k => !out[k]);
    return out;
  }
  const api = { parsePlan, parseTrip, dates: (s, t) => dates(s.toLowerCase(), day(t)) };
  if (typeof module !== "undefined") module.exports = api; else root.YWQuick = api;
})(this);
