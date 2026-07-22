'use strict';

/* ===========================================================
   Pattern of Life — a decade in motion
   Mapbox GL v3 · globe · terrain · immersive data story
   =========================================================== */

const CFG = {
  // Public Mapbox token (valid on the account; URL-restrict to doucett.net when convenient).
  token: 'pk.eyJ1IjoiYWRvdWNldHQiLCJhIjoiY2lvZDFsc2lwMDRnd3Zha2pneWpxcHh6biJ9.sbWgw2zPGyScsp-r4CYQnA',
  style: 'mapbox://styles/mapbox/dark-v11',

  data: {
    points: '/data/json/timeline/points.json',
    segments: '/data/json/timeline/segments.geojson',
    places: '/data/json/timeline/places.json',
    trips: '/data/json/timeline/trips.json',
    chapters: '/data/json/timeline/chapters.json',
    stats: '/data/json/timeline/stats.json',
  },

  // temporal palette (cool 2013 -> warm 2024)
  temporal: ['#2a4d8f', '#4a8fa5', '#7ab87a', '#c4a747', '#fc5200'],
  modeColors: { foot: '#a78bfa', active: '#22c55e', ground: '#38bdf8', air: '#fc5200' },
  accent: '#fc5200',

  home: { center: [-92.0, 39.5], zoom: 3.2 },
};

const state = {
  points: null, segments: null, places: null, trips: null, chapters: null, stats: null,
  epochMin: 0, epochMax: 1,
  mode: 'story',
  isMobile: window.matchMedia('(max-width: 720px)').matches,
  ready: false,
};

let map;

/* -----------------------------------------------------------
   Boot
   ----------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', init);

async function init() {
  mapboxgl.accessToken = CFG.token;

  map = new mapboxgl.Map({
    container: 'map',
    style: CFG.style,
    center: CFG.home.center,
    zoom: CFG.home.zoom,
    projection: 'globe',
    attributionControl: false,
    antialias: true,
    dragRotate: true,
    maxPitch: 75,
  });
  map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');
  map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-left');
  map.scrollZoom.setWheelZoomRate(1 / 250);

  const dataP = loadData();

  map.on('style.load', () => {
    map.setFog({
      color: 'rgb(9, 11, 15)',
      'high-color': 'rgb(24, 34, 56)',
      'horizon-blend': 0.08,
      'space-color': 'rgb(0, 0, 0)',
      'star-intensity': 0.12,
    });
    try {
      map.addSource('mapbox-dem', {
        type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14,
      });
    } catch (e) { /* already present after style reloads */ }
  });

  await dataP;
  if (!state.points) {
    document.querySelector('#loading span').textContent = 'Could not load timeline data.';
    return;
  }

  computeRange();
  populateAmbient();
  buildChapters();

  const go = () => {
    addLayers();
    wireUI();
    state.ready = true;
    document.getElementById('loading').classList.add('done');
    setMode('story', true);
  };
  if (map.isStyleLoaded()) go(); else map.once('load', go);
}

async function loadData() {
  const get = (url, fallback) => fetch(url).then(r => r.ok ? r.json() : fallback).catch(() => fallback);
  const [pts, seg, pl, tr, ch, st] = await Promise.all([
    get(CFG.data.points, null),
    get(CFG.data.segments, { type: 'FeatureCollection', features: [] }),
    get(CFG.data.places, { places: [] }),
    get(CFG.data.trips, { trips: [] }),
    get(CFG.data.chapters, { chapters: [] }),
    get(CFG.data.stats, {}),
  ]);
  state.points = pts && pts.points ? pts.points : null;
  state.segments = seg;
  state.places = (pl.places || []);
  state.trips = (tr.trips || []);
  state.chapters = (ch.chapters || []);
  state.stats = st || {};
}

function computeRange() {
  const p = state.points;
  state.epochMin = p[0][2];
  state.epochMax = p[p.length - 1][2];
  if (state.epochMax <= state.epochMin) state.epochMax = state.epochMin + 1;
}

/* -----------------------------------------------------------
   Derived GeoJSON builders
   ----------------------------------------------------------- */
