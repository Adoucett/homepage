#!/usr/bin/env python3
"""
Expressions of Geometry -- Strava Data Pipeline

Incremental processor for Strava bulk export archives.
Handles GPX, FIT, and TCX files. Filters virtual activities,
checks GPS quality, simplifies geometry, outputs web-ready GeoJSON.

Usage:
    python update.py                     # Process newest ZIP in inbox/
    python update.py /path/to/export.zip # Process specific ZIP
    python update.py /path/to/extracted/ # Process extracted directory
    python update.py --rebuild           # Full reprocess from scratch
    python update.py --migrate-legacy    # Import existing smashrun_part*.geojson
"""

import os
import re
import sys
import json
import csv
import glob
import math
import shutil
import hashlib
import zipfile
import tempfile
import argparse
from datetime import datetime
from pathlib import Path
from multiprocessing import Pool, cpu_count

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
INBOX_DIR = SCRIPT_DIR / "inbox"
REPO_ROOT = SCRIPT_DIR.parent.parent.parent.parent
DATA_DIR = REPO_ROOT / "data" / "json" / "strava"
ROUTES_FILE = DATA_DIR / "routes.geojson"
SUMMARY_FILE = DATA_DIR / "summary.json"
MANIFEST_FILE = DATA_DIR / ".manifest.json"
QUALITY_LOG = DATA_DIR / "quality_report.txt"
LEGACY_GLOB = str(DATA_DIR / "smashrun_part*.geojson")

INCLUDE_TYPES = {
    'Run', 'Trail Run', 'Hike', 'Walk',
    'Ride', 'Gravel Ride', 'Mountain Bike Ride', 'E-Bike Ride',
    'Nordic Ski', 'Alpine Ski', 'Backcountry Ski', 'Snowshoe',
    'Kayaking', 'Canoeing', 'Stand Up Paddling', 'Rowing',
    'Inline Skate', 'Ice Skate', 'Skateboard',
    'Swim', 'Open Water Swim',
}

EXCLUDE_KEYWORDS = {'virtual', 'zwift', 'peloton'}

FILENAME_TYPE_MAP = {
    'Run': 'Run', 'TrailRun': 'Trail Run', 'Ride': 'Ride',
    'GravelRide': 'Gravel Ride', 'MountainBikeRide': 'Mountain Bike Ride',
    'EBikeRide': 'E-Bike Ride', 'VirtualRide': 'Virtual Ride',
    'VirtualRun': 'Virtual Run', 'Walk': 'Walk', 'Hike': 'Hike',
    'NordicSki': 'Nordic Ski', 'AlpineSki': 'Alpine Ski',
    'BackcountrySki': 'Backcountry Ski', 'Snowshoe': 'Snowshoe',
    'Swim': 'Swim', 'OpenWaterSwim': 'Open Water Swim',
    'Rowing': 'Rowing', 'Kayaking': 'Kayaking', 'Canoeing': 'Canoeing',
    'StandUpPaddling': 'Stand Up Paddling',
    'InlineSkate': 'Inline Skate', 'IceSkate': 'Ice Skate',
    'Skateboard': 'Skateboard', 'WeightTraining': 'Weight Training',
    'Cardio': 'Cardio', 'Workout': 'Workout', 'Yoga': 'Yoga',
    'RockClimbing': 'Rock Climb', 'Other': 'Other', 'Golf': 'Golf',
}

MAX_SPEED_KMH = 200
MAX_BBOX_KM = 500
MIN_POINTS = 10
SIMPLIFICATION_TOLERANCE = 0.00005  # ~5 m

# ---------------------------------------------------------------------------
# Geometry utilities
# ---------------------------------------------------------------------------

