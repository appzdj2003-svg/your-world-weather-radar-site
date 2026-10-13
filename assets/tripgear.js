/* Trip Planner "Got your gear?" card. Rule-based from the trip the user entered (activity, travel mode, dates, length).
   This page has no forecast, so nothing here claims a forecast; it points to the app for the real forecast. */
(function (root) {
  const ITEMS = {
    jacket: ["Rain jacket", "Packable waterproof shell"], poncho: ["Poncho", "Covers you and a small pack"], umbrella: ["Umbrella", "Compact windproof"],
    boots: ["Waterproof boots", "For wet trails and docks"], drybag: ["Dry bag", "Keeps phone and papers dry"], rainsuit: ["Rain suit", "Jacket and pants for riding"],
    radio: ["NOAA weather radio", "Warnings with no cell signal"], crankradio: ["Crank weather radio", "No batteries or outlet needed"],
    powerbank: ["Power bank", "Keeps your phone alerts on"], lantern: ["Lantern", "Light for camp or outages"], headlamp: ["Headlamp", "Hands-free light"],
    lightning: ["Lightning detector", "Counts strikes and distance"], thermo: ["Thermometer", "Track temperature and humidity"],
    anemo: ["Pocket wind meter", "Wind, temperature and humidity"], kit: ["Emergency kit", "72-hour supplies for the car"], firstaid: ["First aid kit", "All-purpose kit"],
  };
  const OUT = ["HIKE", "CAMP", "BEACH", "FISH", "BOAT", "SKI", "EVENT"];
  function pick(st) {
    const out = [], add = (k, why) => { if (!out.some(o => o.k === k)) out.push({ k, why }); };
    const act = st.act, mode = st.mode, d = +st.d || 1, m = st.sd ? +String(st.sd).slice(5, 7) : 0;
    const warm = m >= 4 && m <= 9, cold = m === 12 || m <= 2 && m >= 1, hurr = m >= 6 && m <= 11;
    const water = ["BEACH", "FISH", "BOAT"].includes(act) || mode === "BOAT", open = ["MOTORCYCLE", "BIKE", "FOOT"].includes(mode);
    const road = ["CAR", "RV"].includes(mode) && (st.from || mode === "RV");
    if (act === "HIKE" || act === "CAMP") { add("jacket", "outdoor trip"); add("boots", "trails"); add("headlamp", "outdoor trip"); add("firstaid", "outdoor trip"); }
    if (act === "CAMP") { add("lantern", "camping"); add("crankradio", "camping, no power"); add("powerbank", "camping"); }
    if (water) { add("drybag", "on or near water"); add("radio", hurr ? "hurricane season (Jun–Nov)" : "on the water"); add("poncho", "on or near water"); }
    if (OUT.includes(act) && warm) add("lightning", "outdoors in thunderstorm season (Apr–Sep)");
    if (act === "SKI" || mode === "BOAT" || act === "BOAT") add("anemo", act === "SKI" ? "ski trip: wind chill" : "boating: wind");
    if (act === "SKI" || cold) add("thermo", act === "SKI" ? "ski & snow" : "winter dates (Dec–Feb)");
    if (open) { add("rainsuit", "riding or walking in the open"); add("drybag", "riding or walking in the open"); }
    if (road) { add("kit", mode === "RV" ? "RV trip" : "road trip"); add("firstaid", "road trip"); add("powerbank", "road trip"); }
    if (mode === "FLY" || ["SIGHTSEEING", "EVENT", "BUSINESS", "FAMILY"].includes(act)) add("umbrella", "city days");
    if (d >= 3) add("powerbank", `${d}-day trip`);
    if (!out.length) add("umbrella", "any trip");
    return out.slice(0, 6);
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function html(st) {
    const items = pick(st);
    return `<div class="tgear" id="tgear" role="region" aria-label="Gear suggestions"><button type="button" class="x" aria-label="Dismiss gear suggestions">×</button>
<h3>🎒 Got your gear?</h3><p class="note" style="margin:0">Picked from your trip details (type, travel, dates). Open the trip in the app for the actual forecast.</p>
<div class="tgrid">${items.map(o => `<a class="tgi" href="/gear/#g-${o.k}" data-k="${o.k}"><img src="/assets/items/${o.k}.webp" width="560" height="420" loading="lazy" alt=""><span><b>${esc(ITEMS[o.k][0])}</b>${esc(o.why)}</span></a>`).join("")}</div>
<p class="note"><a href="/gear/">See all weather gear →</a> · Gear page links to Amazon; we may earn a commission. <a href="/affiliate-disclosure.html">Disclosure</a></p></div>`;
  }
  function mount(st, el) {
    if (!el || !root.document || sessionStorage.getItem("yw_tgear_x")) return;
    el.insertAdjacentHTML("beforeend", html(st));
    const g = el.querySelector("#tgear"); g.querySelector(".x").onclick = () => { g.remove(); try { sessionStorage.setItem("yw_tgear_x", "1"); } catch (e) {} };
  }
  const api = { pick, html, mount, ITEMS };
  root.YWTripGear = api; if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : this);
