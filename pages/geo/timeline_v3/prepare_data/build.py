#!/usr/bin/env python3
"""
Pattern of Life -- data pipeline (timeline_v3)
================================================

Turns a raw Google Timeline point export (a FeatureCollection of ~146K
timestamped Points spanning a decade) into a small set of clean, derived
artifacts that power the immersive front-end.

It performs a FULL data-quality pass -- no external deps, pure stdlib:

  1. Parse + time-sort
  2. Outlier / GPS-spike removal        (physically impossible speeds)
  3. Stay-point detection               (collapse dwell time to one node)
  4. Douglas-Peucker jitter simplify    (per segment, meter tolerance)
  5. Gap detection                      (break lines across tracking-off periods)
  6. Dwell clustering -> places         (home / work / frequent, with hours)
  7. Trip detection                     (long-distance relocations + flights)
  8. Transport-mode inference           (per-segment median speed -> foot/…/air)

Outputs (compact JSON, committed + CDN-cached) to  data/json/timeline/ :
  points.json     [[lng,lat,epochSec,mode], ...]      (cleaned, for playback + heatmap)
  segments.geojson  LineStrings w/ date/epoch/mode/speed  (no teleports)
  places.json     dwell clusters w/ hours/visits/label
  trips.json      long-distance arcs w/ from/to/date/mode
  chapters.json   narrative keyframes (authored + derived) for the data story
  stats.json      aggregates for ambient + stats panel

Usage:
  python3 build.py [input.geojson] [--out DIR]
Default input:  ./source/timeline_points.geojson  (falls back to the legacy path)
Default out:    <repo>/data/json/timeline
"""

import argparse
import json
import math
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone

# ------------------------------------------------------------------ tunables

STATIONARY_RADIUS_M = 60.0     # points within this of an anchor = same dwell
MIN_DWELL_SEC       = 600      # >=10 min in one spot counts as a "stay"
MAX_SPEED_MS        = 340.0    # ~1225 km/h; faster between points = GPS spike
DP_EPSILON_M        = 18.0     # Douglas-Peucker simplify tolerance (meters)
GAP_SEC             = 6 * 3600  # break a line if >6h between kept nodes
TRIP_MIN_KM         = 120.0    # jump this far between nodes = a trip/relocation
FLY_KM              = 600.0    # trip longer than this (or fast) = flight
PLACE_MERGE_M       = 180.0    # merge stays within this into one place
COORD_DP            = 5        # coordinate rounding (5dp ~= 1.1 m)

# Known home/anchor cities for labeling (lng, lat, label)
GAZETTEER = [
    (-72.5199, 42.3732, "Amherst, MA"),
    (-71.0589, 42.3601, "Boston, MA"),
    (-71.1097, 42.3736, "Cambridge, MA"),
    (-71.0920, 42.3876, "Somerville, MA"),
    (-90.1994, 38.6270, "St. Louis, MO"),
    (-87.6298, 41.8781, "Chicago, IL"),
    (-86.1581, 39.7684, "Indianapolis, IN"),
    (-73.9857, 40.7484, "New York, NY"),
    (-77.0369, 38.9072, "Washington, DC"),
    (-70.2568, 43.6591, "Portland, ME"),
]
GAZETTEER_MAX_KM = 35.0

# ------------------------------------------------------------------ geo utils

R_EARTH_M = 6371000.0

def haversine_m(lng1, lat1, lng2, lat2):
    p1 = math.radians(lat1); p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1); dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_EARTH_M * math.asin(min(1.0, math.sqrt(a)))

def to_xy(lng, lat, lat0):
    """Equirectangular meters relative to lat0 (good enough for local DP)."""
    x = math.radians(lng) * R_EARTH_M * math.cos(math.radians(lat0))
    y = math.radians(lat) * R_EARTH_M
    return x, y

