/* Lunar Landing Site Navigator
 * Sun/Earth geometry: NASA JPL Horizons sub-solar & sub-Earth points (hourly).
 * Terrain horizon: NASA LRO LOLA polar DEM.
 */
"use strict";
const R = 1737.4;               // km, lunar reference radius
const D = Math.PI / 180;
const SUN_R = 0.2666;           // deg, apparent solar radius
const EARTH_R = 0.95;           // deg, apparent Earth radius seen from Moon (approx)
const WIN = 720;                // hours shown in timeline (30 days)
const LUNAR_DAY = 709;          // hours in a synodic month (29.53 d)

const $ = (id) => document.getElementById(id);
let EPH, SITES, DEMI, DEMM, HILL, START_MS, NH, REGIONS = [], VALID = null;
let sunV, earthV;               // Float64Array(NH*3)
const cache = new Map();
const S = { site: null, base: 0, off: 0, playing: false, cmp: [], mode: "planner" };

/* ---------- vectors ---------- */
function llv(lat, lon) {
  const a = lat * D, b = lon * D;
  return [Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)];
}
function frame(lat, lon) {
  const up = llv(lat, lon);
  const east = [-Math.sin(lon * D), Math.cos(lon * D), 0];
  const north = [-Math.sin(lat * D) * Math.cos(lon * D), -Math.sin(lat * D) * Math.sin(lon * D), Math.cos(lat * D)];
  return { up, east, north };
}

/* ---------- data loading ---------- */
async function load() {
  const [eph, sites, demm, dem] = await Promise.all([
    fetch("data/ephemeris.json").then((r) => r.json()),
    fetch("data/sites.json").then((r) => r.json()),
    fetch("data/dem_small.json").then((r) => r.json()),
    fetch("data/dem_small.bin").then((r) => r.arrayBuffer()),
  ]);
  EPH = eph; SITES = sites; DEMM = demm; DEMI = new Int16Array(dem);
  try { REGIONS = await fetch("data/artemis_regions.json").then((r) => r.json()); } catch (e) { REGIONS = []; }
  try { VALID = await fetch("data/validation.json").then((r) => r.json()); } catch (e) { VALID = null; }
  START_MS = Date.parse(eph.start_utc); NH = eph.count;
  sunV = new Float64Array(NH * 3); earthV = new Float64Array(NH * 3);
  for (let i = 0; i < NH; i++) {
    const s = llv(eph.sun_sub_lat[i], eph.sun_sub_lon[i]);
    const e = llv(eph.earth_sub_lat[i], eph.earth_sub_lon[i]);
    const d = eph.earth_dist_km[i];
    for (let k = 0; k < 3; k++) { sunV[i * 3 + k] = s[k]; earthV[i * 3 + k] = e[k] * d; }
  }
  HILL = new Image(); HILL.src = "data/hillshade.png";
  await HILL.decode();
}

/* ---------- terrain horizon for custom sites (downsampled LOLA) ---------- */
function demPix(lat, lon) {
  const k = 2 * DEMM.radius_m * Math.tan(Math.PI / 4 + (lat * D) / 2);
  return [DEMM.center - (k * Math.cos(lon * D)) / DEMM.scale_m, DEMM.center + (k * Math.sin(lon * D)) / DEMM.scale_m];
}
function demAt(l, s) {
  const n = DEMM.n, l0 = Math.floor(l), s0 = Math.floor(s);
  if (l0 < 0 || s0 < 0 || l0 >= n - 1 || s0 >= n - 1) return NaN;
  const fl = l - l0, fs = s - s0, i = l0 * n + s0;
  return DEMI[i] * (1 - fl) * (1 - fs) + DEMI[i + n] * fl * (1 - fs) + DEMI[i + 1] * (1 - fl) * fs + DEMI[i + n + 1] * fl * fs;
}
function computeHorizon(lat, lon) {
  if (lat > -75.5) return { hz: null, elev: null };
  const [pl, ps] = demPix(lat, lon);
  let h0 = demAt(pl, ps);
  if (isNaN(h0)) return { hz: null, elev: null };
  const elev = h0; h0 += 2;
  const Rm = DEMM.radius_m, lat0 = lat * D, lon0 = lon * D;
  const hz = new Array(720);
  for (let a = 0; a < 720; a++) {
    const az = (a / 2) * D; let best = -90;
    for (let d = 1000; d < 250000; d += 1000) {
      const g = d / Rm;
      const lat2 = Math.asin(Math.sin(lat0) * Math.cos(g) + Math.cos(lat0) * Math.sin(g) * Math.cos(az));
      const lon2 = lon0 + Math.atan2(Math.sin(az) * Math.sin(g) * Math.cos(lat0), Math.cos(g) - Math.sin(lat0) * Math.sin(lat2));
      const [l, s] = demPix(lat2 / D, lon2 / D);
      const h = demAt(l, s);
      if (isNaN(h)) continue;
      const r1 = Rm + h, r0 = Rm + h0;
      const el = Math.atan2(r1 * Math.cos(g) - r0, r1 * Math.sin(g)) / D;
      if (el > best) best = el;
    }
    hz[a] = Math.round(best * 100) / 100;
  }
  return { hz, elev: Math.round(elev) };
}

