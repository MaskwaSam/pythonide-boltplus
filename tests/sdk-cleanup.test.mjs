import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function transport({ delayedChooser = false, delayedConnect = false, delayedServices = false, delayedCharacteristics = false } = {}) {
  let disconnects = 0, connects = 0, finishChooser, finishConnect, finishServices, finishCharacteristics;
  let connectFailure = false;
  const listeners = new Map();
  const device = {
    id: 'test-device', name: 'BP-TEST',
    addEventListener(event, handler) { const list = listeners.get(event) || []; if (!list.includes(handler)) list.push(handler); listeners.set(event, list); },
    removeEventListener(event, handler) { listeners.set(event, (listeners.get(event) || []).filter(item => item !== handler)); },
    gatt: {
      connected: false,
      connect() {
        connects++;
        if (connectFailure) return Promise.reject(new Error('native connect failure'));
        const connected = () => { this.connected = true; return this; };
        return delayedConnect ? new Promise(resolve => { finishConnect = () => resolve(connected()); }) : Promise.resolve(connected());
      },
      disconnect() { disconnects++; this.connected = false; },
      getPrimaryServices: async () => delayedServices ? new Promise(resolve => { finishServices = () => resolve([service]); }) : delayedCharacteristics ? [service] : []
    }
  };
  const service = { uuid: 'SERVICE', device,
    getCharacteristics: async () => delayedCharacteristics ? new Promise(resolve => { finishCharacteristics = () => resolve([characteristic]); }) : []
  };
  const characteristic = { uuid: 'CHAR', service };
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
  const source = fs.readFileSync(process.env.SDK_CLEANUP_SOURCE || new URL('../vendor/sphero/sphero-sdk.js', import.meta.url), 'utf8');
  const entry = source.includes('var __webpack_exports__=__webpack_require__(9366)') ? 'var __webpack_exports__=__webpack_require__(9366)' : 'window.SpheroSDK = __webpack_require__(13357)';
  assert.equal(source.split(entry).length, 2, 'exactly one supported bundle entry');
  vm.runInNewContext(source.replace(entry, 'window.sdkRequire = __webpack_require__'), context);
  const require = context.window.sdkRequire;
  const adapter = require(6490)();
  const constants = require(61757);
  return {
    adapter, device,
    listenerCount: () => (listeners.get('gattserverdisconnected') || []).length,
    rejectConnect: enabled => { connectFailure = enabled; },
    deferServices: () => { delayedServices = true; },
    deferCharacteristics: () => { delayedCharacteristics = true; },
    servicesResult: () => finishServices,
    characteristicsResult: () => finishCharacteristics,
    connectOperation: () => adapter.performOperation({ opperation: constants.ENUM_PLATFORM_OP_BLE_CONNECT, deviceId: 1, opperationId: 'explicit-connect' }),
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


function trackOperations(adapter) {
  const events = [];
  for (const event of [adapter.EVENT.OPERATION_COMPLETE, adapter.EVENT.OPERATION_FAILED]) adapter.on(event, payload => events.push({ event, payload }));
  return events;
}
const explicitResults = events => events.filter(item => JSON.stringify(item.payload).includes('explicit-connect'));

test('explicit CONNECT cancelled at native connect settles promptly and closes late owned GATT', async () => {
  const t = transport();
  await t.adapter.init(); t.scan(); await tick();
  t.device.gatt.disconnect();
  // Start only the explicit reconnect with a held native promise.
  let finish;
  t.device.gatt.connect = () => new Promise(resolve => { finish = () => { t.device.gatt.connected = true; resolve(t.device.gatt); }; });
  const events = trackOperations(t.adapter);
  t.connectOperation(); await tick();
  t.adapter.destroy(); await tick();
  assert.equal(explicitResults(events).length, 1);
  assert.equal(explicitResults(events)[0].event, t.adapter.EVENT.OPERATION_FAILED);
  finish(); await tick();
  assert.equal(t.device.gatt.connected, false);
  assert.equal(t.listenerCount(), 0);
  assert.equal(explicitResults(events).length, 1);
});

test('late explicit CONNECT cannot close replacement adapter using the same device', async () => {
  const t = transport();
  await t.adapter.init(); t.scan(); await tick(); t.device.gatt.disconnect();
  const nativeConnect = t.device.gatt.connect.bind(t.device.gatt);
  let finish;
  t.device.gatt.connect = () => new Promise(resolve => { finish = () => { t.device.gatt.connected = true; resolve(t.device.gatt); }; });
  t.connectOperation(); await tick(); t.adapter.destroy();
  t.device.gatt.connect = nativeConnect;
  const replacement = t.newAdapter();
  await replacement.init(); t.scanWith(replacement); await tick();
  const before = t.counts().disconnects;
  finish(); await tick();
  assert.equal(t.device.gatt.connected, true);
  assert.equal(t.counts().disconnects, before);
  assert.equal(t.listenerCount(), 1);
  replacement.destroy();
});

test('destroy cancels explicit CONNECT retry timers and prevents subsequent native retries', async () => {
  const t = transport();
  await t.adapter.init(); t.scan(); await tick(); t.device.gatt.disconnect();
  t.rejectConnect(true);
  const events = trackOperations(t.adapter);
  t.connectOperation(); await tick();
  const before = t.counts().connects;
  t.adapter.destroy(); await tick();
  assert.equal(explicitResults(events).length, 1);
  assert.equal(explicitResults(events)[0].event, t.adapter.EVENT.OPERATION_FAILED);
  await new Promise(resolve => setTimeout(resolve, 2050));
  assert.equal(t.counts().connects, before);
});

for (const phase of ['Services', 'Characteristics']) {
  test(`destroy during deferred get${phase} produces no late discovery events or unhandled rejection`, async () => {
    const t = transport({ ['delayed' + phase]: true });
    const unhandled = [];
    const onUnhandled = error => unhandled.push(error);
    process.on('unhandledRejection', onUnhandled);
    try {
      const events = trackOperations(t.adapter);
      const found = [];
      t.adapter.on(t.adapter.EVENT.CHARACTERISTIC_FOUND, payload => found.push(payload));
      await t.adapter.init(); t.scan(); await tick();
      const finish = phase === 'Services' ? t.servicesResult() : t.characteristicsResult();
      assert.equal(typeof finish, 'function');
      t.adapter.destroy(); await tick();
      assert.equal(events.filter(item => item.event === t.adapter.EVENT.OPERATION_FAILED).length, 1);
      finish(); await tick();
      assert.equal(t.device.gatt.connected, false);
      assert.equal(t.listenerCount(), 0);
      assert.equal(found.length, 0);
      assert.equal(unhandled.length, 0);
      assert.equal(events.filter(item => item.event === t.adapter.EVENT.OPERATION_COMPLETE).length, 0);
    } finally { process.off('unhandledRejection', onUnhandled); }
  });
}


for (const phase of ['Services', 'Characteristics']) {
  test(`explicit CONNECT cancelled during deferred get${phase} cannot publish or rearm`, async () => {
    const t = transport();
    await t.adapter.init(); t.scan(); await tick();
    t.device.gatt.disconnect();
    t['defer' + phase]();
    const events = trackOperations(t.adapter);
    const found = [];
    t.adapter.on(t.adapter.EVENT.CHARACTERISTIC_FOUND, payload => found.push(payload));
    t.connectOperation(); await tick();
    const finish = phase === 'Services' ? t.servicesResult() : t.characteristicsResult();
    assert.equal(typeof finish, 'function');
    t.adapter.destroy(); await tick();
    assert.equal(explicitResults(events).length, 1);
    assert.equal(explicitResults(events)[0].event, t.adapter.EVENT.OPERATION_FAILED);
    finish(); await tick();
    assert.equal(t.device.gatt.connected, false);
    assert.equal(t.listenerCount(), 0);
    assert.equal(found.length, 0);
    assert.equal(explicitResults(events).length, 1);
  });
}