function pointsToGeoJSON(sampleStep) {
  const step = sampleStep || 1;
  const feats = [];
  for (let i = 0; i < state.points.length; i += step) {
    const p = state.points[i];
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p[0], p[1]] },
      properties: { t: p[2] } });
  }
  return { type: 'FeatureCollection', features: feats };
}

function placesToGeoJSON() {
  return {
    type: 'FeatureCollection',
    features: state.places.map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { hours: p.hours, visits: p.visits, label: p.label || '', first: p.first, last: p.last },
    })),
  };
}

function greatCircle(from, to, n) {
  const toRad = Math.PI / 180, toDeg = 180 / Math.PI;
  const lon1 = from[0] * toRad, lat1 = from[1] * toRad, lon2 = to[0] * toRad, lat2 = to[1] * toRad;
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2));
  if (d === 0 || !isFinite(d)) return [from, to];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    pts.push([Math.atan2(y, x) * toDeg, Math.atan2(z, Math.sqrt(x * x + y * y)) * toDeg]);
  }
  return pts;
}

function tripsToGeoJSON() {
  return {
    type: 'FeatureCollection',
    features: state.trips.map(t => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: greatCircle(t.from, t.to, 48) },
      properties: { mode: t.mode, km: t.km, year: t.year },
    })),
  };
}

/* -----------------------------------------------------------
   Layers
   ----------------------------------------------------------- */
function temporalColorExpr(prop) {
  const a = state.epochMin, b = state.epochMax, span = b - a;
  return ['interpolate', ['linear'], ['get', prop],
    a, CFG.temporal[0],
    a + span * 0.25, CFG.temporal[1],
    a + span * 0.5, CFG.temporal[2],
    a + span * 0.75, CFG.temporal[3],
    b, CFG.temporal[4]];
}

function addLayers() {
  // ---- Sources
  map.addSource('pts', { type: 'geojson', data: pointsToGeoJSON(state.isMobile ? 3 : 1) });
  map.addSource('seg', { type: 'geojson', data: state.segments });
  map.addSource('places', { type: 'geojson', data: placesToGeoJSON() });
  map.addSource('trips', { type: 'geojson', data: tripsToGeoJSON() });
  map.addSource('trail', { type: 'geojson', data: emptyLine() });
  map.addSource('dot', { type: 'geojson', data: emptyFC() });

  // ---- Heatmap
  map.addLayer({
    id: 'heat', type: 'heatmap', source: 'pts', maxzoom: 15,
    paint: {
      'heatmap-weight': 0.6,
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 2, 0.6, 6, 1.1, 11, 1.6, 15, 2.2],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 2, 2, 6, 8, 11, 18, 15, 34],
      'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.85, 13, 0.65, 15, 0.35],
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(0,0,0,0)',
        0.15, 'rgba(42,77,143,0.5)',
        0.35, '#4a8fa5',
        0.55, '#7ab87a',
        0.75, '#c4a747',
        1, '#fc5200'],
    },
  });

  // ---- Trace (segments)
  map.addLayer({
    id: 'seg-glow', type: 'line', source: 'seg',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': temporalColorExpr('epoch'),
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2, 10, 6, 15, 11],
      'line-blur': ['interpolate', ['linear'], ['zoom'], 3, 2, 10, 5, 15, 9],
      'line-opacity': 0.16,
    },
  });
  map.addLayer({
    id: 'seg', type: 'line', source: 'seg',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': temporalColorExpr('epoch'),
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 10, 1.3, 15, 2.4],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 10, 0.7, 15, 0.9],
    },
  });

  // ---- Places
  map.addLayer({
    id: 'places-circ', type: 'circle', source: 'places',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'hours']], 0, 3, 30, 10, 140, 34],
      'circle-color': CFG.accent,
      'circle-opacity': 0.28,
      'circle-stroke-color': '#ffd9c2',
      'circle-stroke-width': 1,
      'circle-stroke-opacity': 0.5,
    },
  });

  // ---- Trips
  map.addLayer({
    id: 'trips-line', type: 'line', source: 'trips',
    layout: { 'line-cap': 'round' },
    paint: {
      'line-color': ['match', ['get', 'mode'], 'air', '#fc5200', '#38bdf8'],
      'line-width': ['interpolate', ['linear'], ['get', 'km'], 120, 0.6, 4000, 2.2],
      'line-opacity': 0.5,
      'line-blur': 0.4,
    },
  });

  // ---- Playback trail + dot
  map.addLayer({
    id: 'trail-line', type: 'line', source: 'trail',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffb060', 'line-width': 3, 'line-opacity': 0.5, 'line-blur': 1.5 },
  });
  map.addLayer({
    id: 'dot-glow', type: 'circle', source: 'dot',
    paint: { 'circle-radius': 16, 'circle-color': CFG.accent, 'circle-opacity': 0.28, 'circle-blur': 1 },
  });
  map.addLayer({
    id: 'dot-core', type: 'circle', source: 'dot',
    paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': CFG.accent, 'circle-stroke-width': 2 },
  });

  // Place click
  map.on('click', 'places-circ', onPlaceClick);
  map.on('mouseenter', 'places-circ', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'places-circ', () => map.getCanvas().style.cursor = '');

  setVis(['heat', 'seg-glow', 'seg', 'places-circ', 'trips-line', 'trail-line', 'dot-glow', 'dot-core'], 'none');
}

