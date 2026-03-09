mapboxgl.accessToken =
  "pk.eyJ1IjoicmVpbWFwIiwiYSI6ImNqbW1qcXJyYzBqcnkzbGxiM3hyZWF5dXcifQ.SytLYT49iiWPQjDwtOls6A";

// ── Settings ────────────────────────────────────────────────
const DEFAULTS = {
  resultsCount: 30,
  searchRadius: 10000,
  mapStyle: "mapbox://styles/mapbox/streets-v12",
};

const VALID_STYLES = [
  "mapbox://styles/mapbox/streets-v12",
  "mapbox://styles/mapbox/satellite-streets-v12",
  "mapbox://styles/adoucett/cm6fvb62v005s01s50vq64sb6",
  "mapbox://styles/adoucett/cjxkp8o1n05qm1cmwypaiilla",
  "mapbox://styles/mapbox/dark-v11",
  "mapbox://styles/mapbox/outdoors-v12",
];

const DARK_STYLES = ["mapbox://styles/mapbox/dark-v11"];

let settings = { ...DEFAULTS };

try {
  const saved = JSON.parse(localStorage.getItem("wikimap-settings") || "{}");
  settings = {
    ...DEFAULTS,
    ...saved,
    mapStyle: VALID_STYLES.includes(saved.mapStyle) ? saved.mapStyle : DEFAULTS.mapStyle,
  };
} catch (_) {}

function saveSettings() {
  localStorage.setItem("wikimap-settings", JSON.stringify(settings));
}

// ── URL Hash State ──────────────────────────────────────────
function parseHash() {
  const h = location.hash.replace("#", "");
  if (!h) return null;
  const [lat, lng, z] = h.split(",").map(Number);
  if ([lat, lng, z].some(isNaN)) return null;
  return { lat, lng, zoom: z };
}

function updateHash(lat, lng, zoom) {
  history.replaceState(null, "", `#${lat.toFixed(4)},${lng.toFixed(4)},${Math.round(zoom)}`);
}

// ── Map Init ────────────────────────────────────────────────
const hashState = parseHash();

const map = new mapboxgl.Map({
  container: "map",
  style: settings.mapStyle,
  center: hashState ? [hashState.lng, hashState.lat] : [-92.5, 42.64],
  zoom: hashState ? hashState.zoom : 4,
});

map.addControl(new mapboxgl.NavigationControl(), "bottom-right");

const geocoder = new MapboxGeocoder({
  accessToken: mapboxgl.accessToken,
  mapboxgl: mapboxgl,
  marker: false,
  placeholder: "Search for a location",
});
document.getElementById("geocoder").appendChild(geocoder.onAdd(map));

// ── Dark Mode ───────────────────────────────────────────────
function applyDarkMode(style) {
  document.body.classList.toggle("dark-mode", DARK_STYLES.includes(style));
}
applyDarkMode(settings.mapStyle);

// ── DOM Elements ────────────────────────────────────────────
const $ = (s) => document.querySelector(s);

const infoPanel = $("#info-panel");
const panelTitle = $("#panel-title");
const locationCoordsDiv = $("#location-coords");
const reverseGeocodeDiv = $("#reverse-geocode");
const categorizedArticlesDiv = $("#categorized-articles");
const adminList = $("#admin-list");
const articleCountEl = $("#article-count");
const basemapSelect = $("#basemapSelect");
const previewOverlay = $("#article-preview");
const settingsOverlay = $("#settings-overlay");
const settingsForm = $("#settings-form");
const resultsCountInput = $("#resultsCount");
const searchRadiusInput = $("#searchRadius");
const resultsCountVal = $("#resultsCountVal");
const searchRadiusVal = $("#searchRadiusVal");

let currentArticles = [];
let currentCircle = null;
let activeClickId = 0;
let hoveredMarkerIdx = null;

const resultCache = new Map();
const summaryCache = new Map();

basemapSelect.value = settings.mapStyle;
resultsCountInput.value = settings.resultsCount;
searchRadiusInput.value = settings.searchRadius;
resultsCountVal.textContent = settings.resultsCount;
searchRadiusVal.textContent = formatRadius(settings.searchRadius);

