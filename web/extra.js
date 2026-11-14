/* Lunar Landing Site Navigator — extra modules
 *  - LROC NAC image coverage (LROC QuickMap features API)
 *  - Seasonal overview (every lunar day in the JPL Horizons dataset)
 *  - Nearby-alternatives heatmap (precomputed, LOLA 80 m terrain)
 *  - 3D terrain view with real-time Sun lighting (three.js)
 * Shares globals with app.js (S, siteCalc, T, NH, setBase, setCustom, fit, $ ...).
 * Code written with AI assistance (Claude).
 */
"use strict";
const X = { tile: null, tileId: null, hm: "sun", three: null };

/* ---------- LROC NAC coverage (Quickmap) ---------- */
function drawNac(site) {
  const n = site.nac, el = $("nac");
  if (!n || n.count == null) { el.innerHTML = '<span class="note">LROC NAC coverage: not queried for custom sites. Open LROC QuickMap to browse images.</span>'; return; }
  if (!n.count) { el.innerHTML = "LROC NAC images covering this point: <b>0</b>"; return; }
  el.innerHTML = `<b>${n.count}</b> LROC NAC images cover this point (via LROC QuickMap).<br>
    Sharpest: <a href="${n.best.url}" target="_blank">${n.best.id}</a> · ${n.best.res} m/px · ${n.best.time}<br>
    Most recent: <a href="${n.latest.url}" target="_blank">${n.latest.id}</a> · ${n.latest.res} m/px · ${n.latest.time}`;
}

/* ---------- seasonal overview ---------- */
function drawSeason() {
  const c = siteCalc(S.site), cv = $("season"); const { ctx, w, h } = fit(cv);
  ctx.clearRect(0, 0, w, h);
  const months = Math.floor(NH / LUNAR_DAY), padB = 18, padL = 30, H = h - padB - 4;
  const gw = (w - padL) / months, bw = Math.max(2, gw / 3 - 1.5);
  ctx.strokeStyle = "rgba(255,255,255,.08)"; ctx.fillStyle = "#8b95ad"; ctx.font = "10px system-ui";
  for (const p of [0, 50, 100]) { const y = 4 + H * (1 - p / 100); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w, y); ctx.stroke(); ctx.fillText(p + "%", 2, y + 3); }
  X.seasonGeom = { padL, gw, months };
  for (let m = 0; m < months; m++) {
    const st = stats(c, m * LUNAR_DAY), x = padL + m * gw;
    if (S.base >= m * LUNAR_DAY && S.base < (m + 1) * LUNAR_DAY) { ctx.fillStyle = "rgba(255,255,255,.08)"; ctx.fillRect(x, 0, gw, h - padB); }
    [[st.sun, "#ffc83d"], [st.earth, "#4aa8ff"], [st.both, "#3ddc97"]].forEach(([v, col], k) => {
      ctx.fillStyle = col; ctx.fillRect(x + 1 + k * (bw + 1), 4 + H * (1 - v), bw, H * v);
    });
    if (m % 3 === 0) { ctx.fillStyle = "#8b95ad"; ctx.fillText(fmtDay(m * LUNAR_DAY).slice(0, 7), x, h - 4); }
  }
}
function seasonClick(ev) {
  const r = $("season").getBoundingClientRect(), g = X.seasonGeom; if (!g) return;
  const m = Math.floor((ev.clientX - r.left - g.padL) / g.gw);
  if (m >= 0 && m < g.months) setBase(m * LUNAR_DAY);
}

