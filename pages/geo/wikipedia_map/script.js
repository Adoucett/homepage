mapboxgl.accessToken =
  "pk.eyJ1IjoiYWRvdWNldHQiLCJhIjoiY2lvZDFsc2lwMDRnd3Zha2pneWpxcHh6biJ9.sbWgw2zPGyScsp-r4CYQnA";

let settings = {
  resultsCount: 20,
  searchRadius: 10000,
  mapStyle: "mapbox://styles/mapbox/streets-v12",
};

const validMapStyles = [
  "mapbox://styles/mapbox/streets-v12",
  "mapbox://styles/mapbox/satellite-streets-v12",
  "mapbox://styles/adoucett/cm6fvb62v005s01s50vq64sb6",
  "mapbox://styles/adoucett/cjxkp8o1n05qm1cmwypaiilla",
  "mapbox://styles/mapbox/dark-v11",
  "mapbox://styles/mapbox/outdoors-v12",
  "mapbox://styles/mapbox/satellite-v9",
  "mapbox://styles/mapbox/light-v11",
];

const savedSettings = localStorage.getItem("wikimap-settings");
if (savedSettings) {
  const parsedSettings = JSON.parse(savedSettings);
  settings = {
    ...settings,
    ...parsedSettings,
    mapStyle: validMapStyles.includes(parsedSettings.mapStyle)
      ? parsedSettings.mapStyle
      : settings.mapStyle,
  };
}

const map = new mapboxgl.Map({
  container: "map",
  style: settings.mapStyle,
  center: [-92.5, 42.64],
  zoom: 4,
});

map.addControl(new mapboxgl.NavigationControl());

const geocoder = new MapboxGeocoder({
  accessToken: mapboxgl.accessToken,
  mapboxgl: mapboxgl,
  marker: false,
  placeholder: "Search for a location",
});
document.getElementById("geocoder").appendChild(geocoder.onAdd(map));

// UI elements
const infoPanel = document.getElementById("info-panel");
const closePanelBtn = document.getElementById("close-panel");
const locationCoordsDiv = document.getElementById("location-coords");
const reverseGeocodeDiv = document.getElementById("reverse-geocode");
const categorizedArticlesDiv = document.getElementById("categorized-articles");
const adminList = document.getElementById("admin-list");
const basemapSelect = document.getElementById("basemapSelect");
const settingsBtn = document.getElementById("settings-btn");
const settingsModal = document.getElementById("settings-modal");
const closeSettingsModalBtn = settingsModal.querySelector(".close-modal");
const settingsForm = document.getElementById("settings-form");
const articleModal = document.getElementById("article-modal");
const closeModalBtn = document.getElementById("close-modal");
const wikiIframe = document.getElementById("wiki-iframe");
const fullArticleLink = document.getElementById("full-article-link");

let poiMarkers = [];
let currentArticles = [];
let currentCircle = null;
let isFirstClick = true; // Track if it's the first click

basemapSelect.value = settings.mapStyle;

// Event Listeners (unchanged except for map click)
basemapSelect.addEventListener("change", (e) => {
  const selectedStyle = e.target.value;
  map.setStyle(selectedStyle);
  settings.mapStyle = selectedStyle;
  saveSettings();
  map.once("style.load", () => {
    setTimeout(() => addMarkers(currentArticles), 100);
    if (currentCircle) drawCircle(currentCircle.center, currentCircle.radius);
  });
});

settingsBtn.addEventListener("click", () => {
  settingsModal.style.display = "block";
});

closeSettingsModalBtn.addEventListener("click", () => {
  settingsModal.style.display = "none";
});

settingsForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const formData = new FormData(settingsForm);
  let inputResultsCount = parseInt(formData.get("resultsCount"), 20);
  settings.resultsCount =
    isNaN(inputResultsCount) || inputResultsCount <= 0
      ? 20
      : Math.min(inputResultsCount, 100);
  let inputRadius = parseInt(formData.get("searchRadius"), 10);
  if (inputRadius > 10000) alert("Search radius capped at 10,000 meters.");
  settings.searchRadius =
    isNaN(inputRadius) || inputRadius <= 0
      ? 10000
      : Math.min(inputRadius, 10000);
  settings.mapStyle = formData.get("mapStyle") || settings.mapStyle;
  map.setStyle(settings.mapStyle);
  settingsModal.style.display = "none";
  saveSettings();
  map.once("style.load", () => {
    setTimeout(() => addMarkers(currentArticles), 100);
    if (currentCircle) drawCircle(currentCircle.center, settings.searchRadius);
  });
});

