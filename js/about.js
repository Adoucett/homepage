
// about.js


// Initialize Mapbox
mapboxgl.accessToken = 'pk.eyJ1IjoiYWRvdWNldHQiLCJhIjoiY20zZXZyN20zMGd3MzJycTBxYTFza29iYiJ9.ozrkMII8kTiKtHYTS54P2w';

const map = new mapboxgl.Map({
    container: 'about-map',
    style: 'mapbox://styles/adoucett/cjeg655wt0i482spoj9gsr10l',
    center: [-74.0060, 40.7128], // Example: New York City coordinates
    zoom: 9,
    maxZoom: 12,
    minZoom: 4
});

// Add navigation controls
map.addControl(new mapboxgl.NavigationControl());