function emptyLine() { return { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} }; }
function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

function setVis(ids, v) {
  ids.forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v); });
}
function show(ids) { setVis(ids, 'visible'); }
function hide(ids) { setVis(ids, 'none'); }

function setTerrainOn(on) {
  try {
    if (on && map.getSource('mapbox-dem')) map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.35 });
    else map.setTerrain(null);
  } catch (e) { /* noop */ }
}

/* -----------------------------------------------------------
   Layer emphasis — shared by modes + story chapters
   ----------------------------------------------------------- */
function emphasize(layer) {
  // reset trace paint to temporal by default
  hide(['heat', 'seg-glow', 'seg', 'places-circ', 'trips-line']);
  if (layer === 'heatmap') {
    show(['heat']);
    show(['seg-glow']); map.setPaintProperty('seg-glow', 'line-opacity', 0.05);
  } else if (layer === 'temporal') {
    show(['seg-glow', 'seg']);
    map.setPaintProperty('seg-glow', 'line-opacity', 0.16);
    map.setPaintProperty('seg', 'line-color', temporalColorExpr('epoch'));
  } else if (layer === 'trips') {
    show(['trips-line']);
    show(['seg-glow']); map.setPaintProperty('seg-glow', 'line-opacity', 0.06);
    show(['heat']); map.setPaintProperty('heat', 'heatmap-opacity',
      ['interpolate', ['linear'], ['zoom'], 2, 0.4, 13, 0.3]);
  } else if (layer === 'places') {
    show(['places-circ', 'heat']);
    map.setPaintProperty('heat', 'heatmap-opacity',
      ['interpolate', ['linear'], ['zoom'], 2, 0.35, 13, 0.25]);
  }
}

/* -----------------------------------------------------------
   Ambient stats
   ----------------------------------------------------------- */
function populateAmbient() {
  const s = state.stats || {};
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  if (s.approx_miles != null) set('stat-miles', Math.round(s.approx_miles).toLocaleString());
  if (s.days_tracked != null) set('stat-days', s.days_tracked.toLocaleString());
  if (s.places != null) set('stat-places', s.places.toLocaleString());
  if (Array.isArray(s.year_range)) set('stat-range', s.year_range[0] + ' \u2013 ' + s.year_range[1]);
}

/* -----------------------------------------------------------
   UI wiring
   ----------------------------------------------------------- */
function wireUI() {
  document.querySelectorAll('.mode-btn').forEach(b =>
    b.addEventListener('click', () => setMode(b.dataset.mode)));

  document.getElementById('place-close').addEventListener('click', hidePlace);
  document.getElementById('poster-close').addEventListener('click', () => setMode('heatmap'));
  document.getElementById('poster-download').addEventListener('click', downloadPoster);
  window.addEventListener('resize', () => { if (state.mode === 'poster') renderPoster(); });

  // Playback
  document.getElementById('pb-play').addEventListener('click', togglePlay);
  document.getElementById('pb-scrub').addEventListener('input', onScrub);
  document.querySelectorAll('.pb-speed').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.pb-speed').forEach(x => x.classList.toggle('active', x === b));
    pb.mult = Number(b.dataset.mult);
  }));

  // Story
  document.getElementById('story-exit').addEventListener('click', () => setMode('heatmap'));
  document.getElementById('story-play').addEventListener('click', toggleFilm);
  document.getElementById('cinema-skip').addEventListener('click', stopFilm);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (film.playing) { stopFilm(); return; }
      if (state.mode === 'poster') setMode('heatmap');
      if (!document.getElementById('place-detail').classList.contains('hidden')) hidePlace();
    }
    if (e.key === ' ' && state.mode === 'playback') { e.preventDefault(); togglePlay(); }
  });
}

