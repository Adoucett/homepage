'use strict';

/* ===========================================================
   Expressions of Geometry
   =========================================================== */

const CFG = {
  token: 'pk.eyJ1IjoiYWRvdWNldHQiLCJhIjoiY2lvZDFsc2lwMDRnd3Zha2pneWpxcHh6biJ9.sbWgw2zPGyScsp-r4CYQnA',
  darkStyle: 'mapbox://styles/mapbox/dark-v11',
  voidStyle: {
    version: 8, name: 'void', sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#000000' } }]
  },
  routesUrl: '/data/json/strava/routes.geojson',
  summaryUrl: '/data/json/strava/summary.json',

  typeColors: {
    'Run':        '#fc5200',
    'Ride':       '#3b82f6',
    'Walk':       '#a78bfa',
    'Nordic Ski': '#38bdf8',
    'Swim':       '#06b6d4',
    'Hike':       '#22c55e',
  },
  defaultColor: 'rgba(255, 180, 80, 0.3)',
  highlight: '#ffffff',
  temporal: ['#2a4d8f', '#4a8fa5', '#7ab87a', '#c4a747', '#fc5200'],
  minTypeCount: 40,

  locations: {
    stl:    { center: [-90.28, 38.63], zoom: 11.5, label: 'STL' },
    boston:  { center: [-71.06, 42.36], zoom: 11.5, label: 'BOS' },
    all:    { center: [-82.0, 40.0],   zoom: 4.5,  label: 'ALL' },
  },
  defaultLocation: 'stl',
};

let map, routesGJ = null, summary = null;
let currentMode = 'mapped', selectedId = null, hoveredId = null;
let activeTypes = null, allTypes = null, epochMin = 0, epochMax = 1;
let layersReady = false;
const defaultType = 'Run';

/* -----------------------------------------------------------
   Init
   ----------------------------------------------------------- */

mapboxgl.accessToken = CFG.token;

document.addEventListener('DOMContentLoaded', async () => {
  const loc = CFG.locations[CFG.defaultLocation];
  map = new mapboxgl.Map({
    container: 'map', style: CFG.darkStyle,
    center: loc.center, zoom: loc.zoom,
    attributionControl: false,
  });
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');
  map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

  const [rRes, sRes] = await Promise.all([fetch(CFG.routesUrl), fetch(CFG.summaryUrl)]);
  if (!rRes.ok) {
    document.getElementById('loading').innerHTML =
      '<span style="color:#8e99a8">No route data found.</span>';
    return;
  }
  routesGJ = await rRes.json();
  summary = sRes.ok ? await sRes.json() : null;

  filterSmallTypes();
  computeEpochRange();
  populateAmbient();
  buildSportNav();
  buildLocationNav();

  const go = () => {
    addRouteLayers();
    applyTypeFilter();
    document.getElementById('loading').classList.add('done');
  };
  if (map.loaded()) go(); else map.on('load', go);
  bindModeButtons();
  bindGallery();
  bindDetail();
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (selectedId) deselectRoute();
      if (currentMode === 'gallery') setMode('mapped');
    }
  });
});

function filterSmallTypes() {
  const counts = {};
  for (const f of routesGJ.features) {
    const t = f.properties.activity_type || 'Unknown';
    counts[t] = (counts[t] || 0) + 1;
  }
  const keep = new Set();
  for (const [t, c] of Object.entries(counts)) {
    if (c >= CFG.minTypeCount) keep.add(t);
  }
  routesGJ.features = routesGJ.features.filter(f => keep.has(f.properties.activity_type));
  allTypes = keep;
  activeTypes = new Set([defaultType]);
}

function computeEpochRange() {
  let mn = Infinity, mx = -Infinity;
  for (const f of routesGJ.features) {
    const e = f.properties.date_epoch;
    if (e != null) { mn = Math.min(mn, e); mx = Math.max(mx, e); }
  }
  epochMin = mn === Infinity ? 0 : mn;
  epochMax = mx === -Infinity ? 1 : mx;
  if (epochMax === epochMin) epochMax = epochMin + 1;
}

