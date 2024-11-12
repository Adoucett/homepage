// generate_photos_json.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Define directories
const fullDir = path.join(__dirname, 'full');
const thumbDir = path.join(__dirname, 'thumbnails');
const photosJSONPath = path.join(__dirname, 'photos.json');

// Define allowed image extensions
const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif'];

// Define thumbnail size
const thumbnailWidth = 300; // pixels

// Ensure the thumbnails directory exists
if (!fs.existsSync(thumbDir)) {
    fs.mkdirSync(thumbDir, { recursive: true });
    console.log(`Created thumbnails directory at ${thumbDir}`);
}

// Function to scan directory and generate photos.json
function generatePhotosJSON() {
    fs.readdir(fullDir, (err, files) => {
        if (err) {
            console.error('Unable to scan full images directory:', err);
            return;
        }

        // Filter files by allowed extensions
        const imageFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return allowedExtensions.includes(ext);
        });

        // Initialize photos array
        const photos = [];

        if (imageFiles.length === 0) {
            console.warn('No image files found in the full directory.');
            writeJSON(photos);
            return;
        }

        // Process each image file
        let processedCount = 0;

        imageFiles.forEach(file => {
            const fullImagePath = path.join(fullDir, file);
            const thumbnailImagePath = path.join(thumbDir, file);

            // Generate thumbnail using sharp
            sharp(fullImagePath)
                .resize({ width: thumbnailWidth })
                .toFile(thumbnailImagePath)
                .then(() => {
                    console.log(`Thumbnail created for ${file}`);

                    // Add photo entry to photos array
                    photos.push({
                        thumbnail: path.relative(__dirname, thumbnailImagePath).replace(/\\/g, '/'),
                        full: path.relative(__dirname, fullImagePath).replace(/\\/g, '/'),
                        alt: path.basename(file, path.extname(file)).replace(/_/g, ' ')
                    });

                    processedCount++;

                    // After processing all files, write JSON
                    if (processedCount === imageFiles.length) {
                        writeJSON(photos);
                    }
                })
                .catch(error => {
                    console.error(`Error creating thumbnail for ${file}:`, error);
                    processedCount++;

                    // Even if thumbnail creation fails, proceed to next file
                    if (processedCount === imageFiles.length) {
                        writeJSON(photos);
                    }
                });
        });
    });
}

// Function to write photos.json
function writeJSON(photos) {
    const photosJSON = {
        photos: photos
    };

    fs.writeFile(photosJSONPath, JSON.stringify(photosJSON, null, 4), 'utf8', (err) => {
        if (err) {
            console.error('Error writing photos.json:', err);
            return;
        }
        console.log(`photos.json has been successfully created at ${photosJSONPath}`);
    });
}

// Run the function
generatePhotosJSON();
