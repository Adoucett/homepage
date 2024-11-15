// Existing Burger Menu Toggle
const burger = document.querySelector('.burger');
const nav = document.querySelector('.nav-links');
const navLinks = document.querySelectorAll('.nav-links li');

burger.addEventListener('click', () => {
    // Toggle Nav
    nav.classList.toggle('nav-active');



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
            // Mapbox Access Token (Ensure to keep this secure in production)
            mapboxgl.accessToken = 'pk.eyJ1IjoiYWRvdWNldHQiLCJhIjoiY20zZXZyN20zMGd3MzJycTBxYTFza29iYiJ9.ozrkMII8kTiKtHYTS54P2w';

            // Initialize the map
            const map = new mapboxgl.Map({
                container: 'map', // Container ID
                style: 'mapbox://styles/adoucett/cl59necov000b15pk1jirufhx', // Map style
                center: [0, 55], // Starting position [lng, lat]
                zoom: 2, // Starting zoom
                interactive: false, // Disable all interactions
                attributionControl: false // Hide default attribution
            });

            // Once the map loads, perform the fly-in animation
            map.on('load', () => {

                // Disable terrain before the animation to ensure smooth height transition
                map.setTerrain(null);

                // Fly to Boston, MA with smooth transition
                map.flyTo({
                    center: [-71.0589, 42.3601], // Boston, MA [lng, lat]
                    zoom: 12, // Final zoom level
                    pitch: 75,
                    speed: 0.9, // Adjusted speed for smoother transition
                    curve: 1.5, // Adjusted curve for smoother path
                    essential: true // This animation is considered essential with respect to prefers-reduced-motion
                });
                
                map.setFog({
                        'range': [-1, 2],
                        'horizon-blend': 0.5,
                        'color': '#242B4B',
                        'high-color': '#161B36',
                        'space-color': '#0B1026',
                        'star-intensity': 1 
                        });

                // Adjust pitch and bearing after the flyTo animation completes
                map.once('moveend', () => {
                    map.easeTo({
                        pitch: 85, // Tilt to 45 degrees
                        bearing: 0, // Facing north
                        duration: 5000, // Duration in milliseconds
                        easing: (t) => t, // Linear easing
                        essential: true // Respect user's prefers-reduced-motion setting
                    });

                    // Start flying north slowly after adjusting pitch and bearing
                    flyNorth(map);
                });
            });
        }

        // Function to fly north smoothly using requestAnimationFrame
        function flyNorth(map) {
            const targetLatitude = map.getCenter().lat + 1; // Fly 1 degree north
            const duration = 100000; // Duration of the flight in milliseconds (e.g., 20 seconds)
            const start = performance.now();
            const startLat = map.getCenter().lat;
            const deltaLat = targetLatitude - startLat;

            function animate(time) {
                const elapsed = time - start;
                const progress = Math.min(elapsed / duration, 1); // Ensure progress does not exceed 1

                const newLat = startLat + deltaLat * easeInOutQuad(progress);
                map.setCenter([map.getCenter().lng, newLat]);

                if (progress < 1) {
                    requestAnimationFrame(animate);
                }
            }

            // Easing function for smooth acceleration and deceleration
            function easeInOutQuad(t) {
                return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            }

            requestAnimationFrame(animate);
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
