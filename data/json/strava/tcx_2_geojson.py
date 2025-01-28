import os
import json
import xml.etree.ElementTree as ET
from datetime import datetime
from tkinter import Tk, filedialog, simpledialog, messagebox
import math
import re
import sys
import warnings

# Suppress specific macOS Tkinter warnings
if sys.platform == "darwin":
    warnings.filterwarnings("ignore", category=UserWarning, module="tkinter")

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
    # Define possible time formats, both with and without 'Z'
    time_formats = [
        "%Y-%m-%dT%H:%M:%S.%fZ",  # With fractional seconds and 'Z'
        "%Y-%m-%dT%H:%M:%SZ",     # Without fractional seconds but with 'Z'
        "%Y-%m-%dT%H:%M:%S.%f",   # With fractional seconds, no 'Z'
        "%Y-%m-%dT%H:%M:%S"       # Without fractional seconds and no 'Z'
    ]

    for fmt in time_formats:
        try:
            return datetime.strptime(time_str, fmt)
        except ValueError:
            continue

    # If none of the formats match, raise an error
    raise ValueError(f"Time data '{time_str}' does not match known formats.")

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

        # Extract run metadata (e.g., StartTime from <Id>)
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
                try:
                    parsed_time = parse_time(time_str)
                except ValueError as ve:
                    print(f"Skipping invalid time format in {file_path}: {ve}")
                    continue
                data_point = {
                    'time': parsed_time.isoformat(),  # Store as ISO format string
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

        # Extract run start time for properties (from the first data point)
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

def select_folder_dialog(title, initial_dir=None):
    """
    Open a folder selection dialog and return the selected folder path.

    Args:
        title (str): Title of the dialog.
        initial_dir (str, optional): Initial directory to open. Defaults to script's directory.

    Returns:
        str: Path to the selected folder.
    """
    root = Tk()
    root.withdraw()  # Hide the main window
    root.attributes('-topmost', True)  # Bring the dialog to the front
    folder_selected = filedialog.askdirectory(title=title, initialdir=initial_dir)
    root.destroy()
    return folder_selected

def get_file_size_in_mb(data):
    """Calculate the approximate size of the GeoJSON data in MB."""
    return len(json.dumps(data, separators=(',', ':')).encode('utf-8')) / (1024 * 1024)

def sort_features_by_date(features):
    """Sort GeoJSON features by 'run_start_time' field if present."""
    try:
        # Replace 'Z' with '+00:00' to make it ISO compliant for datetime.fromisoformat
        features.sort(
            key=lambda x: datetime.fromisoformat(
                x['properties'].get('run_start_time').replace('Z', '+00:00')
                if x['properties'].get('run_start_time') else ''
            ),
            reverse=False
        )
        print("Sorted features by 'run_start_time' field.")
    except Exception as e:
        print(f"Error sorting features by 'run_start_time': {e}")
        print("No valid 'run_start_time' field found or unable to sort by date. Skipping sorting.")

def split_geojson(features, max_size_mb):
    """
    Split GeoJSON features into chunks based on the maximum size.

    Args:
        features (list): List of GeoJSON features.
        max_size_mb (float): Maximum size in MB for each chunk.

    Returns:
        list: List of GeoJSON chunks.
    """
    chunks = []
    current_chunk = []
    current_size = 0
    part_number = 1

    for feature in features:
        feature_size = get_file_size_in_mb({"type": "FeatureCollection", "features": [feature]})

        if current_size + feature_size > max_size_mb and current_chunk:
            # Add the current chunk to chunks
            chunks.append({
                "type": "FeatureCollection",
                "features": current_chunk
            })
            print(f"Chunk {part_number} created with size: {current_size:.2f} MB")
            part_number += 1
            current_chunk = []
            current_size = 0

        current_chunk.append(feature)
        current_size += feature_size

    # Add the last chunk
    if current_chunk:
        chunks.append({
            "type": "FeatureCollection",
            "features": current_chunk
        })
        print(f"Chunk {part_number} created with size: {current_size:.2f} MB")

    return chunks

def convert_tcx_to_geojson(tcx_folder):
    """
    Convert all TCX files in a folder to a single GeoJSON FeatureCollection with separate LineString Features.

    Args:
        tcx_folder (str): Path to the folder containing TCX files.

    Returns:
        dict: Combined GeoJSON FeatureCollection.
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
        return None

    # Sort features by date
    sort_features_by_date(features)

    # Create FeatureCollection
    geojson_data = {
        "type": "FeatureCollection",
        "features": features
    }

    return geojson_data

def save_geojson(geojson_data, output_path):
    """
    Save GeoJSON data to a file in minified format.

    Args:
        geojson_data (dict): GeoJSON data.
        output_path (str): Path to save the GeoJSON file.
    """
    try:
        with open(output_path, 'w') as geojson_file:
            json.dump(geojson_data, geojson_file, separators=(',', ':'))
        print(f"Successfully wrote GeoJSON data to {output_path}")
    except Exception as e:
        print(f"Error writing to {output_path}: {e}")

def get_next_part_number(output_directory, output_prefix):
    """
    Determine the next part number based on existing files.

    Args:
        output_directory (str): Directory where output files are saved.
        output_prefix (str): Prefix of the output files.

    Returns:
        int: The next part number to use.
    """
    existing_files = os.listdir(output_directory)
    pattern = re.compile(rf"^{re.escape(output_prefix)}_part(\d+)\.geojson$")
    part_numbers = [int(match.group(1)) for file in existing_files if (match := pattern.match(file))]

    if part_numbers:
        return max(part_numbers) + 1
    else:
        return 1

def save_chunks(chunks, output_directory, output_prefix, continue_naming):
    """
    Save GeoJSON chunks to the specified directory with the given prefix in minified format.

    Args:
        chunks (list): List of GeoJSON chunks.
        output_directory (str): Directory to save the chunks.
        output_prefix (str): Prefix for the output files.
        continue_naming (bool): Whether to continue the existing naming scheme.
    """
    if continue_naming:
        part_number = get_next_part_number(output_directory, output_prefix)
    else:
        part_number = 1

    for chunk in chunks:
        output_filename = f"{output_prefix}_part{part_number}.geojson"
        output_path = os.path.join(output_directory, output_filename)
        try:
            with open(output_path, 'w') as out_file:
                json.dump(chunk, out_file, separators=(',', ':'))
            print(f"Created file: {output_filename} ({get_file_size_in_mb(chunk):.2f} MB)")
            part_number += 1
        except Exception as e:
            print(f"Error writing to {output_filename}: {e}")

def prompt_continue_naming(output_directory, output_prefix):
    """
    Prompt the user to decide whether to continue the existing naming scheme.

    Args:
        output_directory (str): Directory where output files are saved.
        output_prefix (str): Prefix of the output files.

    Returns:
        bool: True if the user wants to continue the naming scheme, False otherwise.
    """
    existing_files = os.listdir(output_directory)
    pattern = re.compile(rf"^{re.escape(output_prefix)}_part(\d+)\.geojson$")
    matching_files = [file for file in existing_files if pattern.match(file)]

    if matching_files:
        response = messagebox.askyesno(
            "Continue Naming Scheme",
            f"Detected existing files with prefix '{output_prefix}_partXX.geojson' in the selected output directory.\n\n"
            "Do you want to continue the existing naming scheme to avoid overwriting files?"
        )
        return response
    else:
        return False

def main():
    """
    Main function to execute the combined TCX to GeoJSON conversion, splitting, and minification.
    """
    print("=== TCX to GeoJSON Converter, Splitter, and Minifier ===")

    # Get the directory where the script is located
    script_dir = os.path.dirname(os.path.abspath(__file__))

    # Step 1: Select TCX Folder
    tcx_folder = select_folder_dialog("Select Folder Containing TCX Files", initial_dir=script_dir)
    if not tcx_folder:
        messagebox.showerror("Error", "No folder selected. Exiting the application.")
        return

    print(f"Selected TCX folder: {tcx_folder}")

    # Step 2: Convert TCX to GeoJSON
    geojson_data = convert_tcx_to_geojson(tcx_folder)
    if geojson_data is None:
        messagebox.showerror("Error", "No valid TCX data to convert. Exiting the application.")
        return

    # Optional: Save the combined GeoJSON (uncomment if needed)
    # combined_geojson_path = os.path.join(tcx_folder, "combined_runs.geojson")
    # save_geojson(geojson_data, combined_geojson_path)

    # Step 3: Prompt for Maximum Chunk Size
    root = Tk()
    root.withdraw()  # Hide the main window
    max_size_str = simpledialog.askstring("Input", "Enter the maximum file size for each chunk (in MB):",
                                         parent=root, initialvalue="10")
    root.destroy()

    if not max_size_str:
        messagebox.showerror("Error", "No maximum size entered. Exiting the application.")
        return

    try:
        max_size_mb = float(max_size_str)
        if max_size_mb <= 0:
            raise ValueError
    except ValueError:
        messagebox.showerror("Error", "Invalid maximum size entered. Please enter a positive number.")
        return

    print(f"Maximum chunk size set to: {max_size_mb} MB")

    # Step 4: Select Output Directory
    output_directory = select_folder_dialog("Select Output Directory for GeoJSON Chunks", initial_dir=script_dir)
    if not output_directory:
        messagebox.showerror("Error", "No output directory selected. Exiting the application.")
        return

    print(f"Selected output directory: {output_directory}")

    # Step 5: Specify Output Prefix
    root = Tk()
    root.withdraw()
    output_prefix = simpledialog.askstring("Input", "Enter the prefix for the output files:",
                                         parent=root, initialvalue="smashrun")
    root.destroy()

    if not output_prefix:
        messagebox.showerror("Error", "No output prefix entered. Exiting the application.")
        return

    print(f"Output file prefix set to: {output_prefix}")

    # Step 6: Check for Existing Files and Prompt
    continue_naming = prompt_continue_naming(output_directory, output_prefix)

    # Step 7: Split GeoJSON into Chunks
    features = geojson_data['features']
    chunks = split_geojson(features, max_size_mb)

    # Step 8: Save Chunks to Output Directory
    save_chunks(chunks, output_directory, output_prefix, continue_naming)

    messagebox.showinfo("Success", "GeoJSON splitting and minification complete.")

if __name__ == "__main__":
    main()