def haversine_km(lon1, lat1, lon2, lat2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.asin(min(1, math.sqrt(a)))


def _perp_dist(pt, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    if dx == 0 and dy == 0:
        return math.hypot(pt[0] - a[0], pt[1] - a[1])
    t = max(0, min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(pt[0] - (a[0] + t * dx), pt[1] - (a[1] + t * dy))


def douglas_peucker(pts, tol):
    if len(pts) <= 2:
        return list(pts)
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        d = _perp_dist(pts[i], pts[0], pts[-1])
        if d > dmax:
            dmax, idx = d, i
    if dmax > tol:
        left = douglas_peucker(pts[: idx + 1], tol)
        right = douglas_peucker(pts[idx:], tol)
        return left[:-1] + right
    return [pts[0], pts[-1]]


def compute_distance_miles(coords):
    total = 0
    for i in range(1, len(coords)):
        total += haversine_km(coords[i - 1][0], coords[i - 1][1],
                              coords[i][0], coords[i][1])
    return round(total * 0.621371, 2)

# ---------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------

def _try_import(name):
    try:
        return __import__(name)
    except ImportError:
        return None


def parse_gpx(filepath):
    gpxpy = _try_import('gpxpy')
    if gpxpy is None:
        print("  WARNING: gpxpy not installed, skipping GPX file")
        return None
    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        gpx = gpxpy.parse(f)
    pts = []
    for trk in gpx.tracks:
        for seg in trk.segments:
            for p in seg.points:
                if p.latitude and p.longitude:
                    pts.append((p.longitude, p.latitude, p.elevation or 0,
                                p.time.isoformat() if p.time else None))
    return pts


def parse_fit(filepath):
    fitparse = _try_import('fitparse')
    if fitparse is None:
        print("  WARNING: python-fitparse not installed, skipping FIT file")
        return None
    ff = fitparse.FitFile(str(filepath))
    pts = []
    for rec in ff.get_messages('record'):
        d = {f.name: f.value for f in rec}
        lat, lon = d.get('position_lat'), d.get('position_long')
        if lat is None or lon is None:
            continue
        lat_d = lat * (180 / 2 ** 31)
        lon_d = lon * (180 / 2 ** 31)
        ele = d.get('enhanced_altitude') or d.get('altitude') or 0
        ts = d.get('timestamp')
        pts.append((lon_d, lat_d, ele, ts.isoformat() if ts else None))
    return pts


def parse_tcx(filepath):
    import xml.etree.ElementTree as ET
    ns = {'t': 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2'}
    tree = ET.parse(filepath)
    pts = []
    for tp in tree.getroot().findall('.//t:Trackpoint', ns):
        pos = tp.find('t:Position', ns)
        if pos is None:
            continue
        lat_el = pos.find('t:LatitudeDegrees', ns)
        lon_el = pos.find('t:LongitudeDegrees', ns)
        if lat_el is None or lon_el is None:
            continue
        lat = float(lat_el.text)
        lon = float(lon_el.text)
        ele_el = tp.find('t:AltitudeMeters', ns)
        ele = float(ele_el.text) if ele_el is not None else 0
        t_el = tp.find('t:Time', ns)
        ts = t_el.text if t_el is not None else None
        pts.append((lon, lat, ele, ts))
    return pts


def parse_activity_file(filepath):
    filepath = Path(filepath)
    ext = filepath.suffix.lower()
    if ext == '.gz':
        import gzip
        tmp = filepath.with_suffix('')
        with gzip.open(filepath, 'rb') as fi, open(tmp, 'wb') as fo:
            shutil.copyfileobj(fi, fo)
        result = parse_activity_file(tmp)
        tmp.unlink(missing_ok=True)
        return result
    parsers = {'.gpx': parse_gpx, '.fit': parse_fit, '.tcx': parse_tcx}
    fn = parsers.get(ext)
    return fn(filepath) if fn else None

# ---------------------------------------------------------------------------
# Quality checks
# ---------------------------------------------------------------------------

def _parse_ts(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace('Z', '+00:00'))
    except Exception:
        return None


def check_quality(points):
    if len(points) < MIN_POINTS:
        return None, 'dropped', f'insufficient_points_{len(points)}'

    lons = [p[0] for p in points]
    lats = [p[1] for p in points]
    bw = haversine_km(min(lons), min(lats), max(lons), min(lats))
    bh = haversine_km(min(lons), min(lats), min(lons), max(lats))
    if max(bw, bh) > MAX_BBOX_KM:
        return None, 'dropped', f'bounding_box_{max(bw, bh):.0f}km'

    clean = [points[0]]
    spikes = 0
    for i in range(1, len(points)):
        d = haversine_km(points[i - 1][0], points[i - 1][1],
                         points[i][0], points[i][1])
        t1, t2 = _parse_ts(points[i - 1][3]), _parse_ts(points[i][3])
        if t1 and t2:
            dt_h = abs((t2 - t1).total_seconds()) / 3600
            if dt_h > 0 and d / dt_h > MAX_SPEED_KMH:
                spikes += 1
                continue
            if dt_h == 0 and d > 0.001:
                spikes += 1
                continue
        elif d > 10:
            spikes += 1
            continue
        clean.append(points[i])

    if len(points) > 0 and spikes / len(points) > 0.3:
        return None, 'dropped', f'spike_ratio_{spikes / len(points):.0%}'
    if len(clean) < MIN_POINTS:
        return None, 'dropped', f'insufficient_clean_points_{len(clean)}'
    return clean, 'included', None

# ---------------------------------------------------------------------------
# Activity type filtering & filename parsing
# ---------------------------------------------------------------------------

def should_include(activity_type):
    if not activity_type:
        return False
    lower = activity_type.lower()
    if any(k in lower for k in EXCLUDE_KEYWORDS):
        return False
    if activity_type in INCLUDE_TYPES:
        return True
    return False


_FN_PATTERN = re.compile(
    r'^(?P<type>[A-Za-z]+(?:[A-Z][a-z]*)*)_(?P<date>\d{4}-\d{2}-\d{2})_(?P<time>\d{2}-\d{2}-\d{2})')
_HASH_PATTERN = re.compile(r'^[0-9a-f]{10,}-(\d+)')
_NUMERIC_PATTERN = re.compile(r'^(\d+)\.\w+$')


def parse_filename(fn):
    """Extract activity_type, date_str, and a stable ID from a Strava filename."""
    # Strip .gz for pattern matching
    base = fn[:-3] if fn.lower().endswith('.gz') else fn

    m = _FN_PATTERN.match(base)
    if m:
        raw_type = m.group('type')
        atype = FILENAME_TYPE_MAP.get(raw_type, raw_type)
        date_part = m.group('date')
        time_part = m.group('time').replace('-', ':')
        date_str = f"{date_part}T{time_part}"
        stable_id = hashlib.md5(fn.encode()).hexdigest()[:12]
        return atype, date_str, stable_id

    m2 = _HASH_PATTERN.match(base)
    if m2:
        stable_id = m2.group(1)
        return None, None, stable_id

    # Numeric ID: "10010835246.fit" or "72726394.gpx"
    m3 = _NUMERIC_PATTERN.match(base)
    if m3:
        stable_id = m3.group(1)
        return None, None, stable_id

    stable_id = hashlib.md5(fn.encode()).hexdigest()[:12]
    return None, None, stable_id


# ---------------------------------------------------------------------------
# Date parsing helpers
# ---------------------------------------------------------------------------

_DATE_FMTS = [
    "%b %d, %Y, %I:%M:%S %p",
    "%b %d, %Y, %H:%M:%S",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%SZ",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d",
]


def parse_date_str(s):
    if not s:
        return None, None
    for fmt in _DATE_FMTS:
        try:
            dt = datetime.strptime(s.strip(), fmt)
            return dt.strftime("%Y-%m-%dT%H:%M:%S"), dt.timestamp()
        except ValueError:
            continue
    return s.strip(), None


def build_csv_index(csv_path):
    """Build lookup dicts from activities.csv for supplementing file-based metadata."""
    by_id = {}
    by_minute = {}
    if not csv_path or not csv_path.exists():
        return by_id, by_minute
    with open(csv_path, 'r', encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            aid = row.get("Activity ID", "").strip()
            atype = row.get("Activity Type", "").strip()
            aname = row.get("Activity Name", "").strip()
            adate = row.get("Activity Date", "").strip()
            if aid:
                by_id[aid] = {"type": atype, "name": aname, "date": adate}
            if adate:
                iso, _ = parse_date_str(adate)
                if iso:
                    minute_key = iso[:16]
                    by_minute.setdefault(minute_key, []).append(
                        {"id": aid, "type": atype, "name": aname, "date": adate})
    return by_id, by_minute


# ---------------------------------------------------------------------------
# Manifest & I/O
# ---------------------------------------------------------------------------

def load_manifest():
    if MANIFEST_FILE.exists():
        with open(MANIFEST_FILE) as f:
            return json.load(f)
    return {"processed": {}}


def save_manifest(manifest):
    st = [v.get("status") for v in manifest["processed"].values()]
    manifest["total_included"] = st.count("included")
    manifest["total_dropped"] = st.count("dropped")
    manifest["total_excluded"] = st.count("excluded")
    manifest["last_updated"] = datetime.now().isoformat()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(MANIFEST_FILE, 'w') as f:
        json.dump(manifest, f, indent=2)


def load_routes():
    if ROUTES_FILE.exists():
        with open(ROUTES_FILE) as f:
            return json.load(f)
    return {"type": "FeatureCollection", "features": []}


def save_routes(gj):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(ROUTES_FILE, 'w') as f:
        json.dump(gj, f, separators=(',', ':'))
    mb = ROUTES_FILE.stat().st_size / 1048576
    print(f"  routes.geojson  {mb:.1f} MB  ({len(gj['features'])} routes)")


def generate_summary(gj):
    feats = gj["features"]
    if not feats:
        return {}
    miles = sum(f["properties"].get("distance_miles", 0) for f in feats)
    dates = sorted(f["properties"]["date"] for f in feats if f["properties"].get("date"))
    tc, tm = {}, {}
    for f in feats:
        t = f["properties"].get("activity_type", "Unknown")
        tc[t] = tc.get(t, 0) + 1
        tm[t] = tm.get(t, 0) + f["properties"].get("distance_miles", 0)
    s = {
        "total_activities": len(feats),
        "total_miles": round(miles, 1),
        "date_range": {"earliest": dates[0] if dates else None,
                       "latest": dates[-1] if dates else None},
        "activity_types": tc,
        "activity_miles": {k: round(v, 1) for k, v in tm.items()},
        "generated": datetime.now().isoformat(),
    }
    with open(SUMMARY_FILE, 'w') as f:
        json.dump(s, f, indent=2)
    print(f"  summary.json    written")
    return s


def log_quality(msg):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(QUALITY_LOG, 'a') as f:
        f.write(f"[{datetime.now().isoformat()}] {msg}\n")

# ---------------------------------------------------------------------------
# ZIP / directory processing
# ---------------------------------------------------------------------------

def find_newest_zip():
    INBOX_DIR.mkdir(parents=True, exist_ok=True)
    zips = sorted(glob.glob(str(INBOX_DIR / "*.zip")),
                  key=os.path.getmtime, reverse=True)
    return Path(zips[0]) if zips else None


def find_inbox_export_dir():
    """Find an extracted Strava export directory in the inbox."""
    INBOX_DIR.mkdir(parents=True, exist_ok=True)
    for d in sorted(INBOX_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if d.is_dir() and (d / "activities").is_dir():
            return d
    return None


def find_inbox_export_dir():
    """Find an extracted Strava export directory in the inbox."""
    INBOX_DIR.mkdir(parents=True, exist_ok=True)
    for d in sorted(INBOX_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if d.is_dir() and (d / "activities").is_dir():
            return d
    return None


def _process_one_activity(args):
    """Worker function for multiprocessing. Returns (aid, result_dict) or (aid, None)."""
    afile_str, aid, atype, aname, adate, fname = args
    afile = Path(afile_str)
    result = {"aid": aid, "atype": atype, "aname": aname, "adate": adate, "fname": fname}

    try:
        pts = parse_activity_file(afile)
    except Exception as e:
        result["status"] = "error"
        result["reason"] = f"parse:{type(e).__name__}"
        result["log"] = f"Dropped {aid} ({atype}): {e}"
        return result

    if not pts:
        result["status"] = "dropped"
        result["reason"] = "no_points"
        return result

    clean, status, reason = check_quality(pts)
    if status != 'included':
        result["status"] = status
        result["reason"] = reason
        result["log"] = f"Dropped {aid} ({atype}, {adate}): {reason}"
        return result

    coords = douglas_peucker([(p[0], p[1]) for p in clean], SIMPLIFICATION_TOLERANCE)
    if len(coords) < 2:
        result["status"] = "dropped"
        result["reason"] = "simplified_empty"
        return result

    iso_date, epoch = parse_date_str(adate)
    dist = compute_distance_miles(coords)

    dur = None
    ts_list = [p[3] for p in clean if p[3]]
    if len(ts_list) >= 2:
        t0, t1 = _parse_ts(ts_list[0]), _parse_ts(ts_list[-1])
        if t0 and t1:
            dur = round(abs((t1 - t0).total_seconds()) / 60, 1)

    result["status"] = "included"
    result["iso_date"] = iso_date
    result["epoch"] = epoch
    result["dist"] = dist
    result["dur"] = dur
    result["coords"] = [list(c) for c in coords]
    return result


def _process_export_dir(export_dir, manifest, rebuild):
    """Process Strava export using CSV as primary metadata source, parallelized."""
    export_dir = Path(export_dir)
    new_feats = []
    st = {"new": 0, "skipped": 0, "excluded": 0, "dropped": 0, "errors": 0}

    csv_path = export_dir / "activities.csv"
    if not csv_path.exists():
        csv_path = next(export_dir.rglob("activities.csv"), None)
    if not csv_path:
        print("  ERROR: No activities.csv found")
        return new_feats, st

    with open(csv_path, 'r', encoding='utf-8-sig') as f:
        rows = list(csv.DictReader(f))
    print(f"  {len(rows)} activities in CSV")

    # Phase 1: Filter and collect work items (fast, single-threaded)
    work_items = []
    for row in rows:
        aid = row.get("Activity ID", "").strip()
        atype = row.get("Activity Type", "").strip()
        aname = row.get("Activity Name", "").strip()
        adate = row.get("Activity Date", "").strip()
        fname = row.get("Filename", "").strip()

        if not aid:
            continue
        if not rebuild and aid in manifest["processed"]:
            st["skipped"] += 1
            continue
        if not should_include(atype):
            manifest["processed"][aid] = {
                "status": "excluded", "reason": f"type:{atype}", "type": atype}
            st["excluded"] += 1
            continue
        if not fname:
            manifest["processed"][aid] = {
                "status": "excluded", "reason": "no_file", "type": atype}
            st["excluded"] += 1
            continue

        afile = export_dir / fname
        if not afile.exists():
            afile_gz = export_dir / (fname + ".gz")
            afile = afile_gz if afile_gz.exists() else None
        if afile is None:
            manifest["processed"][aid] = {
                "status": "dropped", "reason": "file_missing", "type": atype}
            log_quality(f"Dropped {aid} ({atype}, {adate}): file not found {fname}")
            st["dropped"] += 1
            continue

        work_items.append((str(afile), aid, atype, aname, adate, fname))

    print(f"  {len(work_items)} activities to process, {st['excluded']} excluded, {st['skipped']} skipped")

    if not work_items:
        return new_feats, st

    # Phase 2: Parallel parse/quality/simplify
    ncpu = min(cpu_count(), 10)
    print(f"  Processing with {ncpu} workers ...")
    done = 0

    with Pool(ncpu) as pool:
        for r in pool.imap_unordered(_process_one_activity, work_items, chunksize=16):
            done += 1
            aid = r["aid"]
            atype = r["atype"]
            fname = r["fname"]

            if r["status"] == "error":
                manifest["processed"][aid] = {
                    "status": "dropped", "reason": r["reason"],
                    "type": atype, "file": fname}
                if r.get("log"):
                    log_quality(r["log"])
                st["errors"] += 1

            elif r["status"] == "dropped":
                manifest["processed"][aid] = {
                    "status": "dropped", "reason": r["reason"],
                    "type": atype, "file": fname}
                if r.get("log"):
                    log_quality(r["log"])
                st["dropped"] += 1

            elif r["status"] == "included":
                feat = {
                    "type": "Feature",
                    "properties": {
                        "id": aid,
                        "date": r.get("iso_date") or r["adate"],
                        "date_epoch": r.get("epoch"),
                        "activity_type": atype,
                        "name": r["aname"],
                        "distance_miles": r["dist"],
                        "duration_minutes": r["dur"],
                    },
                    "geometry": {
                        "type": "LineString",
                        "coordinates": r["coords"],
                    },
                }
                new_feats.append(feat)
                manifest["processed"][aid] = {
                    "status": "included", "type": atype,
                    "date": r.get("iso_date") or r["adate"], "file": fname}
                st["new"] += 1

            else:
                manifest["processed"][aid] = {
                    "status": r["status"], "reason": r.get("reason", ""),
                    "type": atype, "file": fname}
                st["dropped"] += 1

            if done % 250 == 0:
                print(f"    ... {done}/{len(work_items)} done "
                      f"({st['new']} incl, {st['dropped']} drop, {st['errors']} err)")

    print(f"    ... {done}/{len(work_items)} complete")
    return new_feats, st


def process_zip(zip_path, manifest, rebuild=False):
    print(f"\n  Extracting {zip_path.name} ...")
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        with zipfile.ZipFile(zip_path, 'r') as zf:
            zf.extractall(tmpdir)
        return _process_export_dir(tmpdir, manifest, rebuild)


def process_directory(dir_path, manifest, rebuild=False):
    print(f"\n  Processing directory: {dir_path.name} ...")
    return _process_export_dir(dir_path, manifest, rebuild)


# ---------------------------------------------------------------------------
# Legacy migration
# ---------------------------------------------------------------------------

def migrate_legacy(manifest):
    print("\n  Migrating legacy smashrun_part*.geojson files ...")
    files = sorted(glob.glob(LEGACY_GLOB))
    if not files:
        print(f"  No legacy files found matching {LEGACY_GLOB}")
        return [], {"new": 0, "dropped": 0}

    new_feats = []
    st = {"new": 0, "dropped": 0}

    for fp in files:
        print(f"    {os.path.basename(fp)} ...", end=" ")
        with open(fp) as f:
            data = json.load(f)
        count = 0
        for feat in data.get("features", []):
            props = feat.get("properties", {})
            geom = feat.get("geometry", {})
            fname = props.get("file_name", "")
            pid = hashlib.md5(fname.encode()).hexdigest()[:12]
            if pid in manifest["processed"]:
                continue

            coords = geom.get("coordinates", [])
            if not coords or len(coords) < 2:
                st["dropped"] += 1
                continue

            pts4 = [(c[0], c[1], 0, None) for c in coords]
            clean, status, reason = check_quality(pts4)
            if status != 'included':
                manifest["processed"][pid] = {
                    "status": status, "reason": reason, "type": "Run"}
                st["dropped"] += 1
                continue

            simp = douglas_peucker([(p[0], p[1]) for p in clean],
                                   SIMPLIFICATION_TOLERANCE)
            if len(simp) < 2:
                st["dropped"] += 1
                continue

            dist = compute_distance_miles(simp)
            raw_date = props.get("run_start_time", "")
            iso_date, epoch = parse_date_str(raw_date)

            new_feats.append({
                "type": "Feature",
                "properties": {
                    "id": pid,
                    "date": iso_date or raw_date,
                    "date_epoch": epoch,
                    "activity_type": "Run",
                    "name": fname.replace("smashrun-", "").replace(".tcx", ""),
                    "distance_miles": dist,
                    "duration_minutes": None,
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [list(c) for c in simp],
                },
            })
            manifest["processed"][pid] = {
                "status": "included", "type": "Run",
                "date": iso_date or raw_date, "file": fname, "legacy": True}
            count += 1
            st["new"] += 1
        print(f"{count} routes")

    return new_feats, st

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description="Expressions of Geometry -- Strava Data Pipeline")
    ap.add_argument("input_path", nargs="?",
                    help="Path to Strava export ZIP or extracted directory")
    ap.add_argument("--rebuild", action="store_true",
                    help="Reprocess everything (ignores manifest)")
    ap.add_argument("--migrate-legacy", action="store_true",
                    help="Import existing smashrun_part*.geojson files")
    ap.add_argument("--clean-inbox", action="store_true", default=True,
                    help="Delete ZIP from inbox after processing (default: True)")
    ap.add_argument("--keep-inbox", action="store_true",
                    help="Keep ZIP in inbox after processing")
    args = ap.parse_args()
    if args.keep_inbox:
        args.clean_inbox = False

    print("=" * 60)
    print("  Expressions of Geometry -- Data Pipeline")
    print("=" * 60)

    if QUALITY_LOG.exists():
        QUALITY_LOG.unlink()

    if args.rebuild:
        manifest = {"processed": {}}
        print("\n  [REBUILD] Starting fresh.")
    else:
        manifest = load_manifest()
        n = manifest.get("total_included", 0)
        print(f"\n  Manifest: {n} routes tracked")

    new_feats = []

    if args.migrate_legacy:
        feats, st = migrate_legacy(manifest)
        new_feats.extend(feats)
        print(f"\n  Legacy: {st['new']} imported, {st['dropped']} dropped")
    else:
        input_path = Path(args.input_path) if args.input_path else None
        if input_path and input_path.is_dir():
            feats, st = process_directory(input_path, manifest, rebuild=args.rebuild)
            new_feats.extend(feats)
        elif input_path and input_path.is_file() and input_path.suffix == '.zip':
            feats, st = process_zip(input_path, manifest, rebuild=args.rebuild)
            new_feats.extend(feats)
        else:
            inbox_dir = find_inbox_export_dir()
            zp = find_newest_zip()
            if inbox_dir:
                feats, st = process_directory(inbox_dir, manifest, rebuild=args.rebuild)
                new_feats.extend(feats)
            elif zp and zp.exists():
                feats, st = process_zip(zp, manifest, rebuild=args.rebuild)
                new_feats.extend(feats)
            else:
                print(f"\n  No ZIP or directory found.")
                print(f"  Place a Strava export in: {INBOX_DIR}/")
                print(f"  Or run: python update.py /path/to/export.zip")
                print(f"  Or run: python update.py /path/to/extracted_dir/")
                if not args.rebuild:
                    save_manifest(manifest)
                    return
                st = {"new": 0, "skipped": 0, "excluded": 0, "dropped": 0, "errors": 0}

        print(f"\n  {st['new']} new | {st['skipped']} skipped | "
              f"{st['excluded']} excluded | {st['dropped']} dropped | "
              f"{st['errors']} errors")

    if not new_feats and not args.rebuild:
        print("\n  Nothing new to add.")
        save_manifest(manifest)
        return

    if args.rebuild:
        gj = {"type": "FeatureCollection", "features": new_feats}
    else:
        gj = load_routes()
        ids = {f["properties"]["id"] for f in gj["features"]}
        for f in new_feats:
            if f["properties"]["id"] not in ids:
                gj["features"].append(f)

    gj["features"].sort(key=lambda f: f["properties"].get("date") or "")

    print("\n  Writing output ...")
    save_routes(gj)
    s = generate_summary(gj)
    save_manifest(manifest)

    print(f"\n  Total: {s.get('total_activities', 0)} routes, "
          f"{s.get('total_miles', 0)} miles")
    dr = s.get("date_range", {})
    print(f"  Range: {dr.get('earliest', '?')} to {dr.get('latest', '?')}")
    types = s.get("activity_types", {})
    if types:
        print(f"  Types: {', '.join(f'{k}({v})' for k, v in types.items())}")

    if args.clean_inbox and new_feats:
        for zf in glob.glob(str(INBOX_DIR / "*.zip")):
            os.remove(zf)
            print(f"\n  Cleaned up: {os.path.basename(zf)}")
        for d in INBOX_DIR.iterdir():
            if d.is_dir() and d.name != '.gitkeep':
                shutil.rmtree(d)
                print(f"  Cleaned up: {d.name}/")

    print("\n  Done.\n")


if __name__ == "__main__":
    main()
