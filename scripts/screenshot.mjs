// Headless screenshot each DynaLox dashboard at https://grafana.int.neumueller.net
// Logs into Grafana (basic auth), accepts self-signed cert, captures one
// PNG per dashboard, then checks for obvious empty-panel / error states.
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'fs';

const URL = 'https://grafana.int.neumueller.net';
const USER = 'admin';
const PASS = process.env.PASS;
const DASHBOARDS = [
  ['dynalox-energy-overview', 'Energy Overview'],
  ['dynalox-climate-environment', 'Climate Environment'],
  ['dynalox-lighting-controls', 'Lighting'],
  ['dynalox-miniserver-health', 'Miniserver Health'],
];

mkdirSync('/tmp/grafana-screenshots', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-certificate-errors'],
});
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1920, height: 2400 },
  httpCredentials: { username: USER, password: PASS },
});
const page = await ctx.newPage();
page.on('console', (msg) => {
  if (['error', 'warning'].includes(msg.type())) {
    console.error(`  [browser ${msg.type()}] ${msg.text().slice(0, 200)}`);
  }
});
page.on('pageerror', (e) => console.error('  [pageerror]', e.message));

const report = [];
for (const [uid, label] of DASHBOARDS) {
  const target = `${URL}/d/${uid}/${uid}?orgId=1&from=now-24h&to=now&kiosk=tv`;
  console.error(`>>> ${label}: ${target}`);
  try {
    await page.goto(target, { waitUntil: 'networkidle', timeout: 45000 });
  } catch (e) {
    console.error(`  navigate timeout: ${e.message}`);
  }
  // Give panels a chance to query and render.
  await page.waitForTimeout(12000);
  const outPath = `/tmp/grafana-screenshots/${uid}.png`;
  await page.screenshot({ path: outPath, fullPage: true });

  // Inspect DOM for "No data" / error indicators in panels.
  const stats = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      noData: (text.match(/No data/g) || []).length,
      panelErr: (text.match(/Panel error|status: 500|Query error/g) || []).length,
      datasourceErr: (text.match(/Datasource .* not found|Failed to fetch/g) || []).length,
    };
  });
  report.push({ uid, label, file: outPath, ...stats });
  console.error(`  noData=${stats.noData} panelErr=${stats.panelErr} dsErr=${stats.datasourceErr}`);
}
await browser.close();
console.log(JSON.stringify(report, null, 2));