// ── Helpers ─────────────────────────────────────────────────
function stripHTML(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
}

function cacheKey(lat, lng, radius) {
  return `${(Math.round(lat * 100) / 100).toFixed(2)},${(Math.round(lng * 100) / 100).toFixed(2)},${radius}`;
}

function formatDistance(m) {
  if (m > 2000) return `${(m / 1000).toFixed(1)} km`;
  return `${m} m`;
}

function formatRadius(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} km` : `${m} m`;
}

// ── API: Geosearch + Metadata ───────────────────────────────
async function fetchNearbyArticles(lat, lng, radius, limit) {
  const key = cacheKey(lat, lng, radius);
  if (resultCache.has(key)) return resultCache.get(key);

  const r = Math.min(radius, 10000);
  const l = Math.min(limit, 50);

  try {
    const geoUrl =
      `https://en.wikipedia.org/w/api.php?origin=*` +
      `&action=query&list=geosearch` +
      `&gscoord=${lat}|${lng}` +
      `&gsradius=${r}` +
      `&gslimit=${l}` +
      `&format=json`;

    const geoRes = await fetch(geoUrl);
    if (!geoRes.ok) throw new Error("Wikipedia GeoSearch failed");
    const geoData = await geoRes.json();
    const geoResults = geoData?.query?.geosearch || [];
    if (geoResults.length === 0) return [];

    const pageIds = geoResults.map((g) => g.pageid).join("|");
    const metaUrl =
      `https://en.wikipedia.org/w/api.php?origin=*` +
      `&action=query` +
      `&pageids=${pageIds}` +
      `&prop=pageimages|extracts|pageterms` +
      `&piprop=thumbnail` +
      `&pithumbsize=200` +
      `&exintro=1` +
      `&exsentences=2` +
      `&explaintext=1` +
      `&format=json`;

    const metaRes = await fetch(metaUrl);
    const metaData = metaRes.ok ? await metaRes.json() : null;
    const pages = metaData?.query?.pages || {};

    const articles = geoResults.map((g) => {
      const p = pages[g.pageid] || {};
      return {
        pageid: g.pageid,
        title: g.title,
        lat: g.lat,
        lon: g.lon,
        dist: g.dist,
        thumbnail: p.thumbnail?.source || null,
        extract: p.extract || "",
        description: p.terms?.description?.[0] || "",
      };
    });

    resultCache.set(key, articles);
    if (resultCache.size > 50) {
      resultCache.delete(resultCache.keys().next().value);
    }
    return articles;
  } catch (err) {
    console.error("Wikipedia fetch error:", err);
    return [];
  }
}

// ── API: REST Summary ───────────────────────────────────────
async function fetchSummary(title) {
  if (summaryCache.has(title)) return summaryCache.get(title);
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
    );
    if (!res.ok) throw new Error("Summary API failed");
    const data = await res.json();
    summaryCache.set(title, data);
    if (summaryCache.size > 100) {
      summaryCache.delete(summaryCache.keys().next().value);
    }
    return data;
  } catch (err) {
    console.error("Summary fetch error:", err);
    return null;
  }
}

