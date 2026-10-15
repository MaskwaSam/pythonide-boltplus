// Run against the local project server; uses real Chrome + Pyodide and an explicit SDK mock.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const URL = process.env.IDE_TEST_URL || 'http://127.0.0.1:8765/python-ide.html';
const results = [];
let browser;
async function check(name, fn) {
  const start = Date.now();
  try { await fn(); results.push({ name, passed: true, ms: Date.now() - start }); }
  catch (error) { results.push({ name, passed: false, ms: Date.now() - start, error: error.message }); throw error; }
}
async function ready(page) {
  await page.waitForFunction(() => !document.querySelector('#run').disabled && document.querySelector('#status').textContent.startsWith('Ready'), null, { timeout: 60000 });
}
async function code(page, text) {
  await page.evaluate(text => {
    const editor = document.querySelector('.CodeMirror')?.CodeMirror;
    if (editor) editor.setValue(text);
    else { const input = document.querySelector('#code'); input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); }
  }, text);
}
async function readCode(page) {
  return page.evaluate(() => document.querySelector('.CodeMirror')?.CodeMirror.getValue() ?? document.querySelector('#code').value);
}
async function run(page, source) {
  if (source !== undefined) await code(page, source);
  await page.locator('#clear').click();
  await page.locator('#run').click();
  await ready(page);
  return page.locator('#out').innerText();
}
async function dot(page, state) {
  await page.waitForFunction(state => document.querySelector('#robotDot').className === state, state);
}
const MOCK_SDK = String.raw`
(() => {
  window.__mockCommands = [];
  window.__mockFailNext = false;
  window.__mockGateStop = false;
  window.__mockColorFailNext = false;
  class Emitter {
    constructor() { this.handlers = new Map(); }
    on(event, handler) { const list = this.handlers.get(event) || []; list.push(handler); this.handlers.set(event, list); }
    off(event, handler) { this.handlers.set(event, (this.handlers.get(event) || []).filter(item => item !== handler)); }
    emit(event, value) { for (const handler of this.handlers.get(event) || []) handler(value); }
  }
  function record(method, args = []) { window.__mockCommands.push({ method, args, time: performance.now() }); }
  window.SpheroSDK = () => {
    const sdk = new Emitter(), box = new Emitter();
    sdk.EVENT = { ERROR: 'error', OPERATION_FAILED: 'bluetooth operation failed', CONNECTION_FAILED: 'bluetooth connection failed', USER_CANCELLED: 'bluetooth user cancelled request devices' };
    box.EVENT = { TOY_READY: 'toy ready', READY_TOY_FAILED: 'ready toy failed', TOY_PUT_AWAY: 'toy put away' };
    const toy = Object.assign(new Emitter(), {
      getName: () => 'Mock BOLT+',
      hasCommand: method => ['getBatteryPercentage', 'ping'].includes(method),
      EVENT: { WILL_SLEEP_NOTIFY: 'will sleep', RESPONSE: { GET_BATTERY_PERCENTAGE: 'battery percentage' } },
      getBatteryPercentage: async () => {
        record('getBatteryPercentage');
        if (window.__mockBatteryTransportFailNext) {
          window.__mockBatteryTransportFailNext = false;
          throw new Error('Bluetooth device disconnected');
        }
        queueMicrotask(() => toy.emit(toy.EVENT.RESPONSE.GET_BATTERY_PERCENTAGE, { success: true, data: { percentage: 80 } }));
      },
      ping: async () => { record('ping'); },
      LED: Object.fromEntries(['rearLeft', 'rearCenter', 'rearRight', 'frontRight', 'frontCenter', 'frontLeft'].flatMap((position, i) => ['Red', 'Green', 'Blue'].map((channel, j) => [position + channel, 1 << (i * 3 + j)]))),
      ledControl: { setLeds: async values => {
        if (window.__mockColorFailNext) { window.__mockColorFailNext = false; throw new Error('Unsupported example command'); }
        record('setLeds', [values]);
      } },
      driveControl: {
        aimStart: async () => { record('aimStart'); },
        aimStop: async () => { record('aimStop'); },
        setHeading: async (...args) => { record('setHeading', args); },
        setStabilization: async (...args) => { record('setStabilization', args); },
        rollStart: async (...args) => { record('rollStart', args); },
        rollStop: async (...args) => {
          record('rollStop', args);
          if (window.__mockGateStop) await new Promise(resolve => { window.__mockReleaseStop = () => { window.__mockGateStop = false; resolve(); }; });
        }
      }
    });
    window.__mockSleepWarning = () => toy.emit(toy.EVENT.WILL_SLEEP_NOTIFY, {});
    sdk.toybox = box;
    sdk.init = async () => { record('init'); };
    sdk.destroy = async () => { record('destroy'); box.emit(box.EVENT.TOY_PUT_AWAY, { toy }); };
    box.readyToy = async prefix => {
      record('readyToy', [prefix]);
      await new Promise(resolve => setTimeout(resolve, 20));
      if (window.__mockFailNext) {
        window.__mockFailNext = false;
        sdk.emit(sdk.EVENT.USER_CANCELLED, new Error('Mock chooser cancelled'));
        return;
      }
      // The real SDK delivers an envelope, rather than a bare ToyProxy.
      box.emit(box.EVENT.TOY_READY, { toy });
    };
    window.__mockDrop = () => box.emit(box.EVENT.TOY_PUT_AWAY, { toy });
    return sdk;
  };
})();
`;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await check('real Pyodide loads in dedicated worker', async () => {
    await page.goto(URL);
    await ready(page);
    assert.match(await page.locator('#pyver').innerText(), /^Python 3\./i);
    assert.ok(page.workers().some(worker => worker.url().includes('python-worker')));
  });
  await check('ordinary input() waits for console reply and resumes', async () => {
    await page.locator('#run').click();
    await page.locator('#inputReply').waitFor({ state: 'visible', timeout: 15000 });
    assert.match(await page.locator('#inputPrompt').innerText(), /What is your name/);
    await page.locator('#inputReply').fill('Ada');
    await page.locator('#inputReply').press('Enter');
    await ready(page);
    assert.match(await page.locator('#out').innerText(), /Hello, Ada/);
    assert.equal(await page.locator('#inputForm').isVisible(), false);
  });
  await check('print and nested exception identify exact student line', async () => {
    const output = await run(page, 'print("printed first")\ndef broken():\n    return 1 / 0\nbroken()');
    assert.match(output, /printed first/);
    assert.match(output, /error on line 3/);
    assert.match(output, /ZeroDivisionError/);
    assert.doesNotMatch(output, /<ide-worker>/);
  });
  await check('top-level await starter reports disconnected robot cleanly', async () => {
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#starter').click();
    const output = await run(page);
    assert.match(output, /Hello, BOLT\+!/);
    assert.match(output, /Connect BOLT\+ before running robot commands/);
    assert.match(output, /error on line 9/);
    assert.doesNotMatch(output, /<ide-worker>/);
  });
  await check('Stop interrupts an infinite Python loop and reloads worker', async () => {
    await code(page, 'while True:\n    pass');
    await page.locator('#run').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'Running…');
    // The page event loop remains usable while the worker is busy.
    const start = Date.now();
    await page.locator('#stop').click({ timeout: 3000 });
    await page.waitForFunction(() => document.querySelector('#out').textContent.includes('Program stopped.'), null, { timeout: 3000 });
    assert.ok(Date.now() - start < 3000);
    await ready(page);
    assert.match(await run(page, 'print("after stop")'), /after stop/);
  });
  await check('custom source persists through reload and starter cancellation', async () => {
    const custom = '# preserved student code\nprint(42)';
    await code(page, custom);
    await page.locator('#file').fill('preserved.py');
    await page.locator('#file').dispatchEvent('input');
    await page.reload();
    await ready(page);
    assert.equal(await readCode(page), custom);
    assert.equal(await page.locator('#file').inputValue(), 'preserved.py');
    let sawDialog = false;
    page.once('dialog', async dialog => { sawDialog = true; await dialog.dismiss(); });
    await page.locator('#starter').click();
    assert.ok(sawDialog);
    assert.equal(await readCode(page), custom);
  });
  await check('small viewport has no horizontal document overflow', async () => {
    await page.setViewportSize({ width: 375, height: 760 });
    const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
    assert.ok(dimensions.scroll <= dimensions.width, JSON.stringify(dimensions));
    assert.deepEqual(errors, []);
  });
  await context.close();

  const mockContext = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await mockContext.addInitScript(() => { Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: {} }); });
  await mockContext.route('**/vendor/sphero/sphero-sdk.js', route => route.fulfill({ contentType: 'application/javascript', body: MOCK_SDK }));
  const robotPage = await mockContext.newPage();
  await robotPage.clock.install();
  const mockErrors = [];
  robotPage.on('pageerror', error => mockErrors.push(error.message));
  await robotPage.goto(URL);
  await ready(robotPage);
  await check('mock connection turns green only after live stop command; default gets starter', async () => {
    await robotPage.evaluate(() => { window.__mockGateStop = true; });
    await robotPage.locator('#bolt').click();
    await robotPage.waitForFunction(() => typeof window.__mockReleaseStop === 'function');
    assert.equal(await robotPage.locator('#robotDot').getAttribute('class'), 'connecting');
    await robotPage.evaluate(() => window.__mockReleaseStop());
    await dot(robotPage, 'connected');
    assert.match(await readCode(robotPage), /^# BOLT\+ starter/);
    assert.match(await robotPage.locator('#robotStatus').innerText(), /Mock BOLT\+ connected/);
    const commands = await robotPage.evaluate(() => window.__mockCommands);
    assert.deepEqual(commands.find(command => command.method === 'readyToy').args, ['BP-']);
    assert.ok(commands.some(command => command.method === 'rollStop'));
    await robotPage.locator('#boltAimDialog').waitFor({ state: 'visible' });
    await robotPage.setViewportSize({ width: 375, height: 760 });
    const aimBounds = await robotPage.locator('#boltAimDialog').boundingBox();
    assert.ok(aimBounds.width <= 375 && aimBounds.x >= 0, JSON.stringify(aimBounds));
    await robotPage.locator('#boltAimHeading').press('ArrowRight');
    await robotPage.locator('#boltAimRight').click();
    await robotPage.locator('#boltAimDone').click();
    await robotPage.locator('#boltAimDialog').waitFor({ state: 'hidden' });
    const aimed = await robotPage.evaluate(() => window.__mockCommands);
    assert.deepEqual(aimed.filter(command => command.method === 'setHeading').at(-1).args, [16]);
    assert.ok(aimed.some(command => command.method === 'aimStop'));
    assert.equal(aimed.filter(command => command.method === 'rollStart').length, 0);
    await robotPage.setViewportSize({ width: 1200, height: 800 });
  });
  await check('aim cancellation blocks Run until forward direction is confirmed again', async () => {
    await robotPage.locator('#boltAim').click();
    await robotPage.locator('#boltAimCancel').click();
    await robotPage.locator('#boltAimDialog').waitFor({ state: 'hidden' });
    await robotPage.locator('#clear').click();
    await robotPage.locator('#run').click();
    await robotPage.locator('#boltAimDialog').waitFor({ state: 'visible' });
    assert.doesNotMatch(await robotPage.locator('#out').innerText(), />>> Running/);
    await robotPage.locator('#boltAimDone').click();
    await robotPage.locator('#boltAimDialog').waitFor({ state: 'hidden' });
  });
  await check('mock bridge maps percent speed and stops after roll duration', async () => {
    await robotPage.evaluate(() => { window.__mockCommands.length = 0; });
    const output = await run(robotPage, 'from sphero import bolt\nawait bolt.set_color(10, 20, 30)\nawait bolt.roll(90, 50, 0.02)\nprint("robot complete")');
    assert.match(output, /robot complete/);
    const commands = await robotPage.evaluate(() => window.__mockCommands);
    const ledValues = commands.find(command => command.method === 'setLeds').args[0];
    assert.equal(Object.keys(ledValues).length, 18);
    for (let i = 0; i < 18; i++) assert.equal(ledValues[1 << i], [10, 20, 30][i % 3]);
    const startIndex = commands.findIndex(command => command.method === 'rollStart');
    assert.deepEqual(commands[startIndex].args, [90, 128]);
    assert.equal(commands[startIndex + 1].method, 'rollStop');
    assert.ok(commands[startIndex + 1].time >= commands[startIndex].time);
  });
  await check('async start_program runs and an unsupported command reports an error without disconnecting', async () => {
    await robotPage.evaluate(() => { window.__mockColorFailNext = true; });
    const failed = await run(robotPage, 'from sphero import bolt\nasync def start_program():\n    await bolt.set_color(1, 2, 3)');
    assert.match(failed, /Unsupported example command/);
    assert.match(failed, /error on line 3/);
    await dot(robotPage, 'connected');
    const output = await run(robotPage, 'from sphero import bolt\nasync def start_program():\n    await bolt.set_color(4, 5, 6)\n    print("start_program completed")');
    assert.match(output, /start_program completed/);
    await dot(robotPage, 'connected');
    await robotPage.evaluate(() => { window.__mockCommands.length = 0; });
    const explicit = await run(robotPage, 'from sphero import bolt\nasync def start_program():\n    await bolt.set_color(7, 8, 9)\nawait start_program()');
    assert.doesNotMatch(explicit, /Stopped with an error/);
    assert.equal(await robotPage.evaluate(() => window.__mockCommands.filter(command => command.method === 'setLeds').length), 1);
  });
  await check('mock reconnect preserves custom code; chooser cancellation stays grey and retries', async () => {
    const custom = '# robot student program\nprint("keep this")';
    await code(robotPage, custom);
    await robotPage.locator('#bolt').click();
    await dot(robotPage, '');
    assert.match(await robotPage.locator('#robotStatus').innerText(), /disconnected/);
    await robotPage.evaluate(() => { window.__mockFailNext = true; });
    await robotPage.locator('#bolt').click();
    await robotPage.waitForFunction(() => document.querySelector('#out').textContent.includes('Mock chooser cancelled'));
    await dot(robotPage, '');
    assert.equal(await readCode(robotPage), custom);
    await robotPage.locator('#bolt').click();
    await dot(robotPage, 'connected');
    await robotPage.locator('#boltAimDone').click();
    await robotPage.locator('#boltAimDialog').waitFor({ state: 'hidden' });
    assert.equal(await readCode(robotPage), custom);
    await robotPage.evaluate(() => window.__mockDrop());
    await dot(robotPage, '');
    assert.deepEqual(mockErrors, []);
  });
  await check('mock drop during a roll stops the program and reconnect never replays motion', async () => {
    await robotPage.locator('#bolt').click();
    await dot(robotPage, 'connected');
    await robotPage.locator('#boltAimDone').click();
    await robotPage.locator('#boltAimDialog').waitFor({ state: 'hidden' });
    await robotPage.evaluate(() => { window.__mockCommands.length = 0; });
    await code(robotPage, 'from sphero import bolt\nawait bolt.roll(0, 20, 30)\nprint("MUST_NOT_RESUME")');
    await robotPage.locator('#run').click();
    await robotPage.waitForFunction(() => window.__mockCommands.some(command => command.method === 'rollStart'));
    await robotPage.evaluate(() => window.__mockDrop());
    await dot(robotPage, '');
    await ready(robotPage);
    assert.match(await robotPage.locator('#out').innerText(), /BOLT\+ disconnected. Program stopped/);
    await robotPage.locator('#bolt').click();
    await dot(robotPage, 'connected');
    await robotPage.locator('#boltAimDone').click();
    await robotPage.locator('#boltAimDialog').waitFor({ state: 'hidden' });
    await robotPage.waitForTimeout(100);
    const starts = await robotPage.evaluate(() => window.__mockCommands.filter(command => command.method === 'rollStart'));
    assert.equal(starts.length, 1);
    assert.doesNotMatch(await robotPage.locator('#out').innerText(), /MUST_NOT_RESUME/);
    assert.deepEqual(mockErrors, []);
  });
  await check('mock idle connection polls battery, answers sleep warning, and stops maintenance on disconnect', async () => {
    const before = await robotPage.evaluate(() => window.__mockCommands.filter(command => command.method === 'getBatteryPercentage').length);
    assert.ok(before >= 1, 'battery monitoring starts when connected');
    await robotPage.clock.fastForward(10000);
    await robotPage.waitForFunction(before => window.__mockCommands.filter(command => command.method === 'getBatteryPercentage').length > before, before);
    await robotPage.evaluate(() => window.__mockSleepWarning());
    await robotPage.waitForFunction(() => window.__mockCommands.some(command => command.method === 'ping'));
    await dot(robotPage, 'connected');
    await robotPage.locator('#bolt').click();
    await dot(robotPage, '');
    const stopped = await robotPage.evaluate(() => window.__mockCommands.filter(command => ['getBatteryPercentage', 'ping'].includes(command.method)).length);
    await robotPage.evaluate(() => window.__mockSleepWarning());
    await robotPage.clock.fastForward(30000);
    assert.equal(await robotPage.evaluate(() => window.__mockCommands.filter(command => ['getBatteryPercentage', 'ping'].includes(command.method)).length), stopped);
    assert.deepEqual(mockErrors, []);
  });
  await check('initial maintenance transport failure never reports a successful connection', async () => {
    await robotPage.locator('#clear').click();
    await robotPage.evaluate(() => { window.__mockBatteryTransportFailNext = true; });
    await robotPage.locator('#bolt').click();
    await robotPage.waitForFunction(() => document.querySelector('#out').textContent.includes('disconnected while connecting'));
    await dot(robotPage, '');
    assert.doesNotMatch(await robotPage.locator('#out').innerText(), />>> BOLT\+ connected\./);
    assert.deepEqual(mockErrors, []);
  });
  await mockContext.close();
} catch (error) {
  if (!results.some(result => !result.passed)) results.push({ name: 'browser setup or teardown', passed: false, error: error.message });
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  console.log(JSON.stringify({ physicalRobotTested: false, results }, null, 2));
}
