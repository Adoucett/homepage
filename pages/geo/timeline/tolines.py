import json
from datetime import datetime
from collections import defaultdict
import argparse
import sys
from geopy.distance import great_circle

def parse_arguments():
    parser = argparse.ArgumentParser(description="Convert GeoJSON Points to Daily LineStrings with Distance Constraints and Filtering")
    parser.add_argument("input", help="Path to the input GeoJSON file containing Point features.")
    parser.add_argument("output", help="Path to the output GeoJSON file with LineString features.")
    parser.add_argument("-d", "--max_distance", type=float, default=800.0,
                        help="Maximum allowed distance (in miles) between consecutive points before splitting the LineString. Default is 800 miles.")
    parser.add_argument("-c", "--cumulative_distance", type=float, default=100.0,
                        help="Maximum cumulative distance (in miles) allowed for each LineString before splitting. Default is 100 miles.")
    parser.add_argument("-f", "--min_points", type=int, default=3,
                        help="Minimum number of points required for a LineString to be included in the output. Default is 3.")
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

def group_points_by_day(features):
    grouped = defaultdict(list)
    for feature in features:
        try:
            timestamp_str = feature["properties"]["timestamp"]
            # Parse the timestamp; adjust the format if necessary
            timestamp = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
            date_key = timestamp.date().isoformat()  # YYYY-MM-DD
            grouped[date_key].append((timestamp, feature))
        except Exception as e:
            print(f"Skipping feature due to parsing error: {e}", file=sys.stderr)
            continue
    return grouped

def create_daily_linestrings(grouped_points, max_distance_miles, cumulative_distance_miles, min_points):
    linestring_features = []
    for date, points in grouped_points.items():
        if len(points) < 2:
            # Skip days with less than 2 points; can't form a LineString
            continue
        # Sort points by timestamp
        sorted_points = sorted(points, key=lambda x: x[0])
        # Initialize variables for splitting
        current_line = []
        cumulative_distance = 0.0
        previous_coord = None
        split_count = 0

        for timestamp, feature in sorted_points:
            coord = feature["geometry"]["coordinates"]
            if previous_coord is None:
                current_line.append(coord)
            else:
                # Calculate distance between previous_coord and current coord
                # Swap coordinates to (latitude, longitude) for geopy
                distance = great_circle((previous_coord[1], previous_coord[0]), (coord[1], coord[0])).miles
                if distance > max_distance_miles:
                    print(f"Skipping adding point due to step distance {distance:.2f} miles exceeding max_distance_miles {max_distance_miles} miles.")
                    # Optionally, you could handle this differently, such as inserting intermediate points
                    # For now, we'll skip this point
                    continue

                if cumulative_distance + distance > cumulative_distance_miles:
                    # Split the LineString here
                    if len(current_line) >= min_points:
                        linestring = create_linestring_feature(current_line, date, split_count, sorted_points)
                        linestring_features.append(linestring)
                        split_count += 1
                    # Start a new LineString
                    current_line = [previous_coord, coord]
                    cumulative_distance = distance
                else:
                    current_line.append(coord)
                    cumulative_distance += distance
            previous_coord = coord

        # After looping, add the last LineString if it meets the minimum points requirement
        if len(current_line) >= min_points:
            linestring = create_linestring_feature(current_line, date, split_count, sorted_points)
            linestring_features.append(linestring)

    return linestring_features

def create_linestring_feature(coordinates, date, split_count, sorted_points):
    start_timestamp = get_timestamp_from_coord(coordinates[0], sorted_points)
    end_timestamp = get_timestamp_from_coord(coordinates[-1], sorted_points)
    feature = {
        "type": "Feature",
        "geometry": {
            "type": "LineString",
            "coordinates": coordinates
        },
        "properties": {
            "date": date,
            "split_index": split_count,
            "start_timestamp": start_timestamp,
            "end_timestamp": end_timestamp,
            "num_points": len(coordinates)
        }
    }
    return feature

def get_timestamp_from_coord(coord, sorted_points):
    for timestamp, feature in sorted_points:
        if feature["geometry"]["coordinates"] == coord:
            return timestamp.isoformat()
    return "Unknown"

def write_geojson(output_path, linestring_features):
    feature_collection = {
        "type": "FeatureCollection",
        "features": linestring_features
    }
    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(feature_collection, f, ensure_ascii=False, indent=2)
        print(f"Successfully wrote {len(linestring_features)} LineString features to {output_path}")
    except Exception as e:
        print(f"Error writing output file: {e}", file=sys.stderr)
        sys.exit(1)

def main():
    args = parse_arguments()
    input_geojson = read_geojson(args.input)
    features = input_geojson.get("features", [])
    grouped_points = group_points_by_day(features)
    linestring_features = create_daily_linestrings(grouped_points, args.max_distance, args.cumulative_distance, args.min_points)
    write_geojson(args.output, linestring_features)

if __name__ == "__main__":
    main()