// ── API: Reverse Geocode ────────────────────────────────────
async function reverseGeocode(lng, lat) {
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${mapboxgl.accessToken}`
    );
    if (!res.ok) throw new Error("Reverse geocoding failed");
    return await res.json();
  } catch (err) {
    console.error("Reverse geocode error:", err);
    return null;
  }
}

// ── Sorting ─────────────────────────────────────────────────
function getProminenceScore(title) {
  const t = title.toLowerCase();
  if (t.includes("state") || t.includes("province") || t.includes("country")) return 100;
  if (/(county|region|city|town|village|municipality|borough|district)/.test(t)) return 80;
  if (/(mountain|range|national park|river|lake|forest|desert|waterfall|canyon|island|glacier|volcano|valley|beach|sea|ocean|bay)/.test(t)) return 70;
  if (/(park|garden|parkway|reservoir|creek|dam|bridge|monument|memorial)/.test(t)) return 60;
  if (/(university|college|school|museum|cathedral|church|temple|stadium|airport|station|hospital)/.test(t)) return 55;
  return 50;
}

function sortArticles(articles) {
  return [...articles].sort((a, b) => {
    const sa = getProminenceScore(a.title);
    const sb = getProminenceScore(b.title);
    return sb === sa ? a.dist - b.dist : sb - sa;
  });
}

// ── Background Wikipedia Tileset ─────────────────────────────
const TILESET_DENSE = "mavalues2024.7iktqzqm";
const TILESET_DETAIL = "mavalues2024.7igyuhmf";
const WIKI_BG_HEAT_SOURCE = "wiki-bg-heat-src";
const WIKI_BG_DOT_SOURCE = "wiki-bg-dot-src";
const WIKI_BG_DOTS = "wiki-bg-dots";
const WIKI_BG_HEAT = "wiki-bg-heat";
const titleCache = new Map();
let heatmapVisible = localStorage.getItem("wikimap-heatmap") === "true";

const bgPopup = new mapboxgl.Popup({
  closeButton: false,
  closeOnClick: false,
  className: "wiki-hover-popup",
  offset: 8,
  maxWidth: "240px",
});

function firstTextLabelLayer() {
  for (const l of map.getStyle().layers) {
    if (l.type === "symbol" && l.layout?.["text-field"]) return l.id;
  }
  return undefined;
}

function ensureBackgroundDots() {
  if (map.getLayer(WIKI_BG_DOTS)) return;
  if (!map.getSource(WIKI_BG_DOT_SOURCE)) {
    map.addSource(WIKI_BG_DOT_SOURCE, {
      type: "vector",
      url: `mapbox://${TILESET_DETAIL}`,
    });
  }
  const beforeLabel = firstTextLabelLayer();
  map.addLayer(
    {
      id: WIKI_BG_DOTS,
      type: "circle",
      source: WIKI_BG_DOT_SOURCE,
      "source-layer": "wp",
      paint: {
        "circle-color": "hsl(187, 78%, 54%)",
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          7, 0,
          8.28, 5,
          8.79, 5,
          14, 7,
        ],
        "circle-opacity": [
          "interpolate", ["linear"], ["zoom"],
          0, 0.04,
          8.5, 0.15,
          9.03, 1,
          22, 1,
        ],
        "circle-stroke-color": "hsl(0, 100%, 100%)",
        "circle-stroke-width": [
          "interpolate", ["linear"], ["zoom"],
          0, 0.5,
          13.06, 2,
          22, 3,
        ],
        "circle-stroke-opacity": [
          "interpolate", ["linear"], ["zoom"],
          0, 0,
          8.05, 0,
          9.03, 0.9,
          22, 0.9,
        ],
        "circle-blur": 0.1,
        "circle-emissive-strength": 1,
      },
    },
    beforeLabel
  );
}

function addHeatmapLayer() {
  if (map.getLayer(WIKI_BG_HEAT)) return;
  if (!map.getSource(WIKI_BG_HEAT_SOURCE)) {
    map.addSource(WIKI_BG_HEAT_SOURCE, {
      type: "vector",
      url: `mapbox://${TILESET_DENSE}`,
    });
  }
  const beforeDots = map.getLayer(WIKI_BG_DOTS) ? WIKI_BG_DOTS : undefined;
  map.addLayer(
    {
      id: WIKI_BG_HEAT,
      type: "heatmap",
      source: WIKI_BG_HEAT_SOURCE,
      "source-layer": "wp",
      paint: {
        "heatmap-weight": 0.5,
        "heatmap-intensity": [
          "interpolate", ["linear"], ["zoom"],
          3, 0.01,
          8, 0.3,
          12, 1,
          15, 2.5,
        ],
        "heatmap-radius": [
          "interpolate", ["linear"], ["zoom"],
          3, 20,
          7, 30,
          11, 12,
          15, 1,
        ],
        "heatmap-color": [
          "interpolate", ["linear"], ["heatmap-density"],
          0,   "rgba(0,0,0,0)",
          0.1, "rgba(63,0,255,0.1)",
          0.3, "rgba(127,0,255,0.4)",
          0.5, "rgba(0,200,255,0.7)",
          0.8, "rgba(0,255,200,0.9)",
          1,   "#ffffff",
        ],
        "heatmap-opacity": [
          "interpolate", ["linear"], ["zoom"],
          4, 0.7,
          10, 0.3,
          13, 0.05,
          14, 0,
        ],
      },
    },
    beforeDots
  );
}