/* ---------- per-site hourly geometry ---------- */
function hzAt(hz, az) {
  if (!hz) return 0;
  const x = (((az % 360) + 360) % 360) * 2, i = Math.floor(x) % 720, f = x - Math.floor(x);
  return hz[i] * (1 - f) + hz[(i + 1) % 720] * f;
}
function siteCalc(site) {
  if (cache.has(site.id)) return cache.get(site.id);
  const { up, east, north } = frame(site.lat, site.lon);
  const P = up.map((v) => v * R);
  const c = {
    sEl: new Float32Array(NH), sAz: new Float32Array(NH), eEl: new Float32Array(NH), eAz: new Float32Array(NH),
    sVis: new Uint8Array(NH), eVis: new Uint8Array(NH), both: new Uint8Array(NH),
  };
  for (let i = 0; i < NH; i++) {
    const j = i * 3;
    const s = [sunV[j], sunV[j + 1], sunV[j + 2]];
    let e = [earthV[j] - P[0], earthV[j + 1] - P[1], earthV[j + 2] - P[2]];
    const n = Math.hypot(...e); e = e.map((v) => v / n);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    c.sEl[i] = Math.asin(dot(s, up)) / D;
    c.sAz[i] = ((Math.atan2(dot(s, east), dot(s, north)) / D) + 360) % 360;
    c.eEl[i] = Math.asin(dot(e, up)) / D;
    c.eAz[i] = ((Math.atan2(dot(e, east), dot(e, north)) / D) + 360) % 360;
    c.sVis[i] = c.sEl[i] > hzAt(site.horizon, c.sAz[i]) ? 1 : 0;
    c.eVis[i] = c.eEl[i] > hzAt(site.horizon, c.eAz[i]) ? 1 : 0;
    c.both[i] = c.sVis[i] & c.eVis[i];
  }
  cache.set(site.id, c);
  return c;
}
function runLen(arr, i) { // hours until arr changes value, null if beyond data
  const v = arr[i];
  for (let j = i + 1; j < NH; j++) if (arr[j] !== v) return j - i;
  return null;
}
function stats(c, i0, n = LUNAR_DAY) {
  let s = 0, e = 0, b = 0, dark = 0, maxDark = 0, maxEl = -90;
  const end = Math.min(NH, i0 + n);
  for (let i = i0; i < end; i++) {
    s += c.sVis[i]; e += c.eVis[i]; b += c.both[i];
    if (c.sVis[i]) dark = 0; else { dark++; maxDark = Math.max(maxDark, dark); }
    maxEl = Math.max(maxEl, c.sEl[i]);
  }
  const m = end - i0;
  return { sun: s / m, earth: e / m, both: b / m, maxDark, maxEl };
}

/* ---------- time helpers ---------- */
const hourToDate = (h) => new Date(START_MS + h * 3600e3);
const fmtDate = (h) => hourToDate(h).toISOString().slice(0, 16).replace("T", " ") + " UTC";
const fmtDay = (h) => hourToDate(h).toISOString().slice(0, 10);
function fmtDur(h) {
  if (h === null) return "always*";
  if (h < 48) return `${h} h`;
  const d = Math.floor(h / 24), r = h % 24;
  return `${d} d ${r} h`;
}
const T = () => Math.min(NH - 1, S.base + S.off);