/* -----------------------------------------------------------
   Ambient stats
   ----------------------------------------------------------- */

function populateAmbient() {
  updateAmbientForFilter();
  const dr = summary ? summary.date_range || {} : {};
  if (dr.earliest && dr.latest) {
    const y0 = dr.earliest.slice(0, 4), y1 = dr.latest.slice(0, 4);
    const el = document.getElementById('stat-range');
    if (el) el.textContent = y0 === y1 ? y0 : y0 + ' \u2013 ' + y1;
  }
}

function updateAmbientForFilter() {
  const filtered = routesGJ.features.filter(f => activeTypes.has(f.properties.activity_type));
  const mi = filtered.reduce((s, f) => s + (f.properties.distance_miles || 0), 0);
  const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  el('stat-miles', Math.round(mi).toLocaleString());
  el('stat-count', filtered.length.toLocaleString());
}

/* -----------------------------------------------------------
   Sport navigation
   ----------------------------------------------------------- */

function buildSportNav() {
  const container = document.getElementById('type-filters');
  container.innerHTML = '';
  const counts = {};
  for (const f of routesGJ.features) {
    const t = f.properties.activity_type;
    counts[t] = (counts[t] || 0) + 1;
  }
  const types = [...allTypes].sort((a, b) => (counts[b] || 0) - (counts[a] || 0));

  const allBtn = document.createElement('button');
  allBtn.className = 'type-chip';
  allBtn.textContent = 'All';
  allBtn.addEventListener('click', () => {
    activeTypes = new Set(allTypes);
    updateSportBtnState();
    applyTypeFilter();
    updateAmbientForFilter();
  });
  container.appendChild(allBtn);

  for (const type of types) {
    const chip = document.createElement('button');
    chip.className = 'type-chip' + (activeTypes.has(type) ? ' active' : '');
    chip.dataset.type = type;
    const dot = document.createElement('span');
    dot.className = 'type-dot';
    dot.style.background = CFG.typeColors[type] || '#888';
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(type));
    chip.addEventListener('click', () => {
      activeTypes = new Set([type]);
      updateSportBtnState();
      applyTypeFilter();
      updateAmbientForFilter();
      flyToTypeCenter(type);
    });
    container.appendChild(chip);
  }
}

function updateSportBtnState() {
  document.querySelectorAll('.type-chip').forEach(btn => {
    const t = btn.dataset.type;
    if (!t) btn.classList.toggle('active', activeTypes.size === allTypes.size);
    else btn.classList.toggle('active', activeTypes.has(t));
  });
}

function flyToTypeCenter(type) {
  const feats = routesGJ.features.filter(f => f.properties.activity_type === type);
  if (!feats.length) return;
  const bounds = new mapboxgl.LngLatBounds();
  for (const f of feats) {
    for (const c of f.geometry.coordinates) bounds.extend(c);
  }
  map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 1000 });
}

/* -----------------------------------------------------------
   Location navigation
   ----------------------------------------------------------- */