function removeHeatmapLayer() {
  if (map.getLayer(WIKI_BG_HEAT)) map.removeLayer(WIKI_BG_HEAT);
  if (map.getSource(WIKI_BG_HEAT_SOURCE)) map.removeSource(WIKI_BG_HEAT_SOURCE);
}

function ensureBackgroundLayer() {
  ensureBackgroundDots();
  if (heatmapVisible) addHeatmapLayer();
}

// ── GeoJSON Markers (native Mapbox layers) ──────────────────
const EMPTY_FC = { type: "FeatureCollection", features: [] };
const MARKER_SOURCE = "wiki-markers";
const MARKER_CIRCLES = "wiki-markers-circles";
const MARKER_LABELS = "wiki-markers-labels";
const RADIUS_SOURCE = "search-radius";
const RADIUS_FILL = "search-radius-fill";
const RADIUS_LINE = "search-radius-line";

function articlesToGeoJSON(articles) {
  return {
    type: "FeatureCollection",
    features: articles.map((a, i) => ({
      type: "Feature",
      id: i,
      geometry: { type: "Point", coordinates: [a.lon, a.lat] },
      properties: { title: a.title, index: i, pageid: a.pageid },
    })),
  };
}

function ensureMarkerLayers() {
  if (map.getSource(MARKER_SOURCE)) return;

  map.addSource(MARKER_SOURCE, { type: "geojson", data: EMPTY_FC });

  map.addLayer({
    id: MARKER_CIRCLES,
    type: "circle",
    source: MARKER_SOURCE,
    paint: {
      "circle-radius": [
        "case",
        ["boolean", ["feature-state", "hover"], false],
        9,
        6,
      ],
      "circle-color": [
        "case",
        ["boolean", ["feature-state", "hover"], false],
        "#ff6d00",
        "#1a73e8",
      ],
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });

  map.addLayer({
    id: MARKER_LABELS,
    type: "symbol",
    source: MARKER_SOURCE,
    layout: {
      "text-field": ["get", "title"],
      "text-size": 12,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
      "text-offset": [0, 1.4],
      "text-anchor": "top",
      "text-max-width": 12,
      "text-allow-overlap": false,
      "text-optional": true,
    },
    paint: {
      "text-color": [
        "case",
        ["boolean", ["feature-state", "hover"], false],
        "#ff6d00",
        "#1a1a2e",
      ],
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.5,
    },
  });
}

function setMarkerData(articles) {
  currentArticles = articles;
  ensureMarkerLayers();
  map.getSource(MARKER_SOURCE).setData(articlesToGeoJSON(articles));
}

function clearMarkerData() {
  if (map.getSource(MARKER_SOURCE)) {
    map.getSource(MARKER_SOURCE).setData(EMPTY_FC);
  }
  currentArticles = [];
}

function setMarkerHover(idx, hover) {
  if (!map.getSource(MARKER_SOURCE)) return;
  if (hoveredMarkerIdx !== null && hoveredMarkerIdx !== idx) {
    map.setFeatureState({ source: MARKER_SOURCE, id: hoveredMarkerIdx }, { hover: false });
  }
  map.setFeatureState({ source: MARKER_SOURCE, id: idx }, { hover: hover });
  hoveredMarkerIdx = hover ? idx : null;
}

// ── Search Radius Circle ────────────────────────────────────
function ensureRadiusLayers() {
  if (map.getSource(RADIUS_SOURCE)) return;

  map.addSource(RADIUS_SOURCE, { type: "geojson", data: EMPTY_FC });
  const beforeLabel = firstTextLabelLayer();

  map.addLayer({
    id: RADIUS_FILL,
    type: "fill",
    source: RADIUS_SOURCE,
    paint: { "fill-color": "#1a73e8", "fill-opacity": 0.06 },
  }, beforeLabel);

  map.addLayer({
    id: RADIUS_LINE,
    type: "line",
    source: RADIUS_SOURCE,
    paint: {
      "line-color": "#1a73e8",
      "line-opacity": 0.3,
      "line-width": 1.5,
      "line-dasharray": [4, 3],
    },
  }, beforeLabel);
}

function drawCircle(center, radius) {
  ensureRadiusLayers();
  const circle = turf.circle(center, radius, { steps: 64, units: "meters" });
  map.getSource(RADIUS_SOURCE).setData(circle);
  currentCircle = { center, radius };
}

function clearCircle() {
  if (map.getSource(RADIUS_SOURCE)) {
    map.getSource(RADIUS_SOURCE).setData(EMPTY_FC);
  }
  currentCircle = null;
}

// ── Restore layers after style change ───────────────────────
function reinstallLayers() {
  const hadMarkers = currentArticles.length > 0;
  const savedArticles = [...currentArticles];
  const savedCircle = currentCircle ? { ...currentCircle } : null;

  ensureBackgroundLayer();

  if (hadMarkers) {
    ensureMarkerLayers();
    map.getSource(MARKER_SOURCE).setData(articlesToGeoJSON(savedArticles));
  }
  if (savedCircle) {
    ensureRadiusLayers();
    const circle = turf.circle(savedCircle.center, savedCircle.radius, { steps: 64, units: "meters" });
    map.getSource(RADIUS_SOURCE).setData(circle);
  }
}

// ── Panel ───────────────────────────────────────────────────
function showPanel() {
  infoPanel.classList.add("visible");
}

function hidePanel() {
  infoPanel.classList.remove("visible");
  clearMarkerData();
  clearCircle();
}

// ── Admin List ──────────────────────────────────────────────
function populateAdminList(feature) {
  adminList.innerHTML = "";
  if (!feature) return;

  const context = feature.context || [];
  const entries = [];

  context.forEach((c) => {
    const type = c.id.split(".")[0];
    const wiki = c.properties?.wikipedia;
    let label, wikiTitle;

    if (type === "place" || type === "locality") {
      label = c.text;
      const state = context.find((x) => x.id.startsWith("region"))?.text;
      wikiTitle = wiki || (state ? `${c.text.replace(/\s/g, "_")},_${state.replace(/\s/g, "_")}` : c.text.replace(/\s/g, "_"));
      entries.push({ label, wikiTitle, order: 0 });
    } else if (type === "region") {
      label = c.text;
      wikiTitle = wiki || c.text.replace(/\s/g, "_");
      entries.push({ label, wikiTitle, order: 1 });
    } else if (type === "country") {
      label = c.text;
      wikiTitle = wiki || c.text.replace(/\s/g, "_");
      entries.push({ label, wikiTitle, order: 2 });
    }
  });

  entries.sort((a, b) => a.order - b.order);

  entries.forEach(({ label, wikiTitle }) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle)}`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = label;
    li.appendChild(a);
    adminList.appendChild(li);
  });
}

// ── Render Article Cards ────────────────────────────────────
function renderSkeletons(count) {
  categorizedArticlesDiv.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const sk = document.createElement("div");
    sk.className = "skeleton-card";
    sk.innerHTML =
      '<div class="skeleton-thumb"></div>' +
      '<div class="skeleton-lines"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div>';
    categorizedArticlesDiv.appendChild(sk);
  }
}

function renderArticles(articles) {
  categorizedArticlesDiv.innerHTML = "";
  articleCountEl.textContent = `${articles.length} found`;

  if (articles.length === 0) {
    categorizedArticlesDiv.innerHTML =
      '<div class="empty-state">' +
      '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 15s1.5-2 4-2 4 2 4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>' +
      "<p>No Wikipedia articles found in this area.<br/>Try clicking somewhere else or increasing the search radius.</p></div>";
    return;
  }

  articles.forEach((article, index) => {
    const card = document.createElement("div");
    card.className = "article-card";
    card.dataset.index = index;

    if (article.thumbnail) {
      const img = document.createElement("img");
      img.src = article.thumbnail;
      img.alt = article.title;
      img.className = "article-card-thumb";
      img.loading = "lazy";
      card.appendChild(img);
    } else {
      const ph = document.createElement("div");
      ph.className = "article-card-thumb-placeholder";
      ph.textContent = "W";
      card.appendChild(ph);
    }

    const body = document.createElement("div");
    body.className = "article-card-body";

    const titleEl = document.createElement("div");
    titleEl.className = "article-card-title";
    titleEl.textContent = article.title;
    body.appendChild(titleEl);

    const desc = article.description || article.extract;
    if (desc) {
      const descEl = document.createElement("div");
      descEl.className = "article-card-desc";
      descEl.textContent = desc;
      body.appendChild(descEl);
    }

    const dist = document.createElement("div");
    dist.className = "article-card-dist";
    dist.textContent = formatDistance(article.dist);
    body.appendChild(dist);

    card.appendChild(body);

    card.addEventListener("click", () => showArticlePreview(article.title));
    card.addEventListener("mouseenter", () => {
      card.classList.add("highlight");
      setMarkerHover(index, true);
    });
    card.addEventListener("mouseleave", () => {
      card.classList.remove("highlight");
      setMarkerHover(index, false);
    });

    categorizedArticlesDiv.appendChild(card);
  });
}

function highlightCard(index, on) {
  const card = categorizedArticlesDiv.querySelector(`.article-card[data-index="${index}"]`);
  if (card) {
    card.classList.toggle("highlight", on);
    if (on) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

// ── Article Preview ─────────────────────────────────────────
async function showArticlePreview(title) {
  const heroEl = $("#preview-hero");
  const titleEl = $("#preview-title");
  const descEl = $("#preview-description");
  const extractEl = $("#preview-extract");
  const linkEl = $("#preview-link");
  const loadingEl = $("#preview-loading");

  heroEl.style.backgroundImage = "";
  heroEl.classList.add("no-image");
  titleEl.textContent = title;
  descEl.textContent = "";
  extractEl.innerHTML = "";
  linkEl.href = `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;
  loadingEl.classList.add("active");

  previewOverlay.classList.add("visible");

  const summary = await fetchSummary(title);
  loadingEl.classList.remove("active");

  if (!summary) {
    extractEl.textContent = "Could not load article preview.";
    return;
  }

  titleEl.textContent = stripHTML(summary.displaytitle || summary.title);

  if (summary.description) {
    descEl.textContent = summary.description;
  }

  if (summary.extract_html) {
    extractEl.innerHTML = summary.extract_html;
  } else if (summary.extract) {
    extractEl.textContent = summary.extract;
  }

  const imgUrl = summary.originalimage?.source || summary.thumbnail?.source;
  if (imgUrl) {
    heroEl.style.backgroundImage = `url(${imgUrl})`;
    heroEl.classList.remove("no-image");
  }

  linkEl.href =
    summary.content_urls?.desktop?.page ||
    `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;
}

function hidePreview() {
  previewOverlay.classList.remove("visible");
}

// ── Main Click Handler ──────────────────────────────────────
let clickDebounce = null;

async function handleLocationSearch(lng, lat, flyTo = true) {
  const clickId = ++activeClickId;

  if (flyTo) {
    map.flyTo({
      center: [lng, lat],
      zoom: Math.max(map.getZoom(), 12),
      speed: 1.4,
      curve: 1.42,
    });
  }

  updateHash(lat, lng, Math.max(map.getZoom(), 12));

  reverseGeocodeDiv.textContent = "";
  locationCoordsDiv.textContent = "";
  adminList.innerHTML = "";
  categorizedArticlesDiv.innerHTML = "";
  articleCountEl.textContent = "";
  panelTitle.textContent = "WikiMappr";
  renderSkeletons(5);
  clearMarkerData();
  showPanel();

  locationCoordsDiv.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

  const [geocodeResult, articles] = await Promise.all([
    reverseGeocode(lng, lat),
    fetchNearbyArticles(lat, lng, settings.searchRadius, settings.resultsCount),
  ]);

  if (clickId !== activeClickId) return;

  if (geocodeResult?.features?.length) {
    const f = geocodeResult.features[0];
    reverseGeocodeDiv.textContent = f.place_name;
    panelTitle.textContent = f.text || "WikiMappr";
    populateAdminList(f);
  } else {
    reverseGeocodeDiv.textContent = "Location not found";
  }

  const sorted = sortArticles(articles);
  renderArticles(sorted);
  setMarkerData(sorted);
  drawCircle([lng, lat], settings.searchRadius);
}

// ── Map Interaction Events ──────────────────────────────────

map.on("click", (e) => {
  // Active search markers take priority
  if (map.getLayer(MARKER_CIRCLES)) {
    try {
      const features = map.queryRenderedFeatures(e.point, { layers: [MARKER_CIRCLES] });
      if (features.length) {
        showArticlePreview(features[0].properties.title);
        return;
      }
    } catch (_) {}
  }

  // Background dots handled by their own layer click handler above;
  // check if this click hit one so we don't also trigger a location search
  if (map.getLayer(WIKI_BG_DOTS)) {
    try {
      const bgFeatures = map.queryRenderedFeatures(e.point, { layers: [WIKI_BG_DOTS] });
      if (bgFeatures.length) return;
    } catch (_) {}
  }

  clearTimeout(clickDebounce);
  clickDebounce = setTimeout(() => {
    handleLocationSearch(e.lngLat.lng, e.lngLat.lat);
  }, 200);
});

map.on("mousemove", MARKER_CIRCLES, (e) => {
  map.getCanvas().style.cursor = "pointer";
  if (e.features.length) {
    const idx = e.features[0].properties.index;
    setMarkerHover(idx, true);
    highlightCard(idx, true);
  }
});

map.on("mouseleave", MARKER_CIRCLES, () => {
  map.getCanvas().style.cursor = "";
  if (hoveredMarkerIdx !== null) {
    highlightCard(hoveredMarkerIdx, false);
    setMarkerHover(hoveredMarkerIdx, false);
  }
});

// ── Background Dot Interactions ─────────────────────────────

async function resolvePageTitle(pageid) {
  if (titleCache.has(pageid)) return titleCache.get(pageid);
  try {
    const res = await fetch(
      `https://en.wikipedia.org/w/api.php?origin=*&action=query&pageids=${pageid}&format=json`
    );
    const data = await res.json();
    const title = data?.query?.pages?.[pageid]?.title;
    if (title) {
      titleCache.set(title, title);
      titleCache.set(pageid, title);
    }
    return title || null;
  } catch (_) {
    return null;
  }
}

