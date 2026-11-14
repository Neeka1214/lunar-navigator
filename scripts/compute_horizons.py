"""Compute terrain horizon profiles for curated sites from NASA LRO LOLA topography.

Inputs (LRO LOLA gridded DEMs, south polar stereographic, NASA PDS LRO-L-LOLA-4-GDR-V1;
the same LOLA data that NASA Moon Trek and LROC Quickmap display):
  data_raw/LDEM_80S_80M.IMG   80 m/px, 80S-90S   (fine near-field terrain)
  data_raw/LDEM_75S_240M.IMG 240 m/px, 75S-90S   (far-field terrain / fallback)
Outputs:
  web/data/sites.json       curated sites + 720-azimuth horizon elevation (deg)
  web/data/dem_small.bin    downsampled DEM (int16 m) for custom-site horizons in the browser
  web/data/dem_small.json   metadata for dem_small.bin
  web/data/hillshade.png    map basemap

Azimuth: degrees clockwise from local north (toward +lat), the JPL Horizons convention.
The horizon includes lunar curvature; with no atmosphere there is no refraction.
Code written with AI assistance (Claude); see README.
"""
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
R = 1737400.0  # m, LOLA reference radius
NAZ = 720
MAX_DIST = 250e3


class Dem:
    def __init__(self, fname, n, scale):
        raw = np.fromfile(ROOT / "data_raw" / fname, dtype="<i2")
        self.a = raw.reshape(n, n).astype(np.float32) * 0.5  # m above 1737.4 km
        self.n, self.scale, self.c0 = n, scale, (n - 1) / 2.0

    def pix(self, lat, lon):
        """South polar stereographic (PDS LOLA). Returns (line, sample), 0-based."""
        lat, lon = np.radians(lat), np.radians(lon)
        k = 2 * R * np.tan(np.pi / 4 + lat / 2)
        # verified: Malapert peak +4.8 km, Shackleton floor -2.8 km
        return self.c0 - k * np.cos(lon) / self.scale, self.c0 + k * np.sin(lon) / self.scale

    def sample(self, lat, lon):
        line, s = self.pix(lat, lon)
        n = self.n
        l0, s0 = np.floor(line).astype(int), np.floor(s).astype(int)
        ok = (l0 >= 0) & (s0 >= 0) & (l0 < n - 1) & (s0 < n - 1)
        l0c, s0c = np.clip(l0, 0, n - 2), np.clip(s0, 0, n - 2)
        fl, fs = line - l0c, s - s0c
        a = self.a
        v = (a[l0c, s0c] * (1 - fl) * (1 - fs) + a[l0c + 1, s0c] * fl * (1 - fs)
             + a[l0c, s0c + 1] * (1 - fl) * fs + a[l0c + 1, s0c + 1] * fl * fs)
        return np.where(ok, v, np.nan)


_DEMS = None


def load_dems():
    global _DEMS
    if _DEMS is None:
        fine = Dem("LDEM_80S_80M.IMG", 7600, 80.0) if (ROOT / "data_raw" / "LDEM_80S_80M.IMG").exists() else None
        coarse = Dem("LDEM_75S_240M.IMG", 3812, 240.0)
        _DEMS = (fine, coarse)
    return _DEMS


def load_dem():  # backwards compatible (validate_psr.py)
    return load_dems()


def height(dems, lat, lon):
    fine, coarse = dems
    h = coarse.sample(lat, lon)
    if fine is not None:
        hf = fine.sample(lat, lon)
        h = np.where(np.isnan(hf), h, hf)
    return h


def horizon(dems, lat, lon, observer_m=2.0):
    """Return (site_height_m, horizon elevation array[NAZ] in degrees)."""
    if not isinstance(dems, tuple):
        dems = load_dems()
    lat0, lon0 = np.radians(lat), np.radians(lon)
    h0 = float(height(dems, np.array([lat]), np.array([lon]))[0])
    if np.isnan(h0):
        h0 = 0.0
    h0 += observer_m  # lander antenna / solar panel height
    az = np.radians(np.arange(NAZ) * (360 / NAZ))[:, None]
    # dense steps near the site (where 80 m detail matters), coarser far away
    d = np.concatenate([np.arange(80, 40e3, 80), np.arange(40e3, MAX_DIST, 240)])[None, :]
    ang = d / R
    lat2 = np.arcsin(np.sin(lat0) * np.cos(ang) + np.cos(lat0) * np.sin(ang) * np.cos(az))
    lon2 = lon0 + np.arctan2(np.sin(az) * np.sin(ang) * np.cos(lat0),
                             np.cos(ang) - np.sin(lat0) * np.sin(lat2))
    h = height(dems, np.degrees(lat2), np.degrees(lon2))
    r0, r1 = R + h0, R + h
    el = np.degrees(np.arctan2(r1 * np.cos(ang) - r0, r1 * np.sin(ang)))
    el = np.where(np.isnan(el), -90, el)
    return h0 - observer_m, el.max(axis=1)


def main():
    dems = load_dems()
    fine, coarse = dems
    print("fine DEM:", "yes" if fine is not None else "MISSING", "| coarse DEM ok")
    for name, lat, lon in [("Shackleton floor", -89.67, 129.78), ("Malapert", -85.99, 0.0)]:
        print(f"{name}: h={float(height(dems, np.array([lat]), np.array([lon]))[0]):.0f} m")
    if "--check" in sys.argv:
        return

    sites = json.loads((ROOT / "scripts" / "sites.json").read_text(encoding="utf-8"))
    for st in sites:
        l, s = coarse.pix(st["lat"], st["lon"])
        if 0 <= l < coarse.n - 1 and 0 <= s < coarse.n - 1:
            h0, hz = horizon(dems, st["lat"], st["lon"])
            st["elev_m"] = round(h0)
            st["horizon"] = [round(float(v), 2) for v in hz]
            st["terrain"] = "LOLA 80 m + 240 m" if st["lat"] < -80 else "LOLA 240 m"
        else:
            st["elev_m"], st["horizon"] = None, None  # browser uses the smooth-sphere horizon
            st["terrain"] = "none (outside LOLA polar coverage, sphere horizon)"
        hz_txt = f"max {max(st['horizon']):.1f} deg" if st["horizon"] else "sphere"
        print(f"{st['id']:40s} elev={st['elev_m']} horizon {hz_txt}")
    out = ROOT / "web" / "data"
    out.mkdir(parents=True, exist_ok=True)
    (out / "sites.json").write_text(json.dumps(sites, ensure_ascii=False), encoding="utf-8")

    # --- downsampled DEM for custom sites in the browser (240 m -> 960 m/px)
    f = 4
    n2 = coarse.n // f
    small = coarse.a[:n2 * f, :n2 * f].reshape(n2, f, n2, f).mean(axis=(1, 3))
    small.round().astype("<i2").tofile(out / "dem_small.bin")
    (out / "dem_small.json").write_text(json.dumps({
        "n": n2, "scale_m": coarse.scale * f, "center": (coarse.c0 + 0.5) / f - 0.5, "radius_m": R,
        "source": "LRO LOLA LDEM_75S_240M (NASA PDS), 4x averaged"}))

    # --- hillshade basemap
    from PIL import Image
    gy, gx = np.gradient(small, coarse.scale * f)
    azs, alt = np.radians(315), np.radians(35)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(azs - aspect)
    elev = (small - small.min()) / (small.max() - small.min())
    img = np.clip(0.75 * shade + 0.25 * elev, 0, 1)
    Image.fromarray((img * 255).astype(np.uint8)).save(out / "hillshade.png", optimize=True)
    print("done")


if __name__ == "__main__":
    main()
