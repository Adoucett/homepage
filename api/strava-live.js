'use strict';

/**
 * Public read endpoint for the Strava "live delta" blob.
 *
 * The run map fetches this to merge recent activities on top of the static
 * baseline. Responses are aggressively CDN-cached (the delta only changes once
 * a day), so the underlying function runs at most a handful of times per day
 * regardless of traffic. Returns an empty FeatureCollection when no delta
 * exists yet (e.g. before the first cron run, or on non-Vercel hosting).
 */

const LIVE_PATH = 'strava/live.json';
const EMPTY = { type: 'FeatureCollection', features: [] };

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=3600');
  try {
    const { list } = await import('@vercel/blob');
    const { blobs } = await list({ prefix: LIVE_PATH });
    const b = blobs.find((x) => x.pathname === LIVE_PATH);
    if (!b) return res.status(200).json(EMPTY);
    const r = await fetch(b.url, { cache: 'no-store' });
    if (!r.ok) return res.status(200).json(EMPTY);
    const data = await r.json();
    return res.status(200).json(data);
  } catch (e) {
    return res.status(200).json(EMPTY);
  }
};
