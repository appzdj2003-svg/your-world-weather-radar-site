/* Forecast & Alert Plan link: /plan#v1.<data>. Spec: docs/APP_LINK_SPEC.md
   {v:1, loc, lat?, lon?, act, sd, d, al:[alert keys], tz?} */
(function (root) {
  const core = typeof module !== "undefined" ? require("./codec-core.js") : root.YWCore;
  const ACTS = ["GENERAL","HIKE","BOAT","FISH","BEACH","CAMP","EVENT","COMMUTE","FLY","GARDEN"];
  const ALERTS = ["SEVERE","RAIN","LIGHTNING","WIND","HEAT","COLD","SNOW","FLOOD","HURRICANE","MARINE","AIR"];
  const MAX_DAYS = 10;
  function validate(p) {
    if (!p || p.v !== 1) throw new Error("Unsupported plan version");
    if (!p.loc && !(isFinite(p.lat) && isFinite(p.lon))) throw new Error("Missing place");
    if (!core.isDate(p.sd)) throw new Error("Missing start date");
    if (!ACTS.includes(p.act)) p.act = "GENERAL";
    p.d = Math.min(MAX_DAYS, Math.max(1, parseInt(p.d, 10) || 1));
    p.al = (p.al || []).filter(a => ALERTS.includes(a));
    if (p.lat != null) p.lat = Math.round(+p.lat * 100) / 100;
    if (p.lon != null) p.lon = Math.round(+p.lon * 100) / 100;
    return p;
  }
  const api = Object.assign(core.make("plan", validate), { validate, ACTS, ALERTS, MAX_DAYS });
  if (typeof module !== "undefined") module.exports = api; else root.YWPlan = api;
})(this);
