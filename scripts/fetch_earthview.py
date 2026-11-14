"""Fetch "which side of Earth faces the Moon" from NASA JPL Horizons (for the Astronaut View).

Hourly, 2026-11 .. 2028-12, Earth (399) observed from the Moon's center (500@301):
  - ObsSub-LON/LAT : sub-Moon point on Earth (where the Moon is overhead = center of the Earth disk an astronaut sees)
  - SunSub-LON/LAT : sub-solar point on Earth (for Earth's day/night terminator and phase)

Output: web/data/earthview.json
Code written with AI assistance (Claude); see README.
"""
import json
from pathlib import Path

from fetch_horizons import horizons, START, STOP, STEP

OUT = Path(__file__).resolve().parent.parent / "web" / "data" / "earthview.json"


def main():
    txt = horizons({
        "COMMAND": "399", "CENTER": "500@301", "EPHEM_TYPE": "OBSERVER", "OBJ_DATA": "NO", "MAKE_EPHEM": "YES",
        "START_TIME": START, "STOP_TIME": STOP, "STEP_SIZE": STEP,
        "QUANTITIES": "14,15", "ANG_FORMAT": "DEG", "CSV_FORMAT": "YES",
    })
    body = txt.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()
    m_lon, m_lat, s_lon, s_lat = [], [], [], []
    for line in body:
        f = [x.strip() for x in line.split(",")]
        m_lon.append(round(float(f[3]), 3)); m_lat.append(round(float(f[4]), 3))
        s_lon.append(round(float(f[5]), 3)); s_lat.append(round(float(f[6]), 3))
    # Horizons gives Earth longitudes 0..360 east; convert to -180..180 for mapping
    w = lambda a: [round(((x + 180) % 360) - 180, 3) for x in a]
    OUT.write_text(json.dumps({
        "source": "NASA JPL Horizons, Earth (399) from Moon center (500@301), quantities 14 & 15",
        "start_utc": START + "T00:00:00Z", "step_hours": 1, "count": len(body), "first_row": body[0].split(",")[0].strip(),
        "moon_sub_lon": w(m_lon), "moon_sub_lat": m_lat, "sun_sub_lon": w(s_lon), "sun_sub_lat": s_lat,
    }, separators=(",", ":")))
    print(f"wrote {OUT} rows={len(body)} first={body[0][:40]}")


if __name__ == "__main__":
    main()
