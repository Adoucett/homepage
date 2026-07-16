import { chromium } from 'playwright';

const URL = process.argv[2] || 'https://doucett-homepage.vercel.app/pages/geo/runmap_v2';
const OUT = process.argv[3] || '/tmp/runmap.png';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => console.log('goto:', e.message));
// wait for loading overlay to finish, then let the map settle
await page.waitForSelector('#loading.done', { timeout: 30000 }).catch(() => console.log('loading overlay did not reach done state'));
await page.waitForTimeout(6000);
await page.screenshot({ path: OUT });

const stats = await page.evaluate(() => ({
  miles: document.getElementById('stat-miles')?.textContent,
  count: document.getElementById('stat-count')?.textContent,
  range: document.getElementById('stat-range')?.textContent,
  chips: [...document.querySelectorAll('.type-chip')].map((c) => c.textContent.trim()),
}));
console.log('STATS', JSON.stringify(stats));
console.log('CONSOLE_ERRORS', errors.length, JSON.stringify(errors.slice(0, 8)));
await browser.close();