function buildLocationNav() {
  const container = document.getElementById('location-nav');
  if (!container) return;
  for (const [key, loc] of Object.entries(CFG.locations)) {
    const btn = document.createElement('button');
    btn.className = 'loc-btn' + (key === CFG.defaultLocation ? ' active' : '');
    btn.textContent = loc.label;
    btn.dataset.loc = key;
    btn.addEventListener('click', () => {
      map.flyTo({ center: loc.center, zoom: loc.zoom, duration: 1200 });
      container.querySelectorAll('.loc-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
    container.appendChild(btn);
  }
}

/* -----------------------------------------------------------
   Type filter
   ----------------------------------------------------------- */

function applyTypeFilter() {
  if (!layersReady) return;
  const filt = activeTypes.size === 0
    ? ['==', 'id', '__none__']
    : ['in', 'activity_type', ...activeTypes];
  map.setFilter('routes', filt);
  map.setFilter('routes-glow', filt);
  if (selectedId) {
    map.setFilter('routes-highlight', ['all', filt, ['==', 'id', selectedId]]);
  } else {
    map.setFilter('routes-highlight', ['==', 'id', '__none__']);
  }
}

/* -----------------------------------------------------------
   Route layers
   ----------------------------------------------------------- */

function buildTypeColorExpr() {
  const expr = ['match', ['get', 'activity_type']];
  for (const [type, color] of Object.entries(CFG.typeColors)) expr.push(type, color);
  expr.push(CFG.defaultColor);
  return expr;
}

function ensureRouteLayers() {
  if (map.getSource('routes')) {
    try { map.removeLayer('routes-highlight'); } catch(e) {}
    try { map.removeLayer('routes'); } catch(e) {}
    try { map.removeLayer('routes-glow'); } catch(e) {}
    try { map.removeSource('routes'); } catch(e) {}
  }
  map.addSource('routes', { type: 'geojson', data: routesGJ, generateId: true });

  const colorExpr = buildTypeColorExpr();

  map.addLayer({
    id: 'routes-glow', type: 'line', source: 'routes',
    paint: {
      'line-color': colorExpr,
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, 3, 10, 8, 16, 14],
      'line-blur': ['interpolate', ['linear'], ['zoom'], 5, 3, 10, 6, 16, 10],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.08, 10, 0.15, 15, 0.25],
    },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  });

  map.addLayer({
    id: 'routes', type: 'line', source: 'routes',
    paint: {
      'line-color': colorExpr,
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.3, 10, 1.2, 16, 2.5],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.35, 10, 0.6, 15, 0.85],
    },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  });

  map.addLayer({
    id: 'routes-highlight', type: 'line', source: 'routes',
    filter: ['==', 'id', '__none__'],
    paint: { 'line-color': CFG.highlight, 'line-width': 3, 'line-opacity': 1 },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  });

  layersReady = true;
}

function addRouteLayers() {
  ensureRouteLayers();
  bindMapInteractions();
}

/* -----------------------------------------------------------
   Interactions
   ----------------------------------------------------------- */

function bindMapInteractions() {
  map.off('mousemove', 'routes', onRouteHover);
  map.off('mouseleave', 'routes', onRouteLeave);
  map.off('click', 'routes', onRouteClick);
  map.on('mousemove', 'routes', onRouteHover);
  map.on('mouseleave', 'routes', onRouteLeave);
  map.on('click', 'routes', onRouteClick);
}

function onRouteHover(e) {
  if (!e.features.length || !layersReady) return;
  map.getCanvas().style.cursor = 'pointer';
  const fid = e.features[0].properties.id;
  if (fid === hoveredId) return;
  hoveredId = fid;
  if (!selectedId) map.setFilter('routes-highlight', ['==', 'id', fid]);
}
function onRouteLeave() {
  map.getCanvas().style.cursor = '';
  hoveredId = null;
  if (!selectedId && layersReady) map.setFilter('routes-highlight', ['==', 'id', '__none__']);
}
function onRouteClick(e) {
  if (!e.features.length || !layersReady) return;
  const fid = e.features[0].properties.id;
  if (selectedId === fid) { deselectRoute(); return; }
  selectRoute(fid);
}

function selectRoute(fid) {
  if (!layersReady) return;
  selectedId = fid;
  map.setFilter('routes-highlight', ['==', 'id', fid]);
  map.setPaintProperty('routes', 'line-opacity', ['case', ['==', ['get', 'id'], fid], 0, 0.08]);
  map.setPaintProperty('routes-glow', 'line-opacity', ['case', ['==', ['get', 'id'], fid], 0, 0.03]);
  const feat = routesGJ.features.find(f => String(f.properties.id) === String(fid));
  if (feat) { showDetail(feat); flyToFeature(feat); }
}

