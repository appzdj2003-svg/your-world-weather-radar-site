/* Your World Weather link codec core, v1: JSON (compact keys) -> UTF-8 -> deflate-raw -> base64url -> "v1.<data>" */
(function (root) {
  function b64u(bytes) { let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return (typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function unb64u(str) { str = str.replace(/-/g, "+").replace(/_/g, "/"); while (str.length % 4) str += "=";
    const s = typeof atob === "function" ? atob(str) : Buffer.from(str, "base64").toString("binary");
    const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
  async function pipe(bytes, Stream) { const r = new Blob([bytes]).stream().pipeThrough(new Stream("deflate-raw"));
    return new Uint8Array(await new Response(r).arrayBuffer()); }
  function clean(t) { const o = {}; for (const k in t) { const v = t[k];
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue; o[k] = v; } return o; }
  const PKG = "com.yourworld.weatheranalyzer", SITE = "https://weather.yourworldapps.si/";
  const PLAY = "https://play.google.com/store/apps/details?id=" + PKG + "&referrer=" + encodeURIComponent("utm_source=weathersite&utm_medium=link&utm_campaign=send_to_phone");
  function make(path, validate) {
    const api = {
      async encode(obj) { const json = JSON.stringify(clean(validate(Object.assign({}, obj))));
        return "v1." + b64u(await pipe(new TextEncoder().encode(json), CompressionStream)); },
      async decode(token) { token = String(token || "").replace(/^#/, "").trim();
        if (!token.startsWith("v1.")) throw new Error("Not a v1 link");
        return validate(JSON.parse(new TextDecoder().decode(await pipe(unb64u(token.slice(3)), DecompressionStream)))); },
      PKG, PLAY, WEB: SITE + path,
      webUrl: tok => SITE + path + "#" + tok,
      intentUrl: tok => "intent://" + path + "#" + tok + "#Intent;scheme=yourworldweather;package=" + PKG + ";S.browser_fallback_url=" + encodeURIComponent(PLAY) + ";end"
    };
    return api;
  }
  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
  const core = { make, clean, isDate };
  if (typeof module !== "undefined") module.exports = core; else root.YWCore = core;
})(this);
