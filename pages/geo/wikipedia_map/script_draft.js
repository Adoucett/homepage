// Replace with your own Mapbox Access Token
mapboxgl.accessToken =
  "pk.eyJ1IjoiYWRvdWNldHQiLCJhIjoiY2lvZDFsc2lwMDRnd3Zha2pneWpxcHh6biJ9.sbWgw2zPGyScsp-r4CYQnA";

// Default Settings
let settings = {
  resultsCount: 20,
  searchRadius: 10000, // in meters
  mapStyle: "mapbox://styles/mapbox/streets-v12",
};

// Load settings from localStorage if available
const savedSettings = localStorage.getItem("wikimap-settings");
if (savedSettings) {
  settings = JSON.parse(savedSettings);
}

// Initialize map
const map = new mapboxgl.Map({
  container: "map", // container ID
  style: settings.mapStyle, // initial style from settings
  center: [-92.5, 42.64], // [lng, lat]
  zoom: 4,
});

// Add navigation controls to the map (zoom buttons)
map.addControl(new mapboxgl.NavigationControl());

// Initialize Mapbox Geocoder (search bar)
const geocoder = new MapboxGeocoder({
  accessToken: mapboxgl.accessToken,
  mapboxgl: mapboxgl,
  marker: false, // Disable the default marker
  placeholder: "Search for a location",
});
document.getElementById("geocoder").appendChild(geocoder.onAdd(map));

// Grab UI elements
const infoPanel = document.getElementById("info-panel");
const closePanelBtn = document.getElementById("close-panel");
const locationCoordsDiv = document.getElementById("location-coords");
const reverseGeocodeDiv = document.getElementById("reverse-geocode");
const categorizedArticlesDiv = document.getElementById("categorized-articles");
const adminList = document.getElementById("admin-list");
const basemapSelect = document.getElementById("basemapSelect");
const settingsBtn = document.getElementById("settings-btn");

// Settings Modal Elements
const settingsModal = document.getElementById("settings-modal");
const closeSettingsModalBtn = settingsModal.querySelector(".close-modal");
const settingsForm = document.getElementById("settings-form");

// Modal elements for article preview
const articleModal = document.getElementById("article-modal");
const closeModalBtn = document.getElementById("close-modal");
const wikiIframe = document.getElementById("wiki-iframe");
const fullArticleLink = document.getElementById("full-article-link");

// Marker storage to manage dynamically added markers
let poiMarkers = []; // Array of { marker: mapboxgl.Marker, articleIndex: number }

// To keep track of current articles (useful for re-adding markers after style changes)
let currentArticles = [];

// Variable to store the current circle layer
let currentCircle = null;

// Populate the basemap selector with current settings
basemapSelect.value = settings.mapStyle;

// Event Listeners

// Basemap toggle event
basemapSelect.addEventListener("change", (e) => {
  const selectedStyle = e.target.value;
  map.setStyle(selectedStyle);
  settings.mapStyle = selectedStyle;
  saveSettings();

  // Re-add markers and circle after the new style loads
  map.once("style.load", () => {
    addMarkers(currentArticles);
    if (currentCircle) {
      drawCircle(currentCircle.center, currentCircle.radius);
    }
  });
});

// Open Settings Modal
settingsBtn.addEventListener("click", () => {
  settingsModal.style.display = "block";
});

// Close Settings Modal
closeSettingsModalBtn.addEventListener("click", () => {
  settingsModal.style.display = "none";
});