/* -----------------------------------------------------------
   Modes
   ----------------------------------------------------------- */
function setMode(mode, force) {
  if (!state.ready) return;
  if (mode === state.mode && !force) return;
  const prev = state.mode;
  state.mode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));

  // leaving states
  stopPlay();
  if (prev === 'story' && mode !== 'story') exitStory();
  if (prev === 'poster' && mode !== 'poster') document.getElementById('poster-overlay').classList.add('hidden');
  document.getElementById('temporal-legend').classList.remove('visible');
  document.getElementById('playback-bar').classList.add('hidden');
  hidePlace();

  if (mode === 'story') { enterStory(); return; }
  if (mode === 'poster') { enterPoster(); return; }

  hide(['trail-line', 'dot-glow', 'dot-core']);
  setTerrainOn(false);

  if (mode === 'heatmap') {
    emphasize('heatmap');
    map.setPaintProperty('heat', 'heatmap-opacity',
      ['interpolate', ['linear'], ['zoom'], 2, 0.85, 13, 0.65, 15, 0.35]);
    flyHome();
  } else if (mode === 'temporal') {
    emphasize('temporal');
    showTemporalLegend();
    flyHome();
  } else if (mode === 'playback') {
    emphasize('heatmap');
    map.setPaintProperty('heat', 'heatmap-opacity',
      ['interpolate', ['linear'], ['zoom'], 2, 0.25, 13, 0.18]);
    show(['trail-line', 'dot-glow', 'dot-core']);
    document.getElementById('playback-bar').classList.remove('hidden');
    startPlayback();
  } else if (mode === 'places') {
    emphasize('places');
    flyHome();
  } else if (mode === 'trips') {
    emphasize('trips');
    map.flyTo({ center: [-92, 38], zoom: 3.1, pitch: 0, bearing: 0, duration: 1600, essential: true });
  }
}

function flyHome() {
  map.flyTo({ center: CFG.home.center, zoom: CFG.home.zoom, pitch: 0, bearing: 0, duration: 1400, essential: true });
}

function showTemporalLegend() {
  const el = document.getElementById('temporal-legend');
  el.classList.add('visible');
  document.getElementById('temporal-start').textContent = fmtYear(state.epochMin);
  document.getElementById('temporal-end').textContent = fmtYear(state.epochMax);
}

/* -----------------------------------------------------------
   Playback engine
   ----------------------------------------------------------- */
const pb = { playing: false, raf: null, clock: 0, cursor: 0, mult: 600, last: 0, trailStart: 0, placeTick: 0 };

function startPlayback() {
  pb.clock = state.epochMin;
  pb.cursor = 0;
  pb.trailStart = 0;
  updatePlaybackVisual(true);
  const dot = state.points[0];
  map.flyTo({ center: [dot[0], dot[1]], zoom: 9.5, pitch: 40, duration: 1600, essential: true });
}

function togglePlay() {
  if (pb.playing) stopPlay(); else play();
}
function play() {
  if (state.mode !== 'playback') return;
  if (pb.clock >= state.epochMax) { pb.clock = state.epochMin; pb.cursor = 0; pb.trailStart = 0; }
  pb.playing = true;
  pb.last = performance.now();
  document.getElementById('pb-play').innerHTML = '&#10073;&#10073;';
  pb.raf = requestAnimationFrame(playStep);
}
function stopPlay() {
  pb.playing = false;
  if (pb.raf) cancelAnimationFrame(pb.raf);
  pb.raf = null;
  const btn = document.getElementById('pb-play');
  if (btn) btn.innerHTML = '&#9654;';
}

