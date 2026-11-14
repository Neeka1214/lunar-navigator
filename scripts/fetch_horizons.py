"""Fetch Sun and Earth geometry for the Moon from NASA JPL Horizons.
Code written with AI assistance (Claude, Anthropic).

For every hour in the time range we store:
  - sub-Earth point on the Moon (lon, lat)   -> direction of Earth in Moon-fixed frame
  - sub-solar point on the Moon (lon, lat)   -> direction of Sun in Moon-fixed frame
  - Earth-Moon distance (km)                 -> for topocentric parallax of Earth

With these, the web app computes Sun/Earth azimuth & elevation for ANY lunar
site (curated or custom) without calling Horizons from the browser.

Output: web/data/ephemeris.json
"""
import json
import ssl
import urllib.parse
import urllib.request
from pathlib import Path

AU_KM = 149597870.7
START = "2026-11-01"
STOP = "2029-01-01"
STEP = "1h"

OUT = Path(__file__).resolve().parent.parent / "web" / "data" / "ephemeris.json"


def horizons(params):
    base = "https://ssd.jpl.nasa.gov/api/horizons.api"
    q = urllib.parse.urlencode({k: f"'{v}'" for k, v in params.items()} | {"format": "text"})
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(f"{base}?{q}", timeout=300, context=ctx) as r:
            return r.read().decode()
    except urllib.error.URLError:
        # some networks intercept TLS; data is public, so fall back to unverified
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(f"{base}?{q}", timeout=300, context=ctx) as r:
            return r.read().decode()


def main():
    txt = horizons({
        "COMMAND": "301",           # target: Moon
        "CENTER": "500@399",        # observer: Earth geocenter
        "EPHEM_TYPE": "OBSERVER",
        "OBJ_DATA": "NO",
        "MAKE_EPHEM": "YES",
        "START_TIME": START,
        "STOP_TIME": STOP,
        "STEP_SIZE": STEP,
        "QUANTITIES": "14,15,20",   # obs sub-point, sun sub-point, range
        "ANG_FORMAT": "DEG",
        "CSV_FORMAT": "YES",
    })
    body = txt.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()
    e_lon, e_lat, s_lon, s_lat, dist = [], [], [], [], []
    for line in body:
        f = [x.strip() for x in line.split(",")]
        e_lon.append(round(float(f[3]), 4))
        e_lat.append(round(float(f[4]), 4))
        s_lon.append(round(float(f[5]), 4))
        s_lat.append(round(float(f[6]), 4))
        dist.append(round(float(f[7]) * AU_KM))
    first = body[0].split(",")[0].strip()
    data = {
        "source": "NASA JPL Horizons System (DE441), Moon (301) observed from Earth geocenter",
        "start_utc": START + "T00:00:00Z",
        "step_hours": 1,
        "first_row": first,
        "count": len(body),
        "earth_sub_lon": e_lon,
        "earth_sub_lat": e_lat,
        "sun_sub_lon": s_lon,
        "sun_sub_lat": s_lat,
        "earth_dist_km": dist,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":")))
    print(f"wrote {OUT} rows={len(body)} first={first} size={OUT.stat().st_size/1e6:.2f} MB")


if __name__ == "__main__":
    main()
