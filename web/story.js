/* Chang'e & the Jade Rabbit (嫦娥奔月 · 玉兔) — optional story layer
 *  - Chang'e's flight calculator: real Earth–Moon distance now (JPL Horizons) -> travel time at different speeds
 *  - Find the Jade Rabbits while walking in the Astronaut view (3 hide in the darkest, coldest spots nearby)
 *  - Can be switched off with the 🐰 button (remembered in this browser)
 * Code written with AI assistance (Claude).
 */
"use strict";
const ST = { on: true, rabbits: [], found: 0, spawnedFor: null, speed: 1000 };
try { ST.on = localStorage.getItem("story") !== "off"; } catch (e) { /* storage unavailable */ }

const MOON_KMH = 3680; // mean orbital speed of the Moon around Earth (2*pi*384,400 km / 27.32 d)
const SPEEDS = [
  ["🚶 Walking", 5], ["🚄 Taiwan High Speed Rail", 300], ["✈️ Airliner", 900],
  ["🚀 Apollo 11 average (≈3 days in 1969)", 5300], ["💡 Light", 299792.458 * 3600],
];

function fmtTime(h) {
  if (h < 1 / 60) return `${(h * 3600).toFixed(2)} seconds`;
  if (h < 1) return `${(h * 60).toFixed(0)} minutes`;
  if (h < 48) return `${h.toFixed(1)} hours`;
  const d = h / 24;
  if (d < 365) return `${d.toFixed(1)} days`;
  return `${(d / 365.25).toFixed(1)} years`;
}

/* ---------- Chang'e's flight calculator ---------- */
function drawStory() {
  const box = $("story"); box.style.display = ST.on ? "" : "none";
  $("storyOff").hidden = ST.on;
  $("storyTab").style.display = ST.on ? "" : "none";
  $("storyBtn").classList.toggle("active", ST.on);
  $("storyBtn").textContent = `🐰 Chang'e story: ${ST.on ? "ON" : "OFF"}`;
  if (!ST.on) { if (window.showTab && window.curTab === "story") window.showTab("plan"); return; }
  const i = Math.floor(T()), dkm = EPH.earth_dist_km[i];
  if (!ST.range) { let lo = 1e9, hi = 0; for (const v of EPH.earth_dist_km) { lo = Math.min(lo, v); hi = Math.max(hi, v); } ST.range = [lo, hi]; }
  const [lo, hi] = ST.range, surf = dkm - 6371 - 1737; // surface to surface
  const rows = [...SPEEDS, ["🌙 Chang'e (your choice)", ST.speed]].map(([name, v]) =>
    `<tr><td>${name}</td><td>${v >= 1e6 ? "300,000 km/s" : v.toLocaleString("en") + " km/h"}</td><td><b>${fmtTime(surf / v)}</b></td></tr>`).join("");
  $("storyBody").innerHTML = `
    <p>In the old story, <b>Chang'e (嫦娥)</b> drank the elixir of immortality and floated up to the Moon, where the <b>Jade Rabbit (玉兔)</b> keeps her company.
    How long would her trip take? On <b>${fmtDate(T())}</b> the Moon is <b>${Math.round(dkm).toLocaleString("en")} km</b> from Earth
    (centre to centre, NASA JPL Horizons). That is about <b>${Math.round(surf).toLocaleString("en")} km</b> from ground to ground.
    The distance changes from ${Math.round(lo).toLocaleString("en")} km to ${Math.round(hi).toLocaleString("en")} km, because the Moon's orbit is an ellipse.</p>
    <table>${rows}</table>
    <p class="note">Set Chang'e's speed: <input id="changeSpeed" type="number" min="1" step="100" value="${ST.speed}" style="width:7em"> km/h.
    Light needs only about 1.3 seconds, and that delay is why talking to a lander on the Moon always has a small lag.</p>
    <h3 style="margin:14px 0 4px; font-size:15px; color:var(--sun)">But wait… it is not that simple!</h3>
    <ul class="storyNotes">
      <li><b>🌙 The Moon won't wait for her.</b> The Moon circles Earth at about <b>${MOON_KMH.toLocaleString("en")} km/h</b>,
        ${(MOON_KMH / 300).toFixed(0)} times faster than the high-speed train. If Chang'e aims at where the Moon is <i>now</i>,
        the Moon will be long gone when she arrives: during her ${fmtTime(surf / 300)} on the train it goes around Earth about
        <b>${(surf / 300 / 24 / 27.32).toFixed(1)} times</b>. She has to aim at where the Moon <i>will be</i>.</li>
      <li><b>🌍 Earth's gravity pulls her back.</b> To really leave Earth she needs about <b>11 km/s (about 40,000 km/h)</b>, Earth's escape speed.
        At train speed she would never even reach space.</li>
      <li><b>📏 The distance keeps changing.</b> The Moon's orbit is an ellipse, so even on the same train the trip takes between
        <b>${fmtTime((lo - 8108) / 300)}</b> (Moon closest) and <b>${fmtTime((hi - 8108) / 300)}</b> (Moon farthest).</li>
    </ul>`;
  $("changeSpeed").onchange = (e) => { ST.speed = Math.max(1, +e.target.value || 1000); drawStory(); };
}

