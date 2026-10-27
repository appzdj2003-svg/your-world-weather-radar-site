/* Weather Trip link: /trip#v1.<data>. Spec: docs/APP_LINK_SPEC.md
   {v:1, from?, to, lat?, lon?, sd, d, act, mode, stops?:[names],
    fn?, fd?, fdep?, farr?, fndep?, ffrom?, fto?  // optional flight for Live trip view} */
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
    // Optional flight for Live trip view (same keys as /flight, prefixed with f* except fn).
    if (t.fn) {
      t.fn = String(t.fn).toUpperCase().replace(/\s/g, "").slice(0, 12);
      if (!/^[A-Z0-9]{2,8}\d{1,4}[A-Z]?$/.test(t.fn)) delete t.fn;
    }
    if (!t.fn) { delete t.fn; delete t.fd; delete t.fdep; delete t.farr; delete t.fndep; delete t.ffrom; delete t.fto; }
    else {
      if (t.fd && !core.isDate(t.fd)) delete t.fd;
      const isIso = s => typeof s === "string" && !isNaN(Date.parse(s));
      for (const k of ["fdep", "farr", "fndep"]) if (!isIso(t[k])) delete t[k];
      for (const k of ["ffrom", "fto"]) {
        if (t[k]) t[k] = String(t[k]).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
        if (!t[k]) delete t[k];
      }
    }
    return t;
  }
  const api = Object.assign(core.make("trip", validate), { validate, ACTS, MODES, MAX_DAYS });
  if (typeof module !== "undefined") module.exports = api; else root.YWTrip = api;
})(this);
