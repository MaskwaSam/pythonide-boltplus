import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const receiptPath = new URL('../verification/original-resource/package-check.json', import.meta.url);
const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
const origin = process.env.IDE_TEST_ORIGIN || 'http://127.0.0.1:8765';
const results = [];
let diagnostic;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const [layout, directory] of [['root', receipt.restored], ['moodle-path', receipt.nested]]) {
    const base = `${origin}/${path.relative(process.cwd(), directory).split(path.sep).join('/')}/`;
    const entry = base + 'index.html';
    const context = await browser.newContext();
    await context.addInitScript(() => {
      if (!sessionStorage.getItem('resource-regression-seeded')) {
        localStorage.setItem('resource-regression-preserve', 'existing-browser-data');
        sessionStorage.setItem('resource-regression-seeded', 'true');
      }
      window.__unregisteredResourceScopes = [];
      if (navigator.serviceWorker) navigator.serviceWorker.getRegistrations = async () => [
        new URL('./', location.href).href,
        new URL('./worker-subscope/', location.href).href,
        location.origin + '/unrelated-moodle-worker/'
      ].map(scope => ({ scope, unregister: async () => { window.__unregisteredResourceScopes.push(scope); return true; } }));
    });
    const page = await context.newPage();
    const errors = [], failures = [], responses = new Map();
    diagnostic = { layout, page, errors, failures };
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => { if (request.url().startsWith(base)) {
      failures.push(request.url());
      console.error(JSON.stringify({ layout, failedRequest: request.url(), reason: request.failure(), page: page.url() }));
    } });
    page.on('response', response => { if (response.url().startsWith(base)) responses.set(new URL(response.url()).pathname.slice(new URL(base).pathname.length), response.status()); });
    await page.goto(entry);
    await page.getByRole('button', { name: 'Create program', exact: true }).waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForLoadState('networkidle');
    if (await page.getByRole('button', { name: 'Close cookie notice', exact: true }).isVisible()) await page.getByRole('button', { name: 'Close cookie notice', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__SPHERO_RESOURCE_CONFIG__.version), receipt.version);
    assert.equal(await page.evaluate(() => localStorage.getItem('resource-regression-preserve')), 'existing-browser-data');
    const scopes = await page.evaluate(() => window.__unregisteredResourceScopes);
    assert.deepEqual([...new Set(scopes)].sort(), [base, base + 'worker-subscope/'].sort(), 'cleanup must leave unrelated site workers alone');
    const versioned = await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.getAttribute('src')).filter(src => src?.includes('?v=bolt-ev3-')));
    assert.ok(versioned.length >= 5 && versioned.every(src => src.endsWith(receipt.version)), 'fresh resource cache URLs');

    for (const ev3 of [false, true]) {
      const title = `${layout} ${ev3 ? 'EV3' : 'BOLT'} connection regression`;
      await page.getByRole('button', { name: 'Create program', exact: true }).click();
      await page.getByPlaceholder('Untitled Program', { exact: true }).fill(title);
      await page.getByRole('button', { name: 'Select program type', exact: true }).filter({ hasText: /^Text$/i }).click();
      if (ev3) {
        // The injected EV3 choice creates the named program and opens its editor.
        await page.getByRole('button', { name: 'LEGO EV3', exact: true }).click();
        await page.locator('#sphero-ev3-panel [data-ev3="prog-name"]').filter({ hasText: title }).waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(title => JSON.parse(localStorage.getItem('sphero.ev3.programs')).programs[title].mode, title), 'text');
      } else {
        if (!await page.getByRole('button', { name: /^Create$/i }).isEnabled()) {
          await page.getByRole('button', { name: 'Select robot', exact: true }).filter({ hasText: 'Sphero BOLT+' }).click();
        }
        await page.getByRole('button', { name: /^Create$/i }).click();
      }
      await page.waitForFunction(title => document.body.innerText.includes(title) || [...document.querySelectorAll('input')].some(input => input.value === title), title, { timeout: 15000 });
      if (ev3) assert.match(await page.locator('body').innerText(), /EV3/i);
      else assert.match(page.url(), /index\.html#\/editor\//, 'BOLT navigation remains inside the File resource');
      // Let editor assets finish before the test navigates away and cancels them.
      await page.waitForLoadState('networkidle');
      await page.goto(entry);
      await page.getByRole('button', { name: 'Create program', exact: true }).waitFor({ state: 'visible' });
      await page.waitForLoadState('networkidle');
      if (ev3) {
        await page.locator('.ev3-progs-name').filter({ hasText: title }).waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(title => JSON.parse(localStorage.getItem('sphero.ev3.programs')).programs[title].mode, title), 'text');
      } else await page.getByText(title, { exact: true }).waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(() => localStorage.getItem('resource-regression-preserve')), 'existing-browser-data');
    }
    for (const asset of ['resource-config.js', 'resource-bootstrap.js', 'local-patches.js', 'ev3-patches.js', 'static/js/main.55f08aa7.js', 'ev3/main.js']) {
      assert.equal(responses.get(asset), 200, asset);
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(failures, []);
    results.push({ layout, passed: true, release: receipt.version, boltTextProgramCreatedAndRetained: true,
      ev3TextProgramCreatedAndRetained: true, unrelatedServiceWorkersPreserved: true, localStoragePreserved: true,
      pageErrors: errors, failedLocalRequests: failures });
    await page.screenshot({ path: fileURLToPath(new URL(`../verification/original-resource/${layout}-preview.png`, import.meta.url)) });
    await context.close();
  }
  const latestReceipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  latestReceipt.browserChecks = results;
  fs.writeFileSync(receiptPath, JSON.stringify(latestReceipt, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, physicalDeviceTested: false, results }, null, 2));
} catch (error) {
  if (diagnostic && !diagnostic.page.isClosed()) {
    const { layout, page, errors, failures } = diagnostic;
    const prefix = fileURLToPath(new URL(`../verification/original-resource/${layout}-failure`, import.meta.url));
    await page.screenshot({ path: prefix + '.png' }).catch(() => {});
    fs.writeFileSync(prefix + '.json', JSON.stringify({
      error: error.message, url: page.url(), pageErrors: errors, failedLocalRequests: failures,
      buttons: await page.getByRole('button').evaluateAll(nodes => nodes.map(node => ({
        text: node.innerText, ariaLabel: node.getAttribute('aria-label'), disabled: node.disabled
      }))).catch(() => [])
    }, null, 2) + '\n');
    console.error(`Browser failure diagnostics: ${prefix}.{png,json}`);
  }
  throw error;
} finally {
  await browser.close();
}
