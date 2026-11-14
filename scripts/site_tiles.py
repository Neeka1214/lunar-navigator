"""Per-site neighbourhood products for south-polar curated sites (lat < -80):

1. Alternative-site heatmap: 31 x 31 grid, 1 km spacing (+-15 km) around the site.
   For each grid point: % of time sunlit, % Earth visible, % both, over 2026-11..2028-12
   (JPL Horizons sub-solar/sub-Earth points + LOLA terrain horizon).
2. 3D terrain tile: 151 x 151 heights, 200 m spacing (+-15 km), from LOLA LDEM_80S_80M,
   in a local east/north frame, lunar curvature included.

Output: web/data/tiles/<site-id>.json
Code written with AI assistance (Claude); see README.
"""
import json
import sys
import time
from pathlib import Path

import numpy as np

import compute_horizons as ch

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data" / "tiles"
R = ch.R
NAZ = 180  # 2-degree azimuth bins are enough for % statistics
HM_N, HM_STEP = 31, 1000.0
TR_N, TR_STEP = 151, 200.0


def dest(lat, lon, east_m, north_m):
    """Point reached by moving east/north metres on the sphere from (lat, lon)."""
    d = np.hypot(east_m, north_m) / R
    az = np.arctan2(east_m, north_m)
    lat0, lon0 = np.radians(lat), np.radians(lon)
    lat2 = np.arcsin(np.sin(lat0) * np.cos(d) + np.cos(lat0) * np.sin(d) * np.cos(az))
    lon2 = lon0 + np.arctan2(np.sin(az) * np.sin(d) * np.cos(lat0), np.cos(d) - np.sin(lat0) * np.sin(lat2))
    return np.degrees(lat2), np.degrees(lon2) % 360


def horizon_fast(dems, lat, lon):
    lat0, lon0 = np.radians(lat), np.radians(lon)
    h0 = float(ch.height(dems, np.array([lat]), np.array([lon]))[0])
    if np.isnan(h0):
        return None
    h0 += 2.0
    az = np.radians(np.arange(NAZ) * (360 / NAZ))[:, None]
    d = np.concatenate([np.arange(80, 40e3, 80), np.arange(40e3, 250e3, 240)])[None, :]  # same as compute_horizons
    ang = d / R
    lat2 = np.arcsin(np.sin(lat0) * np.cos(ang) + np.cos(lat0) * np.sin(ang) * np.cos(az))
    lon2 = lon0 + np.arctan2(np.sin(az) * np.sin(ang) * np.cos(lat0), np.cos(ang) - np.sin(lat0) * np.sin(lat2))
    h = ch.height(dems, np.degrees(lat2), np.degrees(lon2))
    r0, r1 = R + h0, R + h
    el = np.degrees(np.arctan2(r1 * np.cos(ang) - r0, r1 * np.sin(ang)))
    return np.where(np.isnan(el), -90, el).max(axis=1)


def load_vectors(step=3):
    e = json.loads((ROOT / "web" / "data" / "ephemeris.json").read_text())
    def v(lat, lon):
        la, lo = np.radians(np.array(lat)), np.radians(np.array(lon))
        return np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], axis=1)
    S = v(e["sun_sub_lat"], e["sun_sub_lon"])[::step]
    E = (v(e["earth_sub_lat"], e["earth_sub_lon"]) * np.array(e["earth_dist_km"])[:, None] * 1000)[::step]
    return S, E


def visibility(hz, lat, lon, S, E):
    a, b = np.radians(lat), np.radians(lon)
    up = np.array([np.cos(a) * np.cos(b), np.cos(a) * np.sin(b), np.sin(a)])
    east = np.array([-np.sin(b), np.cos(b), 0])
    north = np.cross(up, east)
    Et = E - up * R
    Et /= np.linalg.norm(Et, axis=1)[:, None]
    def vis(D):
        el = np.degrees(np.arcsin(D @ up))
        az = (np.degrees(np.arctan2(D @ east, D @ north)) + 360) % 360
        return el > hz[(az / (360 / NAZ)).astype(int) % NAZ]
    s, e = vis(S), vis(Et)
    return s.mean(), e.mean(), (s & e).mean()


