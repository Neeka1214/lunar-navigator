/* Astronaut View
 *  - Earth as seen from the Moon: which face points at you, day/night, time zones (JPL Horizons sub-Moon & sub-solar points on Earth)
 *  - Who on Earth can see the Moon right now (world cities + NASA Deep Space Network antennas)
 *  - First-person 3D view standing at the site (LOLA terrain, true angular sizes, "binocular" zoom)
 * Code written with AI assistance (Claude).
 */
"use strict";
const A = { ev: null, land: null, fp: false, yaw: 0, pitch: 0, fov: 60, stars: null, pos: { e: 0, n: 0 }, keys: new Set(), walked: 0 };

const CITIES = [
  ["Taipei", 25.03, 121.56, "Asia/Taipei", "home"],
  ["Tokyo", 35.68, 139.69, "Asia/Tokyo"],
  ["Sydney", -33.87, 151.21, "Australia/Sydney"],
  ["New Delhi", 28.61, 77.21, "Asia/Kolkata"],
  ["Nairobi", -1.29, 36.82, "Africa/Nairobi"],
  ["Paris", 48.86, 2.35, "Europe/Paris"],
  ["São Paulo", -23.55, -46.63, "America/Sao_Paulo"],
  ["Ottawa (CSA)", 45.42, -75.70, "America/Toronto"],
  ["Houston (NASA JSC)", 29.56, -95.09, "America/Chicago"],
  ["Pasadena (NASA JPL)", 34.20, -118.17, "America/Los_Angeles"],
  ["Honolulu", 21.31, -157.86, "Pacific/Honolulu"],
];
const DSN = [
  ["DSN Goldstone, USA", 35.43, -116.89, "America/Los_Angeles"],
  ["DSN Madrid, Spain", 40.43, -4.25, "Europe/Madrid"],
  ["DSN Canberra, Australia", -35.40, 148.98, "Australia/Sydney"],
];

async function loadAstro() {
  try {
    [A.ev, A.land] = await Promise.all([
      fetch("data/earthview.json").then((r) => r.json()),
      fetch("data/land.json").then((r) => r.json()),
    ]);
  } catch (e) { A.ev = null; }
}

/* ---------- geometry on Earth ---------- */
function evAt(t) {
  const e = A.ev, i = Math.max(0, Math.min(e.count - 2, Math.floor(t))), f = t - i;
  const lerpLon = (a, b) => { let d = b - a; if (d > 180) d -= 360; if (d < -180) d += 360; return ((a + d * f + 540) % 360) - 180; };
  return {
    mlon: lerpLon(e.moon_sub_lon[i], e.moon_sub_lon[i + 1]), mlat: e.moon_sub_lat[i] + (e.moon_sub_lat[i + 1] - e.moon_sub_lat[i]) * f,
    slon: lerpLon(e.sun_sub_lon[i], e.sun_sub_lon[i + 1]), slat: e.sun_sub_lat[i] + (e.sun_sub_lat[i + 1] - e.sun_sub_lat[i]) * f,
  };
}
function angDist(lat1, lon1, lat2, lon2) {
  const a = lat1 * D, b = lat2 * D;
  return Math.acos(Math.max(-1, Math.min(1, Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((lon2 - lon1) * D)))) / D;
}
function moonElev(lat, lon, g) { // topocentric, includes ~0.95 deg lunar parallax
  const geo = 90 - angDist(lat, lon, g.mlat, g.mlon);
  return geo - 0.95 * Math.cos(geo * D);
}
const sunElev = (lat, lon, g) => 90 - angDist(lat, lon, g.slat, g.slon);
function oceanOrLand(lat, lon) {
  if (A.land && window.d3 && d3.geoContains(A.land, [lon, lat])) {
    let best = null, bd = 1e9;
    for (const c of CITIES) { const d = angDist(lat, lon, c[1], c[2]); if (d < bd) { bd = d; best = c[0]; } }
    return bd < 25 ? `land, about ${Math.round(bd * 111)} km from ${best}` : "land";
  }
  if (lat < -60) return "the Southern Ocean";
  if (lon > 20 && lon < 120 && lat < 25) return "the Indian Ocean";
  if (lon > -70 && lon < 20) return "the Atlantic Ocean";
  return "the Pacific Ocean";
}
const localTime = (tz, date) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit" }).format(date);

