'use strict';

/**
 * Nightly Strava sync (Vercel Cron).
 *
 * Pulls activities created since the last cursor via the Strava API, decodes
 * their summary polylines, and appends them to a small "live delta" blob
 * (strava/live.json) in Vercel Blob storage. The full 13-year history lives in
 * the static /data/json/strava/routes.geojson baseline; this function only ever
 * tacks on what is new, so writes stay in the KB range.
 *
 * Env required:
 *   STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN
 *   BLOB_READ_WRITE_TOKEN (auto-injected once a Blob store is linked)
 *   CRON_SECRET (auto-sent by Vercel Cron as `Authorization: Bearer <secret>`)
 */

const LIVE_PATH = 'strava/live.json';

// Anything at/after the baseline's latest activity. Overlap is harmless: the
// browser dedupes the merged set by activity id.
const BOOTSTRAP_AFTER = Math.floor(Date.parse('2026-03-06T00:00:00Z') / 1000);

// Strava sport_type -> display label used by the baseline data + map palette.
const SPORT_TYPE_MAP = {
  Run: 'Run', TrailRun: 'Trail Run',
  Ride: 'Ride', GravelRide: 'Gravel Ride', MountainBikeRide: 'Mountain Bike Ride', EBikeRide: 'E-Bike Ride',
  Walk: 'Walk', Hike: 'Hike',
  NordicSki: 'Nordic Ski', AlpineSki: 'Alpine Ski', BackcountrySki: 'Backcountry Ski', Snowshoe: 'Snowshoe',
  Swim: 'Swim', Rowing: 'Rowing', Kayaking: 'Kayaking', Canoeing: 'Canoeing', StandUpPaddling: 'Stand Up Paddling',
  InlineSkate: 'Inline Skate', IceSkate: 'Ice Skate', Skateboard: 'Skateboard',
};
const INCLUDE = new Set(Object.values(SPORT_TYPE_MAP));

function decodePolyline(str) {
  if (!str) return [];
  let index = 0, lat = 0, lng = 0;
  const coords = [];
  const factor = 1e5;
  while (index < str.length) {
    let shift = 0, result = 0, byte;
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    coords.push([lng / factor, lat / factor]);
  }
  return coords;
}

async function refreshAccessToken() {
  const r = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: process.env.STRAVA_REFRESH_TOKEN,
    }),
  });
  if (!r.ok) throw new Error('token refresh failed: ' + r.status + ' ' + (await r.text()));
  return (await r.json()).access_token;
}

async function loadLive(list) {
  try {
    const { blobs } = await list({ prefix: LIVE_PATH });
    const b = blobs.find((x) => x.pathname === LIVE_PATH);
    if (!b) return null;
    const r = await fetch(b.url, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

function activityToFeature(a) {
  const label = SPORT_TYPE_MAP[a.sport_type] || SPORT_TYPE_MAP[a.type];
  if (!label || !INCLUDE.has(label)) return null;
  if (/virtual/i.test(a.sport_type || '') || /virtual/i.test(a.type || '')) return null;
  const poly = a.map && a.map.summary_polyline;
  const coords = decodePolyline(poly);
  if (coords.length < 2) return null;
  const epoch = Math.floor(new Date(a.start_date).getTime() / 1000);
  return {
    type: 'Feature',
    properties: {
      id: String(a.id),
      date: (a.start_date_local || a.start_date || '').replace('Z', ''),
      date_epoch: epoch,
      activity_type: label,
      name: a.name || '',
      distance_miles: a.distance ? Math.round(a.distance * 0.000621371 * 100) / 100 : null,
      duration_minutes: a.moving_time ? Math.round((a.moving_time / 60) * 10) / 10 : null,
    },
    geometry: { type: 'LineString', coordinates: coords },
  };
}

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!process.env.STRAVA_REFRESH_TOKEN) {
    return res.status(500).json({ error: 'STRAVA_REFRESH_TOKEN not configured' });
  }

  try {
    const { put, list } = await import('@vercel/blob');

    const existing = await loadLive(list);
    const features = existing && Array.isArray(existing.features) ? existing.features : [];
    const haveIds = new Set(features.map((f) => String(f.properties.id)));
    let cursor = (existing && existing.cursor) || BOOTSTRAP_AFTER;

    const token = await refreshAccessToken();

    let page = 1, added = 0, scanned = 0, maxEpoch = cursor;
    while (page <= 20) {
      const url = `https://www.strava.com/api/v3/athlete/activities?after=${cursor}&per_page=200&page=${page}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 429) return res.status(429).json({ error: 'strava rate limited' });
      if (!r.ok) throw new Error('activities fetch failed: ' + r.status + ' ' + (await r.text()));
      const batch = await r.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      scanned += batch.length;
      for (const a of batch) {
        const epoch = Math.floor(new Date(a.start_date).getTime() / 1000);
        if (epoch > maxEpoch) maxEpoch = epoch;
        const feat = activityToFeature(a);
        if (!feat) continue;
        if (haveIds.has(feat.properties.id)) continue;
        features.push(feat);
        haveIds.add(feat.properties.id);
        added++;
      }
      if (batch.length < 200) break;
      page++;
    }

    features.sort((a, b) => (a.properties.date_epoch || 0) - (b.properties.date_epoch || 0));

    const payload = {
      type: 'FeatureCollection',
      cursor: maxEpoch,
      generated: new Date().toISOString(),
      count: features.length,
      features,
    };
    await put(LIVE_PATH, JSON.stringify(payload), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });

    return res.status(200).json({ ok: true, scanned, added, total: features.length, cursor: maxEpoch });
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
};