/* ---------- canvas helpers ---------- */
function fit(cv) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight || +cv.getAttribute("height");
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/* ---------- map ---------- */
function mapXY(lat, lon, w) {
  const [l, s] = demPix(lat, lon);
  return [(s / DEMM.n) * w, (l / DEMM.n) * w];
}
function drawMap() {
  const cv = $("map"); const { ctx, w } = fit(cv);
  ctx.drawImage(HILL, 0, 0, w, w);
  ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.font = "10px system-ui";
  for (const lat of [-80, -85, -88]) {
    ctx.beginPath();
    for (let lon = 0; lon <= 360; lon += 3) { const [x, y] = mapXY(lat, lon, w); lon ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke(); const [x, y] = mapXY(lat, 0, w); ctx.fillText(`${lat}°`, x + 2, y - 2);
  }
  for (const lon of [0, 90, 180, 270]) {
    const [x1, y1] = mapXY(-90, lon, w), [x2, y2] = mapXY(-75.2, lon, w);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.fillText(`${lon}°E`, x2 + (lon === 90 ? -32 : 3), y2 + (lon === 180 ? -4 : 12));
  }
  // Artemis III candidate regions (NASA Moon Trek)
  ctx.strokeStyle = "rgba(61,220,151,.9)"; ctx.fillStyle = "rgba(61,220,151,.18)"; ctx.lineWidth = 1.2;
  for (const rg of REGIONS) {
    ctx.beginPath();
    rg.ring.forEach(([lon, lat], k) => { const [x, y] = mapXY(lat, lon, w); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.lineWidth = 1;
  for (const s of SITES) {
    if (s.lat > -75.3) continue;
    const [x, y] = mapXY(s.lat, s.lon, w);
    ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fillStyle = "#4aa8ff"; ctx.fill();
  }
  if (S.site && S.site.lat <= -75.3) {
    const [x, y] = mapXY(S.site.lat, S.site.lon, w);
    ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.strokeStyle = "#ffc83d"; ctx.lineWidth = 2.5; ctx.stroke(); ctx.lineWidth = 1;
  }
}
function mapClick(ev) {
  const cv = $("map"), r = cv.getBoundingClientRect();
  const s = ((ev.clientX - r.left) / r.width) * DEMM.n, l = ((ev.clientY - r.top) / r.height) * DEMM.n;
  const x = (s - DEMM.center) * DEMM.scale_m, y = -(l - DEMM.center) * DEMM.scale_m;
  const lat = (2 * Math.atan(Math.hypot(x, y) / (2 * DEMM.radius_m)) - Math.PI / 2) / D;
  const lon = ((Math.atan2(x, y) / D) + 360) % 360;
  if (lat > -75.2) return;
  setCustom(lat, lon);
}
let customN = 0;
function setCustom(lat, lon) {
  const { hz, elev } = computeHorizon(lat, lon);
  const id = `custom-${++customN}`;
  const site = {
    id, name: `Custom ${lat.toFixed(2)}°, ${lon.toFixed(2)}°E`, zh: "自訂地點", lat, lon, group: "Custom",
    note: hz ? "Terrain horizon computed live from NASA LOLA topography (960 m/px)." : "Outside the LOLA polar tile — smooth-sphere horizon used.",
    horizon: hz, elev_m: elev,
  };
  SITES.push(site);
  const o = document.createElement("option"); o.value = id; o.textContent = site.name; $("siteSelect").appendChild(o);
  $("siteSelect").value = id;
  selectSite(site);
}

/* ---------- sky panorama ---------- */
function drawSky() {
  const site = S.site, c = siteCalc(site), t = T(), i = Math.floor(t);
  const cv = $("sky"); const { ctx, w, h } = fit(cv);
  const padL = 34, padB = 20, W = w - padL - 6, H = h - padB - 6;
  // vertical range
  let lo = -1, hi = 3;
  for (let k = S.base; k < Math.min(NH, S.base + WIN); k++) { hi = Math.max(hi, c.sEl[k], c.eEl[k]); }
  if (site.horizon) { lo = Math.min(lo, Math.min(...site.horizon) - 0.5); hi = Math.max(hi, Math.max(...site.horizon)); }
  hi = Math.min(90, hi + 1.5); lo = Math.max(-10, lo);
  const X = (az) => padL + (az / 360) * W, Y = (el) => 6 + ((hi - el) / (hi - lo)) * H;
  const pxX = W / 360, pxY = H / (hi - lo);
  // sky
  const sunUp = c.sVis[i];
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#02040a"); g.addColorStop(1, sunUp ? "#0b1426" : "#05070d");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // grid
  ctx.font = "10px system-ui"; ctx.fillStyle = "#8b95ad"; ctx.strokeStyle = "rgba(255,255,255,.07)";
  const stepEl = hi - lo > 40 ? 15 : hi - lo > 15 ? 5 : hi - lo > 6 ? 2 : 1;
  for (let el = Math.ceil(lo / stepEl) * stepEl; el <= hi; el += stepEl) {
    ctx.beginPath(); ctx.moveTo(padL, Y(el)); ctx.lineTo(padL + W, Y(el)); ctx.stroke(); ctx.fillText(`${el}°`, 4, Y(el) + 3);
  }
  ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "N"].forEach((t2, k) => {
    const x = X(k * 45); ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x, 6 + H); ctx.stroke(); ctx.fillText(t2, x - 5, h - 6);
  });
  // geometric horizon
  ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(padL + W, Y(0)); ctx.stroke(); ctx.setLineDash([]);
  // paths for next 30 days
  for (let k = S.base; k < Math.min(NH, S.base + WIN); k += 2) {
    ctx.fillStyle = c.sVis[k] ? "rgba(255,200,61,.55)" : "rgba(255,200,61,.15)";
    ctx.fillRect(X(c.sAz[k]) - 0.8, Y(c.sEl[k]) - 0.8, 1.6, 1.6);
    ctx.fillStyle = c.eVis[k] ? "rgba(74,168,255,.6)" : "rgba(74,168,255,.15)";
    ctx.fillRect(X(c.eAz[k]) - 0.8, Y(c.eEl[k]) - 0.8, 1.6, 1.6);
  }
  // current bodies (interpolated)
  const f = t - i, j = Math.min(NH - 1, i + 1);
  const lerpAz = (a, b) => { let d = b - a; if (d > 180) d -= 360; if (d < -180) d += 360; return (a + d * f + 360) % 360; };
  const sAz = lerpAz(c.sAz[i], c.sAz[j]), sEl = c.sEl[i] + (c.sEl[j] - c.sEl[i]) * f;
  const eAz = lerpAz(c.eAz[i], c.eAz[j]), eEl = c.eEl[i] + (c.eEl[j] - c.eEl[i]) * f;
  const body = (az, el, r, col, glow) => {
    ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = glow;
    ctx.beginPath(); ctx.ellipse(X(az), Y(el), Math.max(2, r * pxX), Math.max(2, r * pxY), 0, 0, 7);
    ctx.fillStyle = col; ctx.fill(); ctx.restore();
  };
  body(eAz, eEl, EARTH_R, "#4aa8ff", 12);
  body(sAz, sEl, SUN_R, "#ffd75e", 22);
  // terrain silhouette (drawn after bodies so it occludes them)
  ctx.beginPath(); ctx.moveTo(padL, 6 + H);
  for (let a = 0; a <= 720; a++) ctx.lineTo(X(a / 2), Y(hzAt(site.horizon, a / 2)));
  ctx.lineTo(padL + W, 6 + H); ctx.closePath();
  const tg = ctx.createLinearGradient(0, Y(hi), 0, 6 + H);
  tg.addColorStop(0, sunUp ? "#8a8d96" : "#3a3c44"); tg.addColorStop(1, "#15161a");
  ctx.fillStyle = tg; ctx.fill();
  ctx.strokeStyle = sunUp ? "#c9ccd6" : "#5a5d66"; ctx.stroke();
  // labels
  ctx.font = "11px system-ui";
  const lab = (az, el, txt, col) => { ctx.fillStyle = col; ctx.fillText(txt, Math.min(X(az) + 10, padL + W - 110), Math.max(16, Y(el) - 8)); };
  lab(sAz, sEl, `Sun ${sEl.toFixed(2)}°${c.sVis[i] ? "" : " (hidden)"}`, "#ffd75e");
  lab(eAz, eEl, `Earth ${eEl.toFixed(2)}°${c.eVis[i] ? "" : " (hidden)"}`, "#7cc0ff");
  $("skyTitle").textContent = `Sky view · ${site.name} · ${fmtDate(t)}`;
  return { sAz, sEl, eAz, eEl };
}

/* ---------- timeline ---------- */
function drawBars(cv, c, i0, n, cursor) {
  const { ctx, w, h } = fit(cv);
  ctx.clearRect(0, 0, w, h);
  const small = h < 40, rows = [[c.sVis, "#ffc83d", "Sunlit"], [c.eVis, "#4aa8ff", "Earth"], [c.both, "#3ddc97", "Both"]];
  const padL = small ? 0 : 50, padB = small ? 0 : 18, rh = (h - padB) / 3;
  ctx.fillStyle = "#0e1422"; ctx.fillRect(padL, 0, w - padL, h - padB);
  const bw = (w - padL) / n;
  rows.forEach(([arr, col, name], r) => {
    ctx.fillStyle = col;
    for (let k = 0; k < n && i0 + k < NH; k++) if (arr[i0 + k]) ctx.fillRect(padL + k * bw, r * rh + 1, bw + 0.6, rh - 2);
    if (!small) { ctx.fillStyle = "#8b95ad"; ctx.font = "11px system-ui"; ctx.fillText(name, 2, r * rh + rh / 2 + 4); }
  });
  if (!small) {
    ctx.fillStyle = "#8b95ad"; ctx.font = "10px system-ui";
    for (let d = 0; d <= n / 24; d += 5) { const x = padL + d * 24 * bw; ctx.fillText(fmtDay(i0 + d * 24).slice(5), Math.min(x, w - 30), h - 4); }
  }
  if (cursor !== undefined) {
    const x = padL + cursor * bw; ctx.fillStyle = "#fff"; ctx.fillRect(x - 1, 0, 2, h - padB);
  }
}

/* ---------- cards ---------- */
function card(k, v, s, cls = "") { return `<div class="card"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="s">${s}</div></div>`; }
function drawCards(cur) {
  const c = siteCalc(S.site), i = Math.floor(T()), st = stats(c, i);
  const sRun = runLen(c.sVis, i), eRun = runLen(c.eVis, i), bRun = runLen(c.both, i);
  const sv = c.sVis[i], ev = c.eVis[i], bv = c.both[i];
  const horiz = Math.max(0, Math.sin(cur.sEl * D)) * (sv ? 1 : 0);
  let verdict, vcls, vsub;
  if (bv && (bRun === null || bRun >= 72)) { verdict = "GO"; vcls = "ok"; vsub = `Power + direct-to-Earth for ${fmtDur(bRun)}`; }
  else if (bv) { verdict = "SHORT"; vcls = "sunc"; vsub = `Only ${fmtDur(bRun)} of power + comms left`; }
  else if (sv) { verdict = "NO COMMS"; vcls = "no"; vsub = "Sunlit, but Earth hidden → needs relay"; }
  else if (ev) { verdict = "NO POWER"; vcls = "no"; vsub = "Earth visible, but site is in shadow"; }
  else { verdict = "NO-GO"; vcls = "no"; vsub = "Dark and out of contact"; }
  $("cards").innerHTML = [
    card("Verdict at this time", verdict, vsub, vcls + " verdict"),
    card("Sun elevation", `${cur.sEl.toFixed(2)}°`, sv ? "above terrain ✓ sunlit" : "blocked / below horizon", sv ? "sunc" : "no"),
    card(sv ? "Sunset in" : "Sunrise in", fmtDur(sRun), sv ? "until terrain or horizon blocks the Sun" : "until sunlight returns", sv ? "sunc" : ""),
    card("Earth elevation", `${cur.eEl.toFixed(2)}°`, ev ? "visible ✓ direct-to-Earth OK" : "hidden → relay needed", ev ? "earthc" : "no"),
    card(ev ? "Earthset in" : "Earthrise in", fmtDur(eRun), ev ? "comms window remaining" : "until direct link possible", ev ? "earthc" : ""),
    card("Sunlit · next lunar day", `${Math.round(st.sun * 100)}%`, `max Sun elevation ${st.maxEl.toFixed(1)}°`),
    card("Earth visible · lunar day", `${Math.round(st.earth * 100)}%`, `both: ${Math.round(st.both * 100)}%`),
    card("Longest darkness", fmtDur(st.maxDark), "battery / heater must survive this"),
    card("Solar panel output", sv ? "100%" : "0%", `sun-tracking panel · fixed flat panel ${Math.round(horiz * 100)}%`),
  ].join("");
  return { st, sRun, eRun, bRun };
}

/* ---------- learn mode ---------- */
function drawLearn(cur, info) {
  const el = $("learn");
  if (S.mode !== "learn") { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  const s = S.site, st = info.st;
  el.innerHTML = `
  <h3>☀️ Why is the Sun so low here?</h3>
  <p>The Moon's spin axis is tilted only <b>1.5°</b> to the Sun (Earth: 23.4°). Near the poles the Sun therefore skims along the horizon all month.
  At <b>${s.name}</b> (${s.lat.toFixed(2)}°) the Sun never climbs higher than <b class="sunc">${st.maxEl.toFixed(1)}°</b> during the next lunar day.
  In Taipei, the noon Sun is 40°–90° high.</p>
  <h3>⛰️ Why do a few kilometres matter so much?</h3>
  <p>When the Sun is only ~1° high, a hill 5 km away and 100 m tall casts a shadow over the site. Click two nearby points on the map: one on a crater
  rim and one on its floor. Their sunlit percentages can differ by more than 80 percentage points. Crater floors in <b>permanent shadow</b> keep water ice, but solar power is impossible there.</p>
  <h3>🌍 Why does Earth barely move?</h3>
  <p>The Moon always shows the same face to Earth (tidal locking), so Earth hangs almost fixed in the sky. It only wobbles a few degrees (<b>libration</b>).
  At the south pole Earth sits right on the horizon, so it rises and sets as it wobbles. On the far side Earth never rises, and a relay satellite is needed.</p>
  <h3>🌗 How long is a lunar day?</h3>
  <p>One sunrise to the next takes <b>29.5 Earth days</b>. At the equator that means about 14 days of light and 14 days of night at −170 °C.
  Here the longest darkness in the next lunar day is <b>${fmtDur(st.maxDark)}</b>. A lander's batteries and heaters must survive it.</p>
  <h3>🌑 No atmosphere means sharp, black shadows</h3>
  <p>There is no air to scatter light or bend it (no refraction), so the Sun vanishes the moment terrain blocks it, and the sky stays black even at noon.
  The horizon in this tool is the real LOLA terrain plus the curvature of the Moon.</p>
  <h3>🇨🇦 Partners are going to the south pole too</h3>
  <p>The Canadian Space Agency (CSA) is preparing a Canadian lunar rover mission to the Moon's south polar region, and CSA astronaut
  Jeremy Hansen is part of NASA's Artemis II crew. A rover faces the same two questions a lander does, but it moves, so the answers change
  with every kilometre: <i>Will my solar panels see the Sun? Can I talk to Earth?</i> Try the <b>Nearby alternatives</b> heatmap to see how far a rover
  would have to drive to reach better sunlight. Learn more at <a href="https://www.asc-csa.gc.ca/eng/astronomy/moon-exploration/" target="_blank">CSA Moon Exploration</a>.</p>
  <h3>🔬 Can I trust these numbers?</h3>
  <p>The Sun and Earth positions come from NASA JPL Horizons, and the terrain comes from NASA's LOLA laser altimeter. We checked the model against
  NASA Moon Trek's map of permanently shadowed regions: the two agree at ${VALID ? (VALID.agreement * 100).toFixed(1) : "–"}% of 300 random test points.</p>`;
}

/* ---------- comparison ---------- */
function cmpRow(sc, idx, best) {
  const c = siteCalc(sc.site), i = Math.floor(sc.t), st = stats(c, i);
  const sv = c.sVis[i], ev = c.eVis[i];
  return `<tr class="${best ? "best" : ""}" data-i="${idx}">
    <td><b>${sc.site.name}</b><br><span class="note">${fmtDate(sc.t)}</span></td>
    <td class="${sv ? "sunc" : "no"}">${sv ? "☀ " + fmtDur(runLen(c.sVis, i)) : "dark"}</td>
    <td class="${ev ? "earthc" : "no"}">${ev ? "🌍 " + fmtDur(runLen(c.eVis, i)) : "hidden"}</td>
    <td>${Math.round(st.sun * 100)}% / ${Math.round(st.earth * 100)}%</td>
    <td><canvas data-c="${idx}" height="18"></canvas></td></tr>`;
}
function drawCmp() {
  if (!S.cmp.length) { $("cmp").innerHTML = '<p class="note">Add scenarios to compare them side by side. The best one (longest remaining power + comms window) is highlighted in green.</p>'; return; }
  const score = (sc) => { const c = siteCalc(sc.site), i = Math.floor(sc.t); return c.both[i] ? (runLen(c.both, i) ?? 1e6) : -1 + stats(c, i).both; };
  const scores = S.cmp.map(score), bi = scores.indexOf(Math.max(...scores));
  $("cmp").innerHTML = `<table><tr><th>Scenario</th><th>Sun left</th><th>Earth left</th><th>Sun/Earth % (lunar day)</th><th>30 days</th></tr>
    ${S.cmp.map((sc, k) => cmpRow(sc, k, k === bi)).join("")}</table>`;
  document.querySelectorAll("#cmp canvas").forEach((cv) => { const sc = S.cmp[+cv.dataset.c]; drawBars(cv, siteCalc(sc.site), Math.floor(sc.t), WIN); });
  document.querySelectorAll("#cmp tr[data-i]").forEach((tr) => tr.onclick = () => {
    const sc = S.cmp[+tr.dataset.i]; $("siteSelect").value = sc.site.id; S.site = sc.site; setBase(Math.floor(sc.t)); });
}

/* ---------- landing window finder ---------- */
function findWindows() {
  const c = siteCalc(S.site), need = Math.max(1, +$("minDays").value) * 24, out = [];
  for (let i = 0; i < NH;) {
    if (c.both[i]) { let j = i; while (j < NH && c.both[j]) j++; if (j - i >= need) out.push([i, j - i]); i = j; } else i++;
  }
  if (!out.length) { $("windows").innerHTML = `<p class="no">No window of ${need / 24}+ days with Sun and Earth both in view at this site (2026-11 → 2028-12). Try a nearby rim or ridge.</p>`; return; }
  $("windows").innerHTML = `<p class="note">${out.length} windows found. Click one to jump there.</p><table><tr><th>Window opens</th><th>Duration</th></tr>
    ${out.slice(0, 40).map(([i, n]) => `<tr class="win" data-h="${i}"><td>${fmtDate(i)}</td><td class="ok">${fmtDur(n)}</td></tr>`).join("")}</table>`;
  document.querySelectorAll("#windows tr.win").forEach((tr) => tr.onclick = () => setBase(+tr.dataset.h));
}

/* ---------- links ---------- */
function drawLinks() {
  const s = S.site, lon180 = s.lon > 180 ? s.lon - 360 : s.lon;
  const hz = `https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='10'&CENTER='coord@301'&COORD_TYPE='GEODETIC'&SITE_COORD='${s.lon.toFixed(3)},${s.lat.toFixed(3)},0'&START_TIME='${fmtDay(T())}'&STOP_TIME='${fmtDay(T() + 48)}'&STEP_SIZE='1h'&QUANTITIES='4'&APPARENT='AIRLESS'`;
  $("links").innerHTML = `<span class="note">${s.lat.toFixed(3)}°, ${s.lon.toFixed(3)}°E (${lon180.toFixed(3)}°) ${s.elev_m != null ? "· elev " + s.elev_m + " m" : ""}</span><br>
    <a href="https://quickmap.lroc.asu.edu/" target="_blank">Open LROC Quickmap ↗</a>
    <a href="https://trek.nasa.gov/moon/" target="_blank">Open Moon Trek 3D ↗</a>
    <a href="${encodeURI(hz)}" target="_blank">Verify Sun position in JPL Horizons ↗</a>`;
}

/* ---------- main render ---------- */
function render() {
  const cur = drawSky();
  drawBars($("timeline"), siteCalc(S.site), S.base, WIN, S.off);
  const info = drawCards(cur);
  drawLearn(cur, info);
  drawMap();
  $("sliderLabel").textContent = `${fmtDate(T())} · +${(S.off / 24).toFixed(1)} days from start`;
  if (window.onRender) window.onRender(cur);
}
function setBase(h) {
  S.base = Math.max(0, Math.min(NH - 1 - WIN, Math.round(h))); S.off = 0; $("slider").value = 0;
  $("dateIn").value = hourToDate(S.base).toISOString().slice(0, 16);
  drawLinks(); render();
}
function selectSite(site) {
  S.site = site; $("siteNote").textContent = `${site.group}. ${site.note}${site.source ? " Source: " + site.source + "." : ""}${site.terrain ? " Terrain: " + site.terrain + "." : ""}`;
  $("latIn").value = site.lat.toFixed(3); $("lonIn").value = site.lon.toFixed(3);
  if (window.onSite) window.onSite(site);
  drawLinks(); render();
}

function wire() {
  const sel = $("siteSelect");
  const groups = [...new Set(SITES.map((s) => s.group))];
  sel.innerHTML = groups.map((g) => `<optgroup label="${g}">${SITES.filter((s) => s.group === g)
    .map((s) => `<option value="${s.id}">${s.name}</option>`).join("")}</optgroup>`).join("");
  if (VALID) $("validation").innerHTML = `<b>Validation:</b> our Sun-visibility model (JPL Horizons + LOLA terrain) agrees with NASA Moon Trek's
    LOLA permanently-shadowed-region map at <b class="ok">${(VALID.agreement * 100).toFixed(1)}%</b> of ${VALID.n_points} random south-pole test points
    (${VALID.psr_detected}/${VALID.psr_points} shadowed, ${VALID.lit_detected}/${VALID.lit_points} sunlit).`;
  sel.onchange = () => selectSite(SITES.find((s) => s.id === sel.value));
  $("goCustom").onclick = () => {
    const lat = +$("latIn").value, lon = ((+$("lonIn").value % 360) + 360) % 360;
    if (lat < -90 || lat > 90 || isNaN(lat)) return; setCustom(lat, lon);
  };
  $("map").onclick = mapClick;
  $("dateIn").onchange = () => { const ms = Date.parse($("dateIn").value + ":00Z"); if (!isNaN(ms)) setBase((ms - START_MS) / 3600e3); };
  $("slider").oninput = () => { S.off = +$("slider").value; render(); };
  document.querySelectorAll(".quick button").forEach((b) => b.onclick = () => setBase(S.base + S.off + +b.dataset.shift));
  $("play").onclick = () => {
    S.playing = !S.playing; $("play").textContent = S.playing ? "❚❚" : "▶";
    const step = () => { if (!S.playing) return; S.off = (S.off + 2) % WIN; $("slider").value = S.off; render(); requestAnimationFrame(step); };
    step();
  };
  $("addCmp").onclick = () => { S.cmp.push({ site: S.site, t: T() }); drawCmp(); };
  $("cmpAll").onclick = () => { S.cmp = SITES.filter((s) => !s.id.startsWith("custom")).map((s) => ({ site: s, t: T() })); drawCmp(); };
  $("clearCmp").onclick = () => { S.cmp = []; drawCmp(); };
  $("findWin").onclick = findWindows;
  // S.mode ("planner" / "learn") is set by the tabs (tabs.js)
  window.addEventListener("resize", () => { render(); drawCmp(); });
}

(async function init() {
  await load();
  wire();
  const want = (location.hash.match(/site=([\w-]+)/) || [])[1];
  S.site = SITES.find((s) => s.id === want) || SITES[0];
  $("siteSelect").value = S.site.id;
  selectSite(S.site);
  const now = Math.floor((Date.now() - START_MS) / 3600e3);
  setBase(Math.max(0, Math.min(NH - 1 - WIN, now)));
  drawCmp();
  // URL options, e.g. #site=a3-connecting-ridge&cmp&win&learn (handy for sharing and screenshots)
  const h = location.hash;
  if (/[#&]cmp\b/.test(h)) $("cmpAll").click();
  if (/[#&]win\b/.test(h)) $("findWin").click();
})();
