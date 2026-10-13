/* Ask Atlantis: client-side. Routes plan/trip sentences to the planners, otherwise answers from curated guide Q&A. */
(function () {
  const $ = id => document.getElementById(id), E = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" })[c]);
  const QA = window.YW_ASK || [], log = $("log");
  const isQuestion = q => /\?\s*$|^(what|how|when|where|why|is|are|can|should|do|does|which)\b/i.test(q.trim());
  function best(q) { return QA.map(x => [score(q, x), x]).filter(x => x[0] >= 2).sort((a, b) => b[0] - a[0]); }
  const words = s => s.toLowerCase().replace(/[^a-z0-9 -]/g, " ").split(/\s+/).filter(Boolean);
  function score(q, item) { const t = " " + q.toLowerCase() + " ", w = words(q); let n = 0;
    for (const k of item.k) n += k.includes(" ") ? (t.includes(k) ? 3 : 0) : (w.some(x => x === k || (k.length > 4 && x.startsWith(k))) ? 2 : 0);
    for (const x of words(item.q)) if (x.length > 3 && w.includes(x)) n += 1; return n; }
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); };
  function route(q) {
    const isQ = isQuestion(q);
    if (isQ) return null;
    const t = YWQuick.parseTrip(q, today()), p = YWQuick.parsePlan(q, today());
    const tripy = /\b(trip|travel|drive|driving|flying|fly to|road trip|vacation|from .+ to )\b/i.test(q);
    if (tripy && t.to) return { href: "/trip-planner/?q=" + encodeURIComponent(q), label: "Open the Trip Planner", text: `Sounds like a trip to <b>${E(t.to)}</b>${t.sd ? ` starting <b>${E(t.sd)}</b>` : ""}. I'll fill in the Trip Planner so you can send it to the app.` };
    if (p.loc || p.sd || p.alNamed) return { href: "/alert-planner/?q=" + encodeURIComponent(q), label: "Open the Alert Planner", text: `Let's set up a forecast plan${p.loc ? ` for <b>${E(p.loc)}</b>` : ""}${p.sd ? ` on <b>${E(p.sd)}</b>` : ""}. I'll fill in the Alert Planner so you can send it to the app.` };
    return null;
  }
  function add(cls, html) { const d = document.createElement("div"); d.className = "msg " + cls; d.innerHTML = html; log.appendChild(d); d.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  function ask(q) {
    q = q.trim(); if (!q) return; add("me", `<p>${E(q)}</p>`);
    const r = route(q);
    if (r) return add("bot", `<b>🌊 Atlantis</b><p>${r.text}</p><a class="btn dark" href="${r.href}">${r.label} →</a>`);
    const ranked = best(q);
    if (!ranked.length) return add("bot", `<b>🌊 Atlantis</b><p>I don't have a sourced answer for that yet. Try the <a href="/guides/">weather guides</a>, or describe a day out (like “boating on Lake Lanier Saturday”) and I'll set up alerts.</p>`);
    const [, a] = ranked[0], more = ranked.slice(1, 3).filter(x => x[1].u !== a.u);
    add("bot", `<b>🌊 Atlantis</b><p>${a.a}</p><p class="note">Source: <a href="${a.u}">${E(a.t === "More" ? "Your World Weather Radar" : a.t + " guide")}</a></p>` +
      (more.length ? `<div class="parsed">${more.map(x => `<button type="button" class="sug">${E(x[1].q)}</button>`).join("")}</div>` : ""));
  }
  window.YWAsk = { best, isQuestion, route };
  if (!log) { if (typeof module !== "undefined") module.exports = window.YWAsk; return; }   // used as a library (trip.html)
  $("askf").onsubmit = e => { e.preventDefault(); ask($("askq").value); $("askq").value = ""; };
  document.addEventListener("click", e => { if (e.target.classList.contains("sug")) ask(e.target.textContent); });
  const q0 = new URLSearchParams(location.search).get("q"); if (q0) ask(q0.slice(0, 300));
  if (typeof module !== "undefined") module.exports = { score, route };
})();
