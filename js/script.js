(function() {
  'use strict';

  const mapContainer = document.getElementById('map');
  if (!mapContainer || window.innerWidth <= 768) return;

  function initializeMap() {
    mapboxgl.accessToken = 'pk.eyJ1IjoiYWRvdWNldHQiLCJhIjoiY20zZXZyN20zMGd3MzJycTBxYTFza29iYiJ9.ozrkMII8kTiKtHYTS54P2w';

    const map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/adoucett/cl59necov000b15pk1jirufhx',
      center: [0, 55],
      zoom: 2,
      interactive: false,
      attributionControl: false
    });

    map.on('load', () => {
      map.setTerrain(null);
      map.setFog({
        range: [-1, 2],
        'horizon-blend': 0.5,
        color: '#242B4B',
        'high-color': '#161B36',
        'space-color': '#0B1026',
        'star-intensity': 1
      });

      map.flyTo({
        center: [-71.0589, 42.3601],
        zoom: 12,
        pitch: 75,
        speed: 0.9,
        curve: 1.5,
        essential: true
      });

      map.once('moveend', () => {
        map.easeTo({
          pitch: 85,
          bearing: 0,
          duration: 5000,
          easing: (t) => t,
          essential: true
        });
        flyNorth(map);
      });
    });
  }

  function flyNorth(map) {
    const duration = 100000;
    const start = performance.now();
    const startLat = map.getCenter().lat;
    const deltaLat = 1;

    function ease(t) {
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    }

    function animate(time) {
      const progress = Math.min((time - start) / duration, 1);
      const newLat = startLat + deltaLat * ease(progress);
      map.setCenter([map.getCenter().lng, newLat]);
      if (progress < 1) requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeMap);
  } else {
    initializeMap();
  }
})();