map.on("click", WIKI_BG_DOTS, async (e) => {
  if (!e.features.length) return;
  const pageid = e.features[0].properties.id;
  const title = await resolvePageTitle(pageid);
  if (title) showArticlePreview(title);
});

map.on("mousemove", WIKI_BG_DOTS, async (e) => {
  if (!e.features.length) return;
  map.getCanvas().style.cursor = "pointer";
  const f = e.features[0];
  const pageid = f.properties.id;
  const coords = f.geometry.coordinates.slice();

  if (titleCache.has(pageid)) {
    bgPopup.setLngLat(coords).setHTML(`<strong>${titleCache.get(pageid)}</strong>`).addTo(map);
  } else {
    bgPopup.setLngLat(coords).setHTML("<em>Loading...</em>").addTo(map);
    const title = await resolvePageTitle(pageid);
    if (title && bgPopup.isOpen()) {
      bgPopup.setHTML(`<strong>${title}</strong>`);
    }
  }
});

map.on("mouseleave", WIKI_BG_DOTS, () => {
  map.getCanvas().style.cursor = "";
  bgPopup.remove();
});

// ── Geocoder ────────────────────────────────────────────────
geocoder.on("result", (e) => {
  const [lng, lat] = e.result.center;
  handleLocationSearch(lng, lat);
});

