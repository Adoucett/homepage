// Photography Page Specific JavaScript
// photography.js

/* =========================
   Slideshow Functionality
   ========================= */
let slideIndex = 0;
let slides = [];
let dots = [];
let slideshowInterval;

// Function to show slides with fade effect
function showSlides(n) {
    const slideshowSlides = document.getElementsByClassName("slides");
    const dotElements = document.getElementsByClassName("dot");

    if (n >= slideshowSlides.length) { slideIndex = 0 }
    if (n < 0) { slideIndex = slideshowSlides.length - 1 }

    // Hide all slides and remove active class from dots
    for (let i = 0; i < slideshowSlides.length; i++) {
        slideshowSlides[i].classList.remove('active');
    }

    for (let i = 0; i < dotElements.length; i++) {
        dotElements[i].classList.remove('active');
    }

    // Show current slide and add active class to corresponding dot
    if (slideshowSlides.length > 0) {
        slideshowSlides[slideIndex].classList.add('active');
    }
    if (dotElements.length > 0) {
        dotElements[slideIndex].classList.add('active');
    }
}

// Function to next slide
function nextSlide() {
    slideIndex++;
    showSlides(slideIndex);
}

// Function to previous slide
function prevSlide() {
    slideIndex--;
    showSlides(slideIndex);
}

// Function to set current slide based on dot click
function currentSlide(n) {
    slideIndex = n;
    showSlides(slideIndex);
}

// Function to setup slideshow
function setupSlideshow() {
    // Fetch photos.json to use the same photos for slideshow
    fetch('images/photos/photos.json')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            const slideshowSlidesContainer = document.querySelector('.slides-container');
            const dotContainer = document.querySelector('.dot-container');

            data.photos.forEach((photo, index) => {
                // Create slide div
                const slideDiv = document.createElement('div');
                slideDiv.classList.add('slides', 'fade');

                // Create image element
                const img = document.createElement('img');
                img.src = photo.full;
                img.alt = photo.alt;

                // Append image to slide div
                slideDiv.appendChild(img);

                // Append slide to slideshow container
                slideshowSlidesContainer.appendChild(slideDiv);

                // Create dot
                const dot = document.createElement('span');
                dot.classList.add('dot');
                dot.addEventListener('click', () => {
                    clearInterval(slideshowInterval); // Stop automatic slideshow on manual navigation
                    currentSlide(index);
                    slideshowInterval = setInterval(nextSlide, 10000); // Restart automatic slideshow
                });

                // Append dot to dot container
                dotContainer.appendChild(dot);
            });

            slides = document.getElementsByClassName("slides");
            dots = document.getElementsByClassName("dot");

            // Initialize slideshow
            showSlides(slideIndex);

            // Start automatic slideshow
            slideshowInterval = setInterval(nextSlide, 10000); // Change slide every 5 seconds
        })
        .catch(error => console.error('Error loading photos.json for slideshow:', error));

    // Add event listeners to Prev and Next buttons
    const prevButton = document.querySelector('.prev');
    const nextButton = document.querySelector('.next');

    if (prevButton && nextButton) {
        prevButton.addEventListener('click', () => {
            clearInterval(slideshowInterval); // Stop automatic slideshow on manual navigation
            prevSlide();
            slideshowInterval = setInterval(nextSlide, 10000); // Restart automatic slideshow
        });

        nextButton.addEventListener('click', () => {
            clearInterval(slideshowInterval); // Stop automatic slideshow on manual navigation
            nextSlide();
            slideshowInterval = setInterval(nextSlide, 10000); // Restart automatic slideshow
        });
    }
}

// Initialize slideshow on DOMContentLoaded
document.addEventListener('DOMContentLoaded', setupSlideshow);

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
            data.photos.forEach((photo, index) => {
                // Create gallery item div
                const galleryItem = document.createElement('div');
                galleryItem.classList.add('gallery-item');

                // Create img element for thumbnail
                const img = document.createElement('img');
                img.src = photo.thumbnail;
                img.alt = photo.alt;
                img.loading = 'lazy';
                img.dataset.full = photo.full; // Store full-resolution path

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
            lightboxImg.src = image.dataset.full; // Use full-resolution image
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

document.addEventListener('DOMContentLoaded', function() {
    // Function to show the next slide
    function showNextSlide() {
        document.querySelector('.next').click();
    }

    // Function to show the previous slide
    function showPrevSlide() {
        document.querySelector('.prev').click();
    }

    // Listen for keydown events
    document.addEventListener('keydown', function(event) {
        if (event.key === 'ArrowRight') {
            showNextSlide();
        } else if (event.key === 'ArrowLeft') {
            showPrevSlide();
        }
    });

    // Optional: Close lightbox with Esc key
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            const lightbox = document.querySelector('.lightbox');
            if (lightbox.style.display === 'block') {
                lightbox.style.display = 'none';
            }
        }
    });
});
