import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../bolt-course-api.js', import.meta.url), 'utf8');
class Events {
  constructor() { this.handlers = new Map(); }
  on(event, handler) { if (!this.handlers.has(event)) this.handlers.set(event, new Set()); this.handlers.get(event).add(handler); }
  off(event, handler) { this.handlers.get(event)?.delete(handler); }
  emit(event, data) { for (const handler of this.handlers.get(event) || []) handler(data); }
  count() { return [...this.handlers.values()].reduce((sum, handlers) => sum + handlers.size, 0); }
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(enabled = ['Locator']) {
  const calls = [], sensor = new Events(), toy = new Events();
  sensor.EVENT = { DATA_READY: 'sensor control data ready' };
  sensor.getEnabledSensors = async () => [...enabled];
  sensor.enable = async names => { calls.push(['enable', ...names]); };
  sensor.disable = async names => { calls.push(['disable', ...names]); };
  toy.sensorControl = sensor;
  toy.EVENT = { REACHED_END_DRIVE_TO_DISTANCE_ASYNC: 'distance end', RESPONSE: { DRIVE_DISTANCE_AT_YAW_NORMALIZED: 'distance response' } };
  toy.hasCommand = name => ['setDisplayText', 'driveDistanceAtYawNormalized'].includes(name);
  toy.driveControl = {
    setHeading: async value => calls.push(['heading', value]),
    rollStop: async value => calls.push(['stop', value])
  };
  toy.setDisplayText = async (...args) => calls.push(['display', ...args]);
  toy.driveDistanceAtYawNormalized = async (...args) => calls.push(['distance', ...args]);
  const connection = { sdk: {}, toy, heading: 0, lastColor: [0, 0, 0], requireToy() { return this.toy; },
    async command(operation, sdk, target) { assert.equal(sdk, this.sdk); assert.equal(target, this.toy); return operation(target); },
    writeColor(target, ...rgb) { assert.equal(target, toy); calls.push(['color', ...rgb]); }
  };
  const context = { window: {}, AbortController, setTimeout, clearTimeout };
  vm.runInNewContext(source, context);
  const api = new context.window.BoltCourseApi(connection, { sensorTimeoutMs: 30, motionTimeoutMs: 30, cleanupTimeoutMs: 10 });
  return { calls, sensor, toy, connection, api };
}
const data = value => ({ AmbientLight: { ambientLight: value, isValid: true } });

test('heading, stop, LED and display use exact SDK arguments', async () => {
  const f = fixture();
  await f.api.set_heading(90);
  await f.api.stop_roll();
  await f.api.set_main_led([25, 0, 255]);
  await f.api.set_display_text('Hi\\nBOLT', [1, 2, 3], [4, 5, 6], 0);
  assert.deepEqual(f.calls, [['heading', 90], ['stop', 90], ['color', 25, 0, 255], ['display', 'Hi\nBOLT', 1, 2, 3, 4, 5, 6, 'font_1']]);
  assert.deepEqual(Array.from(f.connection.lastColor), [25, 0, 255]);
  await assert.rejects(f.api.set_heading(360), /Heading/);
  await assert.rejects(f.api.set_heading(359.5), /Heading/);
  await assert.rejects(f.api.set_main_led([1.5, 2, 3]), /RGB/);
  await assert.rejects(f.api.set_display_text('x', [1, 2, 3], [4, 5, 6], 3), /font/);
});

test('ambient light stops first and awaits a fresh valid raw packet', async () => {
  const f = fixture();
  f.sensor.emit(f.sensor.EVENT.DATA_READY, data(999));
  let done = false;
  const reading = f.api.get_ambient_light().then(value => { done = true; return value; });
  await tick();
  assert.deepEqual(f.calls, [['stop', 0], ['enable', 'AmbientLight']]);
  for (const packet of [{}, { AmbientLight: { ambientLight: 22, isValid: false } }, data(NaN), data(-1)]) f.sensor.emit(f.sensor.EVENT.DATA_READY, packet);
  await tick();
  assert.equal(done, false);
  f.sensor.emit(f.sensor.EVENT.DATA_READY, data(1234.5));
  assert.equal(await reading, 1234.5);
  assert.equal(f.sensor.count(), 0);
  assert.deepEqual(f.calls.at(-1), ['disable', 'AmbientLight']);
  assert.equal(f.api.operations.size, 0);
});

test('BOLT+ light field works and preserves an existing ambient stream', async () => {
  const f = fixture(['Locator', 'AmbientLight']);
  const pending = f.api.get_ambient_light();
  await tick();
  f.sensor.emit(f.sensor.EVENT.DATA_READY, { AmbientLight: { light: 0, isValid: true } });
  assert.equal(await pending, 0);
  assert.equal(f.calls.some(call => call[0] === 'disable'), false);
});

test('ambient timeout and abort release listeners and owned stream only', async () => {
  for (const abort of [false, true]) {
    const f = fixture(), controller = new AbortController();
    const pending = f.api.get_ambient_light({ signal: controller.signal });
    const rejection = assert.rejects(pending, abort ? { name: 'AbortError' } : /fresh valid/);
    await tick();
    if (abort) controller.abort();
    await rejection;
    assert.equal(f.sensor.count(), 0);
    assert.deepEqual(f.calls.at(-1), ['disable', 'AmbientLight']);
    assert.equal(f.api.operations.size, 0);
  }
});

test('late old stream initialization cleans only its captured toy after cancellation', async () => {
  const f = fixture(), start = deferred();
  f.sensor.enable = names => { f.calls.push(['enable', ...names]); return start.promise; };
  const pending = f.api.get_ambient_light();
  const rejection = assert.rejects(pending, { name: 'AbortError' });
  await tick();
  f.api.cancelAll('Run stopped.');
  f.connection.sdk = {};
  f.connection.toy = { sensorControl: { disable() { assert.fail('replacement touched'); } } };
  start.resolve();
  await rejection;
  assert.equal(f.sensor.count(), 0);
  assert.deepEqual(f.calls.at(-1), ['disable', 'AmbientLight']);
});

test('overlapping ambient reads retain their shared stream until both finish', async () => {
  const f = fixture(), controller = new AbortController();
  const first = f.api.get_ambient_light({ signal: controller.signal });
  const rejected = assert.rejects(first, { name: 'AbortError' });
  const second = f.api.get_ambient_light();
  await tick();
  controller.abort();
  await rejected;
  assert.equal(f.calls.some(call => call[0] === 'disable'), false);
  f.sensor.emit(f.sensor.EVENT.DATA_READY, data(44));
  assert.equal(await second, 44);
  assert.equal(f.calls.filter(call => call[0] === 'disable').length, 1);
});

test('distance uses native negative yaw, raw speed 25, centimetres converted once, and actual completion', async () => {
  const f = fixture();
  let done = false;
  const pending = f.api.roll_to_distance(90, 25, 100).then(() => { done = true; });
  await tick();
  assert.deepEqual(f.calls[0], ['distance', -90, 25, 1]);
  assert.equal(done, false);
  f.toy.emit('distance response', { success: true });
  await tick();
  assert.equal(done, false);
  f.toy.emit('distance end', { success: true, data: { success: true } });
  await pending;
  assert.equal(f.connection.heading, 90);
  assert.deepEqual(f.calls.at(-1), ['stop', 90]);
  assert.equal(f.toy.count(), 0);
});

test('distance error, timeout, abort and replacement cleanup always stop the captured toy', async () => {
  for (const mode of ['response', 'end', 'timeout', 'abort']) {
    const f = fixture();
    const pending = f.api.roll_to_distance(270, 25, 500);
    const rejected = assert.rejects(pending);
    await tick();
    if (mode === 'response') f.toy.emit('distance response', { success: false });
    if (mode === 'end') f.toy.emit('distance end', { success: true, data: { success: false } });
    if (mode === 'abort') {
      f.api.cancelAll();
      f.connection.sdk = {};
      f.connection.toy = { driveControl: { rollStop() { assert.fail('replacement touched'); } } };
    }
    await rejected;
    assert.deepEqual(f.calls.at(-1), ['stop', 270]);
    assert.equal(f.toy.count(), 0);
  }
});

test('zero distance stops without moving, invalid input and pre-abort dispatch nothing', async () => {
  const f = fixture();
  await f.api.roll_to_distance(10, 0, 0);
  assert.deepEqual(f.calls, [['stop', 10]]);
  f.calls.length = 0;
  await assert.rejects(f.api.roll_to_distance(10, 0, 1), /nonzero speed/);
  await assert.rejects(f.api.roll_to_distance(10, 256, 1), /Raw speed/);
  await assert.rejects(f.api.roll_to_distance(10, 25, -1), /nonnegative/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.api.get_ambient_light({ signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(f.calls, []);
});

 test('unsupported and failed stream initialization preserve healthy connection', async () => {
  const f = fixture();
  f.sensor.enable = async () => { throw new Error('Unsupported sensor'); };
  const sdk = f.connection.sdk;
  await assert.rejects(f.api.get_ambient_light(), /Unsupported sensor/);
  assert.equal(f.connection.sdk, sdk);
  assert.equal(f.sensor.count(), 0);
  assert.deepEqual(f.calls.at(-1), ['disable', 'AmbientLight']);
  f.toy.hasCommand = () => false;
  await assert.rejects(f.api.set_display_text('x', [0, 0, 0], [0, 0, 0], 0), /not supported/);
  await assert.rejects(f.api.roll_to_distance(0, 25, 1), /not supported/);
  assert.equal(f.toy.count(), 0);
  assert.equal(f.connection.sdk, sdk);
});

test('distance listeners exist before dispatch, and concurrent moves are rejected', async () => {
  const f = fixture();
  f.toy.driveDistanceAtYawNormalized = async () => {
    assert.equal(f.toy.count(), 2);
    f.toy.emit('distance end', { success: true, data: { success: true } });
    f.toy.emit('distance response', { success: true });
  };
  const pending = f.api.roll_to_distance(0, 25, 10);
  await assert.rejects(f.api.roll_to_distance(0, 25, 10), /already running/);
  await pending;
  assert.equal(f.toy.count(), 0);
});


test('both actual acknowledgement and native completion are required in either order', async () => {
  const f = fixture();
  let done = false;
  const pending = f.api.roll_to_distance(90, 25, 100).then(() => { done = true; });
  await tick();
  f.toy.emit('distance end', { success: true, data: { success: true } });
  await tick();
  assert.equal(done, false);
  f.toy.emit('distance response', { success: true });
  await pending;
  const next = f.api.roll_to_distance(90, 25, 100);
  await tick();
  f.toy.emit('distance response', { success: true });
  f.toy.emit('distance end', { success: true, data: { success: true } });
  await next;
  assert.equal(f.calls.filter(call => call[0] === 'distance').length, 2);
});

test('aborted or timed out distance sessions reject reuse even if old completion arrives', async () => {
  for (const mode of ['abort', 'timeout', 'response']) {
    const f = fixture();
    const first = f.api.roll_to_distance(0, 25, 100);
    const rejected = assert.rejects(first);
    await tick();
    if (mode === 'abort') await f.api.cancelAll();
    if (mode === 'response') f.toy.emit('distance response', { success: false });
    await rejected;
    const next = f.api.roll_to_distance(90, 25, 100);
    f.toy.emit('distance end', { success: true, data: { success: true } });
    await assert.rejects(next, /Reconnect BOLT\+ before/);
    assert.equal(f.calls.filter(call => call[0] === 'distance').length, 1);
    assert.equal(f.toy.count(), 0);
  }
});

test('cancelAll and drain settle only after captured cleanup finishes', async () => {
  const f = fixture(), cleanup = deferred();
  f.sensor.disable = () => cleanup.promise;
  const pending = f.api.get_ambient_light();
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await tick();
  let cancelled = false, drained = false;
  const cancelling = f.api.cancelAll().then(() => { cancelled = true; });
  const draining = f.api.drain().then(() => { drained = true; });
  await tick();
  assert.equal(cancelled, false);
  assert.equal(drained, false);
  cleanup.resolve();
  await Promise.all([cancelling, draining, rejected]);
  assert.equal(f.api.operations.size, 0);
});

test('failed stop rejects success, preserves primary failures, and blocks later movement', async () => {
  for (const failCommand of [false, true]) {
    const f = fixture();
    f.toy.driveControl.rollStop = async () => { throw new Error('stop broken'); };
    const pending = f.api.roll_to_distance(0, 25, 100);
    const rejected = assert.rejects(pending, failCommand ? /rejected.*Stop failed: stop broken/ : /could not stop: stop broken/);
    await tick();
    f.toy.emit('distance response', { success: !failCommand });
    if (!failCommand) f.toy.emit('distance end', { success: true, data: { success: true } });
    await rejected;
    await assert.rejects(f.api.roll_to_distance(90, 25, 10), /Reconnect/);
  }
});

test('float32 limits and invalid font values reject invalid values without dispatch', async () => {
  const f = fixture();
  await assert.rejects(f.api.roll_to_distance(0, 25, Number.MAX_VALUE), /float32/);
  await assert.rejects(f.api.roll_to_distance(0, 25, Number.MIN_VALUE), /float32/);
  for (const font of [2, '0', null, true]) await assert.rejects(f.api.set_display_text('x', [0, 0, 0], [0, 0, 0], font), /numeric 0 or 1/);
  assert.deepEqual(f.calls, []);
});


test('cancellation while reading sensor configuration never enables a retired stream', async () => {
  for (const replace of [false, true]) {
    const f = fixture(), configuration = deferred();
    f.sensor.getEnabledSensors = () => configuration.promise;
    const pending = f.api.get_ambient_light();
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await tick();
    const cancelled = f.api.cancelAll();
    if (replace) { f.connection.sdk = {}; f.connection.toy = {}; }
    configuration.resolve(['Locator']);
    await Promise.all([cancelled, rejected]);
    assert.deepEqual(f.calls, [['stop', 0]]);
    assert.equal(f.sensor.count(), 0);
  }
});

test('configuration shared with a surviving reader may still enable the sensor', async () => {
  const f = fixture(), configuration = deferred(), controller = new AbortController();
  f.sensor.getEnabledSensors = () => configuration.promise;
  const first = f.api.get_ambient_light({ signal: controller.signal });
  const rejected = assert.rejects(first, { name: 'AbortError' });
  const second = f.api.get_ambient_light();
  await tick();
  controller.abort();
  await rejected;
  configuration.resolve(['Locator']);
  await tick();
  f.sensor.emit(f.sensor.EVENT.DATA_READY, data(88));
  assert.equal(await second, 88);
  assert.equal(f.calls.filter(call => call[0] === 'enable').length, 1);
  assert.equal(f.calls.filter(call => call[0] === 'disable').length, 1);
});


test('a new ambient lease waits for old disable cleanup before enabling again', async () => {
  const f = fixture(), disable = deferred();
  f.sensor.disable = names => { f.calls.push(['disable', ...names]); return disable.promise; };
  const first = f.api.get_ambient_light();
  await tick();
  f.sensor.emit(f.sensor.EVENT.DATA_READY, data(1));
  await tick();
  const second = f.api.get_ambient_light();
  await tick();
  assert.equal(f.calls.filter(call => call[0] === 'enable').length, 1);
  disable.resolve();
  assert.equal(await first, 1);
  await tick();
  assert.equal(f.calls.filter(call => call[0] === 'enable').length, 2);
  f.sensor.emit(f.sensor.EVENT.DATA_READY, data(2));
  assert.equal(await second, 2);
});

test('a reconnected SDK may drive after the previous session was quarantined', async () => {
  const f = fixture();
  const first = f.api.roll_to_distance(0, 25, 100);
  const rejected = assert.rejects(first, { name: 'AbortError' });
  await tick();
  await f.api.cancelAll();
  await rejected;
  f.connection.sdk = {};
  const next = f.api.roll_to_distance(90, 25, 100);
  await tick();
  f.toy.emit('distance response', { success: true });
  f.toy.emit('distance end', { success: true, data: { success: true } });
  await next;
  assert.equal(f.calls.filter(call => call[0] === 'distance').length, 2);
});


test('quarantine blocks heading and legacy movement checks but always permits manual stop', async () => {
  const f = fixture();
  const pending = f.api.roll_to_distance(0, 25, 100);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await tick();
  await f.api.cancelAll();
  await rejected;
  assert.throws(() => f.api.assertMovementReady(), /Reconnect BOLT\+ before moving/);
  await assert.rejects(f.api.set_heading(90), /Reconnect BOLT\+ before moving/);
  await f.api.stop_roll(45);
  assert.deepEqual(f.calls.at(-1), ['stop', 45]);
  const replacement = fixture();
  f.connection.sdk = replacement.connection.sdk;
  f.connection.toy = replacement.toy;
  f.api.assertMovementReady();
  await f.api.set_heading(90);
  assert.deepEqual(replacement.calls.at(-1), ['heading', 90]);
});

test('real BOLT+ packet without isValid returns light, including zero', async () => {
  for (const value of [0, 312.5]) {
    const f = fixture();
    const pending = f.api.get_ambient_light();
    await tick();
    f.sensor.emit(f.sensor.EVENT.DATA_READY, { AmbientLight: { ambientLight: value } });
    assert.equal(await pending, value);
    assert.equal(f.sensor.count(), 0);
    assert.deepEqual(f.calls.at(-1), ['disable', 'AmbientLight']);
  }
});

test('LCD commands map colors, both fonts, rotation enums, masks and asset IDs', async () => {
  const f = fixture();
  f.toy.hasCommand = () => true;
  for (const method of ['setDisplayColor', 'clearDisplay', 'setDisplayRotation', 'setDisplayLiveSensorData', 'setAnimationIdAndLooping']) {
    f.toy[method] = async (...args) => f.calls.push([method, ...args]);
  }
  await f.api.set_display_color([0, 255, 0]);
  await f.api.set_display_text('Hello\nBOLT+', [255, 255, 255], [0, 0, 0], 1);
  await f.api.set_display_rotation(90);
  await f.api.set_live_sensor_data(16);
  await f.api.set_display_image(642);
  await f.api.set_display_animation(1029, true);
  await f.api.clear_display();
  assert.deepEqual(f.calls, [
    ['setDisplayColor', 0, 255, 0], ['display', 'Hello\nBOLT+', 255, 255, 255, 0, 0, 0, 'font_2'],
    ['setDisplayRotation', 'rotated_90'], ['setDisplayLiveSensorData', 16],
    ['setAnimationIdAndLooping', 642, false], ['setAnimationIdAndLooping', 1029, true], ['clearDisplay']
  ]);
  assert.throws(() => f.api.set_display_rotation(45), /rotation/);
  assert.throws(() => f.api.set_live_sensor_data(true), /mask/);
  await assert.rejects(f.api.set_display_image(-1), /asset ID/);
  f.toy.hasCommand = () => false;
  await assert.rejects(f.api.set_display_color([0, 0, 0]), /not supported/);
});

test('sensor dictionaries are fresh, preserve raw units, and clean independent leases', async () => {
  const f = fixture([]);
  const light = f.api.get_ambient_light();
  const gyro = f.api.get_sensor_data('gyroscope');
  await tick();
  f.sensor.emit(f.sensor.EVENT.DATA_READY, { AmbientLight: { ambientLight: 4 }, Gyroscope: { x: 1, y: NaN, z: 3 } });
  assert.equal(await light, 4);
  assert.equal(f.sensor.count(), 1);
  f.sensor.emit(f.sensor.EVENT.DATA_READY, { Gyroscope: { x: 1, y: -2, z: 3 } });
  assert.deepEqual(JSON.parse(JSON.stringify(await gyro)), { x: 1, y: -2, z: 3 });
  assert.deepEqual(f.calls.filter(call => call[0] === 'disable'), [['disable', 'AmbientLight'], ['disable', 'Gyroscope']]);
  assert.equal(f.sensor.count(), 0);
  await assert.rejects(f.api.get_sensor_data('compass'), /Unsupported/);
  await assert.rejects(f.api.get_ambient_light({ timeoutMs: 0 }), /timeout/);
});

test('battery request listens before dispatch and requires actual response, not dispatch result', async () => {
  const f = fixture();
  f.toy.hasCommand = () => true;
  f.toy.EVENT.RESPONSE.GET_BATTERY_PERCENTAGE = 'battery';
  let finished = false;
  f.toy.getBatteryPercentage = async () => { assert.equal(f.toy.count(), 1); return 100; };
  const pending = f.api.get_battery_percentage().then(value => { finished = true; return value; });
  await tick();
  assert.equal(finished, false);
  f.toy.emit('battery', { success: true, data: { percentage: 74 } });
  assert.equal(await pending, 74);
  assert.equal(f.toy.count(), 0);
});

test('BOLT+ front/back use centre LEDs and left/right use their two corner LEDs', async () => {
  const f = fixture();
  f.toy.LED = Object.fromEntries(['rearLeft', 'rearCenter', 'rearRight', 'frontRight', 'frontCenter', 'frontLeft']
    .flatMap((position, i) => ['Red', 'Green', 'Blue'].map((channel, j) => [position + channel, 1 << (i * 3 + j)])));
  f.toy.ledControl = { setLeds: async values => f.calls.push(['leds', JSON.parse(JSON.stringify(values))]) };
  for (const [group, positions] of Object.entries({ front: ['frontCenter'], back: ['rearCenter'], left: ['frontLeft', 'rearLeft'], right: ['frontRight', 'rearRight'] })) {
    await f.api.set_led(group, [10, 20, 30]);
    const expected = Object.fromEntries(positions.flatMap(position => ['Red', 'Green', 'Blue'].map((channel, i) => [f.toy.LED[position + channel], [10, 20, 30][i]])));
    assert.deepEqual(f.calls.at(-1), ['leds', expected]);
  }
  delete f.toy.LED.frontCenterBlue;
  await assert.rejects(f.api.set_led('front', [0, 0, 0]), /not supported/);
  assert.equal(f.calls.length, 4);
});

test('named image and animation assets resolve the complete library to firmware IDs', async () => {
  const f = fixture(), context = { window: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../display-library.js', import.meta.url), 'utf8'), context);
  // fixture's API reads its VM window; load the same catalogue in that realm.
  const calls = [];
  const runtime = { window: { BoltDisplayLibrary: context.window.BoltDisplayLibrary }, AbortController, setTimeout, clearTimeout };
  vm.runInNewContext(source, runtime);
  const api = new runtime.window.BoltCourseApi(f.connection);
  f.toy.hasCommand = () => true;
  f.toy.setAnimationIdAndLooping = async (...args) => calls.push(args);
  await api.set_display_image('cat');
  await api.set_display_image('angry');
  await api.set_display_animation('fireworks');
  assert.deepEqual(calls, [[642, false], [256, false], [1029, true]]);
  await api.set_display_image('random-emoji');
  assert.ok(context.window.BoltDisplayLibrary.images.filter(asset => asset.category === 'emoji' && Number.isInteger(asset.fwid)).some(asset => asset.fwid === calls.at(-1)[0]));
  assert.throws(() => api.set_display_image('fireworks'), /Unknown built-in image/);
  await assert.rejects(api.set_display_animation('cat'), /Unknown built-in animation/);
  await assert.rejects(api.set_display_animation('custom.gif'), /Custom GIF uploads/);
});

test('animation once waits for matching completion and abort cleans event subscriptions', async () => {
  for (const abort of [false, true]) {
    const f = fixture();
    f.toy.hasCommand = () => true;
    f.toy.EVENT.ANIMATION_COMPLETE_ASYNC = 'animation done';
    f.toy.enableAnimationCompleteAsyncs = async value => f.calls.push(['animation events', value]);
    f.toy.setAnimationIdAndLooping = async (...args) => f.calls.push(['animation', ...args]);
    let finished = false;
    const pending = f.api.set_display_animation(1029, false).then(() => { finished = true; });
    const rejected = abort ? assert.rejects(pending, { name: 'AbortError' }) : null;
    await tick();
    f.toy.emit('animation done', { success: true, data: { animationId: 642 } });
    await tick();
    assert.equal(finished, false);
    if (abort) await f.api.cancelAll();
    else f.toy.emit('animation done', { success: true, data: { animationId: 1029 } });
    if (abort) await rejected; else await pending;
    if (abort) {
      const retry = f.api.set_display_animation(1029, false);
      f.toy.emit('animation done', { success: true, data: { animationId: 1029 } });
      await assert.rejects(retry, /Reconnect BOLT\+/);
      assert.equal(f.calls.filter(call => call[0] === 'animation').length, 1);
    }
    assert.equal(f.toy.count(), 0);
    assert.deepEqual(f.calls.at(-1), ['animation events', false]);
  }
});