// ── Locate Me ───────────────────────────────────────────────
$("#locate-me").addEventListener("click", () => {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported by your browser.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => handleLocationSearch(pos.coords.longitude, pos.coords.latitude),
    () => alert("Unable to retrieve your location.")
  );
});

// ── Close Panel ─────────────────────────────────────────────
$("#close-panel").addEventListener("click", hidePanel);

// ── Basemap ─────────────────────────────────────────────────
basemapSelect.addEventListener("change", (e) => {
  const style = e.target.value;
  map.setStyle(style);
  settings.mapStyle = style;
  saveSettings();
  applyDarkMode(style);

  map.once("style.load", () => reinstallLayers());
});

// ── Settings ────────────────────────────────────────────────
$("#settings-btn").addEventListener("click", () => {
  resultsCountInput.value = settings.resultsCount;
  searchRadiusInput.value = settings.searchRadius;
  resultsCountVal.textContent = settings.resultsCount;
  searchRadiusVal.textContent = formatRadius(settings.searchRadius);
  settingsOverlay.classList.add("visible");
});

const heatmapToggleBtn = $("#heatmap-toggle");
if (heatmapVisible) heatmapToggleBtn.classList.add("active");

heatmapToggleBtn.addEventListener("click", () => {
  heatmapVisible = !heatmapVisible;
  heatmapToggleBtn.classList.toggle("active", heatmapVisible);
  localStorage.setItem("wikimap-heatmap", heatmapVisible);
  if (heatmapVisible) {
    addHeatmapLayer();
  } else {
    removeHeatmapLayer();
  }
});

