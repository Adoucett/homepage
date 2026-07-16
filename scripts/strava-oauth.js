#!/usr/bin/env node
'use strict';

/**
 * One-time Strava OAuth helper.
 *
 * Run:  npm run strava:auth
 *
 * Reads STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET from .env, opens a local
 * callback server, prints an authorize URL. You click "Authorize" once in the
 * browser; this captures the code, exchanges it for a long-lived refresh token,
 * and writes STRAVA_REFRESH_TOKEN back into .env.
 *
 * The refresh token never expires (unless revoked) and auto-renews the short
 * access token every 6h, so this is genuinely a set-once step.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { exec } = require('child_process');

const ENV_PATH = path.join(__dirname, '..', '.env');
const PORT = 8721;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPE = 'activity:read_all';

function parseEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function upsertEnv(file, key, value) {
  let lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : [];
  let found = false;
  lines = lines.map((l) => {
    if (new RegExp(`^\\s*${key}\\s*=`).test(l)) { found = true; return `${key}=${value}`; }
    return l;
  });
  if (!found) lines.push(`${key}=${value}`);
  fs.writeFileSync(file, lines.join('\n').replace(/\n{3,}/g, '\n\n'));
}

const env = { ...parseEnv(ENV_PATH), ...process.env };
const CLIENT_ID = env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = env.STRAVA_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\n  Missing STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET in .env');
  console.error('  Create an app at https://www.strava.com/settings/api');
  console.error('  (set Authorization Callback Domain to: localhost)\n');
  process.exit(1);
}

const authorizeUrl =
  'https://www.strava.com/oauth/authorize?' +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: SCOPE,
  }).toString();

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/callback')) {
    res.writeHead(404).end();
    return;
  }
  const params = new URL(req.url, `http://localhost:${PORT}`).searchParams;
  const code = params.get('code');
  const err = params.get('error');
  if (err || !code) {
    res.writeHead(400, { 'Content-Type': 'text/html' }).end(`<h2>Authorization failed: ${err || 'no code'}</h2>`);
    console.error('\n  Authorization failed:', err || 'no code returned\n');
    server.close();
    process.exit(1);
  }

  try {
    const r = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
      }),
    });
    const data = await r.json();
    if (!r.ok || !data.refresh_token) throw new Error(JSON.stringify(data));

    upsertEnv(ENV_PATH, 'STRAVA_REFRESH_TOKEN', data.refresh_token);

    res.writeHead(200, { 'Content-Type': 'text/html' }).end(
      '<body style="font-family:system-ui;background:#0a0c10;color:#e8e4df;text-align:center;padding-top:80px">' +
      '<h2>Strava connected.</h2><p style="color:#8e99a8">Refresh token saved to .env. You can close this tab.</p></body>'
    );
    console.log('\n  Success. STRAVA_REFRESH_TOKEN written to .env');
    console.log('  Athlete:', data.athlete ? `${data.athlete.firstname} ${data.athlete.lastname}` : '(unknown)');
    console.log('  Scope granted:', SCOPE, '\n');
    server.close();
    process.exit(0);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/html' }).end('<h2>Token exchange failed</h2>');
    console.error('\n  Token exchange failed:', e.message, '\n');
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log('\n  Strava OAuth helper listening on ' + REDIRECT_URI);
  console.log('\n  Open this URL and click Authorize:\n');
  console.log('  ' + authorizeUrl + '\n');
  exec(`open "${authorizeUrl}"`, () => {});
});