// Handle Settings Form Submission with Validation
settingsForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const formData = new FormData(settingsForm);

  // Validate and set resultsCount (max 500)
  let inputResultsCount = parseInt(formData.get("resultsCount"), 10);
  if (isNaN(inputResultsCount) || inputResultsCount <= 0) {
    settings.resultsCount = 20; // Default value
  } else {
    if (inputResultsCount > 500) {
      alert("Results count capped at 500.");
    }
    settings.resultsCount = Math.min(inputResultsCount, 500); // Cap at 500
  }

  // Validate and set searchRadius (max 100000 meters)
  let inputRadius = parseInt(formData.get("searchRadius"), 10);
  if (isNaN(inputRadius) || inputRadius <= 0) {
    settings.searchRadius = 10000; // Default value
  } else {
    if (inputRadius > 100000) {
      alert("Search radius capped at 100,000 meters.");
    }
    settings.searchRadius = Math.min(inputRadius, 100000); // Cap at 100000
  }

  // Set mapStyle if provided
  settings.mapStyle = formData.get("mapStyle") || settings.mapStyle;

  // Update map style
  map.setStyle(settings.mapStyle);

  // Close modal
  settingsModal.style.display = "none";

  // Save settings to localStorage
  saveSettings();

  // Re-add markers and circle after the new style loads
  map.once("style.load", () => {
    addMarkers(currentArticles);
    if (currentCircle) {
      drawCircle(currentCircle.center, settings.searchRadius);
    }
  });
});

// Close side panel
closePanelBtn.addEventListener("click", () => {
  infoPanel.style.display = "none";
  clearPOIMarkers();
});

// Close article modal
closeModalBtn.addEventListener("click", () => {
  articleModal.style.display = "none";
  wikiIframe.src = "";
  fullArticleLink.href = "#";
});

/**
 * Save settings to localStorage
 */
function saveSettings() {
  localStorage.setItem("wikimap-settings", JSON.stringify(settings));
}

/**
 * Reverse Geocode using Mapbox Geocoding API
 */
async function reverseGeocode(lng, lat) {
  const endpoint = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${mapboxgl.accessToken}`;
  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error("Reverse geocoding failed.");
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Reverse Geocode Error:", error);
    return null;
  }
}

/**
 * Fetch nearby Wikipedia articles using the GeoSearch API.
 * Ensures that radius does not exceed 100000 meters and limit does not exceed 100.
 */
async function fetchNearbyWikipediaArticles(lat, lng, radius = 100000, limit = 100) {
  // Enforce maximum radius and limit
  const validatedRadius = Math.min(radius, 100000); // Updated max radius
  const validatedLimit = Math.min(limit, 100); // Updated max limit

  const endpoint = `https://en.wikipedia.org/w/api.php?origin=*` +
    `&action=query` +
    `&list=geosearch` +
    `&gscoord=${lat}|${lng}` +
    `&gsradius=${validatedRadius}` +
    `&gslimit=${validatedLimit}` +
    `&format=json`;

  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error("Wikipedia GeoSearch API failed.");
    }
    const data = await response.json();
    return data?.query?.geosearch || [];
  } catch (error) {
    console.error("Wikipedia GeoSearch Error:", error);
    return [];
  }
}

/**
 * Assign a "prominence score" to an article based on keywords in the title.
 * This is a naive approach—feel free to refine.
 */
function getProminenceScore(title) {
  const t = title.toLowerCase();

  // Some rough categories for demonstration
  // Higher score = displayed higher in the list
  if (t.includes("state") || t.includes("province") || t.includes("country")) {
    return 100;
  }
  if (
    t.includes("county") ||
    t.includes("region") ||
    t.includes("city") ||
    t.includes("town") ||
    t.includes("village")
  ) {
    return 80;
  }
  if (
    t.includes("mountain") ||
    t.includes("range") ||
    t.includes("national park") ||
    t.includes("river") ||
    t.includes("lake") ||
    t.includes("forest") ||
    t.includes("desert") ||
    t.includes("waterfall") ||
    t.includes("canyon") ||
    t.includes("island") ||
    t.includes("glacier") ||
    t.includes("volcano") ||
    t.includes("valley") ||
    t.includes("beach")
  ) {
    return 70;
  }
  if (
    t.includes("park") ||
    t.includes("forest") ||
    t.includes("river") ||
    t.includes("lake") ||
    t.includes("parkway") ||
    t.includes("garden")
  ) {
    return 60;
  }
  // Fallback
  return 50;
}

/**
 * Sort articles according to:
 * 1) "Prominence" from our naive function
 * 2) Then distance from click point (ascending)
 */
function sortArticles(articles) {
  return articles.sort((a, b) => {
    const scoreA = getProminenceScore(a.title);
    const scoreB = getProminenceScore(b.title);

    // If scores are equal, fallback to distance comparison
    if (scoreB === scoreA) {
      return a.dist - b.dist; // ascending by distance
    }
    // Otherwise, compare by prominence score (descending)
    return scoreB - scoreA;
  });
}

