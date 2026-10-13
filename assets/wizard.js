/* Shared one-question-per-screen wizard for plan.html and trip.html. */
(function (root) {
  const $ = id => document.getElementById(id), E = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" })[c]);
  const todayIso = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); };
  function run(cfg) {
    const st = Object.assign({ v: 1 }, cfg.defaults()); let i = 0;
    const box = $("wiz"), steps = cfg.steps;
    function render() {
      const s = steps[i], last = i === steps.length;
      $("prog").style.width = Math.round((i / steps.length) * 100) + "%";
      if (last) return finish();
      let h = `<div class="step"><p class="note">Step ${i + 1} of ${steps.length}</p><h2>${E(s.q)}</h2>`;
      if (s.kind === "text") h += `<input type="text" id="f" value="${E(st[s.key] || "")}" placeholder="${E(s.ph || "")}" autocomplete="off">${s.hint ? `<p class="note">${E(s.hint)}</p>` : ""}`;
      if (s.kind === "dates") h += `<div class="row"><label>Start<input type="date" id="sd" value="${E(st.sd || todayIso())}" min="${todayIso()}"></label><label>Days<input type="number" id="d" min="1" max="${s.max}" value="${E(st.d || 1)}"></label></div><p class="note">${E(s.hint || "")}</p>`;
      if (s.kind === "one" || s.kind === "many") {
        const cur = s.kind === "many" ? (st[s.key] || []) : [st[s.key]];
        h += `<div class="chips">` + s.opts.map(([k, t, sub]) => `<button type="button" class="chip" data-k="${k}" aria-pressed="${cur.includes(k)}">${E(t)}${sub ? `<small>${E(sub)}</small>` : ""}</button>`).join("") + `</div>`;
      }
      h += `<p class="err" id="err"></p><div class="nav2"><button class="btn" id="back" ${i ? "" : "disabled"}>Back</button><button class="btn dark" id="next">${i === steps.length - 1 ? "Make my link" : "Next"}</button></div></div>`;
      box.innerHTML = h;
      box.querySelectorAll(".chip").forEach(b => b.onclick = () => {
        if (s.kind === "one") { st[s.key] = b.dataset.k; box.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", x === b)); if (s.auto !== false) setTimeout(next, 160); }
        else { const a = st[s.key] = st[s.key] || []; const k = b.dataset.k, j = a.indexOf(k); j < 0 ? a.push(k) : a.splice(j, 1); b.setAttribute("aria-pressed", j < 0); }
      });
      $("back").onclick = () => { i = Math.max(0, i - 1); render(); };
      $("next").onclick = next;
      const f = box.querySelector("input"); if (f && s.kind === "text") { f.focus(); f.onkeydown = e => { if (e.key === "Enter") next(); }; }
    }
    function next() {
      const s = steps[i];
      if (s.kind === "text") { const v = $("f").value.trim(); if (!v && !s.optional) return $("err").textContent = "Please fill this in."; st[s.key] = v; }
      if (s.kind === "dates") { st.sd = $("sd").value; st.d = Math.max(1, Math.min(s.max, parseInt($("d").value, 10) || 1)); if (!st.sd) return $("err").textContent = "Pick a start date."; }
      if (s.kind === "many" && s.min && !(st[s.key] || []).length) return $("err").textContent = "Pick at least one.";
      if (s.after) s.after(st);
      i++; render();
    }
    async function finish() {
      $("prog").style.width = "100%";
      let tok; try { tok = await cfg.codec.encode(cfg.pack(st)); } catch (e) { box.innerHTML = `<p class="err">${E(e.message)}</p>`; return; }
      const url = cfg.codec.webUrl(tok), android = /Android/i.test(navigator.userAgent);
      box.innerHTML = `<div class="step" id="plan-result"><h2>${E(cfg.doneTitle)} <button type="button" class="lsay" data-say="#plan-result" aria-label="Listen to this plan" title="Listen">🔊</button></h2><div class="sum">${cfg.summary(st).map(([k, v]) => `<div><span class="dim">${E(k)}</span><b>${E(v)}</b></div>`).join("")}</div>
        ${android ? `<div class="btns"><a class="btn primary" href="${E(cfg.codec.intentUrl(tok))}">Open in the app</a></div>` : `<p class="note" style="text-align:center;margin-top:18px">Scan with your Android phone to open it there.</p><div class="qr" id="qr"></div>`}
        <p class="note">Your link (everything is inside the link itself; nothing is uploaded):</p><div class="linkbox" id="lk">${E(url)}</div>
        <div class="btns"><a class="btn dark" href="${E(cfg.codec.PLAY)}" target="_blank" rel="noopener">Get the app on Google Play</a></div><div class="btns"><button class="btn" id="copy">Copy link</button>${navigator.share ? `<button class="btn" id="share">Share</button>` : ""}<button class="btn" id="again">Start over</button></div>
        <p class="note">${cfg.appNote}</p></div>`;
      if (!android && root.qrcode) { const q = qrcode(0, "L"); q.addData(url); q.make(); $("qr").innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); }
      $("copy").onclick = () => navigator.clipboard.writeText(url).then(() => $("copy").textContent = "Copied ✓");
      if ($("share")) $("share").onclick = () => navigator.share({ title: cfg.doneTitle, url });
      $("again").onclick = () => { Object.keys(st).forEach(k => delete st[k]); Object.assign(st, { v: 1 }, cfg.defaults()); i = 0; history.replaceState(null, "", location.pathname); render(); };
      history.replaceState(null, "", "#" + tok);
    }
    // Quick plan
    $("qgo").onclick = () => {
      const pre = cfg.preQuick && cfg.preQuick($("qtext").value); if (pre) { $("qout").innerHTML = pre; return; }
      const r = cfg.parse($("qtext").value, todayIso()); Object.keys(r).forEach(k => { if (k !== "missing" && k !== "alNamed") st[k] = r[k]; });
      $("qout").innerHTML = cfg.chipsFor(r).map(c => `<span>${E(c)}</span>`).join("") + (r.missing.length ? `<span style="background:#FEF3C7;color:#92400E">Still need: ${E(r.missing.map(m => cfg.missingName[m]).join(", "))}</span>` : "");
      const firstMissing = steps.findIndex(s => r.missing.includes(s.key) || (s.kind === "dates" && r.missing.includes("sd")));
      i = firstMissing >= 0 ? firstMissing : steps.length; render();
    };
    $("qtext").onkeydown = e => { if (e.key === "Enter") $("qgo").click(); };
    // Opened with an existing link: show it.
    if (location.hash.startsWith("#v1.")) cfg.codec.decode(location.hash).then(o => { Object.assign(st, o); i = steps.length; render(); }).catch(() => render());
    else { render(); const q = new URLSearchParams(location.search).get("q"); if (q) { $("qtext").value = q.slice(0, 300); $("qgo").click(); } }
  }
  root.YWWizard = { run, E };
})(this);
