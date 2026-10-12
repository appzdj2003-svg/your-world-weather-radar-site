/* Weather Trip Planner (trip.html) */
(function () {
  const ACT = [["SIGHTSEEING","Sightseeing"],["HIKE","Hiking & parks"],["BEACH","Beach"],["SKI","Ski & snow"],["CAMP","Camping"],["FISH","Fishing"],["BOAT","Boating"],["EVENT","Event"],["BUSINESS","Business"],["FAMILY","Family visit"]];
  const MODE = [["CAR","Car","Road trip"],["RV","RV","Camper, motorhome"],["FLY","Flying"],["BOAT","Boat"],["MOTORCYCLE","Motorcycle"],["BIKE","Bicycle"],["FOOT","On foot"]];
  const name = (L, k) => (L.find(x => x[0] === k) || [k, k])[1];
  YWWizard.run({
    codec: YWTrip, parse: YWQuick.parseTrip, doneTitle: "Your weather trip is ready",
    defaults: () => ({ act: "SIGHTSEEING", mode: "CAR" }),
    missingName: { to: "destination", sd: "dates" },
    steps: [
      { key: "to", kind: "text", q: "Where are you headed?", ph: "Destination city or park" },
      { key: "from", kind: "text", q: "Starting from? (optional)", ph: "Leave blank to skip", optional: true, hint: "Add a start point so you can check the drive or flight there." },
      { key: "sd", kind: "dates", q: "When?", max: 30, hint: "Forecasts reach 10 days ahead; later days fill in as the trip gets closer." },
      { key: "act", kind: "one", q: "What kind of trip?", opts: ACT },
      { key: "mode", kind: "one", q: "How are you getting there?", opts: MODE },
    ],
    pack: st => ({ v: 1, from: st.from, to: st.to, sd: st.sd, d: st.d, act: st.act, mode: st.mode, stops: st.stops }),
    summary: st => [["Destination", st.to], st.from ? ["From", st.from] : null, st.stops && st.stops.length ? ["Stops", st.stops.join(", ")] : null, ["Dates", st.sd + (st.d > 1 ? ` · ${st.d} days` : "")], ["Trip", name(ACT, st.act)], ["Travel", name(MODE, st.mode)]].filter(Boolean),
    chipsFor: r => [r.to && "📍 " + r.to, r.from && "🚩 from " + r.from, r.stops && "↪ via " + r.stops.join(", "), r.sd && "📅 " + r.sd + (r.d > 1 ? ` +${r.d - 1}d` : ""), "🏷 " + name(ACT, r.act), "🚗 " + name(MODE, r.mode)].filter(Boolean),
    appNote: "Open on your Android phone with Your World Weather Radar installed. If the app isn't installed yet, the link opens this page with a Google Play button.",
  });
})();