function playStep(now) {
  if (!pb.playing) return;
  const span = state.epochMax - state.epochMin;
  const rate = (span / 90) * (pb.mult / 600); // data-seconds per real-second
  const dtReal = Math.min(0.05, (now - pb.last) / 1000);
  pb.last = now;
  pb.clock += dtReal * rate;
  if (pb.clock >= state.epochMax) { pb.clock = state.epochMax; updatePlaybackVisual(false); stopPlay(); return; }
  advanceCursor();
  updatePlaybackVisual(false);
  pb.raf = requestAnimationFrame(playStep);
}

function advanceCursor() {
  const P = state.points;
  while (pb.cursor < P.length - 1 && P[pb.cursor + 1][2] <= pb.clock) {
    // detect teleport/gap -> restart trail
    const a = P[pb.cursor], b = P[pb.cursor + 1];
    if (b[2] - a[2] > 6 * 3600 || haversineKm(a, b) > 120) pb.trailStart = pb.cursor + 1;
    pb.cursor++;
  }
}

function updatePlaybackVisual(recenter) {
  const P = state.points;
  const i = pb.cursor;
  const a = P[i], b = P[Math.min(i + 1, P.length - 1)];
  let pos = [a[0], a[1]];
  if (b !== a && b[2] > a[2]) {
    const f = Math.max(0, Math.min(1, (pb.clock - a[2]) / (b[2] - a[2])));
    if (haversineKm(a, b) < 120) pos = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }
  // dot
  map.getSource('dot').setData({ type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: pos }, properties: {} }] });
  // trail (windowed)
  const winStart = Math.max(pb.trailStart, i - 260);
  const coords = [];
  for (let k = winStart; k <= i; k++) coords.push([P[k][0], P[k][1]]);
  coords.push(pos);
  map.getSource('trail').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} });

  // readout
  document.getElementById('pb-date').textContent = fmtFullDate(pb.clock);
  document.getElementById('pb-scrub').value = Math.round(((pb.clock - state.epochMin) / (state.epochMax - state.epochMin)) * 1000);
  if ((pb.placeTick++ % 12) === 0) {
    const near = nearestPlaceLabel(pos);
    document.getElementById('pb-place').textContent = near || '';
  }

  // follow cam
  if (recenter) { map.easeTo({ center: pos, duration: 800, essential: true }); return; }
  if (pb.playing) {
    const p = map.project(pos);
    const c = map.getContainer();
    const mx = c.clientWidth, my = c.clientHeight;
    if (p.x < mx * 0.2 || p.x > mx * 0.8 || p.y < my * 0.2 || p.y > my * 0.8) {
      map.easeTo({ center: pos, duration: 900, essential: true });
    }
  }
}

function onScrub(e) {
  const t = Number(e.target.value) / 1000;
  pb.clock = state.epochMin + t * (state.epochMax - state.epochMin);
  // reset cursor via search
  pb.cursor = lowerBound(pb.clock);
  pb.trailStart = Math.max(0, pb.cursor - 260);
  updatePlaybackVisual(true);
}

function lowerBound(clock) {
  const P = state.points;
  let lo = 0, hi = P.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (P[m][2] < clock) lo = m + 1; else hi = m; }
  return Math.max(0, lo - 1);
}

/* -----------------------------------------------------------
   Places
   ----------------------------------------------------------- */
function onPlaceClick(e) {
  if (!e.features || !e.features.length) return;
  const p = e.features[0].properties;
  const days = (p.hours / 24);
  let html = '<h3>' + (p.label || 'Frequent place') + '</h3>';
  html += row('time here', days >= 1 ? Math.round(days) + ' days' : Math.round(p.hours) + ' h');
  html += row('visits', Number(p.visits).toLocaleString());
  html += row('first', p.first);
  html += row('last', p.last);
  document.getElementById('place-content').innerHTML = html;
  document.getElementById('place-detail').classList.remove('hidden');
}
function hidePlace() { const el = document.getElementById('place-detail'); if (el) el.classList.add('hidden'); }
function row(k, v) { return '<div class="detail-row"><span class="detail-key">' + k + '</span><span class="detail-val">' + v + '</span></div>'; }