closePanelBtn.addEventListener("click", () => {
  infoPanel.style.display = "none";
  //  clearPOIMarkers();
});

closeModalBtn.addEventListener("click", () => {
  articleModal.style.display = "none";
  wikiIframe.src = "";
  fullArticleLink.href = "#";
});

document.getElementById("locate-me").addEventListener("click", () => {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { longitude, latitude } = position.coords;
        map.flyTo({ center: [longitude, latitude], zoom: 12 });
        map.fire("click", { lngLat: { lng: longitude, lat: latitude } });
      },
      (error) => {
        console.error("Geolocation error:", error);
        alert("Unable to retrieve your location.");
      }
    );
  } else {
    alert("Geolocation is not supported by your browser.");
  }
});

function saveSettings() {
  localStorage.setItem("wikimap-settings", JSON.stringify(settings));
}

async function reverseGeocode(lng, lat) {
  const endpoint = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${mapboxgl.accessToken}`;
  try {
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error("Reverse geocoding failed.");
    return await response.json();
  } catch (error) {
    console.error("Reverse Geocode Error:", error);
    return null;
  }
}

async function fetchNearbyWikipediaArticles(
  lat,
  lng,
  radius = 10000,
  limit = 100
) {
  const validatedRadius = Math.min(radius, 10000);
  const validatedLimit = Math.min(limit, 100);
  const geoEndpoint = `https://en.wikipedia.org/w/api.php?origin=*&action=query&list=geosearch&gscoord=${lat}|${lng}&gsradius=${validatedRadius}&gslimit=${validatedLimit}&format=json`;
  try {
    const geoResponse = await fetch(geoEndpoint);
    if (!geoResponse.ok) throw new Error("Wikipedia GeoSearch API failed.");
    const geoData = await geoResponse.json();
    const articles = geoData?.query?.geosearch || [];
    if (articles.length === 0) return articles;

    const pageIds = articles.map((a) => a.pageid).join("|");
    const imageEndpoint = `https://en.wikipedia.org/w/api.php?origin=*&action=query&prop=pageimages&piprop=thumbnail&pithumbsize=150&pageids=${pageIds}&format=json`;
    const imageResponse = await fetch(imageEndpoint);
    if (!imageResponse.ok) throw new Error("Wikipedia Image API failed.");
    const imageData = await imageResponse.json();
    const pages = imageData?.query?.pages || {};

    return articles.map((article) => ({
      ...article,
      thumbnail: pages[article.pageid]?.thumbnail?.source || null,
    }));
  } catch (error) {
    console.error("Wikipedia Fetch Error:", error);
    return [];
  }
}

function getProminenceScore(title) {
  const t = title.toLowerCase();
  if (t.includes("state") || t.includes("province") || t.includes("country"))
    return 100;
  if (
    t.includes("county") ||
    t.includes("region") ||
    t.includes("city") ||
    t.includes("town") ||
    t.includes("village")
  )
    return 80;
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
  )
    return 70;
  if (
    t.includes("park") ||
    t.includes("forest") ||
    t.includes("river") ||
    t.includes("lake") ||
    t.includes("parkway") ||
    t.includes("garden")
  )
    return 60;
  return 50;
}

function sortArticles(articles) {
  return articles.sort((a, b) => {
    const scoreA = getProminenceScore(a.title);
    const scoreB = getProminenceScore(b.title);
    return scoreB === scoreA ? a.dist - b.dist : scoreB - scoreA;
  });
}

function showArticlePreview(title, pageid) {
  const wikiUrl = `https://en.m.wikipedia.org/wiki/${encodeURIComponent(
    title
  )}`;
  articleModal.style.display = "block";
  wikiIframe.src = wikiUrl;
  fullArticleLink.href = `https://en.wikipedia.org/?curid=${pageid}`;
}

