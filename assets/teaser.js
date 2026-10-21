/* FEEL THE LAUNCH teaser: a 15 s muted clip of a simulated practice run. Nothing loads until it is near the screen
   (preload="none"); it autoplays muted once, only when mostly in view and the visitor hasn't asked for less motion or data.
   It never loops: at the end it stops on the end card with the Play button. */
(function () {
  "use strict";
  if (typeof document === "undefined" || !document.querySelectorAll) return;
  const calm = () => (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) || (navigator.connection && navigator.connection.saveData);
  function init(box) {
    const v = box.querySelector("video"), play = box.querySelector(".ftl-play"), end = box.querySelector(".ftl-end"), again = box.querySelector(".ftl-again");
    if (!v || !play || !end) return;
    v.muted = true; v.loop = false;
    let started = false;
    const go = () => { started = true; box.classList.add("playing"); end.hidden = true; play.hidden = true; const p = v.play(); if (p && p.catch) p.catch(() => { play.hidden = false; box.classList.remove("playing"); }); };
    play.addEventListener("click", go);
    if (again) again.addEventListener("click", () => { try { v.currentTime = 0; } catch (e) {} go(); });
    v.addEventListener("ended", () => { box.classList.remove("playing"); end.hidden = false; });
    v.addEventListener("error", () => { play.hidden = true; end.hidden = false; }, true);
    if (!calm() && "IntersectionObserver" in window) {
      const io = new IntersectionObserver(es => es.forEach(e => {
        if (e.isIntersecting && e.intersectionRatio >= 0.6 && !started) { io.disconnect(); go(); }
      }), { threshold: [0, 0.6] });
      io.observe(box);
      // pause when scrolled away; it resumes only by tapping play
      new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting && !v.paused) { v.pause(); play.hidden = false; box.classList.remove("playing"); } }), { threshold: 0 }).observe(box);
    }
  }
  const run = () => document.querySelectorAll(".ftl").forEach(init);
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", run) : run();
})();
