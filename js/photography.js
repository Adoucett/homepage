// Photography Page Specific JavaScript

/* =========================
   Gallery Auto-Population and Lightbox
   ========================= */

// Function to fetch photos.json and populate the gallery
function populateGallery() {
    fetch('images/photos/photos.json')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            const gallery = document.getElementById('gallery');
            data.photos.forEach(photo => {
                // Create gallery item div
                const galleryItem = document.createElement('div');
                galleryItem.classList.add('gallery-item');

                // Create img element
                const img = document.createElement('img');
                img.src = `images/photos/${photo}`;
                img.alt = photo.replace(/\.(jpg|jpeg|png|gif)$/i, '').replace(/_/g, ' ');
                img.loading = 'lazy';

                // Append img to gallery item
                galleryItem.appendChild(img);

                // Append gallery item to gallery
                gallery.appendChild(galleryItem);
            });

            // After populating, initialize lightbox functionality
            initializeLightbox();
        })
        .catch(error => console.error('Error loading photos.json:', error));
}

// Function to initialize lightbox
function initializeLightbox() {
    // Select all gallery images
    const galleryImages = document.querySelectorAll('.gallery-item img');

    // Select lightbox elements
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const captionText = document.getElementById('caption');
    const closeBtn = document.querySelector('.close');

    // Function to open lightbox
    galleryImages.forEach(image => {
        image.addEventListener('click', () => {
            lightbox.style.display = 'block';
            lightboxImg.src = image.src;
            captionText.textContent = image.alt;
            document.body.style.overflow = 'hidden'; // Prevent background scrolling
            closeBtn.focus(); // Shift focus to close button for accessibility
        });
    });

    // Function to close lightbox
    closeBtn.addEventListener('click', () => {
        lightbox.style.display = 'none';
        document.body.style.overflow = 'auto'; // Restore scrolling
    });

    // Close lightbox when clicking outside the image
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) {
            lightbox.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
    });

    // Close lightbox on 'Esc' key press
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && lightbox.style.display === 'block') {
            lightbox.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
    });
}

// Initialize gallery on DOMContentLoaded
document.addEventListener('DOMContentLoaded', populateGallery);