function deselectRoute() {
  if (!layersReady) return;
  selectedId = null;
  map.setFilter('routes-highlight', ['==', 'id', '__none__']);
  map.setPaintProperty('routes', 'line-opacity',
    ['interpolate', ['linear'], ['zoom'], 5, 0.35, 10, 0.6, 15, 0.85]);
  map.setPaintProperty('routes-glow', 'line-opacity',
    ['interpolate', ['linear'], ['zoom'], 5, 0.08, 10, 0.15, 15, 0.25]);
  hideDetail();
}

function flyToFeature(feat) {
  const c = feat.geometry.coordinates;
  if (!c || c.length < 2) return;
  const b = c.reduce((bounds, coord) => bounds.extend(coord), new mapboxgl.LngLatBounds(c[0], c[0]));
  map.fitBounds(b, { padding: 80, maxZoom: 15, duration: 800 });
}

/* -----------------------------------------------------------
   Detail panel
   ----------------------------------------------------------- */

function bindDetail() {
  document.getElementById('detail-close').addEventListener('click', deselectRoute);
}

function showDetail(feat) {
  const p = feat.properties;
  const date = p.date ? new Date(p.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  const dist = p.distance_miles != null ? p.distance_miles + ' mi' : '';
  const dur = fmtDuration(p.duration_minutes);
  const type = p.activity_type || '';
  const name = p.name || '';
  const typeColor = CFG.typeColors[type] || '#888';
  let html = '<h3>' + (name || date) + '</h3>';
  if (type) html += '<div class="detail-type" style="color:' + typeColor + '">' + type + '</div>';
  if (date) html += row('date', date);
  if (dist) html += row('distance', dist);
  if (dur) html += row('duration', dur);
  document.getElementById('detail-content').innerHTML = html;
  document.getElementById('route-detail').classList.remove('hidden');
}

function fmtDuration(min) {
  if (min == null || min <= 0) return '';
  if (min < 60) return Math.round(min) + 'm';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
}
function row(k, v) {
  return '<div class="detail-row"><span class="detail-key">' + k + '</span><span class="detail-val">' + v + '</span></div>';
}
function hideDetail() { document.getElementById('route-detail').classList.add('hidden'); }

/* -----------------------------------------------------------
   Viewing modes
   ----------------------------------------------------------- */

function bindModeButtons() {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
}

function setMode(mode) {
  if (mode === currentMode) return;
  const prev = currentMode;
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));

  if (mode === 'gallery') { enterGallery(); return; }
  if (prev === 'gallery') exitGallery();

  if (mode === 'temporal') {
    enterTemporal();
    return;
  }

  const style = mode === 'void' ? CFG.voidStyle : CFG.darkStyle;
  rebuildWithStyle(style, () => {
    if (mode === 'void') applyVoidColors();
  });
  hideTemporal();
}

function rebuildWithStyle(style, cb) {
  layersReady = false;
  const isJson = typeof style === 'object';
  map.setStyle(style);
  const rebuild = () => {
    addRouteLayers();
    applyTypeFilter();
    if (cb) cb();
  };
  if (isJson) {
    // JSON styles load near-synchronously; use idle event as safety
    map.once('idle', rebuild);
  } else {
    map.once('style.load', rebuild);
  }
}

function applyVoidColors() {
  if (!layersReady) return;
  map.setPaintProperty('routes', 'line-color', 'rgba(255, 200, 120, 0.5)');
  map.setPaintProperty('routes', 'line-opacity',
    ['interpolate', ['linear'], ['zoom'], 5, 0.25, 10, 0.5, 15, 0.7]);
  map.setPaintProperty('routes-glow', 'line-color', 'rgba(255, 180, 80, 0.15)');
  map.setPaintProperty('routes-glow', 'line-opacity',
    ['interpolate', ['linear'], ['zoom'], 5, 0.4, 10, 0.6, 15, 0.8]);
}

/* -----------------------------------------------------------
   Temporal mode -- timeline playback
   ----------------------------------------------------------- */

let temporalPlaying = false, temporalRAF = null, temporalCursor = 0;