def dp_simplify(pts, eps_m):
    """Douglas-Peucker on [(lng,lat), ...] with meter tolerance. Keeps ends."""
    if len(pts) < 3:
        return pts[:]
    lat0 = sum(p[1] for p in pts) / len(pts)
    xy = [to_xy(p[0], p[1], lat0) for p in pts]

    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        s, e = stack.pop()
        ax, ay = xy[s]; bx, by = xy[e]
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        dmax, idx = 0.0, -1
        for i in range(s + 1, e):
            px, py = xy[i]
            if seg2 == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = ((px - ax) * dx + (py - ay) * dy) / seg2
                t = max(0.0, min(1.0, t))
                d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > dmax:
                dmax, idx = d, i
        if dmax > eps_m and idx != -1:
            keep[idx] = True
            stack.append((s, idx)); stack.append((idx, e))
    return [pts[i] for i in range(len(pts)) if keep[i]]

def nearest_city(lng, lat):
    best, bestkm = None, 1e9
    for clng, clat, label in GAZETTEER:
        km = haversine_m(lng, lat, clng, clat) / 1000.0
        if km < bestkm:
            best, bestkm = label, km
    return best if bestkm <= GAZETTEER_MAX_KM else None

def mode_from_speed(ms):
    if ms < 2.2:   return 0   # foot / stationary
    if ms < 8.0:   return 1   # run / bike
    if ms < 62.0:  return 2   # drive / ground
    return 3                  # air

MODE_NAMES = {0: "foot", 1: "active", 2: "ground", 3: "air"}

# ------------------------------------------------------------------ load

def parse_ts(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None

def load_points(path):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    raw = []
    for ft in data.get("features", []):
        g = ft.get("geometry") or {}
        if g.get("type") != "Point":
            continue
        c = g.get("coordinates") or []
        if len(c) < 2:
            continue
        ts = parse_ts((ft.get("properties") or {}).get("timestamp", ""))
        if ts is None:
            continue
        raw.append((float(c[0]), float(c[1]), ts))
    raw.sort(key=lambda p: p[2])
    return raw

# ------------------------------------------------------------------ clean

def remove_outliers(pts):
    out = []
    for p in pts:
        if not out:
            out.append(p); continue
        lp = out[-1]
        dt = p[2] - lp[2]
        d = haversine_m(lp[0], lp[1], p[0], p[1])
        if dt <= 0:
            # same/earlier timestamp: keep only if essentially co-located
            if d > 50:
                continue
            continue
        if d / dt > MAX_SPEED_MS:
            continue
        out.append(p)
    return out

def detect_stays(pts):
    """
    Returns (nodes, stays).
    nodes: ordered [(lng,lat,epoch,is_stay)] -- a stay collapses to its centroid
           timestamped at arrival; move points pass through unchanged.
    stays: [(lng,lat,arr,dep,n)] for clustering into places.
    """
    nodes, stays = [], []
    n = len(pts)
    i = 0
    while i < n:
        j = i + 1
        while j < n and haversine_m(pts[i][0], pts[i][1], pts[j][0], pts[j][1]) <= STATIONARY_RADIUS_M:
            j += 1
        span = pts[j - 1][2] - pts[i][2]
        if span >= MIN_DWELL_SEC and (j - i) >= 2:
            cl = sum(p[0] for p in pts[i:j]) / (j - i)
            ca = sum(p[1] for p in pts[i:j]) / (j - i)
            arr, dep = pts[i][2], pts[j - 1][2]
            nodes.append((cl, ca, arr, True))
            stays.append((cl, ca, arr, dep, j - i))
            i = j
        else:
            p = pts[i]
            nodes.append((p[0], p[1], p[2], False))
            i += 1
    return nodes, stays

# ------------------------------------------------------------------ segments

def build_segments(nodes):
    """Split node stream into segments on gaps/large jumps; DP-simplify each."""
    segs = []
    cur = []
    for k, nd in enumerate(nodes):
        if not cur:
            cur = [nd]; continue
        prev = cur[-1]
        dt = nd[2] - prev[2]
        dkm = haversine_m(prev[0], prev[1], nd[0], nd[1]) / 1000.0
        if dt > GAP_SEC or dkm > TRIP_MIN_KM:
            if len(cur) >= 2:
                segs.append(cur)
            cur = [nd]
        else:
            cur.append(nd)
    if len(cur) >= 2:
        segs.append(cur)

    features = []
    for seg in segs:
        coords_full = [(nd[0], nd[1]) for nd in seg]
        simplified = dp_simplify(coords_full, DP_EPSILON_M)
        if len(simplified) < 2:
            continue
        # median speed across the segment
        speeds = []
        for a, b in zip(seg, seg[1:]):
            dt = b[2] - a[2]
            if dt > 0:
                speeds.append(haversine_m(a[0], a[1], b[0], b[1]) / dt)
        speeds.sort()
        med = speeds[len(speeds) // 2] if speeds else 0.0
        start_ts = seg[0][2]
        d = datetime.fromtimestamp(start_ts, tz=timezone.utc)
        length_km = sum(
            haversine_m(simplified[i][0], simplified[i][1],
                        simplified[i + 1][0], simplified[i + 1][1])
            for i in range(len(simplified) - 1)
        ) / 1000.0
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [[round(x, COORD_DP), round(y, COORD_DP)] for x, y in simplified],
            },
            "properties": {
                "date": d.strftime("%Y-%m-%d"),
                "epoch": int(start_ts),
                "year": d.year,
                "mode": MODE_NAMES[mode_from_speed(med)],
                "speed_ms": round(med, 2),
                "km": round(length_km, 2),
            },
        })
    return features

