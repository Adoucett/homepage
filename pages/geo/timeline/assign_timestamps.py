import json
from datetime import datetime, timedelta
import argparse
import sys

def parse_arguments():
    parser = argparse.ArgumentParser(description="Assign timestamps to LineString coordinates")
    parser.add_argument("input", help="Path to the input LineString GeoJSON file.")
    parser.add_argument("output", help="Path to the output GeoJSON file with timestamps.")
    return parser.parse_args()

def read_geojson(input_path):
    try:
        with open(input_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if data.get("type") != "FeatureCollection":
            print("Input GeoJSON must be a FeatureCollection.", file=sys.stderr)
            sys.exit(1)
        return data
    except Exception as e:
        print(f"Error reading input file: {e}", file=sys.stderr)
        sys.exit(1)

def assign_timestamps(features):
    # Sort features by start_timestamp
    sorted_features = sorted(features, key=lambda f: datetime.fromisoformat(f["properties"]["start_timestamp"].replace("Z", "+00:00")))
    
    flattened_features = []
    
    for feature in sorted_features:
        start_time = datetime.fromisoformat(feature["properties"]["start_timestamp"].replace("Z", "+00:00"))
        end_time = datetime.fromisoformat(feature["properties"]["end_timestamp"].replace("Z", "+00:00"))
        coords = feature["geometry"]["coordinates"]
        num_coords = len(coords)
        time_diff = (end_time - start_time) / (num_coords - 1) if num_coords > 1 else timedelta(0)
        
        for i, coord in enumerate(coords):
            current_time = start_time + time_diff * i
            new_feature = {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": coord
                },
                "properties": {
                    "timestamp": current_time.isoformat()
                }
            }
            flattened_features.append(new_feature)
    
    return flattened_features

def write_geojson(output_path, features):
    feature_collection = {
        "type": "FeatureCollection",
        "features": features
    }
    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(feature_collection, f, ensure_ascii=False, indent=2)
        print(f"Successfully wrote {len(features)} Point features with timestamps to {output_path}")
    except Exception as e:
        print(f"Error writing output file: {e}", file=sys.stderr)
        sys.exit(1)

def main():
    args = parse_arguments()
    input_geojson = read_geojson(args.input)
    features = input_geojson.get("features", [])
    flattened_features = assign_timestamps(features)
    write_geojson(args.output, flattened_features)

if __name__ == "__main__":
    main()
