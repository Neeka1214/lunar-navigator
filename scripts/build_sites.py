"""Build the curated landing-site list from NASA Moon Trek services.

Sources (all NASA Moon Trek, https://trek.nasa.gov/moon/):
  - CLPS_sites MapServer      : CLPS mission landing sites
  - A3_Named_regions          : the 13 Artemis III candidate landing regions (NASA, 2022)
Plus a few reference sites (Apollo 11, ISRO Chandrayaan-3, JAXA SLIM, Shackleton floor).

Output: scripts/sites.json (input for compute_horizons.py), web/data/artemis_regions.json
Code written with AI assistance (Claude); see README.
"""
import json
import ssl
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLPS = ("https://trek.nasa.gov/moon/trekarcgis3/rest/services/CLPS_sites/MapServer/0/query"
        "?where=1%3D1&outFields=*&returnGeometry=true&f=pjson")
A3 = "https://trek.nasa.gov/moon/TrekWS/rest/cat/data/stream?label=A3_Named_regions"


def get(url):
    try:
        ctx = ssl.create_default_context()
        return json.loads(urllib.request.urlopen(url, timeout=120, context=ctx).read())
    except urllib.error.URLError:
        ctx = ssl._create_unverified_context()  # some networks intercept TLS
        return json.loads(urllib.request.urlopen(url, timeout=120, context=ctx).read())


def slug(s):
    return "".join(c.lower() if c.isalnum() else "-" for c in s).strip("-").replace("--", "-")


def main():
    sites = []
    # --- Artemis III candidate regions (polygons -> representative point = vertex mean)
    a3 = get(A3)
    regions = []
    for f in a3["features"]:
        ring = f["geometry"]["coordinates"][0][:-1]
        name = f["properties"]["label"]
        # average in 3D to avoid longitude wrap problems near the pole
        import math
        x = y = z = 0
        for lon, lat in ring:
            a, b = math.radians(lat), math.radians(lon)
            x += math.cos(a) * math.cos(b); y += math.cos(a) * math.sin(b); z += math.sin(a)
        lat = math.degrees(math.atan2(z, math.hypot(x, y)))
        lon = math.degrees(math.atan2(y, x)) % 360
        regions.append({"name": name, "ring": ring})
        sites.append({
            "id": "a3-" + slug(name), "name": f"Artemis III: {name}",
            "lat": round(lat, 4), "lon": round(lon, 4), "group": "Artemis III candidate region",
            "source": "NASA Moon Trek, Artemis III Candidate Landing Regions (A3_Named_regions)",
            "note": "Center of one of the 13 Artemis III candidate regions announced by NASA (Aug 2022).",
        })
    # --- CLPS sites
    clps = get(CLPS)
    for f in clps["features"]:
        at, g = f["attributes"], f["geometry"]
        sites.append({
            "id": "clps-" + slug(at["LABEL"]), "name": f"CLPS: {at['LABEL']}",
            "lat": round(g["y"], 4), "lon": round(g["x"] % 360, 4), "group": "CLPS (NASA Commercial Lunar Payload Services)",
            "source": "NASA Moon Trek, CLPS_sites layer",
            "note": f"{at['site']} · lander {at['lander']} · task order {at['clps_contr']}.",
        })
    # IM-2: the Moon Trek point is the original PRIME-1 target near Shackleton (it falls on the
    # crater floor in the 80 m DEM). IM-2 actually landed at Mons Mouton in March 2025.
    for s in sites:
        if s["id"] == "clps-intuitive-machines-im-2":
            s.update(lat=-84.7906, lon=29.1957,
                     source="Moon Trek CLPS_sites (target) + reported landing coordinates (approx.)",
                     note="Landed at Mons Mouton, Mar 2025. Moon Trek lists the original target near Shackleton (-89.63, 132.32).")
    # --- reference sites (other nations / Apollo / PSR demo)
    sites += [
        {"id": "shackleton-floor", "name": "Shackleton Crater floor (PSR)",
         "lat": -89.67, "lon": 129.78, "group": "Permanently shadowed region",
         "source": "Crater center; PSR status checked against Moon Trek PSR map",
         "note": "Crater floor in permanent shadow: a water-ice target, but solar power is impossible here."},
        {"id": "chandrayaan3", "name": "Chandrayaan-3 Vikram (ISRO, India)",
         "lat": -69.373, "lon": 32.319, "group": "Other nations (Space Agency Partner)",
         "source": "ISRO public landing coordinates", "note": "ISRO lander, August 2023."},
        {"id": "slim", "name": "SLIM (JAXA, Japan)",
         "lat": -13.316, "lon": 25.251, "group": "Other nations (Space Agency Partner)",
         "source": "JAXA public landing coordinates", "note": "JAXA precision lander, January 2024."},
        {"id": "apollo11", "name": "Apollo 11 Tranquility Base",
         "lat": 0.6741, "lon": 23.4730, "group": "Apollo (comparison)",
         "source": "NASA / Moon Trek Apollo 11 bookmark",
         "note": "Equatorial reference: the Sun climbs high and Earth hangs almost fixed in the sky."},
    ]
    (ROOT / "scripts" / "sites.json").write_text(json.dumps(sites, ensure_ascii=False, indent=1), encoding="utf-8")
    out = ROOT / "web" / "data"
    out.mkdir(parents=True, exist_ok=True)
    (out / "artemis_regions.json").write_text(json.dumps(regions), encoding="utf-8")
    print(f"{len(sites)} sites ({len(regions)} Artemis III regions, {len(clps['features'])} CLPS)")


if __name__ == "__main__":
    main()
