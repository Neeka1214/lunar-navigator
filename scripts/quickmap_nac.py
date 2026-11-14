"""Attach LROC NAC image coverage to every curated site, from the LROC Quickmap features API.

Source: LROC QuickMap (https://quickmap.lroc.asu.edu/) public OGC features API,
collection "nac" (footprints + metadata of every LRO Narrow Angle Camera image).
For each site we store: number of NAC images covering it, best resolution,
the image with the best resolution, and the most recent image (with links to LROC data).

Input/Output: web/data/sites.json (adds "nac" field) — run after compute_horizons.py
Code written with AI assistance (Claude); see README.
"""
import json
import math
import ssl
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://features-api.quickmap.io/collections/nac.geojson"


def get(url):
    for ctx in (ssl.create_default_context(), ssl._create_unverified_context()):
        try:
            return json.loads(urllib.request.urlopen(url, timeout=180, context=ctx).read())
        except urllib.error.URLError:
            continue
    raise RuntimeError("Quickmap API unreachable")


def _in_ring(ring, x, y):
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-15) + x1:
            inside = not inside
    return inside


def contains(geom, lat, lon):
    """Point-in-footprint test, tolerant of the 0/360 longitude seam."""
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    for poly in polys:
        ring = poly[0]
        xs = [p[0] for p in ring]
        # unwrap ring longitudes relative to its first vertex
        ref = xs[0]
        ring2 = [[ref + ((p[0] - ref + 180) % 360) - 180, p[1]] for p in ring]
        for L in (lon, lon - 360, lon + 360):
            Lw = ref + ((L - ref + 180) % 360) - 180
            if _in_ring(ring2, Lw, lat):
                return True
    return False


def nac_for(lat, lon):
    dlat = 0.003  # ~90 m box: images that cover the landing point itself
    dlon = min(5.0, dlat / max(0.01, math.cos(math.radians(lat))))
    # Footprints are stored in mixed longitude conventions (0..360 and -180..180), so query
    # both, merge by product id, then keep only footprints that really contain the site.
    feats = {}
    for L in {lon % 360, ((lon + 180) % 360) - 180}:
        url = f"{API}?bbox={L - dlon:.5f},{lat - dlat:.5f},{L + dlon:.5f},{lat + dlat:.5f}&limit=10000"
        for f in get(url)["features"]:
            feats[f["properties"]["product_id"]] = f
    imgs = []
    for f in feats.values():
        p = f["properties"]
        if not p.get("resolution") or not contains(f["geometry"], lat, lon):
            continue
        imgs.append({"id": p["product_id"], "res": round(float(p["resolution"]), 2),
                     "time": (p.get("stop_time") or "")[:10], "inc": p.get("incidence_angle"),
                     "url": p.get("url")})
    if not imgs:
        return {"count": 0}
    best = min(imgs, key=lambda x: x["res"])
    latest = max(imgs, key=lambda x: x["time"])
    return {"count": len(imgs), "best": best, "latest": latest,
            "source": "LROC QuickMap features API (collection nac)"}


def main():
    p = ROOT / "web" / "data" / "sites.json"
    sites = json.loads(p.read_text(encoding="utf-8"))
    for s in sites:
        try:
            s["nac"] = nac_for(s["lat"], s["lon"])
        except Exception as e:  # keep going if one query fails
            s["nac"] = {"count": None, "error": str(e)[:80]}
        n = s["nac"]
        print(f"{s['id']:40s} NAC images={n.get('count')} best={n.get('best', {}).get('res')} m")
    p.write_text(json.dumps(sites, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