function populateAdminList(feature) {
  adminList.innerHTML = "";
  if (!feature) return;
  const context = feature.context || [];
  let cityName = "",
    stateName = "",
    countryName = "";
  context.forEach((c) => {
    const type = c.id.split(".")[0];
    if (type === "place" || type === "locality") cityName = c.text;
    else if (type === "region") stateName = c.text;
    else if (type === "country") countryName = c.text;
  });

  function createWikiLink(name, type, wikiTitle) {
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.href = `https://en.m.wikipedia.org/wiki/${encodeURIComponent(
      wikiTitle
    )}`;
    link.target = "_blank";
    link.textContent = `${type}: ${name}`;
    li.appendChild(link);
    return li;
  }

  if (cityName) {
    let wikiCity;
    const cityContext = context.find(
      (c) =>
        (c.id.split(".")[0] === "place" || c.id.split(".")[0] === "locality") &&
        c.properties &&
        c.properties.wikipedia
    );
    wikiCity = cityContext
      ? cityContext.properties.wikipedia
      : stateName
      ? `${cityName.replace(/\s/g, "_")},_${stateName.replace(/\s/g, "_")}`
      : cityName.replace(/\s/g, "_");
    adminList.appendChild(createWikiLink(cityName, "City", wikiCity));
  }
  if (stateName) {
    let wikiState;
    const stateContext = context.find(
      (c) =>
        c.id.split(".")[0] === "region" &&
        c.properties &&
        c.properties.wikipedia
    );
    wikiState = stateContext
      ? stateContext.properties.wikipedia
      : stateName.replace(/\s/g, "_");
    adminList.appendChild(createWikiLink(stateName, "State", wikiState));
  }
  if (countryName) {
    let wikiCountry;
    const countryContext = context.find(
      (c) =>
        c.id.split(".")[0] === "country" &&
        c.properties &&
        c.properties.wikipedia
    );
    wikiCountry = countryContext
      ? countryContext.properties.wikipedia
      : countryName.replace(/\s/g, "_");
    adminList.appendChild(createWikiLink(countryName, "Country", wikiCountry));
  }
}

function addMarkers(articles) {
  currentArticles = articles;
  articles.forEach((article, index) => {
    const markerEl = document.createElement("div");
    markerEl.className = "poi-marker";
    markerEl.dataset.index = index;
    const labelEl = document.createElement("div");
    labelEl.className = "marker-label";
    labelEl.textContent = article.title;
    markerEl.appendChild(labelEl);
    const marker = new mapboxgl.Marker(markerEl)
      .setLngLat([article.lon, article.lat])
      .addTo(map);
    const openPreview = () => showArticlePreview(article.title, article.pageid);
    markerEl.addEventListener("click", openPreview);
    labelEl.addEventListener("click", (e) => {
      e.stopPropagation();
      openPreview();
    });
    markerEl.addEventListener("mouseenter", () => {
      const row = categorizedArticlesDiv.querySelector(
        `.article-row[data-index="${index}"]`
      );
      if (row) row.classList.add("highlight-row");
    });
    markerEl.addEventListener("mouseleave", () => {
      const row = categorizedArticlesDiv.querySelector(
        `.article-row[data-index="${index}"]`
      );
      if (row) row.classList.remove("highlight-row");
    });
    poiMarkers.push({ marker, articleIndex: index });
  });
}

function clearPOIMarkers() {
  poiMarkers.forEach((markerObj) => markerObj.marker.remove());
  poiMarkers = [];
}

function formatDistance(meters) {
  return meters > 2000
    ? `${(meters / 1000).toFixed(1)} km away`
    : `${meters} m away`;
}

function drawCircle(center, radius) {
  if (currentCircle) {
    if (map.getSource("search-radius")) {
      map.removeLayer("search-radius-layer");
      map.removeSource("search-radius");
    }
    currentCircle = null;
  }
  const circle = turf.circle(center, radius, { steps: 64, units: "meters" });
  map.addSource("search-radius", { type: "geojson", data: circle });
  map.addLayer({
    id: "search-radius-layer",
    type: "fill",
    source: "search-radius",
    paint: { "fill-color": "#1DA1F2", "fill-opacity": 0.1 },
  });
  currentCircle = { center, radius };
}

