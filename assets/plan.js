/* Forecast & Alert Planner (plan.html) */
(function () {
  const ACT = [["GENERAL","Just weather"],["HIKE","Hiking"],["BOAT","Boating"],["FISH","Fishing"],["BEACH","Beach"],["CAMP","Camping"],["EVENT","Outdoor event"],["COMMUTE","Commute"],["FLY","Flight day"],["GARDEN","Garden"]];
  const AL = [["SEVERE","Severe storms","Watches & warnings"],["RAIN","Rain","Rain arriving soon"],["LIGHTNING","Lightning","Strikes nearby"],["WIND","Wind","Strong gusts"],["HEAT","Heat"],["COLD","Cold & frost"],["SNOW","Snow & ice"],["FLOOD","Flooding"],["HURRICANE","Hurricane","NHC tracks"],["MARINE","Marine","Waves, small craft"],["AIR","Air quality","Smoke, AQI"]];
  const DEF = { GENERAL:["SEVERE","RAIN"], HIKE:["SEVERE","LIGHTNING","RAIN","HEAT"], BOAT:["SEVERE","WIND","MARINE","LIGHTNING"], FISH:["SEVERE","WIND","LIGHTNING"], BEACH:["SEVERE","LIGHTNING","MARINE","HEAT"], CAMP:["SEVERE","LIGHTNING","RAIN","COLD"], EVENT:["SEVERE","RAIN","LIGHTNING"], COMMUTE:["SEVERE","SNOW","FLOOD"], FLY:["SEVERE","SNOW","WIND"], GARDEN:["COLD","RAIN","HEAT"] };
  const name = (L, k) => (L.find(x => x[0] === k) || [k, k])[1];
  YWWizard.run({
    codec: YWPlan, parse: YWQuick.parsePlan, doneTitle: "Your forecast plan is ready",
    defaults: () => ({ act: "GENERAL" }),
    missingName: { loc: "place", sd: "dates" },
    steps: [
      { key: "loc", kind: "text", q: "Where?", ph: "City, park, lake or ZIP", hint: "A town, a park or a ZIP code works." },
      { key: "act", kind: "one", q: "What are you doing?", opts: ACT, after: st => { if (!st._alTouched) st.al = DEF[st.act].slice(); } },
      { key: "sd", kind: "dates", q: "When?", max: 10, hint: "Up to 10 days, the same range as the app's forecast." },
      { key: "al", kind: "many", q: "Which alerts matter?", opts: AL, min: 1, after: st => st._alTouched = true },
    ],
    pack: st => ({ v: 1, loc: st.loc, act: st.act, sd: st.sd, d: st.d, al: st.al }),
    summary: st => [["Place", st.loc], ["Activity", name(ACT, st.act)], ["Dates", st.sd + (st.d > 1 ? ` · ${st.d} days` : "")], ["Alerts", (st.al || []).map(k => name(AL, k)).join(", ")]],
    chipsFor: r => [r.loc && "📍 " + r.loc, r.sd && "📅 " + r.sd + (r.d > 1 ? ` +${r.d - 1}d` : ""), "🏷 " + name(ACT, r.act), r.al && "🔔 " + r.al.map(k => name(AL, k)).join(", ")].filter(Boolean),
    appNote: "Open on your Android phone with Your World Weather Radar installed. If the app isn't installed yet, the link opens this page with a Google Play button.",
  });
})();
