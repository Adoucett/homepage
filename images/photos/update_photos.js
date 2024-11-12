// generate_photos_json.js

const fs = require('fs');
const path = require('path');

// Define the directory to scan (current directory)
const directoryPath = __dirname;

// Define allowed image extensions
const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif'];

// Function to scan directory and generate photos.json
function generatePhotosJSON() {
    fs.readdir(directoryPath, (err, files) => {
        if (err) {
            console.error('Unable to scan directory:', err);
            return;
        }

        // Filter files by allowed extensions
        const photos = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return allowedExtensions.includes(ext);
        });

        // Create the JSON object
        const photosJSON = {
            photos: photos
        };

        // Define the output path (assuming photos.json is in /data/ directory relative to project root)
        // Adjust the path as needed
        const outputPath = path.join(directoryPath, '..', '..', 'data', 'photos.json');

        // Ensure the /data/ directory exists
        fs.mkdir(path.dirname(outputPath), { recursive: true }, (err) => {
            if (err) {
                console.error('Error creating /data/ directory:', err);
                return;
            }

            // Write the JSON file with indentation for readability
            fs.writeFile(outputPath, JSON.stringify(photosJSON, null, 4), 'utf8', (err) => {
                if (err) {
                    console.error('Error writing photos.json:', err);
                    return;
                }
                console.log(`photos.json has been successfully created at ${outputPath}`);
            });
        });
    });
}

// Run the function
generatePhotosJSON();
