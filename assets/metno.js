/* MET Norway Locationforecast 2.0 -> the Trip Planner's daily forecast shape (same fields as YWTripCore.days for NWS).
   Data: MET Norway (Norwegian Meteorological Institute), CC BY 4.0 / NLOD 2.0, https://api.met.no/.
   Only values MET actually returns are used. Outside the Nordic region MET usually has no rain chance, thunder chance or
   wind gusts; those stay null and the page says "not available" (never estimated). Daily highs/lows, rain totals and wind are
   summaries of MET's own hourly and 6-hour values, and the weather words come from MET's symbol codes. */
(function (root) {
  "use strict";
  const SYM = { clearsky: "Clear sky", fair: "Fair", partlycloudy: "Partly cloudy", cloudy: "Cloudy", fog: "Fog",
    lightrainshowers: "Light rain showers", rainshowers: "Rain showers", heavyrainshowers: "Heavy rain showers",
    lightrainshowersandthunder: "Light rain showers and thunder", rainshowersandthunder: "Rain showers and thunder", heavyrainshowersandthunder: "Heavy rain showers and thunder",
    lightsleetshowers: "Light sleet showers", sleetshowers: "Sleet showers", heavysleetshowers: "Heavy sleet showers",
    lightssleetshowersandthunder: "Light sleet showers and thunder", sleetshowersandthunder: "Sleet showers and thunder", heavysleetshowersandthunder: "Heavy sleet showers and thunder",
    lightsnowshowers: "Light snow showers", snowshowers: "Snow showers", heavysnowshowers: "Heavy snow showers",
    lightssnowshowersandthunder: "Light snow showers and thunder", snowshowersandthunder: "Snow showers and thunder", heavysnowshowersandthunder: "Heavy snow showers and thunder",
    lightrain: "Light rain", rain: "Rain", heavyrain: "Heavy rain", lightrainandthunder: "Light rain and thunder", rainandthunder: "Rain and thunder", heavyrainandthunder: "Heavy rain and thunder",
    lightsleet: "Light sleet", sleet: "Sleet", heavysleet: "Heavy sleet", lightsleetandthunder: "Light sleet and thunder", sleetandthunder: "Sleet and thunder", heavysleetandthunder: "Heavy sleet and thunder",
    lightsnow: "Light snow", snow: "Snow", heavysnow: "Heavy snow", lightsnowandthunder: "Light snow and thunder", snowandthunder: "Snow and thunder", heavysnowandthunder: "Heavy snow and thunder" };
  const base = c => String(c || "").replace(/_(day|night|polartwilight)$/, "");
  const symText = c => SYM[base(c)] || null;
  const SEV = c => { c = base(c); return /thunder/.test(c) ? 6 : /heavy/.test(c) ? 5 : /snow|sleet/.test(c) ? 4 : /rain/.test(c) ? (/light/.test(c) ? 2 : 3) : c === "fog" ? 1 : 0; };
  /* MET asks for at most 4 decimals ("truncate all coordinates to max 4 decimals"). */
  const coord = x => String(Math.trunc(+x * 1e4) / 1e4);
  const url = (baseUrl, lat, lon) => `${baseUrl}?lat=${coord(lat)}&lon=${coord(lon)}`;
  const F = c => c == null ? null : Math.round(c * 9 / 5 + 32);
  const MPH = ms => ms == null ? null : Math.round(ms * 2.23694);
  const IN = mm => Math.round(mm / 25.4 * 100) / 100;
  /* UTC ISO time -> {date:"YYYY-MM-DD", h} in the destination's IANA time zone */
  function local(t, tz) {
    const p = {}; new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(t)).forEach(x => p[x.type] = x.value);
    return { date: `${p.year}-${p.month}-${p.day}`, h: +p.hour % 24 };
  }
  const mx = (a, b) => a == null ? b : b == null ? a : Math.max(a, b), mn = (a, b) => a == null ? b : b == null ? a : Math.min(a, b);
  function days(json, tz) {
    const ts = (json && json.properties && json.properties.timeseries) || [], by = {}, order = [];
    let covered = 0;   // ms up to which precipitation has been counted (no double counting of 1h and 6h blocks)
    for (const s of ts) {
      const t = Date.parse(s.time), L = local(s.time, tz), d = by[L.date] || (order.push(L.date), by[L.date] = { date: L.date, hiC: null, loC: null, mm: 0, mmN: 0, pop: null, thunderPct: null, gust: null, windMs: null, sym: null, symH: -1, symSev: 0, codes: [], day: false });
      const i = (s.data && s.data.instant && s.data.instant.details) || {}, n1 = s.data.next_1_hours, n6 = s.data.next_6_hours, n12 = s.data.next_12_hours;
      d.hiC = mx(d.hiC, i.air_temperature); d.loC = mn(d.loC, i.air_temperature);
      if (n6 && n6.details) { d.hiC = mx(d.hiC, n6.details.air_temperature_max); d.loC = mn(d.loC, n6.details.air_temperature_min); }
      d.windMs = mx(d.windMs, i.wind_speed); d.gust = mx(d.gust, i.wind_speed_of_gust);
      for (const n of [n1, n6, n12]) if (n && n.details) { d.pop = mx(d.pop, n.details.probability_of_precipitation); d.thunderPct = mx(d.thunderPct, n.details.probability_of_thunder); }
      if (t >= covered) {
        const blk = n1 && n1.details && n1.details.precipitation_amount != null ? [n1, 36e5] : n6 && n6.details && n6.details.precipitation_amount != null ? [n6, 216e5] : null;
        if (blk) { d.mm += blk[0].details.precipitation_amount; d.mmN++; covered = t + blk[1]; }
      }
      const sum = (n1 || n6 || n12 || {}).summary; if (sum && sum.symbol_code) {
        if (L.h >= 6 && L.h < 21) d.day = true;
        if (L.h >= 6 && L.h <= 18) d.codes.push(sum.symbol_code);
        const dist = Math.abs(L.h - 12);   // the day's headline symbol: MET's symbol closest to midday (6-hour where available)
        if (L.h >= 6 && L.h <= 18 && (d.symH < 0 || dist < Math.abs(d.symH - 12) || dist === Math.abs(d.symH - 12) && n6)) { d.sym = (n6 && n6.summary || sum).symbol_code; d.symH = L.h; }
        if (!d.sym && !d.night) d.night = sum.symbol_code;
      }
    }
    const out = [];
    order.forEach((k, idx) => {
      const d = by[k]; if (!d.day && idx > 0) return;   // drop trailing partial days with no daytime data
      const code = d.sym || d.night, all = d.codes.concat(code ? [code] : []).map(base).join(" ");
      const r = { date: d.date, src: "metno", hi: d.day ? F(d.hiC) : null, lo: F(d.loC), pop: d.pop == null ? null : Math.round(d.pop),
        thunderPct: d.thunderPct == null ? null : Math.round(d.thunderPct), gust: MPH(d.gust), wind: MPH(d.windMs) || 0,
        precipMm: d.mmN ? Math.round(d.mm * 10) / 10 : null, precipIn: d.mmN ? IN(d.mm) : null,
        short: symText(code) || "Forecast", detail: "", name: "", nightOnly: !d.day, symbol: code || null,
        thunder: /thunder/.test(all) || d.thunderPct != null && d.thunderPct >= 30, snow: /snow|sleet/.test(all) };
      out.push(r);
    });
    return out;
  }
  /* Which MET fields this forecast actually has (for the "not available" labels). */
  function fields(ds) {
    const has = k => (ds || []).some(d => d[k] != null);
    return { pop: has("pop"), thunderPct: has("thunderPct"), gust: has("gust"), precip: has("precipMm") };
  }
  function tzFor(place, rows, data) {
    if (!place || !data || !data.tz || !data.z) return null;
    const i = rows.indexOf(place); return i >= 0 && data.tz[data.z[i]] || null;
  }
  const ATTR = 'Weather data from <a href="https://www.met.no/en" target="_blank" rel="noopener">MET Norway</a> (Norwegian Meteorological Institute), <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>. Daily values are summarized by us from MET\'s hourly and 6-hour forecast.';
  const api = { SYM, symText, sev: SEV, coord, url, local, days, fields, tzFor, ATTR };
  root.YWMetno = api; if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : this);