/* ---------- Earth globe as seen from the Moon ---------- */
function drawGlobe(g) {
  const cv = $("globe"); const { ctx, w } = fit(cv);
  ctx.clearRect(0, 0, w, w);
  if (!window.d3 || !A.land) { ctx.fillStyle = "#8b95ad"; ctx.fillText("Globe needs an internet connection (d3).", 10, 20); return; }
  const r = w / 2 - 6;
  const proj = d3.geoOrthographic().scale(r).translate([w / 2, w / 2]).rotate([-g.mlon, -g.mlat]).clipAngle(90);
  const path = d3.geoPath(proj, ctx);
  ctx.beginPath(); path({ type: "Sphere" }); ctx.fillStyle = "#0d3466"; ctx.fill();
  ctx.beginPath(); path(d3.geoGraticule10()); ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.lineWidth = 0.6; ctx.stroke();
  ctx.beginPath(); path(A.land); ctx.fillStyle = "#6f8f56"; ctx.fill();
  // night side
  ctx.beginPath(); path(d3.geoCircle().center([((g.slon + 360) % 360) - 180, -g.slat]).radius(90)()); ctx.fillStyle = "rgba(0,0,12,.68)"; ctx.fill();
  // time-zone meridians with local standard time
  const now = hourToDate(T()), utcH = now.getUTCHours() + now.getUTCMinutes() / 60;
  ctx.font = "11px system-ui"; ctx.textAlign = "center";
  for (let k = -12; k <= 12; k++) {
    const lon = k * 15; if (d3.geoDistance([lon, g.mlat], [g.mlon, g.mlat]) > 1.0) continue; // skip crowded meridians near the limb
    ctx.beginPath(); path({ type: "LineString", coordinates: [[lon, -80], [lon, 0], [lon, 80]] }); ctx.strokeStyle = "rgba(255,200,61,.35)"; ctx.stroke();
    const p = proj([lon, Math.max(-50, Math.min(50, g.mlat))]); if (!p) continue;
    const hh = ((utcH + k) % 24 + 24) % 24;
    ctx.fillStyle = "#ffd75e"; ctx.fillText(`${String(Math.floor(hh)).padStart(2, "0")}:${String(Math.round((hh % 1) * 60) % 60).padStart(2, "0")}`, p[0], p[1] - 3);
    ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.fillText(`UTC${k >= 0 ? "+" : ""}${k}`, p[0], p[1] + 10);
  }
  // cities
  ctx.textAlign = "left";
  for (const c of [...CITIES, ...DSN]) {
    if (d3.geoDistance([c[2], c[1]], [g.mlon, g.mlat]) > Math.PI / 2) continue;
    const p = proj([c[2], c[1]]); if (!p) continue;
    ctx.beginPath(); ctx.arc(p[0], p[1], c[4] ? 4 : 2.5, 0, 7); ctx.fillStyle = c[4] ? "#ffd75e" : c[0].startsWith("DSN") ? "#3ddc97" : "#fff"; ctx.fill();
    if (c[4] || c[0].startsWith("DSN")) { ctx.fillStyle = "#fff"; ctx.fillText(c[0].replace("DSN ", "DSN "), p[0] + 6, p[1] + 4); }
  }
  ctx.beginPath(); path({ type: "Sphere" }); ctx.strokeStyle = "rgba(120,180,255,.6)"; ctx.lineWidth = 1.5; ctx.stroke();
}