# ------------------------------------------------------------------ places

def cluster_places(stays):
    """Greedy merge of stays within PLACE_MERGE_M into places with dwell totals."""
    places = []
    for (lng, lat, arr, dep, npts) in stays:
        hours = max(0.0, (dep - arr) / 3600.0)
        placed = False
        for pl in places:
            if haversine_m(lng, lat, pl["_lng"], pl["_lat"]) <= PLACE_MERGE_M:
                w0 = pl["hours"]; w1 = hours
                tot = w0 + w1 if (w0 + w1) > 0 else 1
                pl["_lng"] = (pl["_lng"] * w0 + lng * w1) / tot
                pl["_lat"] = (pl["_lat"] * w0 + lat * w1) / tot
                pl["hours"] += hours
                pl["visits"] += 1
                pl["first"] = min(pl["first"], arr)
                pl["last"] = max(pl["last"], dep)
                placed = True
                break
        if not placed:
            places.append({
                "_lng": lng, "_lat": lat, "hours": hours, "visits": 1,
                "first": arr, "last": dep,
            })
    out = []
    for pl in places:
        lng = round(pl["_lng"], COORD_DP); lat = round(pl["_lat"], COORD_DP)
        out.append({
            "lng": lng, "lat": lat,
            "hours": round(pl["hours"], 1),
            "visits": pl["visits"],
            "first": datetime.fromtimestamp(pl["first"], tz=timezone.utc).strftime("%Y-%m-%d"),
            "last": datetime.fromtimestamp(pl["last"], tz=timezone.utc).strftime("%Y-%m-%d"),
            "label": nearest_city(lng, lat),
        })
    out.sort(key=lambda p: p["hours"], reverse=True)
    return out

def home_bases_by_year(stays):
    """Most-dwelt city label per year."""
    per_year = defaultdict(lambda: defaultdict(float))
    for (lng, lat, arr, dep, _n) in stays:
        y = datetime.fromtimestamp(arr, tz=timezone.utc).year
        label = nearest_city(lng, lat) or "%.2f,%.2f" % (lat, lng)
        per_year[y][label] += (dep - arr) / 3600.0
    result = {}
    for y, d in sorted(per_year.items()):
        best = max(d.items(), key=lambda kv: kv[1])
        result[str(y)] = {"label": best[0], "hours": round(best[1], 1)}
    return result

# ------------------------------------------------------------------ trips

def detect_trips(nodes):
    trips = []
    for a, b in zip(nodes, nodes[1:]):
        dkm = haversine_m(a[0], a[1], b[0], b[1]) / 1000.0
        if dkm >= TRIP_MIN_KM:
            dt = max(1.0, b[2] - a[2])
            speed_kmh = dkm / (dt / 3600.0)
            is_fly = dkm >= FLY_KM or speed_kmh > 200
            d = datetime.fromtimestamp(a[2], tz=timezone.utc)
            trips.append({
                "from": [round(a[0], COORD_DP), round(a[1], COORD_DP)],
                "to": [round(b[0], COORD_DP), round(b[1], COORD_DP)],
                "date": d.strftime("%Y-%m-%d"),
                "year": d.year,
                "km": round(dkm, 1),
                "mode": "air" if is_fly else "ground",
                "from_label": nearest_city(a[0], a[1]),
                "to_label": nearest_city(b[0], b[1]),
            })
    trips.sort(key=lambda t: t["km"], reverse=True)
    return trips