function nearestPlaceLabel(pos) {
  let best = null, bestkm = 8; // within 8km
  for (const p of state.places) {
    if (!p.label) continue;
    const km = haversineKm([p.lng, p.lat], pos);
    if (km < bestkm) { bestkm = km; best = p.label; }
  }
  return best;
}

/* -----------------------------------------------------------
   Story — scrollytelling
   ----------------------------------------------------------- */
let storyObserver = null;
let activeChapter = null;

function buildChapters() {
  const scroll = document.getElementById('story-scroll');
  scroll.innerHTML = '';
  state.chapters.forEach((ch, i) => {
    const el = document.createElement('div');
    el.className = 'chapter';
    el.dataset.index = i;
    let html = '<div class="chapter__eyebrow">' + String(i + 1).padStart(2, '0') + ' &middot; ' + (ch.id || '') + '</div>';
    html += '<h2 class="chapter__title">' + (ch.title || '') + '</h2>';
    html += '<p class="chapter__caption">' + (ch.caption || '') + '</p>';
    if (ch.stats && ch.stats.length) {
      html += '<div class="chapter__stats">';
      ch.stats.forEach(s => { html += '<div class="chapter__stat"><span class="n">' + s.num + '</span><span class="l">' + s.label + '</span></div>'; });
      html += '</div>';
    }
    el.innerHTML = html;
    scroll.appendChild(el);
  });
}

function enterStory() {
  document.getElementById('story').classList.remove('hidden');
  document.getElementById('controls').classList.add('hidden');
  document.getElementById('ambient-stats').classList.add('hidden');
  document.getElementById('vignette').style.opacity = '1';

  const scroll = document.getElementById('story-scroll');
  scroll.scrollTop = 0;
  activeChapter = null;

  if (storyObserver) storyObserver.disconnect();
  storyObserver = new IntersectionObserver(onChapterIntersect, {
    root: scroll, rootMargin: '-45% 0px -45% 0px', threshold: 0,
  });
  document.querySelectorAll('.chapter').forEach(c => storyObserver.observe(c));

  // apply first chapter immediately
  applyChapter(0);
  const first = document.querySelector('.chapter');
  if (first) first.classList.add('active');
}

function exitStory() {
  document.getElementById('story').classList.add('hidden');
  document.getElementById('controls').classList.remove('hidden');
  document.getElementById('ambient-stats').classList.remove('hidden');
  if (storyObserver) { storyObserver.disconnect(); storyObserver = null; }
  stopFilm();
}

function onChapterIntersect(entries) {
  if (film.playing) return;
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      document.querySelectorAll('.chapter').forEach(c => c.classList.toggle('active', c === entry.target));
      applyChapter(Number(entry.target.dataset.index));
    }
  });
}

function applyChapter(index) {
  const ch = state.chapters[index];
  if (!ch || index === activeChapter) return;
  activeChapter = index;

  const cam = ch.camera || {};
  emphasize(ch.layer || 'heatmap');
  if (ch.layer === 'heatmap') {
    map.setPaintProperty('heat', 'heatmap-opacity',
      ['interpolate', ['linear'], ['zoom'], 2, 0.85, 13, 0.6, 15, 0.35]);
  }
  setTerrainOn((cam.pitch || 0) > 20);

  // progress bar
  const fill = document.getElementById('story-progress-fill');
  if (fill) fill.style.width = ((index) / Math.max(1, state.chapters.length - 1) * 100) + '%';

  map.flyTo({
    center: cam.center || CFG.home.center,
    zoom: cam.zoom != null ? cam.zoom : CFG.home.zoom,
    pitch: cam.pitch || 0,
    bearing: cam.bearing || 0,
    duration: 2600,
    essential: true,
    curve: 1.4,
  });
}

/* -----------------------------------------------------------
   Story — auto cinematic film
   ----------------------------------------------------------- */
const film = { playing: false, idx: 0, timer: null };

function toggleFilm() { if (film.playing) stopFilm(); else startFilm(); }

function startFilm() {
  film.playing = true;
  film.idx = 0;
  document.body.classList.add('cinema-mode');
  document.getElementById('cinema').classList.remove('hidden');
  filmStep();
}