/* ---------- cities table + lead text ---------- */
function drawCities(g) {
  const date = hourToDate(T()), c = siteCalc(S.site), i = Math.floor(T()), cur = X.lastCur;
  const lit = (1 + Math.cos(angDist(g.mlat, g.mlon, g.slat, g.slon) * D)) / 2; // Earth phase seen from the Moon
  const row = (ct) => {
    const me = moonElev(ct[1], ct[2], g), se = sunElev(ct[1], ct[2], g), see = me > 0;
    const sky = se > -0.83 ? "☀ day" : se > -6 ? "🌆 twilight" : "🌃 night";
    return `<tr class="${see ? "see" : ""} ${ct[4] || ""}"><td>${ct[0]}</td><td><b>${localTime(ct[3], date)}</b></td>
      <td>${sky}</td><td>${see ? `🌙 up ${me.toFixed(0)}°` : `<span class="note">Moon below horizon</span>`}</td></tr>`;
  };
  $("cities").innerHTML = `<tr><th>Place</th><th>Local time</th><th>Sky there</th><th>Can they see the Moon?</th></tr>
    ${CITIES.map(row).join("")}<tr><th colspan="4">NASA Deep Space Network: the antennas that talk to lunar landers</th></tr>${DSN.map(row).join("")}`;
  const dsnUp = DSN.filter((d) => moonElev(d[1], d[2], g) > 10).map((d) => d[0].replace("DSN ", "").split(",")[0]);
  const eVis = c.eVis[i];
  const where = !cur ? "" : eVis ? `Earth is <b class="earthc">in your sky</b>, ${cur.eEl.toFixed(1)}° above the horizon (azimuth ${cur.eAz.toFixed(0)}°).`
    : cur.eEl > 0 ? `Earth is <b class="no">hidden behind the terrain</b> (it would be ${cur.eEl.toFixed(1)}° high). You would need a relay satellite.`
    : `Earth is <b class="no">below your horizon</b> (${cur.eEl.toFixed(1)}°). You would need a relay satellite.`;
  $("astroLead").innerHTML = `${where} Earth looks <b>${Math.round(lit * 100)}% lit</b>, so people on Earth see a <b>${Math.round((1 - lit) * 100)}% lit Moon</b>.
    The middle of the Earth disk you see is above ${oceanOrLand(g.mlat, g.mlon)}.
    ${eVis ? (dsnUp.length ? `A direct link is possible through DSN <b class="ok">${dsnUp.join(" & ")}</b> (Moon more than 10° above the antenna's horizon).`
      : "No DSN antenna has the Moon high enough right now, so wait for the next station.") : ""}`;
  $("globeNote").textContent = `Earth seen from the Moon at ${fmtDate(T())}, drawn north-up (JPL Horizons sub-Moon & sub-solar points). Dark area = night side. Yellow labels = local standard time on each time-zone meridian.`;
  $("astroTime").textContent = `Taipei time: ${localTime("Asia/Taipei", date)}`;
}

/* ---------- first-person 3D ---------- */
function setFP(on) {
  const t3 = X.three; if (!t3 || !X.tile) { A.fp = false; $("fpBtn").textContent = "👩‍🚀 Stand here as an astronaut"; return; }
  A.fp = on;
  $("threeBox").classList.toggle("fp", on);
  $("fpBtn").textContent = on ? "↩ Back to overview" : "👩‍🚀 Stand here as an astronaut";
  if (on) {
    $("exag").value = 1; build3D(); A.pos = { e: 0, n: 0 }; A.walked = 0;
    const cur = X.lastCur, c = siteCalc(S.site), i = Math.floor(T());
    A.yaw = c.eVis[i] || cur.eEl > cur.sEl - 5 ? cur.eAz : cur.sAz; A.pitch = Math.max(-5, Math.min(30, (c.eVis[i] ? cur.eEl : cur.sEl) + 1)); A.fov = 50;
    t3.controls.enabled = false;
    t3.camera.near = 0.5; t3.camera.updateProjectionMatrix();
    if (!A.stars) { // illustrative background stars
      const n = 4000, p = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) { const u = Math.random() * 2 - 1, th = Math.random() * 2 * Math.PI, s = Math.sqrt(1 - u * u); p.set([s * Math.cos(th) * 300000, u * 300000, s * Math.sin(th) * 300000], k * 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p, 3));
      A.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false }));
      t3.scene.add(A.stars);
    }
    A.stars.visible = true;
  } else {
    t3.controls.enabled = true; t3.camera.near = 10; t3.camera.fov = 50; t3.camera.updateProjectionMatrix();
    t3.camera.position.set(22000, 26000, 44000); t3.controls.target.set(0, 0, 0);
    if (A.stars) A.stars.visible = false;
    $("exag").value = 2; build3D();
  }
  if (!A.glow) { // soft glare so the 0.5-degree Sun is easy to spot
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d"), gr = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,240,200,1)"); gr.addColorStop(0.15, "rgba(255,215,120,.55)"); gr.addColorStop(1, "rgba(255,200,80,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    A.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false }));
    A.glow.scale.set(2600, 2600, 1); t3.scene.add(A.glow);
  }
  A.glow.visible = on;
  if (X.lastCur) update3D(X.lastCur);
  (t3.meshes || []).forEach((m) => (m.material.needsUpdate = true));
  applyFP();
}
function applyFP() {
  const t3 = X.three; if (!t3) return;
  X.dirty = true;
  const fp = A.fp;
  // true angular sizes in first person, enlarged markers in overview
  t3.earthBall.scale.setScalar(fp ? Math.tan(0.95 * D) * 24000 / 900 : 1);
  t3.sunBall.scale.setScalar(fp ? Math.tan(0.267 * D) * 24000 / 700 : 1);
  t3.sunLabel.visible = t3.earthLabel.visible = t3.sunLine.visible = t3.earthLine.visible = !fp;
  t3.lander.visible = !fp; t3.compass.forEach((s) => (s.visible = !fp));
  if (!fp) { $("fpHint").textContent = ""; $("walkHud").style.display = "none"; return; }
  const P = A.pos, eye = heightAt(P.e, P.n) + 2, me = new THREE.Vector3(P.e, eye, -P.n);
  t3.camera.position.copy(me);
  const y = A.yaw * D, p = A.pitch * D;
  t3.camera.lookAt(new THREE.Vector3(P.e + Math.sin(y) * Math.cos(p), eye + Math.sin(p), -P.n - Math.cos(y) * Math.cos(p)));
  t3.camera.fov = A.fov; t3.camera.updateProjectionMatrix();
  const cur = X.lastCur;
  if (cur) { // Sun/Earth stay "infinitely far": keep them centred on the walker
    t3.sunBall.position.copy(dirVec(cur.sAz, cur.sEl, 24000)).add(me);
    t3.earthBall.position.copy(dirVec(cur.eAz, cur.eEl, 24000)).add(me);
    if (A.glow) A.glow.position.copy(t3.sunBall.position);
  }
  if (A.stars) A.stars.position.copy(me);
  drawWalkHud(eye);
}

/* is the direction (az, el) blocked by terrain as seen from the walker? march the height field */
function blocked(az, el, eye) {
  const a = az * D, se = Math.sin(a), ce = Math.cos(a), t = Math.tan(el * D);
  for (let d = 30; d < 150000; d *= 1.012) {
    const h = heightAt(A.pos.e + se * d, A.pos.n + ce * d);
    if (h > eye + t * d) return true;
  }
  return false;
}
function drawWalkHud(eye) {
  const cur = X.lastCur; if (!cur) return;
  const sunOk = cur.sEl > -0.27 && !blocked(cur.sAz, cur.sEl, eye), earthOk = cur.eEl > -0.95 && !blocked(cur.eAz, cur.eEl, eye);
  const hm = X.tile.heatmap, c = Math.floor(hm.n / 2);
  const col = Math.round(A.pos.e / hm.step_m) + c, row = Math.round(A.pos.n / hm.step_m) + c;
  const inHm = col >= 0 && row >= 0 && col < hm.n && row < hm.n;
  const dist = Math.hypot(A.pos.e, A.pos.n);
  $("walkHud").style.display = "";
  $("walkHud").innerHTML = `<b>${(dist / 1000).toFixed(2)} km</b> from the landing site · you walked ${(A.walked / 1000).toFixed(2)} km · ground ${Math.round(eye - 2)} m (relative)<br>
    <span class="${sunOk ? "sunc" : "no"}">${sunOk ? "☀ Sun visible here now" : "☀ Sun hidden here now"}</span> ·
    <span class="${earthOk ? "earthc" : "no"}">${earthOk ? "🌍 Earth visible: you can call home" : "🌍 Earth hidden: no direct link"}</span>
    ${inHm ? `<br>This spot over 2026–2028: sunlit <b>${hm.sun[row][col] ?? "–"}%</b>, Earth visible <b>${hm.earth[row][col] ?? "–"}%</b>, both <b>${hm.both[row][col] ?? "–"}%</b>` : ""}`;
  $("fpHint").textContent = `Facing ${A.yaw.toFixed(0)}° (${["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(A.yaw / 45) % 8]}), ${A.pitch.toFixed(1)}° up · view ${A.fov.toFixed(1)}°. Walk with W A S D or the arrow keys (hold Shift to drive like a rover). Drag to look around, scroll to zoom like binoculars. Stars are illustrative.`;
}

/* walking loop */
function walkLoop(ts) {
  requestAnimationFrame(walkLoop);
  if (!A.fp || !A.keys.size) { A.lastTs = ts; return; }
  const dt = Math.min(0.1, ((ts - (A.lastTs || ts)) / 1000)); A.lastTs = ts;
  const speed = A.keys.has("shift") ? 400 : 25; // m/s (sped up: real moonwalk is ~1 m/s)
  let f = 0, s = 0, turn = 0;
  if (A.keys.has("w") || A.keys.has("arrowup")) f += 1;
  if (A.keys.has("s") || A.keys.has("arrowdown")) f -= 1;
  if (A.keys.has("d")) s += 1;
  if (A.keys.has("a")) s -= 1;
  if (A.keys.has("arrowleft")) turn -= 1;
  if (A.keys.has("arrowright")) turn += 1;
  A.yaw = (A.yaw + turn * 60 * dt + 360) % 360;
  const y = A.yaw * D, de = (Math.sin(y) * f + Math.cos(y) * s) * speed * dt, dn = (Math.cos(y) * f - Math.sin(y) * s) * speed * dt;
  const ne = A.pos.e + de, nn = A.pos.n + dn;
  if (Math.abs(ne) < 39000 && Math.abs(nn) < 39000) { A.pos = { e: ne, n: nn }; A.walked += Math.hypot(de, dn); }
  applyFP();
  if (Math.hypot(de, dn) > 0 && X.lastCur) update3D(X.lastCur); // move the shadow box with the walker
}
function wireFP() {
  const box = $("three"); let drag = null;
  box.addEventListener("pointerdown", (e) => { if (A.fp) drag = [e.clientX, e.clientY, A.yaw, A.pitch]; });
  window.addEventListener("pointerup", () => (drag = null));
  window.addEventListener("pointermove", (e) => {
    if (!A.fp || !drag) return;
    const k = A.fov / box.clientHeight;
    A.yaw = ((drag[2] - (e.clientX - drag[0]) * k) % 360 + 360) % 360;
    A.pitch = Math.max(-30, Math.min(85, drag[3] + (e.clientY - drag[1]) * k));
    applyFP();
  });
  box.addEventListener("wheel", (e) => { if (!A.fp) return; e.preventDefault(); A.fov = Math.max(1.5, Math.min(75, A.fov * (e.deltaY > 0 ? 1.15 : 1 / 1.15))); applyFP(); }, { passive: false });
  $("fpBtn").onclick = () => setFP(!A.fp);
  const keyName = (e) => e.key.toLowerCase();
  const WALK = ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"];
  window.addEventListener("keydown", (e) => {
    if (!A.fp || /input|select|textarea/i.test(document.activeElement.tagName)) return;
    const k = keyName(e); if (!WALK.includes(k)) return;
    e.preventDefault(); A.keys.add(k);
  });
  window.addEventListener("keyup", (e) => A.keys.delete(keyName(e)));
  window.addEventListener("blur", () => A.keys.clear());
  // on-screen buttons for touch screens
  document.querySelectorAll("#walkPad button").forEach((b) => {
    const k = b.dataset.k;
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); A.keys.add(k); });
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => b.addEventListener(ev, () => A.keys.delete(k)));
  });
  requestAnimationFrame(walkLoop);
}

/* ---------- hooks ---------- */
(function () {
  const prevRender = window.onRender, prevSite = window.onSite;
  window.onRender = (cur) => {
    prevRender(cur);
    if (!A.ev) return;
    const g = evAt(T()); drawGlobe(g); drawCities(g);
    if (A.fp) applyFP();
    $("fpBtn").style.display = X.tile ? "" : "none";
    if (X.tile && X.three && !A.autoFp && /[#&]fp\b/.test(location.hash)) { A.autoFp = true; setFP(true); }
  };
  window.onSite = (site) => { if (A.fp) setFP(false); prevSite(site); };
  wireFP();
  loadAstro().then(() => { if (S.site) render(); });
})();