/* ---------- Jade Rabbit hunt in first person ---------- */
function rabbitSprite() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d"), gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,255,255,.9)"); gr.addColorStop(0.5, "rgba(200,230,255,.35)"); gr.addColorStop(1, "rgba(200,230,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  g.font = "64px system-ui"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("🐇", 64, 68);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false }));
  s.scale.set(40, 40, 1);
  return s;
}
function clearRabbits() {
  for (const r of ST.rabbits) X.three.scene.remove(r.sprite);
  ST.rabbits = []; ST.found = 0; ST.spawnedFor = null;
}
function spawnRabbits() {
  if (!X.three || !X.tile) return;
  clearRabbits();
  const hm = X.tile.heatmap, c = Math.floor(hm.n / 2), cells = [], R4 = Math.round(4000 / hm.step_m); // cells within ~4 km
  for (let r = c - R4; r <= c + R4; r++) for (let q = c - R4; q <= c + R4; q++) {
    const v = hm.sun[r] && hm.sun[r][q];
    if (v != null && (r !== c || q !== c)) cells.push([v, r, q]);
  }
  cells.sort((a, b) => a[0] - b[0]);
  const picks = cells.slice(0, 3); // the darkest, coldest spots: where real ice can hide
  for (let k = 0; k < 2; k++) picks.push(cells[3 + Math.floor(Math.random() * (cells.length - 3))]);
  for (const [sun, r, q] of picks) {
    const e = (q - c) * hm.step_m + (Math.random() - 0.5) * hm.step_m * 0.6, n = (r - c) * hm.step_m + (Math.random() - 0.5) * hm.step_m * 0.6;
    const s = rabbitSprite(); s.position.set(e, heightAt(e, n) + 15, -n); X.three.scene.add(s);
    ST.rabbits.push({ e, n, sun, sprite: s, found: false });
  }
  ST.spawnedFor = S.site.id;
}
function storyTick() {
  const hud = $("rabbitHud");
  if (!ST.on || !A.fp || !X.tile) { hud.style.display = "none"; ST.rabbits.forEach((r) => (r.sprite.visible = false)); return; }
  if (ST.spawnedFor !== S.site.id) spawnRabbits();
  ST.rabbits.forEach((r) => (r.sprite.visible = !r.found));
  X.dirty = true;
  let near = null, nd = 1e9;
  for (const r of ST.rabbits) {
    if (r.found) continue;
    const d = Math.hypot(r.e - A.pos.e, r.n - A.pos.n);
    if (d < 60) {
      r.found = true; ST.found++;
      ST.msg = `🎉 You found a Jade Rabbit! This spot is sunlit only <b>${r.sun}%</b> of the time.` +
        (r.sun < 20 ? " Rabbits love cold, dark craters, and so does water ice: it can survive for billions of years in permanent shadow." : " Even here the low Sun makes long, cold shadows.");
      continue;
    }
    if (d < nd) { nd = d; near = r; }
  }
  hud.style.display = "";
  if (!near) { hud.innerHTML = `🐇 All ${ST.rabbits.length} Jade Rabbits found! Chang'e (嫦娥) thanks you. ${ST.msg || ""}`; return; }
  const bearing = (Math.atan2(near.e - A.pos.e, near.n - A.pos.n) / D + 360) % 360;
  const rel = ((bearing - A.yaw + 540) % 360) - 180;
  const arrow = Math.abs(rel) < 22 ? "⬆ straight ahead" : rel > 0 ? (rel < 90 ? "↗ to your right" : "↘ behind you, right") : (rel > -90 ? "↖ to your left" : "↙ behind you, left");
  hud.innerHTML = `🐇 Jade Rabbits (玉兔) found: <b>${ST.found}/${ST.rabbits.length}</b> · nearest is <b>${(nd / 1000).toFixed(2)} km</b> away, ${arrow}
    (bearing ${bearing.toFixed(0)}°)${ST.msg ? "<br>" + ST.msg : ""}`;
}

/* ---------- toggle + hooks ---------- */
(function () {
  $("storyBtn").onclick = () => {
    ST.on = !ST.on;
    try { localStorage.setItem("story", ST.on ? "on" : "off"); } catch (e) { /* ignore */ }
    if (!ST.on && X.three) clearRabbits();
    drawStory(); storyTick();
  };
  const prevRender = window.onRender;
  window.onRender = (cur) => { prevRender(cur); if (EPH) drawStory(); storyTick(); };
  const prevApply = applyFP;
  applyFP = function () { prevApply(); storyTick(); }; // runs every walking step
  const prevSite = window.onSite;
  window.onSite = (site) => { if (X.three) clearRabbits(); prevSite(site); };
})();