function enterTemporal() {
  rebuildWithStyle(CFG.voidStyle, () => {
    // Set temporal colors on all routes
    map.setPaintProperty('routes', 'line-color', [
      'interpolate', ['linear'], ['get', 'date_epoch'],
      epochMin, CFG.temporal[0],
      epochMin + (epochMax - epochMin) * 0.25, CFG.temporal[1],
      epochMin + (epochMax - epochMin) * 0.5, CFG.temporal[2],
      epochMin + (epochMax - epochMin) * 0.75, CFG.temporal[3],
      epochMax, CFG.temporal[4],
    ]);
    map.setPaintProperty('routes', 'line-opacity', 0.7);
    map.setPaintProperty('routes-glow', 'line-color', [
      'interpolate', ['linear'], ['get', 'date_epoch'],
      epochMin, CFG.temporal[0], epochMax, CFG.temporal[4],
    ]);
    map.setPaintProperty('routes-glow', 'line-opacity', 0.3);

    // Set filter to show all active types
    applyTypeFilter();

    // Build the timeline UI
    showTemporal();
    updateTemporalFilter(epochMax);
  });
}

function showTemporal() {
  const el = document.getElementById('temporal-legend');
  if (!el) return;
  el.classList.add('visible');

  const tStart = document.getElementById('temporal-start');
  const tEnd = document.getElementById('temporal-end');
  if (tStart) tStart.textContent = fmtYear(epochMin);
  if (tEnd) tEnd.textContent = fmtYear(epochMax);

  // Add slider if not present
  let slider = document.getElementById('temporal-slider');
  if (!slider) {
    slider = document.createElement('input');
    slider.type = 'range';
    slider.id = 'temporal-slider';
    slider.min = 0;
    slider.max = 1000;
    slider.value = 1000;
    const bar = el.querySelector('.temporal-bar');
    if (bar) bar.replaceWith(slider);
  }
  slider.value = 1000;

  let curLabel = document.getElementById('temporal-current');
  if (!curLabel) {
    curLabel = document.createElement('span');
    curLabel.id = 'temporal-current';
    curLabel.className = 'temporal-label temporal-current-label';
    el.appendChild(curLabel);
  }
  curLabel.textContent = fmtYear(epochMax);

  slider.oninput = () => {
    const t = Number(slider.value) / 1000;
    const epoch = epochMin + t * (epochMax - epochMin);
    updateTemporalFilter(epoch);
    curLabel.textContent = fmtDate(epoch);
  };

  // Play button
  let playBtn = document.getElementById('temporal-play');
  if (!playBtn) {
    playBtn = document.createElement('button');
    playBtn.id = 'temporal-play';
    playBtn.className = 'loc-btn';
    playBtn.textContent = '\u25B6';
    el.appendChild(playBtn);
  }
  playBtn.onclick = () => {
    if (temporalPlaying) { stopTemporalPlay(); playBtn.textContent = '\u25B6'; }
    else { startTemporalPlay(slider, curLabel); playBtn.textContent = '\u25A0'; }
  };
}

function hideTemporal() {
  const el = document.getElementById('temporal-legend');
  if (el) el.classList.remove('visible');
  stopTemporalPlay();
}

function updateTemporalFilter(maxEpoch) {
  if (!layersReady) return;
  temporalCursor = maxEpoch;
  const typeFilt = activeTypes.size === 0
    ? ['==', 'id', '__none__']
    : ['in', 'activity_type', ...activeTypes];
  const timeFilt = ['<=', ['get', 'date_epoch'], maxEpoch];
  map.setFilter('routes', ['all', typeFilt, timeFilt]);
  map.setFilter('routes-glow', ['all', typeFilt, timeFilt]);
}