/**
 * Show the mini article preview in an iframe.
 */
function showArticlePreview(title, pageid) {
  const wikiUrl = `https://en.m.wikipedia.org/wiki/${encodeURIComponent(title)}`;

  // Show the modal
  articleModal.style.display = "block";
  wikiIframe.src = wikiUrl;
  fullArticleLink.href = `https://en.wikipedia.org/?curid=${pageid}`;
}

/**
 * Create clickable admin link list items for city, state, and country.
 */
function populateAdminList(feature) {
  // Clear existing
  adminList.innerHTML = "";

  if (!feature) return;

  // "context" array often includes country, region, place, etc.
  const context = feature.context || [];
  let cityName = "";
  let stateName = "";
  let countryName = "";

  context.forEach((c) => {
    // c.id => region.###, place.###, country.###, etc.
    const type = c.id.split(".")[0];
    if (type === "place" || type === "locality") {
      cityName = c.text;
    } else if (type === "region") {
      stateName = c.text;
    } else if (type === "country") {
      countryName = c.text;
    }
  });

  // Add City: link
  if (cityName) {
    const cityLi = document.createElement("li");
    const cityLink = document.createElement("a");
    // Attempt something like "Park_City,_Utah"
    // If no stateName, just do cityName
    const wikiCity = stateName
      ? `${cityName.replace(/\s/g, "_")},_${stateName.replace(/\s/g, "_")}`
      : cityName.replace(/\s/g, "_");

    cityLink.href = `https://en.m.wikipedia.org/wiki/${encodeURIComponent(wikiCity)}`;
    cityLink.target = "_blank";
    cityLink.textContent = `City: ${cityName}`;
    cityLi.appendChild(cityLink);
    adminList.appendChild(cityLi);
  }

  // Add State: link
  if (stateName) {
    const stateLi = document.createElement("li");
    const stateLink = document.createElement("a");
    // e.g. "Utah" => "Utah"
    const wikiState = stateName.replace(/\s/g, "_");
    stateLink.href = `https://en.m.wikipedia.org/wiki/${encodeURIComponent(wikiState)}`;
    stateLink.target = "_blank";
    stateLink.textContent = `State: ${stateName}`;
    stateLi.appendChild(stateLink);
    adminList.appendChild(stateLi);
  }

  // Add Country: link
  if (countryName) {
    const countryLi = document.createElement("li");
    const countryLink = document.createElement("a");
    // e.g. "United States" => "United_States"
    const wikiCountry = countryName.replace(/\s/g, "_");
    countryLink.href = `https://en.m.wikipedia.org/wiki/${encodeURIComponent(wikiCountry)}`;
    countryLink.target = "_blank";
    countryLink.textContent = `Country: ${countryName}`;
    countryLi.appendChild(countryLink);
    adminList.appendChild(countryLi);
  }
}

/**
 * Add markers to the map for each POI.
 * This function uses custom markers styled via CSS.
 */
function addMarkers(articles) {
  // Clear existing markers first to avoid duplication
  clearPOIMarkers();

  // Store current articles for re-adding after style changes
  currentArticles = articles;

  articles.forEach((article, index) => {
    // Debug: Log marker creation
    console.log(
      `Adding marker for ${article.title} at [Longitude: ${article.lon}, Latitude: ${article.lat}]`
    );

    // Create a DOM element for the marker
    const markerEl = document.createElement("div");
    markerEl.className = "poi-marker";
    markerEl.dataset.index = index; // Assign index for reference

    // Create label element
    const labelEl = document.createElement("div");
    labelEl.className = "marker-label";
    labelEl.textContent = article.title;
    markerEl.appendChild(labelEl);

    // Create the marker and add to the map
    const marker = new mapboxgl.Marker(markerEl)
      .setLngLat([article.lon, article.lat]) // Ensure [lng, lat] order
      .addTo(map);

    // Function to show article preview
    const openPreview = () => {
      showArticlePreview(article.title, article.pageid);
    };

    // Add click event to marker container
    markerEl.addEventListener("click", () => {
      openPreview();
      zoomToLocation(article.lon, article.lat);
    });

    // Add click event to label
    labelEl.addEventListener("click", (e) => {
      e.stopPropagation(); // Prevent event from bubbling to markerEl
      openPreview();
      zoomToLocation(article.lon, article.lat);
    });

    // Add mouseenter and mouseleave events for hover effects
    markerEl.addEventListener("mouseenter", () => {
      const row = categorizedArticlesDiv.querySelector(
        `.article-row[data-index="${index}"]`
      );
      if (row) {
        row.classList.add("highlight-row");
      }
    });

    markerEl.addEventListener("mouseleave", () => {
      const row = categorizedArticlesDiv.querySelector(
        `.article-row[data-index="${index}"]`
      );
      if (row) {
        row.classList.remove("highlight-row");
      }
    });

    // Store markers for later removal and reference
    poiMarkers.push({ marker, articleIndex: index, coordinates: [article.lon, article.lat] });
  });
}

