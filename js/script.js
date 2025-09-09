// --- Burger Menu (Works on all pages) ---
const burger = document.querySelector('.burger');
const nav = document.querySelector('.nav-links');
const navLinks = document.querySelectorAll('.nav-links li');

// Check if burger exists to prevent errors on pages without it
if (burger) {
    burger.addEventListener('click', () => {
        // Toggle Nav
        nav.classList.toggle('nav-active');
        // Burger Animation
        burger.classList.toggle('toggle');
    });
}

// Close menu when a link is clicked
navLinks.forEach(link => {
    link.addEventListener('click', () => {
        if (nav.classList.contains('nav-active')) {
            nav.classList.remove('nav-active');
            if (burger) {
                burger.classList.remove('toggle');
            }
        }
    });
});


// --- Homepage Mapbox Integration (Only runs if map container is found) ---
const homepageMapContainer = document.getElementById('map');

if (homepageMapContainer && window.innerWidth > 768) {
    // Function to initialize the Mapbox map
    function initializeMap() {
        // Mapbox Access Token
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
            map.setTerrain(null);

            // Fly to Boston, MA
            map.flyTo({
                center: [-71.0589, 42.3601], // Boston, MA
                zoom: 12,
                pitch: 75,
                speed: 0.9,
                curve: 1.5,
                essential: true
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
                    pitch: 85,
                    bearing: 0,
                    duration: 5000,
                    easing: (t) => t,
                    essential: true
                });
                // Start flying north slowly
                flyNorth(map);
            });
        });
    }

    // Function to fly north smoothly
    function flyNorth(map) {
        const targetLatitude = map.getCenter().lat + 1;
        const duration = 100000;
        const start = performance.now();
        const startLat = map.getCenter().lat;
        const deltaLat = targetLatitude - startLat;

        function animate(time) {
            const elapsed = time - start;
            const progress = Math.min(elapsed / duration, 1);
            const newLat = startLat + deltaLat * (t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t)(progress);
            map.setCenter([map.getCenter().lng, newLat]);
            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        }
        requestAnimationFrame(animate);
    }

    // Initialize the map on load
    window.addEventListener('load', initializeMap);
}


// --- Lightbox Functionality (Only runs if lightbox elements are found) ---
const lightbox = document.getElementById('lightbox');
const closeBtn = document.querySelector('.close');
const galleryItems = document.querySelectorAll('.gallery-item img');

// Check if lightbox and related elements exist on the page
if (lightbox && closeBtn && galleryItems.length > 0) {
    const lightboxImg = document.getElementById('lightbox-img');
    const captionText = document.getElementById('caption');

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
    const closeLightbox = () => {
        lightbox.style.display = 'none';
        document.body.style.overflow = 'auto'; // Restore scrolling
    };

    closeBtn.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) {
            closeLightbox();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && lightbox.style.display === 'block') {
            closeLightbox();
        }
    });
}