map.on("click", async (e) => {
  const { lng, lat } = e.lngLat;

  if (isFirstClick) {
    // First click: Slowly zoom in toward the clicked area
    map.zoomTo(10, {
      duration: 2000, // 2 seconds for a slow zoom
      center: map.getCenter(), // Keep current center, just zoom
    });
    isFirstClick = false; // Mark that the first click has occurred
  } else {
    // Subsequent clicks: Fly to the clicked location
    map.flyTo({
      center: [lng, lat],
      zoom: Math.max(map.getZoom(), 10), // Maintain at least zoom level 10
      speed: 1.2, // Moderate speed for smooth transition
      curve: 1.42, // Smooth curve for natural motion
    });
  }

  reverseGeocodeDiv.innerHTML = "Loading address info...";
  adminList.innerHTML = "";
  categorizedArticlesDiv.innerHTML = "<p>Loading Wikipedia articles...</p>";
  clearPOIMarkers();
  infoPanel.style.display = "flex";
  locationCoordsDiv.textContent = `Coordinates: ${lat.toFixed(
    5
  )}, ${lng.toFixed(5)}`;

  const geocodeResult = await reverseGeocode(lng, lat);
  let firstFeature = null;
  if (
    geocodeResult &&
    geocodeResult.features &&
    geocodeResult.features.length
  ) {
    firstFeature = geocodeResult.features[0];
    reverseGeocodeDiv.innerHTML = `<strong>Reverse Geocode:</strong><br/>${firstFeature.place_name}`;
  } else {
    reverseGeocodeDiv.innerHTML = "No address info found.";
  }

  if (firstFeature) populateAdminList(firstFeature);

  const wikiResults = await fetchNearbyWikipediaArticles(
    lat,
    lng,
    settings.searchRadius,
    settings.resultsCount
  );
  const sortedArticles = sortArticles(wikiResults);

  if (sortedArticles.length === 0) {
    categorizedArticlesDiv.innerHTML =
      "<p>No Wikipedia articles found nearby.</p>";
  } else {
    const categoryGroup = document.createElement("div");
    categoryGroup.className = "category-group";
    const categoryHeader = document.createElement("h4");
    categoryHeader.textContent = "Articles";
    categoryGroup.appendChild(categoryHeader);
    const table = document.createElement("table");
    table.className = "articles-table";
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const thumbHeader = document.createElement("th");
    thumbHeader.textContent = "Preview";
    const titleHeader = document.createElement("th");
    titleHeader.textContent = "Title";
    const distanceHeader = document.createElement("th");
    distanceHeader.textContent = "Distance";
    headerRow.appendChild(thumbHeader);
    headerRow.appendChild(titleHeader);
    headerRow.appendChild(distanceHeader);
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    sortedArticles.forEach((article, index) => {
      const tr = document.createElement("tr");
      tr.className = "article-row";
      tr.dataset.index = index;
      const thumbTd = document.createElement("td");
      if (article.thumbnail) {
        const img = document.createElement("img");
        img.src = article.thumbnail;
        img.alt = `${article.title} thumbnail`;
        img.className = "thumbnail";
        thumbTd.appendChild(img);
      }
      const titleTd = document.createElement("td");
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = article.title;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        showArticlePreview(article.title, article.pageid);
      });
      titleTd.appendChild(link);
      const distanceTd = document.createElement("td");
      distanceTd.textContent = formatDistance(article.dist);
      tr.appendChild(thumbTd);
      tr.appendChild(titleTd);
      tr.appendChild(distanceTd);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    categoryGroup.appendChild(table);
    categorizedArticlesDiv.innerHTML = "";
    categorizedArticlesDiv.appendChild(categoryGroup);
    const tableRows = categorizedArticlesDiv.querySelectorAll(".article-row");
    tableRows.forEach((row) => {
      const index = parseInt(row.dataset.index, 10);
      row.addEventListener("mouseenter", () => highlightMarker(index));
      row.addEventListener("mouseleave", () => unhighlightMarker(index));
    });
    addMarkers(sortedArticles);
  }

  drawCircle([lng, lat], settings.searchRadius);
});

function highlightMarker(index) {
  const markerObj = poiMarkers.find((m) => m.articleIndex === index);
  if (markerObj)
    markerObj.marker.getElement().classList.add("highlight-marker");
}

function unhighlightMarker(index) {
  const markerObj = poiMarkers.find((m) => m.articleIndex === index);
  if (markerObj)
    markerObj.marker.getElement().classList.remove("highlight-marker");
}

geocoder.on("result", (e) => {
  const [lng, lat] = e.result.center;
  map.flyTo({ center: [lng, lat], zoom: 12 });
  map.fire("click", { lngLat: { lng, lat } });
});

map.on("load", () => {
  if (currentArticles.length) {
    setTimeout(() => addMarkers(currentArticles), 100);
  }
});