function filmStep() {
  if (!film.playing) return;
  if (film.idx >= state.chapters.length) { stopFilm(); return; }
  const ch = state.chapters[film.idx];
  applyChapter(film.idx);

  const cinema = document.getElementById('cinema');
  cinema.classList.remove('show');
  document.getElementById('cinema-title').textContent = ch.title || '';
  document.getElementById('cinema-caption').textContent = ch.caption || '';
  setTimeout(() => cinema.classList.add('show'), 400);

  // slow orbit for globe chapters
  if (ch.globe) {
    setTimeout(() => { if (film.playing) map.easeTo({ bearing: (ch.camera.bearing || 0) + 25, duration: 6000, easing: t => t }); }, 800);
  }

  film.idx++;
  film.timer = setTimeout(filmStep, 7000);
}

function stopFilm() {
  if (!film.playing && !document.body.classList.contains('cinema-mode')) return;
  film.playing = false;
  if (film.timer) clearTimeout(film.timer);
  document.body.classList.remove('cinema-mode');
  document.getElementById('cinema').classList.remove('show');
  document.getElementById('cinema').classList.add('hidden');
}

/* -----------------------------------------------------------
   Poster — the whole decade as one geographic print
   ----------------------------------------------------------- */
function enterPoster() {
  const overlay = document.getElementById('poster-overlay');
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => requestAnimationFrame(renderPoster));
}

function renderPoster() {
  const cvs = document.getElementById('poster-canvas');
  const stage = document.getElementById('poster-stage');
  if (!cvs || !stage) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = stage.clientWidth, H = stage.clientHeight;
  if (W < 2 || H < 2) return;
  cvs.width = Math.round(W * dpr); cvs.height = Math.round(H * dpr);
  cvs.style.width = W + 'px'; cvs.style.height = H + 'px';
  const ctx = cvs.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

  const feats = state.segments.features;
  if (!feats.length) return;

  // bbox over all segments
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const f of feats) for (const c of f.geometry.coordinates) {
    if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0];
    if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1];
  }
  const lat0 = (y0 + y1) / 2, latf = Math.cos(lat0 * Math.PI / 180) || 1;
  const rx = (x1 - x0) * latf || 1e-4, ry = (y1 - y0) || 1e-4;
  const pad = Math.min(W, H) * 0.08;
  const s = Math.min((W - pad * 2) / rx, (H - pad * 2) / ry);
  const ox = (W - rx * s) / 2, oy = (H - ry * s) / 2;
  const proj = (c) => [ox + (c[0] - x0) * latf * s, oy + (y1 - c[1]) * s];

  const a = state.epochMin, span = state.epochMax - a;
  const stops = CFG.temporal;
  const colorAt = (epoch) => {
    const t = Math.max(0, Math.min(1, (epoch - a) / span));
    const seg = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
    return stops[seg + 1];
  };

  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'lighter';
  // Two passes: a soft wide glow, then a crisp core line — richer, more print-worthy.
  const passes = [
    { w: 2.4, a: 0.05 },
    { w: 0.85, a: 0.6 },
  ];
  for (const pass of passes) {
    for (const f of feats) {
      const coords = f.geometry.coordinates;
      if (coords.length < 2) continue;
      ctx.strokeStyle = colorAt(f.properties.epoch || a);
      ctx.globalAlpha = pass.a; ctx.lineWidth = pass.w;
      ctx.beginPath();
      for (let i = 0; i < coords.length; i++) {
        const p = proj(coords[i]);
        i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]);
      }
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

function downloadPoster() {
  const cvs = document.getElementById('poster-canvas');
  if (!cvs) return;
  const a = document.createElement('a');
  a.download = 'pattern-of-life.png';
  a.href = cvs.toDataURL('image/png');
  a.click();
}

/* -----------------------------------------------------------
   Utils
   ----------------------------------------------------------- */
function haversineKm(a, b) {
  const R = 6371, toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad, dLng = (b[0] - a[0]) * toRad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtYear(epoch) { return new Date(epoch * 1000).getFullYear(); }
function fmtFullDate(epoch) { const d = new Date(epoch * 1000); return MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