def one(st):
    dems = ch.load_dems()
    S, E = load_vectors()
    if True:
        t0 = time.time()
        # --- 3D terrain tile
        k = (np.arange(TR_N) - TR_N // 2) * TR_STEP
        ee, nn = np.meshgrid(k, k)  # rows = north index, cols = east index
        tl, tn = dest(st["lat"], st["lon"], ee.ravel(), nn.ravel())
        th = ch.height(dems, tl, tn).reshape(TR_N, TR_N)
        h_site = float(ch.height(dems, np.array([st["lat"]]), np.array([st["lon"]]))[0])
        drop = (ee ** 2 + nn ** 2) / (2 * R)  # curvature: the surface falls away from the site
        terrain = np.nan_to_num(th - h_site - drop, nan=0.0)
        # --- heatmap
        k2 = (np.arange(HM_N) - HM_N // 2) * HM_STEP
        sun = np.zeros((HM_N, HM_N)); earth = np.zeros_like(sun); both = np.zeros_like(sun)
        for i, n_m in enumerate(k2):
            for j, e_m in enumerate(k2):
                la, lo = dest(st["lat"], st["lon"], np.array([e_m]), np.array([n_m]))
                hz = horizon_fast(dems, float(la[0]), float(lo[0]))
                if hz is None:
                    sun[i, j] = earth[i, j] = both[i, j] = np.nan
                    continue
                sun[i, j], earth[i, j], both[i, j] = visibility(hz, float(la[0]), float(lo[0]), S, E)
        pct = lambda a: [[None if np.isnan(x) else int(round(x * 100)) for x in row] for row in a]
        data = {
            "id": st["id"], "lat": st["lat"], "lon": st["lon"],
            "heatmap": {"n": HM_N, "step_m": HM_STEP, "sun": pct(sun), "earth": pct(earth), "both": pct(both),
                        "period": "2026-11 to 2028-12, every 3 h"},
            "terrain": {"n": TR_N, "step_m": TR_STEP, "h": np.round(terrain).astype(int).tolist(),
                        "source": "LRO LOLA LDEM_80S_80M (NASA PDS)"},
            "note": "rows run south->north, columns west->east, centred on the site",
        }
        (OUT / f"{st['id']}.json").write_text(json.dumps(data, separators=(",", ":")))
        return f"{st['id']:40s} center sun={sun[HM_N//2, HM_N//2]:.0%} best sun={np.nanmax(sun):.0%} best both={np.nanmax(both):.0%} ({time.time()-t0:.0f}s)"


def main():
    from multiprocessing import Pool
    only = sys.argv[1:]
    sites = json.loads((ROOT / "web" / "data" / "sites.json").read_text(encoding="utf-8"))
    todo = [s for s in sites if s["lat"] <= -80 and (not only or s["id"] in only)]
    OUT.mkdir(parents=True, exist_ok=True)
    with Pool(max(1, min(len(todo), 8))) as pool:  # each worker holds ~300 MB of DEMs
        for msg in pool.imap_unordered(one, todo):
            print(msg, flush=True)


if __name__ == "__main__" and "--walk" not in sys.argv and "--fine" not in sys.argv:
    main()


# ---------------------------------------------------------------------------
# Walkable terrain (binary, loaded by the 3D "astronaut" mode)
#   near: +-40 km at 200 m (401 x 401, LOLA 80 m + 240 m)
#   far : +-150 km at 1 km (301 x 301, LOLA 240 m) so distant mountains appear on the horizon
# int16 metres relative to the site height, lunar curvature included, rows south->north.
def walk_terrain(st, dems):
    h_site = float(ch.height(dems, np.array([st["lat"]]), np.array([st["lon"]]))[0])
    out = {}
    for name, n, step in (("near", 401, 200.0), ("far", 301, 1000.0)):
        k = (np.arange(n) - n // 2) * step
        ee, nn = np.meshgrid(k, k)
        la, lo = dest(st["lat"], st["lon"], ee.ravel(), nn.ravel())
        h = ch.height(dems, la, lo).reshape(n, n) - h_site - (ee ** 2 + nn ** 2) / (2 * R)
        h = np.nan_to_num(h, nan=float(np.nanmin(h)) if np.isfinite(np.nanmin(h)) else 0.0)
        np.clip(np.round(h), -32768, 32767).astype("<i2").tofile(OUT / f"{st['id']}.{name}.bin")
        out[name] = {"n": n, "step_m": step}
    return out


def walk_main():
    dems = ch.load_dems()
    sites = json.loads((ROOT / "web" / "data" / "sites.json").read_text(encoding="utf-8"))
    for st in sites:
        if st["lat"] > -80:
            continue
        p = OUT / f"{st['id']}.json"
        data = json.loads(p.read_text())
        data["walk"] = walk_terrain(st, dems)
        p.write_text(json.dumps(data, separators=(",", ":")))
        print("walk terrain", st["id"], flush=True)


if __name__ == "__main__" and "--walk" in sys.argv:
    walk_main()


# ---------------------------------------------------------------------------
# Finer heatmap (500 m cells, 61 x 61, +-15 km); keeps the existing terrain/walk data
FINE_N, FINE_STEP = 61, 500.0


def fine_one(st):
    dems = ch.load_dems()
    S, E = load_vectors()
    t0 = time.time()
    k2 = (np.arange(FINE_N) - FINE_N // 2) * FINE_STEP
    sun = np.zeros((FINE_N, FINE_N)); earth = np.zeros_like(sun); both = np.zeros_like(sun)
    for i, n_m in enumerate(k2):
        for j, e_m in enumerate(k2):
            la, lo = dest(st["lat"], st["lon"], np.array([e_m]), np.array([n_m]))
            hz = horizon_fast(dems, float(la[0]), float(lo[0]))
            if hz is None:
                sun[i, j] = earth[i, j] = both[i, j] = np.nan
                continue
            sun[i, j], earth[i, j], both[i, j] = visibility(hz, float(la[0]), float(lo[0]), S, E)
    pct = lambda a: [[None if np.isnan(x) else int(round(x * 100)) for x in row] for row in a]
    p = OUT / f"{st['id']}.json"
    data = json.loads(p.read_text())
    data["heatmap"] = {"n": FINE_N, "step_m": FINE_STEP, "sun": pct(sun), "earth": pct(earth), "both": pct(both),
                       "period": "2026-11 to 2028-12, every 3 h"}
    p.write_text(json.dumps(data, separators=(",", ":")))
    return f"{st['id']:40s} fine heatmap done ({time.time()-t0:.0f}s)"


def fine_main():
    from multiprocessing import Pool
    sites = json.loads((ROOT / "web" / "data" / "sites.json").read_text(encoding="utf-8"))
    todo = [s for s in sites if s["lat"] <= -80]
    with Pool(8) as pool:
        for msg in pool.imap_unordered(fine_one, todo):
            print(msg, flush=True)


if __name__ == "__main__" and "--fine" in sys.argv:
    fine_main()
