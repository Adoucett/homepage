document.addEventListener('DOMContentLoaded', function() {

    // --- Animated Text Feature ---
    // Using your original list of words and their classes
    const dynamicWordEl = document.getElementById('dynamic-word');
    if (dynamicWordEl) {
        const words = [
            { text: "Cartographer", class: "font-cartographer" },
            { text: "Cyclist", class: "font-cyclist" },
            { text: "Runner", class: "font-runner" },
            { text: "Geospatial Marketer", class: "font-geospatial-marketer" },
            { text: "Coffee Lover", class: "font-coffee-lover" },
            { text: "Strava Aficionado", class: "font-strava-aficionado" },
            { text: "IKEA Fan", class: "font-ikea-fan" },
            { text: "Nordic Skier", class: "font-nordic-skier" },
            { text: "Hot Sauce Lover", class: "font-hot-sauce-lover" },
            { text: "Jazz Pianist", class: "font-jazz-pianist" },
            { text: "Sales Engineer", class: "font-sales-engineer" },
        ];

        let wordIndex = 0;
        let charIndex = 0;
        let isDeleting = false;

        function type() {
            const currentWord = words[wordIndex];
            const fullText = currentWord.text;
            
            // Apply the correct class for styling
            dynamicWordEl.className = currentWord.class;
            
            // Handle typing or deleting
            if (isDeleting) {
                dynamicWordEl.textContent = fullText.substring(0, charIndex - 1);
                charIndex--;
            } else {
                dynamicWordEl.textContent = fullText.substring(0, charIndex + 1);
                charIndex++;
            }

            // Logic to switch between typing, pausing, and deleting
            if (!isDeleting && charIndex === fullText.length) {
                setTimeout(() => isDeleting = true, 2000); // Pause before deleting
            } else if (isDeleting && charIndex === 0) {
                isDeleting = false;
                wordIndex = (wordIndex + 1) % words.length;
            }

            const typeSpeed = isDeleting ? 75 : 150;
            setTimeout(type, typeSpeed);
        }
        // Start the effect
        type();
    }

    // --- Interactive Mapbox Map ---
    const mapContainer = document.getElementById('about-map');
    if (mapContainer) {
        // Using your original Mapbox access token and custom style
        mapboxgl.accessToken = 'pk.eyJ1IjoiYWRvdWNldHQiLCJhIjoiY20zZXZyN20zMGd3MzJycTBxYTFza29iYiJ9.ozrkMII8kTiKtHYTS54P2w'; 

        const map = new mapboxgl.Map({
            container: 'about-map',
            style: 'mapbox://styles/adoucett/cjeg655wt0i482spoj9gsr10l', 
            center: [-87.0, 40.5], // Centered to show all points
            zoom: 3.8
        });
        
        map.on('load', () => {
             // Disable unwanted map interactions for a cleaner experience
            map.dragRotate.disable();
            map.touchZoomRotate.disableRotation();

            // The locations to feature on your map
            const locations = [
                {
                    coords: [-72.6898, 42.3686],
                    title: 'Western Massachusetts',
                    description: 'Where I grew up and developed a love for the outdoors.'
                },
                {
                    coords: [-71.0589, 42.3601],
                    title: 'Boston, MA',
                    description: 'Spent a decade building my career in the tech scene here.'
                },
                {
                    coords: [-90.1994, 38.6270],
                    title: 'St. Louis, MO',
                    description: 'My current home. Excited for a new chapter in the Midwest!'
                }
            ];

            // Add a styled marker and popup for each location
            locations.forEach(location => {
                const el = document.createElement('div');
                el.className = 'marker';
                el.style.backgroundImage = 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'%23e67e22\' width=\'30px\' height=\'30px\'%3E%3Cpath d=\'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z\'/%3E%3C/svg%3E")';
                el.style.width = '30px';
                el.style.height = '30px';
                el.style.backgroundSize = '100%';

                new mapboxgl.Marker(el)
                    .setLngLat(location.coords)
                    .setPopup(new mapboxgl.Popup({ offset: 25 })
                    .setHTML(`<h4>${location.title}</h4><p>${location.description}</p>`))
                    .addTo(map);
            });
        });
    }
});
