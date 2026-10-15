import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function transport({ delayedChooser = false, delayedConnect = false } = {}) {
  let disconnects = 0, connects = 0, finishChooser, finishConnect;
  const device = {
    id: 'test-device', name: 'BP-TEST', addEventListener() {}, removeEventListener() {},
    gatt: {
      connected: false,
      connect() {
        connects++;
        const connected = () => { this.connected = true; return this; };
        return delayedConnect ? new Promise(resolve => { finishConnect = () => resolve(connected()); }) : Promise.resolve(connected());
      },
      disconnect() { disconnects++; this.connected = false; },
      getPrimaryServices: async () => []
    }
  };
  const bluetooth = {
    addEventListener() {}, removeEventListener() {}, getAvailability: async () => true,
    requestDevice: async options => {
      assert.equal(options.filters[0].namePrefix, 'BP-');
      assert.ok(options.optionalServices.includes('00010001-574f-4f20-5370-6865726f2121'));
      return delayedChooser ? new Promise(resolve => { finishChooser = () => resolve(device); }) : device;
    }
  };
  const context = { window: {}, navigator: { bluetooth }, document: { baseURI: 'https://localhost/', currentScript: { src: 'https://localhost/vendor/sphero/sphero-sdk.js' } }, URL, Symbol, Object, Promise, setTimeout, clearTimeout, console };
  context.self = context.window;
  const source = fs.readFileSync(new URL('../vendor/sphero/sphero-sdk.js', import.meta.url), 'utf8');
  vm.runInNewContext(source.replace('window.SpheroSDK = __webpack_require__(13357)', 'window.sdkRequire = __webpack_require__'), context);
  const require = context.window.sdkRequire;
  const adapter = require(6490)();
  const constants = require(61757);
  return {
    adapter, device,
    newAdapter: () => require(6490)(),
    scanWith: instance => instance.performOperation({ opperation: constants.ENUM_PLATFORM_OP_BLE_STARTSCAN, filter: { parameters: { name: 'prefix', prefixes: 'BP-' } }, uuidFilterList: '00010001-574f-4f20-5370-6865726f2121' }),
    scan: () => adapter.performOperation({ opperation: constants.ENUM_PLATFORM_OP_BLE_STARTSCAN, filter: { parameters: { name: 'prefix', prefixes: 'BP-' } }, uuidFilterList: '00010001-574f-4f20-5370-6865726f2121' }),
    counts: () => ({ connects, disconnects }),
    choose: () => finishChooser(),
    connect: () => finishConnect(),
    chooserResult: () => finishChooser,
    connectResult: () => finishConnect
  };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

test('actual SDK WebBluetooth teardown closes the selected GATT device', async () => {
  const t = transport();
  await t.adapter.init(); t.scan(); await tick();
  assert.equal(t.device.gatt.connected, true);
  t.adapter.destroy();
  assert.equal(t.device.gatt.connected, false);
  assert.ok(t.counts().disconnects > 0);
});

test('actual SDK ignores chooser selection after teardown', async () => {
  const t = transport({ delayedChooser: true });
  await t.adapter.init(); t.scan(); await tick();
  t.adapter.destroy(); t.choose(); await tick();
  assert.equal(t.counts().connects, 0);
  assert.equal(t.device.gatt.connected, false);
});

test('actual SDK closes a GATT connection that resolves after teardown', async () => {
  const t = transport({ delayedConnect: true });
  await t.adapter.init(); t.scan(); await tick();
  t.adapter.destroy(); t.connect(); await tick();
  assert.equal(t.device.gatt.connected, false);
  assert.ok(t.counts().disconnects >= 2);
});

test('same adapter can initialize again without accepting an old chooser result', async () => {
  const t = transport({ delayedChooser: true });
  await t.adapter.init(); t.scan(); await tick();
  const oldChoose = t.chooserResult();
  t.adapter.destroy();
  await t.adapter.init(); t.scan(); await tick();
  const newChoose = t.chooserResult();
  oldChoose(); await tick();
  assert.equal(t.counts().connects, 0);
  newChoose(); await tick();
  assert.equal(t.counts().connects, 1);
  assert.equal(t.device.gatt.connected, true);
  t.adapter.destroy();
});

test('old chooser result cannot disconnect a newer SDK using the same device', async () => {
  const t = transport({ delayedChooser: true });
  await t.adapter.init(); t.scan(); await tick();
  const oldChoose = t.chooserResult();
  t.adapter.destroy();
  const replacement = t.newAdapter();
  await replacement.init(); t.scanWith(replacement); await tick();
  t.chooserResult()(); await tick();
  assert.equal(t.device.gatt.connected, true);
  const before = t.counts().disconnects;
  oldChoose(); await tick();
  assert.equal(t.device.gatt.connected, true);
  assert.equal(t.counts().disconnects, before);
  replacement.destroy();
});

test('late native connect cannot disconnect the replacement SDK session', async () => {
  const t = transport({ delayedConnect: true });
  await t.adapter.init(); t.scan(); await tick();
  const oldConnect = t.connectResult();
  t.adapter.destroy();
  const replacement = t.newAdapter();
  await replacement.init(); t.scanWith(replacement); await tick();
  const newConnect = t.connectResult();
  newConnect(); await tick();
  assert.equal(t.device.gatt.connected, true);
  const before = t.counts().disconnects;
  oldConnect(); await tick();
  assert.equal(t.device.gatt.connected, true);
  assert.equal(t.counts().disconnects, before);
  replacement.destroy();
});
