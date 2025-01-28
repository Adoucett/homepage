import os
import json
import xml.etree.ElementTree as ET
from datetime import datetime
from tkinter import Tk
from tkinter import filedialog

def parse_tcx(file_path):
    """
    Parse a TCX file and extract time and location data.

    Args:
        file_path (str): Path to the TCX file.

    Returns:
        dict: A dictionary containing run metadata and a list of coordinates.
    """
    try:
        namespaces = {
            'tcx': 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2',
            'ns3': 'http://www.garmin.com/xmlschemas/ActivityExtension/v2'
        }
        tree = ET.parse(file_path)
        root = tree.getroot()

        # Extract run metadata (e.g., StartTime)
        activity = root.find('.//tcx:Activity', namespaces)
        if activity is not None:
            start_time_elem = activity.find('tcx:Id', namespaces)
            start_time_str = start_time_elem.text if start_time_elem is not None else "Unknown"
        else:
            start_time_str = "Unknown"

        # Extract all track points
        data_points = []
        for trackpoint in root.findall('.//tcx:Trackpoint', namespaces):
            time_elem = trackpoint.find('tcx:Time', namespaces)
            position = trackpoint.find('tcx:Position', namespaces)
            lat_elem = position.find('tcx:LatitudeDegrees', namespaces) if position is not None else None
            lon_elem = position.find('tcx:LongitudeDegrees', namespaces) if position is not None else None

            if time_elem is not None and lat_elem is not None and lon_elem is not None:
                time_str = time_elem.text
                data_point = {
                    'time': time_str,  # Keeping as string for GeoJSON
                    'latitude': float(lat_elem.text),
                    'longitude': float(lon_elem.text)
                }
                data_points.append(data_point)

        if not data_points:
            print(f"No valid track points found in {file_path}.")
            return None

        # Sort data points by time
        try:
            data_points.sort(key=lambda x: parse_time(x['time']))
        except Exception as e:
            print(f"Could not sort data points by time in {file_path}: {e}")

        # Extract coordinates
        coordinates = [[point['longitude'], point['latitude']] for point in data_points]

        # Extract run start time for properties
        run_start_time = data_points[0]['time'] if data_points else "Unknown"

        # Create run metadata
        run_metadata = {
            "file_name": os.path.basename(file_path),
            "run_start_time": run_start_time
        }

        return {
            "metadata": run_metadata,
            "coordinates": coordinates
        }

    except ET.ParseError as e:
        print(f"Error parsing {file_path}: {e}")
        return None
    except Exception as e:
        print(f"Unexpected error with {file_path}: {e}")
        return None

def select_folder_dialog():
    """
    Open a folder selection dialog and return the selected folder path.

    Returns:
        str: Path to the selected folder.
    """
    root = Tk()
    root.withdraw()  # Hide the main window
    root.attributes('-topmost', True)  # Bring the dialog to the front
    folder_selected = filedialog.askdirectory(title="Select Folder Containing TCX Files")
    root.destroy()
    return folder_selected

def parse_time(time_str):
    """
    Parse a time string into a datetime object, handling multiple formats.

    Args:
        time_str (str): Time string from TCX file.

    Returns:
        datetime: Parsed datetime object.

    Raises:
        ValueError: If the time string does not match any known format.
    """
    # Define possible time formats
    time_formats = [
        "%Y-%m-%dT%H:%M:%S.%fZ",  # With fractional seconds
        "%Y-%m-%dT%H:%M:%SZ"      # Without fractional seconds
    ]

    for fmt in time_formats:
        try:
            return datetime.strptime(time_str, fmt)
        except ValueError:
            continue

    # If none of the formats match, raise an error
    raise ValueError(f"Time data '{time_str}' does not match known formats.")

def convert_tcx_folder_to_geojson(tcx_folder, output_geojson):
    """
    Convert all TCX files in a folder to a single GeoJSON FeatureCollection with separate LineString Features.

    Args:
        tcx_folder (str): Path to the folder containing TCX files.
        output_geojson (str): Path to the output GeoJSON file.
    """
    features = []

    # Iterate over all files in the folder
    for filename in os.listdir(tcx_folder):
        if filename.lower().endswith('.tcx'):
            file_path = os.path.join(tcx_folder, filename)
            print(f"Processing {file_path}...")
            run_data = parse_tcx(file_path)
            if run_data is None:
                continue  # Skip files with no valid data

            # Create GeoJSON Feature for the run
            feature = {
                "type": "Feature",
                "properties": run_data["metadata"],
                "geometry": {
                    "type": "LineString",
                    "coordinates": run_data["coordinates"]
                }
            }
            features.append(feature)

    if not features:
        print("No valid data found in the TCX files.")
        return

    # Create FeatureCollection
    geojson_data = {
        "type": "FeatureCollection",
        "features": features
    }

    # Write to GeoJSON file
    try:
        with open(output_geojson, 'w') as geojson_file:
            json.dump(geojson_data, geojson_file, indent=4)
        print(f"Successfully wrote GeoJSON data to {output_geojson}")
    except Exception as e:
        print(f"Error writing to {output_geojson}: {e}")

def find_tcx_in_current_directory():
    """
    Check for TCX files in the current working directory.

    Returns:
        list: List of TCX file paths.
    """
    current_dir = os.getcwd()
    tcx_files = [os.path.join(current_dir, f) for f in os.listdir(current_dir) if f.lower().endswith('.tcx')]
    return tcx_files

def main():
    """
    Main function to execute the TCX to GeoJSON conversion.
    """
    current_dir = os.getcwd()
    tcx_files = find_tcx_in_current_directory()

    if tcx_files:
        print(f"Found {len(tcx_files)} TCX file(s) in the current directory: {current_dir}")
        tcx_folder = current_dir
    else:
        print("No TCX files found in the current directory.")
        tcx_folder = select_folder_dialog()
        if not tcx_folder:
            print("No folder selected. Exiting the script.")
            return
        tcx_files = [os.path.join(tcx_folder, f) for f in os.listdir(tcx_folder) if f.lower().endswith('.tcx')]
        if not tcx_files:
            print("No TCX files found in the selected folder. Exiting the script.")
            return
        print(f"Found {len(tcx_files)} TCX file(s) in the selected folder: {tcx_folder}")

    # Define the output GeoJSON path
    output_geojson = os.path.join(tcx_folder, "combined_runs.geojson")

    convert_tcx_folder_to_geojson(tcx_folder, output_geojson)

if __name__ == "__main__":
    main()