function startTemporalPlay(slider, label) {
  temporalPlaying = true;
  let t = Number(slider.value) / 1000;
  if (t >= 0.99) t = 0;
  const speed = 0.0008; // ~20 sec full playback
  const tick = () => {
    t += speed;
    if (t > 1) { t = 1; stopTemporalPlay(); document.getElementById('temporal-play').textContent = '\u25B6'; }
    slider.value = Math.round(t * 1000);
    const epoch = epochMin + t * (epochMax - epochMin);
    updateTemporalFilter(epoch);
    label.textContent = fmtDate(epoch);
    if (temporalPlaying) temporalRAF = requestAnimationFrame(tick);
  };
  temporalRAF = requestAnimationFrame(tick);
}

function stopTemporalPlay() {
  temporalPlaying = false;
  if (temporalRAF) { cancelAnimationFrame(temporalRAF); temporalRAF = null; }
}

function fmtYear(epoch) { return new Date(epoch * 1000).getFullYear(); }
function fmtDate(epoch) {
  const d = new Date(epoch * 1000);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getFullYear();
}

/* -----------------------------------------------------------
   Gallery
   ----------------------------------------------------------- */

function bindGallery() {
  document.getElementById('gallery-close').addEventListener('click', () => setMode('mapped'));
}

function enterGallery() {
  const grid = document.getElementById('gallery-grid');
  grid.innerHTML = '';
  const sorted = [...routesGJ.features]
    .filter(f => activeTypes.has(f.properties.activity_type || 'Unknown'))
    .sort((a, b) => (b.properties.date || '').localeCompare(a.properties.date || ''));
  let idx = 0;
  (function batch() {
    const end = Math.min(idx + 60, sorted.length);
    for (; idx < end; idx++) grid.appendChild(mkCard(sorted[idx]));
    if (idx < sorted.length) requestAnimationFrame(batch);
  })();
  document.getElementById('gallery-overlay').classList.remove('hidden');
  document.body.style.overflow = 'auto';
}

function exitGallery() {
  document.getElementById('gallery-overlay').classList.add('hidden');
  document.body.style.overflow = 'hidden';
}

function mkCard(feat) {
  const card = document.createElement('div');
  card.className = 'gallery-card';
  const cvs = document.createElement('canvas');
  cvs.width = 400; cvs.height = 400;
  card.appendChild(cvs);
  const lbl = document.createElement('div');
  lbl.className = 'gallery-label';
  const p = feat.properties;
  const d = p.date ? new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }) : '';
  const mi = p.distance_miles != null ? p.distance_miles + ' mi' : '';
  lbl.textContent = [d, mi, p.activity_type].filter(Boolean).join(' \u00B7 ');
  card.appendChild(lbl);
  const typeColor = CFG.typeColors[p.activity_type] || 'rgba(255, 190, 100, 0.7)';
  requestAnimationFrame(() => drawRoute(cvs, feat.geometry.coordinates, typeColor));
  card.addEventListener('click', () => {
    exitGallery();
    currentMode = 'mapped';
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === 'mapped'));
    rebuildWithStyle(CFG.darkStyle, () => {
      selectRoute(p.id);
      flyToFeature(feat);
    });
  });
  return card;
}

function drawRoute(cvs, coords, color) {
  const ctx = cvs.getContext('2d');
  const w = cvs.width, h = cvs.height, pad = 40;
  ctx.fillStyle = '#0a0c10';
  ctx.fillRect(0, 0, w, h);
  if (!coords || coords.length < 2) return;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const c of coords) { x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]); }
  const rx = x1 - x0 || 0.001, ry = y1 - y0 || 0.001;
  const s = Math.min((w - pad * 2) / rx, (h - pad * 2) / ry);
  const ox = (w - rx * s) / 2, oy = (h - ry * s) / 2;

  ctx.globalAlpha = 0.15;
  ctx.strokeStyle = color;
  ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < coords.length; i++) {
    const px = ox + (coords[i][0] - x0) * s, py = oy + (y1 - coords[i][1]) * s;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.stroke();

  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < coords.length; i++) {
    const px = ox + (coords[i][0] - x0) * s, py = oy + (y1 - coords[i][1]) * s;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}
