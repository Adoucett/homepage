import json
import os
from datetime import datetime

def get_file_size_in_mb(data):
    """Calculate the approximate size of the GeoJSON data in MB."""
    return len(json.dumps(data).encode('utf-8')) / (1024 * 1024)

def sort_features_by_date(features):
    """Sort GeoJSON features by 'date' field if present."""
    try:
        features.sort(key=lambda x: datetime.fromisoformat(x['properties'].get('date')), reverse=False)
        print("Sorted features by 'date' field.")
    except Exception:
        print("No valid 'date' field found or unable to sort by date. Skipping sorting.")

def split_geojson(input_filename, max_size_mb, output_prefix):
    # Read input GeoJSON file
    with open(input_filename, 'r') as f:
        geojson_data = json.load(f)

    # Ensure GeoJSON has a 'FeatureCollection' type
    if geojson_data.get('type') != 'FeatureCollection':
        print("Invalid GeoJSON format: Must be of type 'FeatureCollection'.")
        return

    features = geojson_data['features']
    sort_features_by_date(features)

    part_number = 1
    current_chunk = []
    current_chunk_size = 0

    for feature in features:
        feature_size = get_file_size_in_mb({"type": "FeatureCollection", "features": [feature]})

        if current_chunk_size + feature_size > max_size_mb:
            # Save the current chunk
            output_filename = f"{output_prefix}_part{part_number}.geojson"
            with open(output_filename, 'w') as out_file:
                json.dump({"type": "FeatureCollection", "features": current_chunk}, out_file)
            print(f"Created file: {output_filename} ({current_chunk_size:.2f} MB)")

            # Reset chunk
            part_number += 1
            current_chunk = []
            current_chunk_size = 0

        # Add feature to the current chunk
        current_chunk.append(feature)
        current_chunk_size += feature_size

    # Save the final chunk if it contains any features
    if current_chunk:
        output_filename = f"{output_prefix}_part{part_number}.geojson"
        with open(output_filename, 'w') as out_file:
            json.dump({"type": "FeatureCollection", "features": current_chunk}, out_file)
        print(f"Created file: {output_filename} ({current_chunk_size:.2f} MB)")

def main():
    input_filename = input("Enter the GeoJSON file name to split: ").strip()
    if not os.path.isfile(input_filename):
        print("File not found. Please check the file path.")
        return

    try:
        max_size_mb = float(input("Enter the maximum file size (in MB) for each chunk: "))
        if max_size_mb <= 0:
            print("Maximum size must be greater than 0.")
            return
    except ValueError:
        print("Invalid input for maximum size. Please enter a valid number.")
        return

    output_prefix = input("Enter the prefix for the output files: ").strip()

    split_geojson(input_filename, max_size_mb, output_prefix)
    print("Splitting complete.")

if __name__ == "__main__":
    main()
