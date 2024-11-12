// Existing Burger Menu Toggle
const burger = document.querySelector('.burger');
const nav = document.querySelector('.nav-links');
const navLinks = document.querySelectorAll('.nav-links li');

burger.addEventListener('click', () => {
    // Toggle Nav
    nav.classList.toggle('nav-active');

    // Animate Links
    navLinks.forEach((link, index) => {
        if(link.style.animation){
            link.style.animation = '';
        } else {
            link.style.animation = `navLinkFade 0.5s ease forwards ${index / 7 + 0.3}s`;
        }
    });

    // Burger Animation
    burger.classList.toggle('toggle');
});

// Optional: Close menu when a link is clicked (for better UX)
navLinks.forEach(link => {
    link.addEventListener('click', () => {
        if(nav.classList.contains('nav-active')){
            nav.classList.remove('nav-active');
            burger.classList.remove('toggle');
            navLinks.forEach(link => {
                link.style.animation = '';
            });
        }
    });
});

/* =========================
   Mapbox Integration (from index.html)
   ========================= */

// Function to initialize the Mapbox map
function initializeMap() {
    // Mapbox Access Token
    mapboxgl.accessToken = 'pk.eyJ1IjoiYWRvdWNldHQiLCJhIjoiY20zZXZyN20zMGd3MzJycTBxYTFza29iYiJ9.ozrkMII8kTiKtHYTS54P2w';

    // Initialize the map
    const map = new mapboxgl.Map({
        container: 'map', // Container ID
        style: 'mapbox://styles/adoucett/cl59necov000b15pk1jirufhx', // Map style
        center: [0, 0], // Starting position [lng, lat]
        zoom: 1, // Starting zoom
        interactive: false, // Disable all interactions
        attributionControl: false // Hide default attribution
    });

//    // Add custom attribution (as per Mapbox policy)
//   map.addControl(new mapboxgl.AttributionControl({
//        compact: true
//    }));

    // Once the map loads, perform the fly-in animation
    map.on('load', () => {
        map.flyTo({
            center: [-71.0589, 42.3601], // Boston, MA [lng, lat]
            zoom: 12, // Neighborhood level
            speed: 0.5, // Fly speed
            essential: true // This animation is considered essential with respect to prefers-reduced-motion
        });
    });
}

// Check if the screen width is greater than 768px before initializing the map
if (window.innerWidth > 768) {
    // Initialize the map after a short delay to ensure everything is loaded
    window.addEventListener('load', () => {
        initializeMap();
    });
}

/* =========================
   Lightbox Functionality
   ========================= */

// Select all gallery items
const galleryItems = document.querySelectorAll('.gallery-item img');

// Select the lightbox elements
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const captionText = document.getElementById('caption');
const closeBtn = document.querySelector('.close');

// Function to open lightbox
galleryItems.forEach(item => {
    item.addEventListener('click', () => {
        lightbox.style.display = 'block';
        lightboxImg.src = item.src;
        captionText.innerHTML = item.alt;
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
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
