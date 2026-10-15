// Browser-check the restored Moodle ZIP; no robot or uploaded Moodle is simulated as real.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const base = process.env.IDE_TEST_BASE || 'http://127.0.0.1:8765/verification/moodle-restored/';
const results = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const relative of ['index.html', 'pluginfile.php/123/mod_resource/content/1/index.html']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [], failedRequests = [], localRequests = [], loadedAssets = new Map();
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
    page.on('request', request => {
      if (request.url().startsWith(base)) localRequests.push(request.url());
    });
    page.on('response', response => {
      if (response.url().startsWith(base)) loadedAssets.set(new URL(response.url()).pathname.split('/').at(-1), response.status());
    });
    await page.goto(new URL(relative, base).href);
    await page.waitForFunction(() => typeof window.SpheroSDK === 'function' &&
      typeof bolt !== 'undefined' && !!bolt.sdk?.toybox &&
      !document.querySelector('#bolt').disabled && !document.querySelector('#run').disabled,
    null, { timeout: 60000 });
    assert.deepEqual(errors, []);
    assert.deepEqual(failedRequests, []);
    assert.ok(localRequests.every(url => !url.includes('/vendor/')), 'no vendor request needed');
    for (const name of ['python-worker.js', 'toybox.js', 'core-4.6.0.wasm']) {
      assert.equal(loadedAssets.get(name), 200, `${name} loads from restored ZIP`);
    }
    assert.equal(await page.locator('script[src]:not([src^="https://"])').count(), 0);
    assert.equal(await page.locator('#boltAim').count(), 1, 'aiming UI initialized');
    await page.locator('#run').click();
    await page.locator('#inputReply').waitFor({ state: 'visible' });
    await page.locator('#inputReply').fill('Moodle');
    await page.locator('#inputReply').press('Enter');
    await page.waitForFunction(() => document.querySelector('#out').textContent.includes('>>> Finished'));
    assert.match(await page.locator('#out').innerText(), /Hello, Moodle/);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#starter').click();
    const source = await page.evaluate(() => document.querySelector('.CodeMirror')?.CodeMirror.getValue() ?? document.querySelector('#code').value);
    assert.match(source, /async def start_program\(\):/);
    await page.locator('#clear').click();
    await page.locator('#run').click();
    await page.waitForFunction(() => document.querySelector('#out').textContent.includes('Connect BOLT+ before running robot commands'));
    assert.match(await page.locator('#out').innerText(), /Hello, BOLT\+!/);
    assert.doesNotMatch(await page.locator('#help').innerText(), /SDK.*(?:missing|could not load)/);
    assert.deepEqual(errors, []);
    assert.deepEqual(failedRequests, []);
    results.push({ path: relative, passed: true, realSdkAndWasm: true, realPythonAndInput: true,
      asyncStarterDispatched: true, localAssets: Object.fromEntries(loadedAssets), noVendorRequests: true });
    await context.close();
  }
  const path = new URL('../verification/moodle-package-check.json', import.meta.url);
  const record = JSON.parse(fs.readFileSync(path, 'utf8'));
  record.browserChecks = results;
  fs.writeFileSync(path, JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, physicalRobotTested: false, actualMoodleUploadTested: false, results }, null, 2));
} finally {
  await browser.close();
}
