// Test-stand readouts for the SIMULATED static fire (made-up numbers, not telemetry).
// The full panels live in `mount` (below the stage on phones, side panels on wide screens); the stage only gets a
// small corner block (SIMULATED pill + T-clock + thrust) so nothing covers the rocket, tower or plume.
import { ENGINES, sfEvents } from "./staticfire.js";
const E = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const f = (v, d = 1) => (v == null || isNaN(v)) ? "—" : v.toFixed(d);
const clk = (t) => { const a = Math.abs(t), m = Math.floor(a / 60), s = a % 60; return (t < 0 ? "T-" : "T+") + String(m).padStart(2, "0") + ":" + s.toFixed(1).padStart(4, "0"); };

export function createSfHud(root, mount) {
  const mini = document.createElement("div"); mini.className = "sf-mini";
  mini.innerHTML = `<div class="sf-pill">⚠ SIMULATED · NOT REAL</div><div class="sf-mclk" id="sfMClk" hidden>T-00:20.0</div><div class="sf-mthr" id="sfMThr" hidden>0.0 MN · 0%</div>`;
  root.appendChild(mini);
  const mClk = mini.querySelector("#sfMClk"), mThr = mini.querySelector("#sfMThr");
  const el = document.createElement("div"); el.id = "sfHud"; el.setAttribute("aria-label", "Simulated static fire test data"); el.hidden = true;
  const dots = ENGINES.map((e, i) => `<circle id="sfE${i}" cx="${(e.x * 10).toFixed(1)}" cy="${(e.z * 10).toFixed(1)}" r="${e.g === 2 ? 3.6 : 3.9}"/>`).join("");
  el.innerHTML = `
  <div class="sfp sfL"><div class="sfTag">⚠ SIMULATED · NOT REAL</div><div class="sfH">SIM STATIC FIRE</div>
    <div class="sfClk" id="sfClk">T-00:20.0</div><div class="sfSt" id="sfSt">COUNT</div>
    <div class="sfK">THRUST</div><div class="sfV" id="sfThr">0.0 MN</div><div class="sfS" id="sfTf">0 tf</div>
    <div class="sfK">Pc AVG (min/max)</div><div class="sfV" id="sfPc">0 bar</div><div class="sfS" id="sfPcR">—</div>
    <div class="sfK">CLAMPS ×20</div><div class="sfV" id="sfCl">—</div>
    <div class="sfK">AFT VIB · ACOUSTIC</div><div class="sfV" id="sfVib">—</div><div class="sfS" id="sfDb">—</div></div>
  <div class="sfp sfR"><div class="sfTag">⚠ SIMULATED · NOT REAL</div><div class="sfH">RAPTORS <b id="sfLit">0/33</b></div>
    <svg viewBox="-42 -42 84 84" class="sfEng" aria-hidden="true"><circle r="41" class="rim"/>${dots}</svg>
    <div class="sfS" id="sfRings">C 0/3 · I 0/10 · O 0/20</div>
    <div class="sfK">LOX TANK</div><div class="sfS" id="sfLox">—</div>
    <div class="sfK">CH4 TANK</div><div class="sfS" id="sfCh4">—</div>
    <div class="sfK">ENGINE BAY</div><div class="sfS" id="sfBay">—</div>
    <div class="sfK">DELUGE</div><div class="sfS" id="sfDel">—</div>
    <div class="sfK" id="sfAmbK">AMBIENT</div><div class="sfS" id="sfAmb">—</div></div>
  <div class="sfp sfB"><div class="sfTag">⚠ SIMULATED · NOT REAL · made-up test data</div><div class="sfK">GSE <span id="sfGse"></span></div><div id="sfLog" class="sfLog"></div></div>`;
  (mount || root).appendChild(el);
  const $ = (id) => el.querySelector("#" + id), set = (id, v) => { const n = $(id); if (n._v !== v) { n._v = v; n.textContent = v; } };
  let events = [], logKey = "";
  return {
    el,
    show(on, run) { el.hidden = !on; mClk.hidden = mThr.hidden = !on; if (run) { events = sfEvents(run); logKey = ""; } },
    update(st) {
      set("sfClk", clk(st.t));
      const mc = clk(st.t), mt = f(st.thrustMN, 1) + " MN · " + Math.round(st.thrust * 100) + "%";
      if (mClk._v !== mc) { mClk._v = mc; mClk.textContent = mc; } if (mThr._v !== mt) { mThr._v = mt; mThr.textContent = mt; }
      set("sfSt", st.t < -16 ? "PROP LOAD" : st.t < 0 ? "TERMINAL COUNT" : st.t < 2.4 ? "STARTUP" : st.t < 8 ? "MAINSTAGE" : st.t < 9 ? "SHUTDOWN" : st.t < 30 ? "SAFING" : "TEST COMPLETE");
      set("sfThr", f(st.thrustMN, 1) + " MN"); set("sfTf", Math.round(st.thrustTf).toLocaleString("en-US") + " tf · " + Math.round(st.thrust * 100) + "%");
      set("sfPc", Math.round(st.pcAvg) + " bar"); set("sfPcR", st.pcAvg ? Math.round(st.pcMin) + " / " + Math.round(st.pcMax) + " bar" : "— / —");
      set("sfCl", (st.clampMN >= 0 ? "+" : "") + f(st.clampMN, 2) + " MN " + (st.clampMN >= 0 ? "TENS" : "COMP"));
      set("sfVib", f(st.vibG, 2) + " g rms"); set("sfDb", Math.round(st.dB) + " dB @1 km");
      const lit = [0, 0, 0]; for (let i = 0; i < 33; i++) { const r = st.r[i], c = i === st.out ? "out" : r > 0.85 ? "on" : r > 0.05 ? "spin" : "off", n = $("sfE" + i); if (r > 0.85) lit[ENGINES[i].g]++; if (n._c !== c) { n._c = c; n.setAttribute("class", c); } }
      set("sfLit", st.lit + "/33" + (st.out >= 0 ? " · 1 OUT" : "")); set("sfRings", `C${lit[0]}/3 I${lit[1]}/10 O${lit[2]}/20`);
      set("sfLox", `${f(st.lox.p, 2)}bar ${f(st.lox.lvl, 1)}% ${f(st.lox.K, 1)}K`);
      set("sfCh4", `${f(st.ch4.p, 2)}bar ${f(st.ch4.lvl, 1)}% ${f(st.ch4.K, 1)}K`);
      set("sfBay", `${Math.round(st.engBayK)} K · ${st.engBayK > 370 ? "WARM" : "NOMINAL"}`);
      set("sfDel", `${f(st.delugeM3s, 1)} m³/s · tank ${f(st.waterPct, 0)}%`);
      const a = st.amb; set("sfAmbK", a.real ? `AMBIENT · ${a.station || "METAR"} REAL` : "AMBIENT · SIM");
      set("sfAmb", `${f(a.tempC, 0)}°C · ${a.wdir ?? "VRB"}° ${a.wkt ?? "—"} kt`);
      set("sfGse", st.gse);
      const shown = events.filter(e => e[0] <= st.t + 1e-6), key = shown.length + "";
      if (key !== logKey) { logKey = key; $("sfLog").innerHTML = shown.slice(-5).map(e => `<div><span>${E(clk(e[0]))}</span> ${E(e[1])}</div>`).join(""); }
    },
  };
}