resultsCountInput.addEventListener("input", () => {
  resultsCountVal.textContent = resultsCountInput.value;
});

searchRadiusInput.addEventListener("input", () => {
  searchRadiusVal.textContent = formatRadius(Number(searchRadiusInput.value));
});

settingsForm.addEventListener("submit", (e) => {
  e.preventDefault();
  settings.resultsCount = Math.min(Math.max(parseInt(resultsCountInput.value, 10) || 30, 1), 50);
  settings.searchRadius = Math.min(Math.max(parseInt(searchRadiusInput.value, 10) || 10000, 500), 10000);
  saveSettings();
  settingsOverlay.classList.remove("visible");

  if (currentCircle) {
    const [lng, lat] = currentCircle.center;
    handleLocationSearch(lng, lat, false);
  }
});

$("#close-settings").addEventListener("click", () => {
  settingsOverlay.classList.remove("visible");
});

// ── Close Preview ───────────────────────────────────────────
$("#close-preview").addEventListener("click", hidePreview);

// ── Keyboard ────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (previewOverlay.classList.contains("visible")) {
      hidePreview();
    } else if (settingsOverlay.classList.contains("visible")) {
      settingsOverlay.classList.remove("visible");
    } else if (infoPanel.classList.contains("visible")) {
      hidePanel();
    }
  }
});