/* ---------- nearby alternatives heatmap ---------- */
function destLL(lat, lon, e, n) {
  const R0 = 1737400, d = Math.hypot(e, n) / R0, az = Math.atan2(e, n), a = lat * D, b = lon * D;
  const lat2 = Math.asin(Math.sin(a) * Math.cos(d) + Math.cos(a) * Math.sin(d) * Math.cos(az));
  const lon2 = b + Math.atan2(Math.sin(az) * Math.sin(d) * Math.cos(a), Math.cos(d) - Math.sin(a) * Math.sin(lat2));
  return [lat2 / D, ((lon2 / D) % 360 + 360) % 360];
}
function heatColor(v, kind) {
  if (v == null) return "#000";
  // high-contrast "inferno"-style colour scale (dark purple -> red -> orange -> pale yellow)
  const stops = [[0, [8, 6, 30]], [0.25, [87, 16, 110]], [0.5, [188, 55, 84]], [0.75, [249, 142, 9]], [1, [252, 255, 164]]];
  const t = Math.max(0, Math.min(1, v / 100));
  let k = 0; while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
  const [t0, c0] = stops[k], [t1, c1] = stops[k + 1], f = (t - t0) / (t1 - t0);
  return [0, 1, 2].map((q) => Math.round(c0[q] + (c1[q] - c0[q]) * f));
}
/* hillshade of the +-15 km terrain tile (drawn once per site) */
function hillshadeCanvas() {
  if (X.shadeFor === X.tileId && X.shade) return X.shade;
  const tr = X.tile.terrain, n = tr.n, cv = document.createElement("canvas"); cv.width = cv.height = n;
  const g = cv.getContext("2d"), img = g.createImageData(n, n), az = 315 * D, alt = 35 * D;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const h = (rr, cc) => tr.h[Math.max(0, Math.min(n - 1, rr))][Math.max(0, Math.min(n - 1, cc))];
    const dx = (h(r, c + 1) - h(r, c - 1)) / (2 * tr.step_m), dy = (h(r + 1, c) - h(r - 1, c)) / (2 * tr.step_m);
    const slope = Math.atan(Math.hypot(dx, dy)), aspect = Math.atan2(-dx, -dy);
    const s = Math.max(0, Math.sin(alt) * Math.cos(slope) + Math.cos(alt) * Math.sin(slope) * Math.cos(az - aspect));
    const p = ((n - 1 - r) * n + c) * 4, v = Math.round(110 + 145 * s); // north up (light hillshade: multiplied with the colours)
    img.data[p] = img.data[p + 1] = img.data[p + 2] = v; img.data[p + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  X.shade = cv; X.shadeFor = X.tileId;
  return cv;
}
function drawHeat() {
  const wrap = $("heatWrap");
  if (!X.tile) { wrap.style.display = S.site.lat <= -80 && !S.site.id.startsWith("custom") ? "" : "none"; $("heatNote").textContent = "Loading…"; return; }
  wrap.style.display = "";
  const hm = X.tile.heatmap, grid = hm[X.hm], n = hm.n;
  const cv = $("heat"); const { ctx, w, h } = fit(cv);
  const legendH = 34, W = w, cs = W / n;
  ctx.clearRect(0, 0, w, h);
  // 1) terrain hillshade underlay
  ctx.imageSmoothingEnabled = true; ctx.drawImage(hillshadeCanvas(), 0, 0, W, W);
  // 2) heat overlay (semi-transparent so craters and ridges stay visible)
  const off = document.createElement("canvas"); off.width = off.height = n;
  const og = off.getContext("2d"), oi = og.createImageData(n, n);
  let best = -1, bi = 0, bj = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = grid[i][j], p = ((n - 1 - i) * n + j) * 4; // north up
    if (v == null) { oi.data[p + 3] = 0; continue; }
    const col = heatColor(v);
    oi.data[p] = col[0]; oi.data[p + 1] = col[1]; oi.data[p + 2] = col[2]; oi.data[p + 3] = 255;
    if (v > best) { best = v; bi = i; bj = j; }
  }
  og.putImageData(oi, 0, 0);
  // multiply keeps the colours vivid while the terrain shading still shows through
  ctx.imageSmoothingEnabled = false; ctx.globalCompositeOperation = "multiply"; ctx.drawImage(off, 0, 0, W, W); ctx.globalCompositeOperation = "source-over";
  // 3) markers
  const c = Math.floor(n / 2), px = (j) => (j + 0.5) * cs, py = (i) => (n - 1 - i + 0.5) * cs;
  ctx.lineWidth = 2.5; ctx.strokeStyle = "#fff"; ctx.strokeRect(px(c) - 6, py(c) - 6, 12, 12);
  ctx.strokeStyle = "#3ddc97"; ctx.beginPath(); ctx.arc(px(bj), py(bi), 9, 0, 7); ctx.stroke();
  if (X.hover) { ctx.strokeStyle = "#4aa8ff"; ctx.lineWidth = 1.5; ctx.strokeRect(X.hover[1] * cs, (n - 1 - X.hover[0]) * cs, cs, cs); }
  ctx.lineWidth = 1; ctx.font = "bold 12px system-ui"; ctx.fillStyle = "#fff"; ctx.shadowColor = "#000"; ctx.shadowBlur = 3;
  ctx.fillText("N ↑", 6, 16);
  const km5 = 5000 / hm.step_m * cs; // 5 km scale bar
  ctx.fillRect(W - km5 - 10, W - 12, km5, 3); ctx.fillText("5 km", W - km5 - 10, W - 17); ctx.shadowBlur = 0;
  // 4) legend
  const ly = W + 8, lw = W - 60;
  for (let x = 0; x < lw; x++) { const col = heatColor((x / lw) * 100); ctx.fillStyle = `rgb(${col})`; ctx.fillRect(30 + x, ly, 1, 10); }
  ctx.fillStyle = "#8b95ad"; ctx.font = "11px system-ui"; ctx.fillText("0%", 4, ly + 9); ctx.fillText("100%", 32 + lw, ly + 9);
  ctx.fillText("50%", 30 + lw / 2 - 10, ly + 24);
  const here = grid[c][c], dist = (Math.hypot(bi - c, bj - c) * hm.step_m / 1000).toFixed(1);
  const label = { sun: "sunlit", earth: "Earth visible", both: "sunlit with Earth in view" }[X.hm];
  const hov = X.hover && grid[X.hover[0]] ? grid[X.hover[0]][X.hover[1]] : null;
  $("heatNote").innerHTML = `Share of time <b>${label}</b>, ${hm.period}, on ${(hm.step_m / 1000).toFixed(1)} km cells over NASA LOLA terrain.
    <span style="color:#fff">□</span> this site: <b>${here ?? "–"}%</b> ·
    <span class="ok">○</span> best spot nearby: <b>${best}%</b>, ${dist} km away.
    ${X.hover ? `<br>Under your cursor: <b>${hov ?? "–"}%</b>, ${(Math.hypot(X.hover[0] - c, X.hover[1] - c) * hm.step_m / 1000).toFixed(1)} km from the site.` : ""}
    Click any cell to evaluate it.`;
  X.heatBest = [bi, bj];
}
function heatCell(ev) {
  const r = $("heat").getBoundingClientRect(), n = X.tile.heatmap.n, side = r.width;
  const j = Math.floor(((ev.clientX - r.left) / side) * n), i = n - 1 - Math.floor(((ev.clientY - r.top) / side) * n);
  return i >= 0 && j >= 0 && i < n && j < n ? [i, j] : null;
}
function heatClick(ev) {
  if (!X.tile) return;
  const cell = heatCell(ev); if (!cell) return;
  const n = X.tile.heatmap.n, c = Math.floor(n / 2), [i, j] = cell;
  const step = X.tile.heatmap.step_m, [lat, lon] = destLL(X.tile.lat, X.tile.lon, (j - c) * step, (i - c) * step);
  setCustom(lat, lon);
}
async function loadTile(site) {
  X.tile = null; X.tileId = site.id;
  if (site.lat > -80 || site.id.startsWith("custom")) { drawHeat(); build3D(); return; }
  try {
    const t = await fetch(`data/tiles/${site.id}.json`).then((r) => { if (!r.ok) throw 0; return r.json(); });
    if (t.walk) { // walkable near (+-40 km) and far (+-150 km) terrain
      const [nb, fb] = await Promise.all(["near", "far"].map((k) => fetch(`data/tiles/${site.id}.${k}.bin`).then((r) => r.arrayBuffer())));
      t.walk.near.h = new Int16Array(nb); t.walk.far.h = new Int16Array(fb);
    }
    if (X.tileId !== site.id) return;
    X.tile = t;
  } catch (e) { X.tile = null; }
  drawHeat(); build3D(); update3D();
  if (window.onRender && X.lastCur) window.onRender(X.lastCur); // let other modules react to the new tile
}

