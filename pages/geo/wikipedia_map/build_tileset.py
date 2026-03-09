#!/usr/bin/env python3
"""
Download the English Wikipedia geo_tags SQL dump and extract all primary
coordinates into a newline-delimited GeoJSON file suitable for tippecanoe.

Usage:
    python3 build_tileset.py

Output:
    wiki_points.geojson.ndjson   (one GeoJSON Feature per line)

Then run (clustered — best for heatmap, keeps all point weight at low zoom):
    tippecanoe -o wiki_points_clustered.mbtiles -l wp -z12 \
        --minimum-zoom=0 -M 2000000 \
        --cluster-densest-as-needed \
        --accumulate-attribute=n:sum \
        --cluster-distance=4 \
        wiki_points.geojson.ndjson

    Upload to Mapbox, then use "n" property as heatmap-weight so clusters
    carry the combined weight of all their merged points.

Or for max detail at high zoom (dots layer):
    tippecanoe -o wiki_points_detail.mbtiles -l wp -z12 \
        --minimum-zoom=0 -M 1500000 \
        --drop-densest-as-needed --extend-zooms-if-still-dropping \
        wiki_points.geojson.ndjson
"""

import gzip
import json
import os
import re
import sys
import urllib.request

DUMP_URL = "https://dumps.wikimedia.org/enwiki/latest/enwiki-latest-geo_tags.sql.gz"
GZ_PATH = "enwiki-latest-geo_tags.sql.gz"
OUTPUT = "wiki_points.geojson.ndjson"

# Matches a parenthesized VALUES tuple inside an INSERT statement.
# Captures the inner contents of each (...) group.
ROW_RE = re.compile(r"\(([^)]+)\)")


def download_dump():
    if os.path.exists(GZ_PATH):
        size_mb = os.path.getsize(GZ_PATH) / 1_000_000
        print(f"  {GZ_PATH} already exists ({size_mb:.1f} MB), skipping download")
        return

    print(f"  Downloading {DUMP_URL} ...")
    req = urllib.request.Request(DUMP_URL, headers={"User-Agent": "WikiMappr/1.0"})
    with urllib.request.urlopen(req) as resp, open(GZ_PATH, "wb") as f:
        total = int(resp.headers.get("Content-Length", 0))
        downloaded = 0
        while True:
            chunk = resp.read(1 << 20)  # 1 MB
            if not chunk:
                break
            f.write(chunk)
            downloaded += len(chunk)
            if total:
                pct = downloaded * 100 // total
                print(f"\r  {downloaded // 1_000_000} / {total // 1_000_000} MB ({pct}%)", end="", flush=True)
        print()
    print(f"  Saved {GZ_PATH}")


def parse_row(raw):
    """Parse a single SQL VALUES tuple into its fields, handling quoted strings."""
    fields = []
    i = 0
    n = len(raw)
    while i < n:
        if raw[i] == "'":
            # quoted string
            j = i + 1
            while j < n:
                if raw[j] == "\\":
                    j += 2
                    continue
                if raw[j] == "'":
                    break
                j += 1
            fields.append(raw[i + 1 : j])
            i = j + 1
            # skip comma
            if i < n and raw[i] == ",":
                i += 1
        elif raw[i] == ",":
            i += 1
        elif raw[i] in (" ", "\t"):
            i += 1
        else:
            j = i
            while j < n and raw[j] != ",":
                j += 1
            fields.append(raw[i:j].strip())
            i = j + 1 if j < n else j
    return fields


def parse_dump():
    """Stream-parse the gzipped SQL dump, yield (page_id, lat, lon) tuples."""
    print(f"  Parsing {GZ_PATH} ...")
    with gzip.open(GZ_PATH, "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            if not line.startswith("INSERT INTO"):
                continue
            for match in ROW_RE.finditer(line):
                fields = parse_row(match.group(1))
                # geo_tags schema (as of 2024):
                #   gt_id, gt_page_id, gt_globe, gt_primary, gt_lat, gt_lon,
                #   gt_dim, gt_type, gt_name, gt_country, gt_region
                if len(fields) < 6:
                    continue
                try:
                    globe = fields[2]
                    primary = fields[3]
                    if globe != "earth" or primary != "1":
                        continue
                    page_id = int(fields[1])
                    lat = float(fields[4])
                    lon = float(fields[5])
                    if lat < -90 or lat > 90 or lon < -180 or lon > 180:
                        continue
                    yield page_id, lat, lon
                except (ValueError, IndexError):
                    continue


def main():
    print("Step 1/2: Download geo_tags dump")
    download_dump()

    print("Step 2/2: Parse and write GeoJSON")
    seen = set()
    count = 0
    with open(OUTPUT, "w") as out:
        for page_id, lat, lon in parse_dump():
            if page_id in seen:
                continue
            seen.add(page_id)
            feature = {
                "type": "Feature",
                "properties": {"id": page_id},
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(lon, 5), round(lat, 5)],
                },
            }
            out.write(json.dumps(feature, separators=(",", ":")) + "\n")
            count += 1
            if count % 50_000 == 0:
                print(f"  {count:,} points written ...")

    print(f"  Done: {count:,} points -> {OUTPUT}")
    size_mb = os.path.getsize(OUTPUT) / 1_000_000
    print(f"  Output size: {size_mb:.1f} MB")
    print()
    print("Next step:")
    print(f"  tippecanoe -o wiki_points.mbtiles -l wp -zg \\")
    print(f"    --drop-densest-as-needed --extend-zooms-if-still-dropping \\")
    print(f"    --minimum-zoom=2 {OUTPUT}")


if __name__ == "__main__":
    main()