# ------------------------------------------------------------------ chapters

def build_chapters(stats, places, homes, trips):
    """Authored narrative + data-derived camera targets. Copy is editable."""
    def place_for(label):
        for p in places:
            if p["label"] == label:
                return [p["lng"], p["lat"]]
        return None

    y0 = stats["year_range"][0]; y1 = stats["year_range"][1]
    ch = []
    ch.append({
        "id": "intro", "title": "A Decade in Motion",
        "caption": "Every place I slept, worked, ran, drove, and flew for %d years — "
                   "%s GPS points, cleaned and rendered." % (y1 - y0 + 1, f"{stats['raw_points']:,}"),
        "camera": {"center": [-92.0, 40.0], "zoom": 3.1, "pitch": 0, "bearing": 0},
        "layer": "heatmap", "globe": True,
        "stats": [
            {"num": f"{int(stats['approx_miles']):,}", "label": "miles"},
            {"num": f"{stats['days_tracked']:,}", "label": "days tracked"},
            {"num": str(stats["places"]), "label": "places"},
        ],
    })
    if place_for("Amherst, MA"):
        ch.append({
            "id": "amherst", "title": "Where it began — Amherst",
            "caption": "UMass Amherst. Earth Systems, GIS, and the first tracks in the dataset.",
            "camera": {"center": place_for("Amherst, MA"), "zoom": 11.5, "pitch": 45, "bearing": -20},
            "layer": "temporal", "globe": False,
        })
    if place_for("Boston, MA") or place_for("Cambridge, MA"):
        ch.append({
            "id": "boston", "title": "A decade in Boston",
            "caption": "Consulting to startups. Years of daily movement etched across the city.",
            "camera": {"center": place_for("Boston, MA") or place_for("Cambridge, MA"),
                       "zoom": 11.2, "pitch": 50, "bearing": 15},
            "layer": "heatmap", "globe": False,
        })
    if trips:
        ch.append({
            "id": "travels", "title": "Everywhere else",
            "caption": "Flights and road trips — the long jumps between the places I called home.",
            "camera": {"center": [-92.0, 39.0], "zoom": 3.3, "pitch": 0, "bearing": 0},
            "layer": "trips", "globe": True,
        })
    if place_for("St. Louis, MO"):
        ch.append({
            "id": "stl", "title": "St. Louis",
            "caption": "Planet Labs — Sr. Data Visualization Engineer. A new grid to trace.",
            "camera": {"center": place_for("St. Louis, MO"), "zoom": 11.2, "pitch": 50, "bearing": -10},
            "layer": "temporal", "globe": False,
        })
    ch.append({
        "id": "finale", "title": "The whole pattern",
        "caption": "Eleven years of a life, drawn as one continuous line.",
        "camera": {"center": [-85.0, 40.5], "zoom": 4.2, "pitch": 0, "bearing": 0},
        "layer": "temporal", "globe": True,
    })
    return ch

# ------------------------------------------------------------------ main

def compact_points(nodes):
    pts = []
    prev = None
    for nd in nodes:
        ms = 0.0
        if prev is not None:
            dt = nd[2] - prev[2]
            if dt > 0:
                ms = haversine_m(prev[0], prev[1], nd[0], nd[1]) / dt
        pts.append([round(nd[0], COORD_DP), round(nd[1], COORD_DP), int(nd[2]), mode_from_speed(ms)])
        prev = nd
    return pts

def write_json(path, obj, pretty=False):
    with open(path, "w", encoding="utf-8") as f:
        if pretty:
            json.dump(obj, f, ensure_ascii=False, indent=2)
        else:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))

def human(n):
    for unit in ["B", "KB", "MB"]:
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} GB"