/* ---------- 3D terrain (three.js) ---------- */
function build3D() {
  const box = $("three"), wrap = $("threeWrap");
  if (!window.THREE || !X.tile) {
    wrap.style.display = X.tile === null && (S.site.lat > -80 || S.site.id.startsWith("custom")) ? "none" : "";
    $("threeNote").textContent = window.THREE ? "Loading terrain…" : "3D view needs an internet connection (three.js).";
    return;
  }
  wrap.style.display = "";
  if (!X.three) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    box.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x000000);
    const camera = new THREE.PerspectiveCamera(50, 1, 10, 400000);
    camera.position.set(22000, 26000, 44000);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0); controls.maxPolarAngle = Math.PI * 0.49;
    const amb = new THREE.AmbientLight(0x223355, 0.12); scene.add(amb);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -42000, right: 42000, top: 42000, bottom: -42000, near: 100, far: 400000 });
    sun.shadow.bias = -0.0005; scene.add(sun); scene.add(sun.target);
    // Sun / Earth markers on a 24 km "sky ring" (sizes enlarged for visibility)
    const sunBall = new THREE.Mesh(new THREE.SphereGeometry(700, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffd75e }));
    // Earth is lit by the same Sun light, so it shows its real phase
    const earthBall = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 24), new THREE.MeshLambertMaterial({ color: 0x5fb4ff, emissive: 0x0b1e3a }));
    scene.add(sunBall); scene.add(earthBall);
    // compass labels
    const label = (txt, col) => {
      const c = document.createElement("canvas"); c.width = c.height = 128;
      const g = c.getContext("2d"); g.fillStyle = col; g.font = "bold 72px system-ui"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(txt, 64, 64);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
      s.scale.set(2200, 2200, 1); return s;
    };
    const compass = [["N", 0], ["E", 90], ["S", 180], ["W", 270]].map(([t, az]) => {
      const s = label(t, "#8b95ad"); const a = az * D; s.position.set(Math.sin(a) * 42000, 1500, -Math.cos(a) * 42000); s.scale.set(4000, 4000, 1); scene.add(s); return s;
    });
    // text labels next to the Sun/Earth direction markers (text updated every time step)
    const textLabel = (col) => {
      const c = document.createElement("canvas"); c.width = 1024; c.height = 160;
      const tex = new THREE.CanvasTexture(c);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
      s.scale.set(28000, 4400, 1);
      s.userData.set = (txt) => {
        const g = c.getContext("2d"); g.clearRect(0, 0, 1024, 160);
        g.font = "bold 64px system-ui"; g.textAlign = "center"; g.textBaseline = "middle";
        g.lineWidth = 10; g.strokeStyle = "rgba(0,0,0,.85)"; g.strokeText(txt, 512, 80); g.fillStyle = col; g.fillText(txt, 512, 80);
        tex.needsUpdate = true;
      };
      return s;
    };
    const sunLabel = textLabel("#ffd75e"), earthLabel = textLabel("#7cc0ff");
    scene.add(sunLabel); scene.add(earthLabel);
    // dashed "line of sight" from the lander to each body: these are directions, not objects on the ground
    const sightLine = (col) => {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]);
      const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color: col, dashSize: 900, gapSize: 600, depthTest: false, transparent: true, opacity: 0.9 }));
      l.renderOrder = 5; scene.add(l); return l;
    };
    const sunLine = sightLine(0xffd75e), earthLine = sightLine(0x4aa8ff);
    const lander = new THREE.Mesh(new THREE.ConeGeometry(250, 700, 12), new THREE.MeshBasicMaterial({ color: 0xff6b6b }));
    scene.add(lander);
    X.three = { renderer, scene, camera, controls, sun, sunBall, earthBall, sunLabel, earthLabel, sunLine, earthLine, lander, compass, amb, mesh: null };
    // render only when something changed (saves battery; the scene is static between updates)
    controls.addEventListener("change", () => (X.dirty = true));
    const loop = () => {
      requestAnimationFrame(loop);
      if (!(typeof A !== "undefined" && A.fp)) controls.update();
      if (X.dirty) { X.dirty = false; renderer.render(scene, camera); }
    };
    loop();
    window.addEventListener("resize", size3D);
  }
  const t3 = X.three, ex = +$("exag").value;
  for (const m of t3.meshes || []) { t3.scene.remove(m); m.geometry.dispose(); }
  t3.meshes = [];
  const grids = X.tile.walk ? [X.tile.walk.far, X.tile.walk.near]
    : [{ n: X.tile.terrain.n, step_m: X.tile.terrain.step_m, h: Int16Array.from(X.tile.terrain.h.flat()) }];
  grids.forEach((gr, gi) => {
    const n = gr.n, half = ((n - 1) / 2) * gr.step_m, far = grids.length === 2 && gi === 0;
    const g = new THREE.PlaneGeometry(2 * half, 2 * half, n - 1, n - 1);
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const col = Math.round((pos.getX(k) + half) / gr.step_m), row = Math.round((pos.getY(k) + half) / gr.step_m); // row 0 = south
      pos.setZ(k, gr.h[row * n + col] * ex - (far ? 3 : 0));
    }
    g.rotateX(-Math.PI / 2); // plane +Y (north) -> -Z ; height -> +Y
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: far ? 0x8a8a8a : 0x9a9a9a, roughness: 1, metalness: 0 });
    if (far) { mat.polygonOffset = true; mat.polygonOffsetFactor = 2; mat.polygonOffsetUnits = 2; }
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true; m.castShadow = !far;
    t3.scene.add(m); t3.meshes.push(m);
  });
  t3.mesh = t3.meshes[t3.meshes.length - 1];
  X.dirty = true;
  t3.lander.position.set(0, heightAt(0, 0) * ex + 350, 0);
  $("exagV").textContent = ex + "×";
  size3D();
}
/* terrain height (m, relative to the site, curvature included) at local east/north metres */
function heightAt(e, n) {
  const w = X.tile && X.tile.walk;
  const grids = w ? [w.near, w.far] : [{ n: X.tile.terrain.n, step_m: X.tile.terrain.step_m, h: Int16Array.from(X.tile.terrain.h.flat()) }];
  for (const g of grids) {
    const half = ((g.n - 1) / 2) * g.step_m, c = (e + half) / g.step_m, r = (n + half) / g.step_m;
    const c0 = Math.floor(c), r0 = Math.floor(r);
    if (c0 < 0 || r0 < 0 || c0 >= g.n - 1 || r0 >= g.n - 1) continue;
    const fc = c - c0, fr = r - r0, i = r0 * g.n + c0, h = g.h;
    return h[i] * (1 - fc) * (1 - fr) + h[i + 1] * fc * (1 - fr) + h[i + g.n] * (1 - fc) * fr + h[i + g.n + 1] * fc * fr;
  }
  return -3000;
}
function size3D() {
  if (!X.three) return;
  X.dirty = true;
  const box = $("three"), w = box.clientWidth, h = box.clientHeight;
  X.three.renderer.setSize(w, h); X.three.camera.aspect = w / h; X.three.camera.updateProjectionMatrix();
}
function dirVec(az, el, r) { // x = east, y = up, z = -north
  const a = az * D, e = el * D;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e) * r, Math.sin(e) * r, -Math.cos(a) * Math.cos(e) * r);
}
function update3D(cur) {
  if (!X.three || !X.tile) return;
  X.dirty = true;
  cur = cur || X.lastCur; if (!cur) return;
  const t3 = X.three, ex = +$("exag").value;
  // the scene is vertically exaggerated, so exaggerate the light elevation to keep shadows consistent
  const lightEl = Math.atan(Math.tan(cur.sEl * D) * ex) / D;
  // light follows the walker in first-person mode so nearby shadows stay sharp
  const fc = typeof A !== "undefined" && A.fp ? A.pos : { e: 0, n: 0 }, focus = new THREE.Vector3(fc.e, 0, -fc.n);
  t3.sun.position.copy(dirVec(cur.sAz, lightEl, 150000)).add(focus); t3.sun.target.position.copy(focus);
  const sb = typeof A !== "undefined" && A.fp ? 9000 : 42000;
  Object.assign(t3.sun.shadow.camera, { left: -sb, right: sb, top: sb, bottom: -sb }); t3.sun.shadow.camera.updateProjectionMatrix();
  const fpOn = typeof A !== "undefined" && A.fp;
  t3.sun.intensity = cur.sEl > -0.3 ? (fpOn ? 5 : 1.6) : 0; // first person: eye-adapted brightness
  t3.amb.intensity = fpOn ? 0.3 : 0.28; // overview: keep the terrain readable even during the lunar night t3.amb.color.set(fpOn ? 0x8890a0 : 0x223355);
  t3.sun.shadow.normalBias = fpOn ? 60 : 30; // grazing sunlight: avoid self-shadowing (shadow acne)
  t3.renderer.toneMapping = fpOn ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping; t3.renderer.toneMappingExposure = 1.3;
  const earthEl = Math.atan(Math.tan(cur.eEl * D) * ex) / D;
  const c = siteCalc(S.site), i = Math.floor(T());
  // direction markers sit on a ring beyond the detailed terrain, joined to the lander by dashed sight lines
  const RM = 52000, tip = t3.lander.position.clone().add(new THREE.Vector3(0, 350, 0));
  const sunPos = dirVec(cur.sAz, lightEl, RM).add(new THREE.Vector3(0, tip.y, 0));
  const earthPos = dirVec(cur.eAz, earthEl, RM).add(new THREE.Vector3(0, tip.y, 0));
  t3.sunBall.position.copy(sunPos); t3.earthBall.position.copy(earthPos);
  if (!fpOn) { t3.sunBall.scale.setScalar(1.8); t3.earthBall.scale.setScalar(1.8); }
  t3.sunLabel.position.copy(sunPos).add(new THREE.Vector3(0, 4500, 0));
  t3.earthLabel.position.copy(earthPos).add(new THREE.Vector3(0, 5000, 0));
  t3.sunLabel.userData.set(`☀ Sun ${cur.sEl.toFixed(1)}° · ${c.sVis[i] ? "visible" : "hidden"}`);
  t3.earthLabel.userData.set(`🌍 Earth ${cur.eEl.toFixed(1)}° · ${c.eVis[i] ? "visible" : "hidden"}`);
  for (const [line, to] of [[t3.sunLine, sunPos], [t3.earthLine, earthPos]]) {
    line.geometry.setFromPoints([tip, to]); line.computeLineDistances(); line.visible = !fpOn;
  }
  $("threeNote").innerHTML = `Real terrain from NASA LOLA (80 m near the site, out to ±150 km), lit by the real Sun position (JPL Horizons) at ${fmtDate(T())}.
    Red cone = lander. The dashed lines point from the lander <b>toward</b> the Sun and Earth: they are directions in the sky, not objects on the ground
    (heights are stretched ${ex}× so the low polar Sun is easier to see).
    Drag to orbit, scroll to zoom. Press ▶ to watch the shadows sweep around the pole.`;
}

/* ---------- hooks ---------- */
window.onSite = (site) => { drawNac(site); loadTile(site); };
window.onRender = (cur) => { X.lastCur = cur; drawSeason(); drawHeat(); update3D(cur); };
(function wireExtra() {
  $("season").onclick = seasonClick;
  $("heat").onclick = heatClick;
  $("heat").onmousemove = (e) => { if (!X.tile) return; const c = heatCell(e); if (String(c) !== String(X.hover)) { X.hover = c; drawHeat(); } };
  $("heat").onmouseleave = () => { X.hover = null; if (X.tile) drawHeat(); };
  document.querySelectorAll("#hmBtns button").forEach((b) => b.onclick = () => {
    X.hm = b.dataset.hm; document.querySelectorAll("#hmBtns button").forEach((x) => x.classList.toggle("active", x === b)); drawHeat();
  });
  $("exag").oninput = () => { build3D(); update3D(); };
})();
