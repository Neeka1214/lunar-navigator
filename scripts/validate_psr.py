"""Validate our Sun-visibility model against NASA Moon Trek's LOLA PSR map.

Moon Trek product: "LOLA Permanently Shadowed Regions Southpole 240m"
(label LRO_LOLA_Illumination_SPole65S_240m_EQ, derived from LDEM_75S_240M).

For random points near the south pole we compute, with OUR pipeline
(JPL Horizons sub-solar points + LOLA terrain horizon), whether the Sun's
center ever clears the local horizon during 2026-11 .. 2028-12, and compare
with Moon Trek's binary PSR flag at the same point.

Output: web/data/validation.json  (summary shown in the web app)
Code written with AI assistance (Claude); see README.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

import compute_horizons as ch

ROOT = Path(__file__).resolve().parent.parent
Image.MAX_IMAGE_PIXELS = None


def load_psr():
    im = Image.open(ROOT / "data_raw" / "PSR_SPole_240m_MoonTrek.tif")
    a = np.array(im)
    tie = im.tag_v2[33922]  # (i, j, k, lon0, lat0, z)
    sc = im.tag_v2[33550]
    return a, tie[3], tie[4], sc[0], sc[1]


def psr_at(psr, lat, lon):
    a, lon0, lat0, dx, dy = psr
    lon180 = ((lon + 180) % 360) - 180
    col = int((lon180 - lon0) / dx)
    row = int((lat0 - lat) / dy)
    # PSR pixels are small; take a 3x3 majority to reduce edge noise
    win = a[max(0, row - 1):row + 2, max(0, col - 1):col + 2]
    return int(win[1, 1] if win.shape == (3, 3) else a[row, col]), float((win > 0).mean())


def sun_vectors():
    e = json.loads((ROOT / "web" / "data" / "ephemeris.json").read_text())
    la = np.radians(np.array(e["sun_sub_lat"]))
    lo = np.radians(np.array(e["sun_sub_lon"]))
    return np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], axis=1)


def ever_sunlit(dem, S, lat, lon):
    _, hz = ch.horizon(dem, lat, lon)
    a, b = np.radians(lat), np.radians(lon)
    up = np.array([np.cos(a) * np.cos(b), np.cos(a) * np.sin(b), np.sin(a)])
    east = np.array([-np.sin(b), np.cos(b), 0])
    north = np.cross(up, east)
    el = np.degrees(np.arcsin(S @ up))
    az = (np.degrees(np.arctan2(S @ east, S @ north)) + 360) % 360
    x = az * 2
    i = np.floor(x).astype(int) % 720
    f = x - np.floor(x)
    h = hz[i] * (1 - f) + hz[(i + 1) % 720] * f
    return bool((el > h).any()), float((el > h).mean())


def main():
    rng = np.random.default_rng(42)
    dem = ch.load_dem()
    psr = load_psr()
    S = sun_vectors()
    # candidate points: uniform in area between 84S and 89.8S
    pts = []
    while len(pts) < 4000:
        colat = np.degrees(np.arccos(rng.uniform(np.cos(np.radians(6.0)), np.cos(np.radians(0.2)))))
        lat = -(90.0 - colat)  # area-uniform between 84S and 89.8S
        lon = rng.uniform(0, 360)
        flag, frac = psr_at(psr, lat, lon)
        if frac in (0.0, 1.0):  # skip PSR edge pixels (ambiguous at 240 m)
            pts.append((lat, lon, flag))
    pts = np.array(pts)
    shadow = pts[pts[:, 2] > 0][:150]
    lit = pts[pts[:, 2] == 0][:150]
    sample = np.vstack([shadow, lit])
    tp = tn = fp = fn = 0
    rows = []
    for lat, lon, flag in sample:
        lit_ours, frac = ever_sunlit(dem, S, lat, lon)
        ours_psr = not lit_ours
        nasa_psr = flag > 0
        tp += ours_psr and nasa_psr
        tn += (not ours_psr) and (not nasa_psr)
        fp += ours_psr and not nasa_psr
        fn += (not ours_psr) and nasa_psr
        rows.append([round(lat, 3), round(lon, 3), int(nasa_psr), int(ours_psr), round(frac, 3)])
    n = len(sample)
    acc = (tp + tn) / n
    out = {
        "reference": "NASA Moon Trek: LOLA Permanently Shadowed Regions Southpole 240m (LRO_LOLA_Illumination_SPole65S_240m_EQ)",
        "n_points": n, "agreement": round(acc, 4),
        "psr_points": int(len(shadow)), "psr_detected": int(tp),
        "lit_points": int(len(lit)), "lit_detected": int(tn),
        "period": "2026-11 to 2028-12 (hourly JPL Horizons)", "samples": rows,
    }
    (ROOT / "web" / "data" / "validation.json").write_text(json.dumps(out))
    print(f"agreement {acc:.1%}  PSR {tp}/{len(shadow)}  lit {tn}/{len(lit)}  (fp={fp}, fn={fn})")


if __name__ == "__main__":
    main()