def main():
    here = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.abspath(os.path.join(here, "..", "..", "..", ".."))
    default_in = os.path.join(here, "source", "timeline_points.geojson")
    legacy_in = os.path.join(repo, "pages", "geo", "timeline", "timeline2.geojson")

    ap = argparse.ArgumentParser()
    ap.add_argument("input", nargs="?", default=default_in)
    ap.add_argument("--out", default=os.path.join(repo, "data", "json", "timeline"))
    args = ap.parse_args()

    inp = args.input
    if not os.path.exists(inp) and os.path.exists(legacy_in):
        inp = legacy_in
    if not os.path.exists(inp):
        print(f"Input not found: {inp}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(args.out, exist_ok=True)
    print(f"\n  Pattern of Life — build\n  {'—' * 44}\n")
    print(f"  Reading {os.path.relpath(inp, repo)}")

    raw = load_points(inp)
    print(f"  Raw points:        {len(raw):,}")

    cleaned = remove_outliers(raw)
    print(f"  After outliers:    {len(cleaned):,}  ({len(raw) - len(cleaned):,} spikes removed)")

    nodes, stays = detect_stays(cleaned)
    print(f"  Nodes (deduped):   {len(nodes):,}  ({len(stays):,} stays collapsed)")

    segments = build_segments(nodes)
    points = compact_points(nodes)
    places = cluster_places(stays)
    homes = home_bases_by_year(stays)
    trips = detect_trips(nodes)

    # ---- stats
    lngs = [n[0] for n in nodes]; lats = [n[1] for n in nodes]
    years = sorted({datetime.fromtimestamp(n[2], tz=timezone.utc).year for n in nodes})
    days = {datetime.fromtimestamp(n[2], tz=timezone.utc).strftime("%Y-%m-%d") for n in nodes}
    per_year = defaultdict(int)
    for n in nodes:
        per_year[datetime.fromtimestamp(n[2], tz=timezone.utc).year] += 1
    total_km = sum(f["properties"]["km"] for f in segments)
    longest = trips[0] if trips else None

    stats = {
        "raw_points": len(raw),
        "clean_points": len(nodes),
        "days_tracked": len(days),
        "approx_miles": round(total_km * 0.621371, 0),
        "approx_km": round(total_km, 0),
        "year_range": [years[0], years[-1]] if years else [0, 0],
        "points_per_year": {str(y): per_year[y] for y in years},
        "home_bases": homes,
        "places": len(places),
        "trips": len(trips),
        "longest_trip": longest,
        "bbox": [round(min(lngs), COORD_DP), round(min(lats), COORD_DP),
                 round(max(lngs), COORD_DP), round(max(lats), COORD_DP)] if lngs else None,
        "extent": {
            "north": round(max(lats), COORD_DP) if lats else None,
            "south": round(min(lats), COORD_DP) if lats else None,
            "east": round(max(lngs), COORD_DP) if lngs else None,
            "west": round(min(lngs), COORD_DP) if lngs else None,
        },
    }
    chapters = build_chapters(stats, places, homes, trips)

    # ---- write
    write_json(os.path.join(args.out, "points.json"),
               {"start": points[0][2] if points else 0,
                "end": points[-1][2] if points else 0,
                "points": points})
    write_json(os.path.join(args.out, "segments.geojson"),
               {"type": "FeatureCollection", "features": segments})
    write_json(os.path.join(args.out, "places.json"), {"places": places}, pretty=False)
    write_json(os.path.join(args.out, "trips.json"), {"trips": trips}, pretty=False)
    write_json(os.path.join(args.out, "chapters.json"), {"chapters": chapters}, pretty=True)
    write_json(os.path.join(args.out, "stats.json"), stats, pretty=True)

    print(f"\n  Segments:          {len(segments):,}")
    print(f"  Places:            {len(places):,}")
    print(f"  Trips:             {len(trips):,}")
    print(f"  Days tracked:      {len(days):,}")
    print(f"  Approx miles:      {int(stats['approx_miles']):,}")
    print(f"\n  Wrote to {os.path.relpath(args.out, repo)}/")
    for fn in ["points.json", "segments.geojson", "places.json", "trips.json", "chapters.json", "stats.json"]:
        fp = os.path.join(args.out, fn)
        print(f"    {fn:20s} {human(os.path.getsize(fp))}")
    print()

if __name__ == "__main__":
    main()
