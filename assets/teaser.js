/* FEEL THE LAUNCH teaser: a 15 s muted clip of a simulated practice run. preload="none", so nothing downloads until it
   plays. Tapping anywhere on the clip plays it from the start (inside the tap, so no browser blocks it). It autoplays muted
   once when mostly in view, unless the visitor asked for reduced motion or Data Saver. It never loops: at the end it
   stops on the end card with the Play button. The play icon stays visible until frames are actually playing. */
(function () {
  "use strict";
  if (typeof document === "undefined" || !document.querySelectorAll) return;
  const calm = () => { try { return (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) || !!(navigator.connection && navigator.connection.saveData); } catch (e) { return false; } };
  function init(box) {
    const v = box.querySelector("video"), hit = box.querySelector(".ftl-hit"), end = box.querySelector(".ftl-end"), again = box.querySelector(".ftl-again");
    if (!v || !hit || !end || box.dataset.ready) return;
    box.dataset.ready = "1";
    v.muted = true; v.defaultMuted = true; v.loop = false; v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", "");
    let timer = 0;
    const state = s => { box.classList.remove("is-idle", "is-loading", "is-playing", "is-ended"); box.classList.add("is-" + s);
      hit.setAttribute("aria-label", s === "playing" ? "Pause the teaser" : "Play the 15-second teaser"); };
    const fail = () => { clearTimeout(timer); if (!v.ended) state("idle"); };
    function play(fromStart) {
      end.hidden = true; state("loading");
      if (v.networkState === 3 /* NETWORK_NO_SOURCE */ || v.readyState === 0) { try { v.load(); } catch (e) {} }   // preload=none: start loading inside the tap
      if (fromStart) { try { v.currentTime = 0; } catch (e) {} }
      let p; try { p = v.play(); } catch (e) { fail(); return; }
      if (p && typeof p.then === "function") p.then(() => {}, fail);
      clearTimeout(timer); timer = setTimeout(() => { if (v.paused) fail(); }, 8000);        // never stuck on a hidden play icon
    }
    v.addEventListener("playing", () => { clearTimeout(timer); state("playing"); });
    v.addEventListener("waiting", () => { if (!v.paused) state("loading"); });
    v.addEventListener("pause", () => { if (!v.ended) state("idle"); });
    v.addEventListener("ended", () => { clearTimeout(timer); state("ended"); end.hidden = false; });
    v.addEventListener("error", fail, true);
    hit.addEventListener("click", e => {
      e.preventDefault();
      if (box.classList.contains("is-playing")) { v.pause(); return; }
      play(v.ended || v.currentTime < 0.2 || v.currentTime > v.duration - 0.3);
    });
    if (again) again.addEventListener("click", e => { e.preventDefault(); play(true); });
    state("idle");
    if (!calm() && "IntersectionObserver" in window) {
      let auto = false;
      const io = new IntersectionObserver(es => es.forEach(e => {
        if (e.isIntersecting && e.intersectionRatio >= 0.6 && !auto && box.classList.contains("is-idle") && v.currentTime === 0) { auto = true; play(true); }
        if (!e.isIntersecting && !v.paused) v.pause();                                       // scrolled away: pause; a tap resumes
      }), { threshold: [0, 0.6] });
      io.observe(box);
    }
  }
  const run = () => document.querySelectorAll(".ftl").forEach(init);
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", run) : run();
})();