// ── Click outside modals ────────────────────────────────────
previewOverlay.addEventListener("click", (e) => {
  if (e.target === previewOverlay) hidePreview();
});

settingsOverlay.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) settingsOverlay.classList.remove("visible");
});

// ── Mobile Bottom Sheet Drag ────────────────────────────────
(function initBottomSheetDrag() {
  const handle = $("#panel-drag-handle");
  let startY = 0;
  let startTranslate = 0;
  let dragging = false;

  function getTranslateY() {
    const m = new DOMMatrix(getComputedStyle(infoPanel).transform);
    return m.m42;
  }

  handle.addEventListener("touchstart", (e) => {
    if (window.innerWidth > 768) return;
    dragging = true;
    startY = e.touches[0].clientY;
    startTranslate = getTranslateY();
    infoPanel.style.transition = "none";
  });

  document.addEventListener("touchmove", (e) => {
    if (!dragging) return;
    const dy = e.touches[0].clientY - startY;
    const newY = Math.max(0, startTranslate + dy);
    infoPanel.style.transform = `translateY(${newY}px)`;
  });

  document.addEventListener("touchend", () => {
    if (!dragging) return;
    dragging = false;
    infoPanel.style.transition = "";
    const currentY = getTranslateY();
    if (currentY > infoPanel.offsetHeight * 0.4) {
      hidePanel();
    } else {
      infoPanel.style.transform = "";
    }
  });
})();

// ── Map Load / Hash ─────────────────────────────────────────
map.on("load", () => {
  ensureBackgroundLayer();
  if (hashState) {
    handleLocationSearch(hashState.lng, hashState.lat, false);
  }
});

map.on("moveend", () => {
  const c = map.getCenter();
  updateHash(c.lat, c.lng, map.getZoom());
});
