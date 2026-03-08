(function() {
  'use strict';

  // --- Typing Animation ---
  const wordEl = document.getElementById('dynamic-word');
  if (wordEl) {
    const words = [
      'Cartographer',
      'Data Viz Engineer',
      'Cyclist',
      'Runner',
      'Photographer',
      'Jazz Pianist',
      'Sales Engineer',
      'Nordic Skier'
    ];

    let wordIndex = 0;
    let charIndex = 0;
    let isDeleting = false;

    function type() {
      const current = words[wordIndex];

      if (isDeleting) {
        charIndex--;
        wordEl.textContent = current.substring(0, charIndex);
      } else {
        charIndex++;
        wordEl.textContent = current.substring(0, charIndex);
      }

      if (!isDeleting && charIndex === current.length) {
        setTimeout(() => { isDeleting = true; type(); }, 2200);
        return;
      }

      if (isDeleting && charIndex === 0) {
        isDeleting = false;
        wordIndex = (wordIndex + 1) % words.length;
      }

      const speed = isDeleting ? 60 : 120;
      setTimeout(type, speed);
    }

    type();
  }

  // --- About Page Mapbox Map ---
  const mapContainer = document.getElementById('about-map');
  if (mapContainer && typeof mapboxgl !== 'undefined') {
    mapboxgl.accessToken = 'pk.eyJ1IjoiYWRvdWNldHQiLCJhIjoiY20zZXZyN20zMGd3MzJycTBxYTFza29iYiJ9.ozrkMII8kTiKtHYTS54P2w';

    const map = new mapboxgl.Map({
      container: 'about-map',
      style: 'mapbox://styles/adoucett/cjeg655wt0i482spoj9gsr10l',
      center: [-87.0, 40.5],
      zoom: 3.8
    });

    map.on('load', () => {
      map.dragRotate.disable();
      map.touchZoomRotate.disableRotation();

      const locations = [
        {
          coords: [-72.6898, 42.3686],
          title: 'Western Massachusetts',
          description: 'Where I grew up and developed a love for the outdoors.'
        },
        {
          coords: [-71.0589, 42.3601],
          title: 'Boston, MA',
          description: 'Spent a decade building my career in the tech scene.'
        },
        {
          coords: [-90.1994, 38.6270],
          title: 'St. Louis, MO',
          description: 'My current home — Planet Labs and new horizons.'
        }
      ];

      locations.forEach(loc => {
        const el = document.createElement('div');
        el.style.cssText = 'width:16px;height:16px;background:var(--color-accent,#E67E22);border-radius:50%;border:2px solid rgba(255,255,255,0.8);box-shadow:0 0 8px rgba(230,126,34,0.5);cursor:pointer;';

        new mapboxgl.Marker(el)
          .setLngLat(loc.coords)
          .setPopup(
            new mapboxgl.Popup({ offset: 15 })
              .setHTML(`<h4>${loc.title}</h4><p style="margin:0;font-size:0.85rem;">${loc.description}</p>`)
          )
          .addTo(map);
      });
    });
  }
})();
