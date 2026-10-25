// Lite tier: 2D canvas launch (no WebGL). Light on memory and battery.
export function createLite(canvas) {
  const ctx = canvas.getContext("2d"); let W = 0, H = 0, dpr = 1;
  const puffs = [], stars = [...Array(140)].map(() => [Math.random(), Math.random() * 0.7, Math.random() * 1.4 + 0.3]);
  function resize(w, h) { dpr = Math.min(1.5, window.devicePixelRatio || 1); W = w; H = h; canvas.width = w * dpr; canvas.height = h * dpr; }
  function frame(s, o, dt) {
    const c = ctx; c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const day = o.day ?? 0, alt = s.alt || 0, sky = Math.max(0, 1 - alt / 60000);
    const shake = o.reduced ? 0 : 2 * Math.max(0, Math.min(1, o.shake ?? 0.5)) * Math.max(s.thrust1, s.thrust2) * (alt < 2000 ? 7 : 2) * (0.4 + (s.q || 0));
    c.save(); c.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    const gr = c.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, `rgb(${2 + 40 * day * sky},${6 + 80 * day * sky},${20 + 140 * day * sky})`);
    gr.addColorStop(0.8, `rgb(${20 + 160 * day * sky + 60 * (1 - day) * sky * 0.4},${30 + 150 * day * sky},${50 + 150 * day * sky})`);
    gr.addColorStop(1, `rgb(${40 + 150 * sky},${30 + 90 * sky},${40 + 60 * sky})`);
    c.fillStyle = gr; c.fillRect(-20, -20, W + 40, H + 40);
    c.fillStyle = "#fff"; for (const [x, y, r] of stars) { c.globalAlpha = Math.max(0, 0.9 - day * 1.4 * sky); c.fillRect(x * W, y * H, r, r); } c.globalAlpha = 1;
    // camera climbs with the rocket after liftoff
    const camUp = Math.min(alt, 900) * (H / 700), gy = H * 0.86 + camUp;
    c.fillStyle = "#06080c"; c.fillRect(-20, gy, W + 40, H);
    const SS = o.vehicle === "starship", lift = SS ? H * 0.045 : 0; // Starship: taller, wider, stands on a launch mount
    const rh = H * (SS ? 0.47 : 0.38), rw = rh * (SS ? 0.043 : 0.055), rx = W * (SS ? 0.56 : 0.5), ry = gy - Math.min(alt, 900) * (H / 700) * 0.15 - (alt > 900 ? 0 : 0);
    const by = alt < 900 ? gy - 4 - lift - alt * (H / 700) * 0.85 : H * 0.55;
    if (SS) drawStarbase(c, rx, gy, rw, rh, lift, W, day);
    else {
      const tx = W * 0.62; c.strokeStyle = "#1f2937"; c.lineWidth = 3; // tower
      for (let y = gy; y > gy - H * 0.42; y -= 18) { c.beginPath(); c.moveTo(tx, y); c.lineTo(tx + 26, y - 18); c.moveTo(tx + 26, y); c.lineTo(tx, y - 18); c.stroke(); }
      c.fillStyle = "#111827"; c.fillRect(tx - 3, gy - H * 0.42, 4, H * 0.42); c.fillRect(tx + 24, gy - H * 0.42, 4, H * 0.42);
    }
    if (o.sf && o.sf.deluge > 0) for (let i = 0; i < 2; i++) puffs.push({ x: rx + (Math.random() - 0.5) * rw * 6, y: gy - 2, vx: (Math.random() - 0.5) * 40, vy: -60 - Math.random() * 60, r: 3, a: 0.5 * o.sf.deluge });
    const th = Math.max(s.thrust1, s.thrust2);
    if (th > 0) { // flame
      const fl = rh * (0.35 + 0.25 * th) * (1 + alt / 30000) * (SS ? 0.8 : 1);
      const fg = c.createLinearGradient(0, by, 0, by + fl); fg.addColorStop(0, "rgba(255,255,240,1)"); fg.addColorStop(0.3, "rgba(255,190,90,.95)"); fg.addColorStop(1, "rgba(255,90,20,0)");
      const fw = SS ? 1.6 : 1; c.fillStyle = fg; c.beginPath(); c.moveTo(rx - rw * 0.8 * fw, by); c.quadraticCurveTo(rx - rw * 2.6 * fw, by + fl * 0.5, rx, by + fl); c.quadraticCurveTo(rx + rw * 2.6 * fw, by + fl * 0.5, rx + rw * 0.8 * fw, by); c.fill();
      const glow = c.createRadialGradient(rx, by + 10, 0, rx, by + 10, rh * 0.9); glow.addColorStop(0, `rgba(255,170,80,${0.45 * th})`); glow.addColorStop(1, "rgba(255,120,40,0)");
      c.fillStyle = glow; c.fillRect(0, 0, W, H);
      if (alt < 300 && Math.random() < 0.9) for (let i = 0; i < 3; i++) puffs.push({ x: rx + (Math.random() - 0.5) * 40, y: gy - 6, vx: (Math.random() - 0.5) * 220, vy: -Math.random() * 30, r: 14, a: 0.8 });
    }
    for (let i = puffs.length - 1; i >= 0; i--) { const p = puffs[i]; p.x += p.vx * dt; p.y += p.vy * dt + camUp * 0; p.vx *= 0.985; p.r += 26 * dt; p.a -= 0.05 * dt; if (p.a <= 0) { puffs.splice(i, 1); continue; }
      c.fillStyle = `rgba(${200 + 40 * th},${190 + 20 * th},${185},${p.a * 0.5})`; c.beginPath(); c.arc(p.x, p.y + camUp * 0.0, p.r, 0, 6.283); c.fill(); }
    if (puffs.length > 260) puffs.splice(0, puffs.length - 260);
    if (SS && !(s.t > (o.sep || 1e9) + 30)) drawStarship(c, rx, by, rw, rh);
    else if (!(s.t > (o.sep || 1e9) + 30)) { c.fillStyle = "#e5e7eb"; c.fillRect(rx - rw, by - rh, rw * 2, rh); c.fillStyle = "#111"; c.fillRect(rx - rw, by - rh * 0.4, rw * 2, rh * 0.06);
      c.beginPath(); c.moveTo(rx - rw * 1.3, by - rh); c.quadraticCurveTo(rx, by - rh * 1.22, rx + rw * 1.3, by - rh); c.fillStyle = "#f1f5f9"; c.fill(); }
    c.restore();
  }
  return { resize, frame, dispose() {} };
}
// Starship full stack, 2D: stainless booster + ship, hot-staging ring, grid fins, black tiles on one side, flaps
function drawStarship(c, rx, by, rw, rh) {
  const top = by - rh, bTop = by - rh * 0.59, sg = c.createLinearGradient(rx - rw, 0, rx + rw, 0);
  sg.addColorStop(0, "#8b9096"); sg.addColorStop(0.35, "#e2e5e9"); sg.addColorStop(0.7, "#b7bcc2"); sg.addColorStop(1, "#7a7f86");
  c.fillStyle = sg; c.fillRect(rx - rw, bTop, rw * 2, by - bTop);                            // booster
  c.fillStyle = "rgba(40,44,50,.35)"; c.fillRect(rx - rw, by - rh * 0.035, rw * 2, rh * 0.035); // darker aft skirt
  c.fillStyle = "rgba(60,64,70,.35)"; for (const k of [-0.55, 0.55]) c.fillRect(rx + rw * k - 0.75, bTop + rh * 0.04, 1.5, by - bTop - rh * 0.1); // chines
  c.fillStyle = "rgba(70,74,80,.25)"; for (let y = bTop + rh * 0.02; y < by; y += rh * 0.022) c.fillRect(rx - rw, y, rw * 2, 0.8); // weld rings
  c.fillStyle = "#16181b"; c.fillRect(rx - rw * 1.04, bTop - rh * 0.015, rw * 2.08, rh * 0.015);  // hot-staging ring (vented)
  c.fillStyle = "#9aa0a7"; for (let i = 0; i < 6; i++) c.fillRect(rx - rw + (i + 0.3) * rw / 3, bTop - rh * 0.012, rw / 7, rh * 0.009);
  c.fillStyle = "#2a2d32"; c.fillRect(rx - rw * 1.9, bTop + rh * 0.026, rw * 0.9, rh * 0.02); c.fillRect(rx + rw, bTop + rh * 0.026, rw * 0.9, rh * 0.02); // grid fins
  const shipB = bTop - rh * 0.015, noseB = top + rh * 0.12;
  c.fillStyle = sg; c.fillRect(rx - rw, noseB, rw * 2, shipB - noseB);                         // ship barrel
  c.beginPath(); c.moveTo(rx - rw, noseB); c.bezierCurveTo(rx - rw, top + rh * 0.05, rx - rw * 0.3, top, rx, top); c.bezierCurveTo(rx + rw * 0.3, top, rx + rw, top + rh * 0.05, rx + rw, noseB); c.fill();
  c.fillStyle = "#16181b"; c.fillRect(rx + rw * 0.15, noseB, rw * 0.85, shipB - noseB);         // tiles (windward side, right half, like the Starbase view)
  c.beginPath(); c.moveTo(rx + rw * 0.15, noseB); c.quadraticCurveTo(rx + rw * 0.2, top + rh * 0.01, rx, top); c.quadraticCurveTo(rx + rw, top, rx + rw, noseB); c.fill();
  c.fillStyle = "#2a2d31";                                                                      // flaps
  c.beginPath(); c.moveTo(rx - rw, shipB - rh * 0.005); c.lineTo(rx - rw * 1.75, shipB - rh * 0.02); c.lineTo(rx - rw * 1.75, shipB - rh * 0.075); c.lineTo(rx - rw, shipB - rh * 0.095); c.fill();
  c.beginPath(); c.moveTo(rx + rw, shipB - rh * 0.005); c.lineTo(rx + rw * 1.75, shipB - rh * 0.02); c.lineTo(rx + rw * 1.75, shipB - rh * 0.075); c.lineTo(rx + rw, shipB - rh * 0.095); c.fill();
  c.beginPath(); c.moveTo(rx - rw * 0.85, noseB + rh * 0.005); c.lineTo(rx - rw * 1.4, noseB - rh * 0.005); c.lineTo(rx - rw * 1.2, noseB - rh * 0.05); c.lineTo(rx - rw * 0.6, noseB - rh * 0.06); c.fill();
  c.beginPath(); c.moveTo(rx + rw * 0.85, noseB + rh * 0.005); c.lineTo(rx + rw * 1.4, noseB - rh * 0.005); c.lineTo(rx + rw * 1.2, noseB - rh * 0.05); c.lineTo(rx + rw * 0.6, noseB - rh * 0.06); c.fill();
  c.fillStyle = "#3b3d42"; c.fillRect(rx - rw * 0.9, by, rw * 1.8, rh * 0.008);                // engine skirt
}
// Starbase, 2D: tapered concrete launch mount, Mechazilla tower with chopsticks + ship QD arm (left), white tank farm (right)
function drawStarbase(c, rx, gy, rw, rh, lift, W, day) {
  const tw = rw * 3, tx = rx - rw * 6.2 - tw, th = rh * 1.12 + lift;
  c.fillStyle = day > 0.3 ? "#cfd3d6" : "#3a3f46";                                            // tank farm
  for (const [dx, hk] of [[3.6, 0.2], [4.6, 0.15], [5.6, 0.2], [6.6, 0.15]]) c.fillRect(rx + rw * dx * 1.6, gy - rh * hk, rw * 1.3, rh * hk);
  c.fillStyle = "#2f343b"; c.fillRect(tx, gy - th, tw, th);                                     // tower body
  c.strokeStyle = "#596069"; c.lineWidth = 1;
  for (let y = gy, k = 0; y > gy - th; y -= tw * 0.5, k++) { c.beginPath(); c.moveTo(tx, y); c.lineTo(tx + tw, y - tw * 0.5); c.moveTo(tx + tw, y); c.lineTo(tx, y - tw * 0.5); c.moveTo(tx, y); c.lineTo(tx + tw, y); c.stroke(); }
  c.fillStyle = "#1c2026"; c.fillRect(tx - 1, gy - th, 3, th); c.fillRect(tx + tw - 2, gy - th, 3, th); c.fillRect(tx - rw * 0.3, gy - th - rh * 0.03, tw + rw * 0.6, rh * 0.03);
  const arm = (y, x1, h) => { c.fillStyle = "#3a4048"; c.fillRect(tx + tw, y - h / 2, x1 - tx - tw, h); c.strokeStyle = "#69707a"; c.beginPath(); for (let x = tx + tw, i = 0; x < x1; x += h, i++) { c.moveTo(x, y + (i & 1 ? h : -h) / 2); c.lineTo(x + h, y + (i & 1 ? -h : h) / 2); } c.stroke(); };
  const bTop = gy - 4 - lift - rh * 0.59;
  arm(bTop + rh * 0.01, rx + rw * 0.3, rh * 0.03);                                              // chopsticks at the booster top
  c.fillStyle = "#30353c"; c.fillRect(tx + tw - 2, bTop - rh * 0.03, rw * 0.9, rh * 0.06);       // carriage
  arm(gy - 4 - lift - rh * 0.8, rx - rw, rh * 0.022);                                           // ship QD arm
  c.save(); c.translate(tx + tw, gy - 4 - lift - rh * 0.83); c.rotate(-0.6); c.fillStyle = "#3a4048"; c.fillRect(0, -rh * 0.01, rh * 0.11, rh * 0.02); c.restore();
  c.fillStyle = day > 0.3 ? "#d6d0c4" : "#4a4743";                                             // tapered concrete mount
  c.beginPath(); c.moveTo(rx - rw * 3.7, gy); c.lineTo(rx - rw * 2.0, gy - lift); c.lineTo(rx + rw * 2.0, gy - lift); c.lineTo(rx + rw * 3.7, gy); c.fill();
  c.fillStyle = "#1a1c20"; c.fillRect(rx - rw * 1.4, gy - lift * 0.32, rw * 0.9, lift * 0.32); c.fillRect(rx + rw * 0.5, gy - lift * 0.32, rw * 0.9, lift * 0.32);
  c.fillStyle = "#5b6067"; c.fillRect(rx - rw * 1.5, gy - lift - 4, rw * 3, 4);                 // steel table
}