/**
 * Clear all POI markers from the map.
 */
function clearPOIMarkers() {
  poiMarkers.forEach((markerObj) => markerObj.marker.remove());
  poiMarkers = [];
}

/**
 * Format distance: meters to meters or kilometers.
 */
function formatDistance(meters) {
  if (meters > 2000) {
    return `${(meters / 1000).toFixed(1)} km away`;
  }
  return `${meters} m away`;
}

/**
 * Draw a circle on the map using Turf.js
 * @param {Array} center - [lng, lat]
 * @param {number} radius - in meters
 */
function drawCircle(center, radius) {
  // Remove existing circle if any
  if (currentCircle) {
    if (map.getSource("search-radius")) {
      map.removeLayer("search-radius-layer");
      map.removeSource("search-radius");
    }
    currentCircle = null;
  }

  // Create a Turf.js circle
  const options = { steps: 64, units: "meters" };
  const circle = turf.circle(center, radius, options);

  // Add circle as a source
  map.addSource("search-radius", {
    type: "geojson",
    data: circle,
  });

  // Add circle as a layer
  map.addLayer({
    id: "search-radius-layer",
    type: "fill",
    source: "search-radius",
    layout: {},
    paint: {
      "fill-color": "#1DA1F2",
      "fill-opacity": 0.1,
    },
  });

  // Store current circle info
  currentCircle = {
    center: center,
    radius: radius,
  };
}

/**
 * Zoom to a specific location and center the map
 * @param {number} lng - Longitude
 * @param {number} lat - Latitude
 */
function zoomToLocation(lng, lat) {
  map.flyTo({
    center: [lng, lat],
    zoom: 14,
    essential: true, // this animation is considered essential with respect to prefers-reduced-motion
  });

  // Optionally, adjust the search radius circle
  if (currentCircle) {
    drawCircle([lng, lat], settings.searchRadius);
  }
}

/**
 * Main click handler on the map
 * 1. Reverse geocode
 * 2. Query Wikipedia
 * 3. Sort & display
 * 4. Show admin hierarchy at top
 * 5. Add POI markers
 * 6. Draw search radius circle
 */
