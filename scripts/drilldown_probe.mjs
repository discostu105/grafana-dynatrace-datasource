// Visit Grafana's drilldown apps, capture what datasources each one
// queries via /api/datasources and what the page renders.
import { chromium } from '@playwright/test';

const URL = 'https://grafana.int.neumueller.net';
const PASS = process.env.PASS;

const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-certificate-errors'],
});
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1920, height: 1080 },
});
const page = await ctx.newPage();

// Log in via session cookie (basicAuth headers don't satisfy the drilldown
// apps; they redirect anonymous viewers to Home).
await page.request.post(URL + '/login', {
  data: { user: 'admin', password: PASS },
  headers: { 'Content-Type': 'application/json' },
});

const apiCalls = [];
page.on('request', (req) => {
  const u = req.url();
  if (u.includes('/api/datasources') || u.includes('frontend/settings')) {
    apiCalls.push({
      method: req.method(),
      url: u.replace(URL, ''),
    });
  }
});
page.on('response', async (resp) => {
  const u = resp.url();
  if (u.includes('/api/datasources?') || u.endsWith('/api/datasources') || u.includes('frontend/settings')) {
    try {
      const body = await resp.text();
      const idx = apiCalls.length;
      apiCalls.push({
        status: resp.status(),
        url: u.replace(URL, ''),
        body: body.slice(0, 2000),
      });
    } catch {}
  }
});

for (const path of ['/a/grafana-lokiexplore-app']) {
  apiCalls.length = 0;
  console.log('\n=== ' + path + ' ===');
  try {
    await page.goto(URL + path, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    console.log('navigation:', e.message);
  }
  await page.waitForTimeout(6000);
  // Find the datasource picker and pull its option list
  const dsPicker = await page.evaluate(() => {
    // Grafana renders datasource pickers with the data-testid below
    const sel =
      document.querySelector('[data-testid="data testid Data source picker select container"]') ||
      document.querySelector('label:has(+ * input)') ||
      null;
    // Just dump the visible "Data source" area
    const label = Array.from(document.querySelectorAll('label')).find((l) => l.textContent === 'Data source');
    return label ? label.parentElement.parentElement.innerText.slice(0, 400) : null;
  });
  console.log('--- ds picker area ---');
  console.log(dsPicker);
  // Click the actual datasource select input to open the dropdown
  const sel = page.locator('input[id*="select"]').first();
  if (await sel.count()) {
    await sel.click({ delay: 100 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  const options = await page.evaluate(() => {
    const opts = Array.from(document.querySelectorAll('[role="option"], [aria-label="Select option"]'));
    return opts.map((o) => o.innerText.slice(0, 80));
  });
  console.log('--- options shown ---');
  for (const o of options.slice(0, 20)) console.log('  ', o);
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 300));
  console.log('--- visible top of page ---');
  console.log(bodyText);
  console.log('--- /api/datasources calls ---');
  for (const c of apiCalls) {
    if (c.url.includes('/api/datasources')) {
      console.log(`  [${c.status}] ${c.url}`);
      console.log('     body:', c.body.slice(0, 600));
    }
  }
}

await browser.close();
