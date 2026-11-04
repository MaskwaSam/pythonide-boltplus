// Execute the supplied ToyBox modules; do not infer wire formats from mocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../vendor/sphero/toybox.js', import.meta.url), 'utf8');
const anchor = 'let r,o,i,a,s;n.o=';
assert.equal(source.split(anchor).length, 2);
const context = { console, setTimeout, clearTimeout };
vm.runInNewContext(source.replace(anchor, 'globalThis.toyRequire=n;return;let r,o,i,a,s;n.o='), context);

test('actual display encoders use correct font, rotation, RGB and asset formats', () => {
  const commands = context.toyRequire(837), calls = [];
  const toy = { sendApiCommand: (...args) => calls.push(JSON.parse(JSON.stringify(args))) };
  commands['Set Display Color'].function.call(toy, 1, 2, 3, 17);
  assert.deepEqual(calls.pop(), [17, 21, 2, [1, 2, 3]]);
  for (const [font, byte] of [['font_1', 0], ['font_2', 1]]) {
    commands['Set Display Text'].function.call(toy, 'Hi', 1, 2, 3, 4, 5, 6, font, 17);
    assert.deepEqual(calls.pop(), [17, 21, 3, [72, 105, 0, 1, 2, 3, 4, 5, 6, 0, byte]]);
  }
  commands['Set Display Rotation'].function.call(toy, 'rotated_90', 17);
  assert.deepEqual(calls.pop(), [17, 21, 11, [1]]);
  commands['Set Animation Id And Looping'].function.call(toy, 1029, false, 17);
  assert.deepEqual(calls.pop(), [17, 21, 16, [0, 0, 4, 5, 0]]);
  commands['Clear Display'].function.call(toy, 17);
  assert.deepEqual(calls.pop(), [17, 21, 7, null]);
  commands['Set Display Live Sensor Data'].function.call(toy, 128, 17);
  assert.deepEqual(calls.pop(), [17, 21, 20, [0, 0, 0, 128]]);
});

test('actual BOLT+ v2 parser emits raw light without an isValid flag', () => {
  const SensorControl = context.toyRequire(902), handlers = new Map(), calls = [];
  const toy = {
    EVENT: { SENSOR_STREAMING_DATA_NOTIFY: 'data', RESPONSE: { SET_SENSOR_STREAMING_MASK: 'mask', SET_EXTENDED_SENSOR_STREAMING_MASK: 'extended' } },
    getSupportedCommands: () => ['setSensorStreamingMask'],
    on: (name, handler) => handlers.set(name, handler),
    setSensorStreamingMask: (...args) => calls.push(['mask', ...args]),
    setExtendedSensorStreamingMask: (...args) => calls.push(['extended', ...args])
  };
  const control = new SensorControl({ this: toy, supportedSensors: {
    AmbientLight: { key: 'ambientLight', sensors: { AmbientLight: { key: 'ambientLight', value: 262144, mask: 2, modifier: null } } }
  } });
  let packet;
  control.on(control.EVENT.DATA_READY, value => { packet = value; });
  control.enable(['AmbientLight']);
  assert.deepEqual(Array.from(control.getEnabledSensors()), ['AmbientLight']);
  assert.deepEqual(calls, [['mask', 0, 0, 0], ['extended', 262144], ['mask', 250, 0, 0]]);
  handlers.get('mask')({});
  handlers.get('extended')({});
  handlers.get('data')({ data: { sensorData: [0] } });
  assert.deepEqual(JSON.parse(JSON.stringify(packet)), { AmbientLight: { ambientLight: 0 } });
  control.disable(['AmbientLight']);
  assert.deepEqual(Array.from(control.getEnabledSensors()), []);
});
