/* Weather Trip link: /trip#v1.<data>. Spec: docs/APP_LINK_SPEC.md
   {v:1, from?, to, lat?, lon?, sd, d, act, mode, stops?:[names]} */
(function (root) {
  const core = typeof module !== "undefined" ? require("./codec-core.js") : root.YWCore;
  const ACTS = ["SIGHTSEEING","HIKE","BEACH","SKI","CAMP","FISH","BOAT","EVENT","BUSINESS","FAMILY"];
  const MODES = ["CAR","RV","FLY","BOAT","MOTORCYCLE","BIKE","FOOT"];
  const MAX_DAYS = 30;
  function validate(t) {
    if (!t || t.v !== 1) throw new Error("Unsupported trip version");
    if (!t.to && !(isFinite(t.lat) && isFinite(t.lon))) throw new Error("Missing destination");
    if (!core.isDate(t.sd)) throw new Error("Missing start date");
    if (!ACTS.includes(t.act)) t.act = "SIGHTSEEING";
    if (!MODES.includes(t.mode)) t.mode = "CAR";
    t.d = Math.min(MAX_DAYS, Math.max(1, parseInt(t.d, 10) || 1));
    if (t.stops) t.stops = t.stops.slice(0, 8).map(String);
    if (t.lat != null) t.lat = Math.round(+t.lat * 100) / 100;
    if (t.lon != null) t.lon = Math.round(+t.lon * 100) / 100;
    return t;
  }
  const api = Object.assign(core.make("trip", validate), { validate, ACTS, MODES, MAX_DAYS });
  if (typeof module !== "undefined") module.exports = api; else root.YWTrip = api;
})(this);