map.on("click", async (e) => {
  const { lng, lat } = e.lngLat;

  // Debug: Log the clicked coordinates
  console.log(`Map Clicked at [Longitude: ${lng}, Latitude: ${lat}]`);

  // Clear old content and markers
  reverseGeocodeDiv.innerHTML = "Loading address info...";
  adminList.innerHTML = "";
  categorizedArticlesDiv.innerHTML = "";
  clearPOIMarkers();

  // Show side panel
  infoPanel.style.display = "flex";

  // Display raw coordinates
  locationCoordsDiv.textContent = `Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;

  // 1) Reverse Geocode
  const geocodeResult = await reverseGeocode(lng, lat);
  let firstFeature = null;

  if (
    geocodeResult &&
    geocodeResult.features &&
    geocodeResult.features.length
  ) {
    firstFeature = geocodeResult.features[0];
    const placeName = firstFeature.place_name;
    reverseGeocodeDiv.innerHTML = `<strong>Mapbox Reverse Geocode:</strong><br/>${placeName}`;
  } else {
    reverseGeocodeDiv.innerHTML = "No address info found.";
  }

  // 2) Populate the city/state list if available
  if (firstFeature) {
    populateAdminList(firstFeature);
  }

  // 3) Fetch nearby Wikipedia articles
  const wikiResults = await fetchNearbyWikipediaArticles(
    lat,
    lng,
    settings.searchRadius,
    settings.resultsCount
  );

  // Debug: Log fetched articles
  console.log("Fetched Wikipedia Articles:", wikiResults);

  // 4) Sort them by "prominence" (and distance)
  const sortedArticles = sortArticles(wikiResults);

  // Debug: Log sorted articles
  console.log("Sorted Articles:", sortedArticles);

  // 5) Display the categorized articles
  if (sortedArticles.length === 0) {
    categorizedArticlesDiv.innerHTML =
      "<p>No Wikipedia articles found nearby.</p>";
  } else {
    const categoryGroup = document.createElement("div");
    categoryGroup.className = "category-group";

    const categoryHeader = document.createElement("h4");
    categoryHeader.textContent = "Articles";
    categoryGroup.appendChild(categoryHeader);

    // Create table
    const table = document.createElement("table");
    table.className = "articles-table";

    // Table header
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");

    const titleHeader = document.createElement("th");
    titleHeader.textContent = "Title";
    const distanceHeader = document.createElement("th");
    distanceHeader.textContent = "Distance";

    headerRow.appendChild(titleHeader);
    headerRow.appendChild(distanceHeader);
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Table body
    const tbody = document.createElement("tbody");

    sortedArticles.forEach((article, index) => {
      const tr = document.createElement("tr");
      tr.className = "article-row";
      tr.dataset.index = index; // Assign index for reference

      const titleTd = document.createElement("td");
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = article.title;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        showArticlePreview(article.title, article.pageid);
        zoomToLocation(article.lon, article.lat);
      });
      titleTd.appendChild(link);

      const distanceTd = document.createElement("td");
      distanceTd.textContent = formatDistance(article.dist);

      tr.appendChild(titleTd);
      tr.appendChild(distanceTd);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    categoryGroup.appendChild(table);
    categorizedArticlesDiv.appendChild(categoryGroup);

    // Add hover and click event listeners to table rows
    const tableRows = categorizedArticlesDiv.querySelectorAll(".article-row");

    tableRows.forEach((row) => {
      const index = parseInt(row.dataset.index, 10);

      row.addEventListener("mouseenter", () => {
        highlightMarker(index);
      });

      row.addEventListener("mouseleave", () => {
        unhighlightMarker(index);
      });

      row.addEventListener("click", () => {
        const article = sortedArticles[index];
        if (article) {
          showArticlePreview(article.title, article.pageid);
          zoomToLocation(article.lon, article.lat);
        }
      });
    });

    // 6) Add markers to the map for POIs
    addMarkers(sortedArticles);
  }

  // 7) Draw search radius circle
  const center = [lng, lat];
  const radius = settings.searchRadius;
  drawCircle(center, radius);
}

/**
 * Highlight the marker corresponding to the given article index.
 * @param {number} index
 */
function highlightMarker(index) {
  const markerObj = poiMarkers.find((m) => m.articleIndex === index);
  if (markerObj) {
    const markerEl = markerObj.marker.getElement();
    markerEl.classList.add("highlight-marker");
  }
}

/**
 * Remove the highlight from the marker corresponding to the given article index.
 * @param {number} index
 */
function unhighlightMarker(index) {
  const markerObj = poiMarkers.find((m) => m.articleIndex === index);
  if (markerObj) {
    const markerEl = markerObj.marker.getElement();
    markerEl.classList.remove("highlight-marker");
  }
}

/**
 * Handle Geocoder result
 */
geocoder.on("result", async (e) => {
  const [lng, lat] = e.result.center;

  // Debug: Log the geocoded coordinates
  console.log(`Geocoder Result: [Longitude: ${lng}, Latitude: ${lat}]`);

  // Fly to the geocoded location
  map.flyTo({ center: [lng, lat], zoom: 12 });

  // Trigger the same logic as a map click
  const fakeEvent = {
    lngLat: { lng, lat },
  };

  map.fire("click", fakeEvent);
});
