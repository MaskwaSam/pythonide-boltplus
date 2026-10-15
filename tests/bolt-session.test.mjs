import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../bolt-connection.js', import.meta.url), 'utf8');
const BASE_EVENTS = {
  ERROR: 'error', OPERATION_FAILED: 'bluetooth operation failed',
  CONNECTION_FAILED: 'bluetooth connection failed', USER_CANCELLED: 'bluetooth user cancelled request devices'
};
const TOY_EVENTS = {
  TOY_READY: 'toybox toy ready', READY_TOY_FAILED: 'toybox ready toy failed', TOY_PUT_AWAY: 'toybox toy put away'
};
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class Emitter {
  constructor(events) { this.EVENT = events; this.handlers = new Map(); }
  on(event, handler) {
    const handlers = this.handlers.get(event) || [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
  }
  off(event, handler) { this.handlers.set(event, (this.handlers.get(event) || []).filter(item => item !== handler)); }
  emit(event, payload) { for (const handler of this.handlers.get(event) || []) handler(payload); }
}
const BOLT_PLUS_LEDS = Object.fromEntries(
  ['rearLeft', 'rearCenter', 'rearRight', 'frontRight', 'frontCenter', 'frontLeft']
    .flatMap(position => ['Red', 'Green', 'Blue'].map(color => position + color))
    .map((name, index) => [name, 2 ** index])
);
function sdk(name, options = {}) {
  const instance = new Emitter(BASE_EVENTS);
  instance.toybox = new Emitter(TOY_EVENTS);
  instance.calls = [];
  instance.toy = {
    getName: () => name,
    LED: { ...BOLT_PLUS_LEDS, fakeRedAlias: 1 << 24 },
    hasCommand: command => (options.supported || []).includes(command),
    ledControl: {
      setLeds: values => { instance.calls.push(['color', values]); return options.color?.promise || Promise.resolve(); }
    },
    driveControl: {
      aimStart: async () => { instance.calls.push(['aimStart']); },
      aimStop: async () => { instance.calls.push(['aimStop']); return options.aimStop?.promise; },
      setHeading: async degrees => { instance.calls.push(['setHeading', degrees]); },
      setStabilization: async enabled => { instance.calls.push(['stabilization', enabled]); },
      rollStart: async (...args) => { instance.calls.push(['roll', ...args]); },
      rollStop: async (...args) => { instance.calls.push(['stop', ...args]); }
    }
  };
  const toyEvents = new Emitter({ RESPONSE: { GET_BATTERY_PERCENTAGE: 'battery percentage' }, WILL_SLEEP_NOTIFY: 'will sleep' });
  instance.toy.EVENT = toyEvents.EVENT;
  instance.toy.on = toyEvents.on.bind(toyEvents);
  instance.toy.off = toyEvents.off.bind(toyEvents);
  instance.toyEvents = toyEvents;
  instance.toy.getBatteryPercentage = () => { instance.calls.push(['battery']); return options.battery?.() || Promise.resolve(); };
  instance.toy.ping = () => { instance.calls.push(['ping']); return options.ping?.() || Promise.resolve(); };
  instance.batteryReply = percentage => toyEvents.emit(toyEvents.EVENT.RESPONSE.GET_BATTERY_PERCENTAGE, { success: true, data: { percentage } });
  instance.sleep = () => toyEvents.emit(toyEvents.EVENT.WILL_SLEEP_NOTIFY);
  instance.init = () => { instance.calls.push(['init']); return options.init?.promise || Promise.resolve(); };
  instance.destroy = () => { instance.calls.push(['destroy']); return options.destroy?.promise || Promise.resolve(); };
  instance.toybox.readyToy = async prefix => {
    instance.calls.push(['ready', prefix]);
    assert.equal(prefix, 'BP-');
    if (options.autoReady !== false) queueMicrotask(() => instance.ready());
  };
  // Match the SDK event's real envelope, including when delivering a stale event.
  instance.ready = () => instance.toybox.emit(instance.toybox.EVENT.TOY_READY, { toy: instance.toy });
  return instance;
}
function fixture(...instances) { return fixtureWithTimers({ setTimeout, clearTimeout, Date }, ...instances); }
function fixtureWithTimers(timers, ...instances) {
  const states = [];
  const diagnostics = [];
  const window = {
    isSecureContext: true,
    SpheroSDK: () => {
      const next = instances.shift();
      assert.ok(next, 'unexpected additional SDK instance');
      return next;
    }
  };
  vm.runInNewContext(source, { window, navigator: { bluetooth: {} }, document: { baseURI: 'http://localhost/' }, URL, ...timers });
  return { connection: new window.BoltConnection((state, name) => states.push({ state, name }), detail => diagnostics.push(detail)), states, diagnostics };
}
async function promptly(promise) {
  let timeout;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('controlled operation did not settle promptly')), 500); })]);
  } finally { clearTimeout(timeout); }
}
function owns(connection, instance) {
  assert.equal(connection.sdk, instance);
  assert.equal(connection.toy, instance.toy);
  assert.equal(connection.state, 'connected');
  assert.equal(instance.calls.filter(call => call[0] === 'destroy').length, 0);
}

test('late A color failure cannot dispose connected SDK B', async () => {
  const color = deferred();
  const a = sdk('A', { color }), b = sdk('B');
  const { connection } = fixture(a, b);
  await connection.connect();
  const failure = assert.rejects(connection.setColor(1, 2, 3), /old color failed/);
  assert.equal(a.calls.at(-1)[0], 'color');
  assert.deepEqual(Object.values(a.calls.at(-1)[1]), [1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3]);
  await connection.dispose(a);
  await connection.connect();
  owns(connection, b);
  color.reject(new Error('old color failed'));
  await promptly(failure);
  owns(connection, b);
});

test('A destroy finishing after B connects cannot publish stale disconnected state', async () => {
  const destroy = deferred();
  const a = sdk('A', { destroy }), b = sdk('B');
  const { connection, states } = fixture(a, b);
  await connection.connect();
  const cleanup = connection.dispose(a);
  assert.equal(connection.state, 'disconnected');
  assert.equal(connection.sdk, null);
  await connection.connect();
  const stateCount = states.length;
  owns(connection, b);
  destroy.resolve();
  await promptly(cleanup);
  owns(connection, b);
  assert.equal(states.length, stateCount);
  assert.deepEqual(states.at(-1), { state: 'connected', name: 'B' });
});

test('disposing pending A rejects its connection promptly and ignores stale A ready', async () => {
  const a = sdk('A', { autoReady: false }), b = sdk('B');
  const { connection, states } = fixture(a, b);
  await connection.initialize();
  const cancelled = assert.rejects(connection.connect(), /Connection attempt cancelled/);
  assert.equal(connection.state, 'connecting');
  assert.ok(connection.pendingConnection);
  await connection.dispose(a);
  await promptly(cancelled);
  await connection.connect();
  const stateCount = states.length;
  a.ready();
  await Promise.resolve();
  owns(connection, b);
  assert.equal(connection.pendingConnection, null);
  assert.equal(states.length, stateCount);
});

test('delayed A initialization rejection cannot dispose connected SDK B', async () => {
  const init = deferred();
  const a = sdk('A', { init }), b = sdk('B');
  const { connection, states } = fixture(a, b);
  const failure = assert.rejects(connection.initialize(), /old init failed/);
  assert.equal(connection.sdk, a);
  await connection.dispose(a);
  await connection.connect();
  const stateCount = states.length;
  init.reject(new Error('old init failed'));
  await promptly(failure);
  owns(connection, b);
  assert.equal(states.length, stateCount);
});


test('BOLT+ MAIN maps all 18 actual enum masks through LED control without a raw setMainLed', async () => {
  const a = sdk('BOLT+');
  const { connection } = fixture(a);
  await connection.connect();
  assert.equal(a.toy.setMainLed, undefined);
  await connection.setColor(10, 20, 30);
  const values = a.calls.at(-1)[1];
  assert.equal(Object.keys(values).length, 18);
  for (const [name, mask] of Object.entries(BOLT_PLUS_LEDS)) {
    assert.equal(values[mask], name.endsWith('Red') ? 10 : name.endsWith('Green') ? 20 : 30);
  }
  assert.equal(values[1 << 24], undefined, 'unknown alias must not add a mask bit');
  owns(connection, a);
});

test('unsupported command and SDK ERROR report diagnostics while keeping BLE session', async () => {
  const color = deferred();
  const a = sdk('BOLT+', { color });
  const { connection, diagnostics } = fixture(a);
  await connection.connect();
  const failure = assert.rejects(connection.setColor(1, 2, 3), /Unsupported command/);
  a.emit(a.EVENT.ERROR, { message: 'Unsupported command setMainLed', robotID: 7, deviceId: 'private', identifier: 'private' });
  color.reject(new Error('Unsupported command setMainLed'));
  await promptly(failure);
  owns(connection, a);
  assert.ok(diagnostics.some(detail => detail.includes('Unsupported command')));
  assert.ok(diagnostics.some(detail => detail.includes('robotID')));
  assert.ok(diagnostics.every(detail => !detail.includes('private') && detail.length <= 1082));
  await connection.stop();
  owns(connection, a);
});

test('unsupported platform operation is diagnostic without invalidating the toy', async () => {
  const a = sdk('BOLT+');
  const { connection, diagnostics } = fixture(a);
  await connection.connect();
  a.emit(a.EVENT.OPERATION_FAILED, { opperation: 3, message: 'Opperation not supported!' });
  owns(connection, a);
  assert.match(diagnostics.at(-1), /Opperation not supported/);
});

for (const event of [BASE_EVENTS.OPERATION_FAILED, BASE_EVENTS.CONNECTION_FAILED, TOY_EVENTS.TOY_PUT_AWAY]) {
  test(`transport loss via ${event} invalidates the session immediately`, async () => {
    const a = sdk('BOLT+');
    const { connection } = fixture(a);
    await connection.connect();
    const emitter = event === TOY_EVENTS.TOY_PUT_AWAY ? a.toybox : a;
    emitter.emit(event, { message: 'Bluetooth device disconnected' });
    assert.equal(connection.state, 'disconnected');
    assert.equal(connection.sdk, null);
    assert.equal(connection.toy, null);
    assert.equal(a.calls.filter(call => call[0] === 'destroy').length, 1);
    await connection.stop();
    await assert.rejects(connection.drive(0, 20), /Connect BOLT/);
  });
}

test('command timeout invalidates the session but ordinary command errors do not', async () => {
  const a = sdk('BOLT+');
  const { connection } = fixture(a);
  await connection.connect();
  // Keep the timeout classification real without waiting six seconds in a unit test.
  const originalTimeout = connection.withTimeout.bind(connection);
  connection.withTimeout = (promise, milliseconds, message, code) => originalTimeout(promise, 5, message, code);
  a.toy.ledControl.setLeds = () => new Promise(() => {});
  await assert.rejects(connection.setColor(1, 2, 3), /stopped responding/);
  assert.equal(connection.state, 'disconnected');
  assert.equal(connection.toy, null);
});


test('aiming uses stationary SDK heading and aimStop reset once, restoring the last color', async () => {
  const a = sdk('BOLT+');
  const { connection } = fixture(a);
  await connection.connect();
  await connection.setColor(10, 20, 30);
  const color = a.calls.at(-1)[1];
  a.calls.length = 0;
  await connection.aimStart();
  await connection.aimRotate(-90);
  await connection.aimRotate(405);
  await connection.aimFinish();
  assert.deepEqual(a.calls.map(call => call[0]), ['aimStart', 'setHeading', 'setHeading', 'aimStop', 'stabilization', 'color']);
  assert.deepEqual(a.calls[1], ['setHeading', 270]);
  assert.deepEqual(a.calls[2], ['setHeading', 45]);
  assert.deepEqual(a.calls[4], ['stabilization', true]);
  assert.deepEqual(a.calls[5][1], color);
  assert.equal(connection.heading, 0);
  await assert.rejects(connection.aimRotate(NaN), /finite number/);
});

test('aim cancellation clears SDK aiming and restores color; program preparation enables stabilization', async () => {
  const a = sdk('BOLT+');
  const { connection } = fixture(a);
  await connection.connect();
  a.calls.length = 0;
  await connection.aimCancel();
  await connection.prepareProgram();
  assert.deepEqual(a.calls.map(call => call[0]), ['aimStop', 'color', 'stabilization']);
  assert.ok(Object.values(a.calls[1][1]).every(value => value === 0));
});

test('finishing an old aim cannot restore color or set stabilization on a replacement SDK', async () => {
  const aimStop = deferred();
  const a = sdk('A', { aimStop }), b = sdk('B');
  const { connection } = fixture(a, b);
  await connection.connect();
  const cancelled = assert.rejects(connection.aimFinish(), /Connection attempt cancelled/);
  await connection.dispose(a);
  await connection.connect();
  const count = b.calls.length;
  aimStop.resolve();
  await promptly(cancelled);
  owns(connection, b);
  assert.equal(b.calls.length, count);
});


test('vendored BOLT+ drive control aims at zero speed and aimStop resets yaw itself', () => {
  const worker = fs.readFileSync(new URL('../vendor/sphero/toybox.js', import.meta.url), 'utf8');
  const start = worker.indexOf('132:(e,t,n)=>{');
  const end = worker.indexOf(',175:(e,t,n)=>{', start);
  assert.ok(start >= 0 && end > start, 'vendored drive control module is present');
  const module = { exports: {} };
  const constants = { SISTR_ENUM_TOYTYPE_SPHEROBOLTPLUS: 'boltplus' };
  const requireModule = id => {
    if (id === 112) return constants;
    if (id === 735) return class { requireOptions() { return true; } };
    throw new Error(`Unexpected worker dependency ${id}`);
  };
  vm.runInNewContext(`(${worker.slice(start + 4, end)})`, {})(module, {}, requireModule);
  const calls = [];
  const raw = {
    LED: BOLT_PLUS_LEDS,
    getType: () => constants.SISTR_ENUM_TOYTYPE_SPHEROBOLTPLUS,
    getSupportedCommands: () => ['setAllLedsWith32BitMask', 'driveWithHeading', 'resetYaw', 'setStabilization'],
    setAllLedsWith32BitMask: (masks, values) => calls.push(['leds', [...masks], [...values]]),
    driveWithHeading: (speed, heading, flags) => calls.push(['drive', speed, heading, [...flags]]),
    resetYaw: () => calls.push(['resetYaw']),
    setStabilization: mode => calls.push(['stabilization', mode])
  };
  const control = module.exports({ this: raw });
  control.aimStart();
  assert.deepEqual(calls[0][1], Object.values(BOLT_PLUS_LEDS));
  assert.deepEqual(calls[0][2], [0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  control.setHeading(270);
  assert.deepEqual(calls[1], ['drive', 0, 270, []]);
  control.aimStop();
  assert.ok(calls[2][2].every(value => value === 0));
  assert.deepEqual(calls[3], ['resetYaw']);
  assert.equal(control.isAiming(), false);
  control.setStabilization(true);
  assert.deepEqual(calls[4], ['stabilization', 'full_control_system']);
});


function fakeClock() {
  let now = 0, next = 1;
  const timers = new Map();
  const clock = {
    setTimeout(callback, delay) { const id = next++; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    Date: class extends Date { static now() { return now; } },
    timers,
    async flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); },
    async tick(milliseconds) {
      const end = now + milliseconds;
      await clock.flush();
      for (;;) {
        const entry = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
        if (!entry) break;
        now = entry[1].due;
        timers.delete(entry[0]);
        entry[1].callback();
        await clock.flush();
      }
      now = end;
      await clock.flush();
    }
  };
  return clock;
}
const MAINTENANCE_COMMANDS = ['getBatteryPercentage', 'ping'];
const countCalls = (instance, method) => instance.calls.filter(call => call[0] === method).length;

test('battery subscribes before immediate dispatch and polls ten seconds after actual reply', async () => {
  const clock = fakeClock();
  let a;
  a = sdk('BOLT+', { supported: MAINTENANCE_COMMANDS, battery: () => { a.batteryReply(80); return Promise.resolve(); } });
  const { connection } = fixtureWithTimers(clock, a);
  await connection.connect();
  assert.equal(countCalls(a, 'battery'), 1);
  await clock.tick(9999);
  assert.equal(countCalls(a, 'battery'), 1);
  await clock.tick(1);
  assert.equal(countCalls(a, 'battery'), 2);
  assert.equal(countCalls(a, 'ping'), 0, 'no periodic ping');
  await connection.dispose();
  assert.equal(clock.timers.size, 0);
});

test('dispatch completion does not count as battery reply; missing reply diagnoses and retries', async () => {
  const clock = fakeClock(), a = sdk('BOLT+', { supported: MAINTENANCE_COMMANDS });
  const { connection, diagnostics } = fixtureWithTimers(clock, a);
  await connection.connect();
  await clock.tick(6000);
  owns(connection, a);
  assert.ok(diagnostics.some(value => value.includes('battery reply missing')));
  await clock.tick(9999);
  assert.equal(countCalls(a, 'battery'), 1);
  await clock.tick(1);
  assert.equal(countCalls(a, 'battery'), 2);
  a.batteryReply(70);
  await clock.tick(9999);
  assert.equal(countCalls(a, 'battery'), 2);
  await clock.tick(1);
  assert.equal(countCalls(a, 'battery'), 3);
  await connection.dispose();
});

test('reactive sleep pings coalesce until dispatch settles and cleanup removes listeners synchronously', async () => {
  const clock = fakeClock(), ping = deferred(), destroy = deferred();
  const a = sdk('BOLT+', { supported: ['ping'], ping: () => ping.promise, destroy });
  const { connection } = fixtureWithTimers(clock, a);
  await connection.connect();
  a.sleep(); a.sleep(); a.sleep();
  assert.equal(countCalls(a, 'ping'), 1);
  ping.resolve();
  await clock.flush();
  a.sleep();
  assert.equal(countCalls(a, 'ping'), 2);
  await clock.flush();
  const cleanup = connection.dispose();
  assert.equal(clock.timers.size, 0);
  assert.ok([...a.toyEvents.handlers.values()].every(handlers => handlers.length === 0));
  a.sleep();
  assert.equal(countCalls(a, 'ping'), 2);
  destroy.resolve(); await cleanup;
});

test('old maintenance callbacks, late replies and transport errors cannot affect replacement SDK', async () => {
  const clock = fakeClock(), battery = deferred(), ping = deferred();
  let reads = 0;
  const a = sdk('A', { supported: MAINTENANCE_COMMANDS, battery: () => ++reads === 1 ? Promise.resolve() : battery.promise, ping: () => ping.promise });
  const b = sdk('B', { supported: MAINTENANCE_COMMANDS });
  const { connection, diagnostics } = fixtureWithTimers(clock, a, b);
  await connection.connect();
  a.batteryReply(80);
  await clock.tick(10000);
  const oldHandlers = [...a.toyEvents.handlers.values()].flat();
  const oldTimers = [...clock.timers.values()].map(timer => timer.callback);
  a.sleep();
  await connection.dispose(a);
  await connection.connect();
  const before = diagnostics.length;
  a.batteryReply(30);
  for (const callback of oldHandlers) callback({ success: true, data: { percentage: 30 } });
  for (const callback of oldTimers) callback();
  battery.reject(new Error('Bluetooth device disconnected'));
  ping.reject(new Error('Bluetooth device disconnected'));
  await clock.flush();
  owns(connection, b);
  assert.equal(diagnostics.length, before);
  assert.equal(countCalls(b, 'battery'), 1);
  assert.equal(countCalls(b, 'ping'), 0);
  await connection.dispose();
  assert.equal(clock.timers.size, 0);
});

test('ordinary maintenance dispatch errors preserve the session and battery retries', async () => {
  const clock = fakeClock();
  const a = sdk('BOLT+', { supported: MAINTENANCE_COMMANDS, battery: () => Promise.reject(new Error('Unsupported battery request')), ping: () => Promise.reject(new Error('Unsupported ping')) });
  const { connection, diagnostics } = fixtureWithTimers(clock, a);
  await connection.connect(); a.sleep();
  await clock.flush();
  owns(connection, a);
  assert.ok(diagnostics.some(value => value.includes('battery dispatch failed')));
  assert.ok(diagnostics.some(value => value.includes('sleep ping failed')));
  await clock.tick(10000);
  assert.equal(countCalls(a, 'battery'), 2);
  owns(connection, a);
  await connection.dispose();
});

test('maintenance transport failures retain command disposal policy and report session timing', async () => {
  const clock = fakeClock();
  const a = sdk('BOLT+', { supported: ['ping'], ping: () => Promise.reject(new Error('Bluetooth device disconnected')) });
  const { connection, diagnostics } = fixtureWithTimers(clock, a);
  await connection.connect();
  await clock.tick(2000); a.sleep(); await clock.flush();
  assert.equal(connection.state, 'disconnected');
  assert.equal(clock.timers.size, 0);
  assert.ok(diagnostics.some(value => value.includes('connected 2000ms; last battery reply age none')));
});

test('unsupported maintenance capabilities create no timers or listeners', async () => {
  const clock = fakeClock(), a = sdk('BOLT+');
  const { connection } = fixtureWithTimers(clock, a);
  await connection.connect(); await clock.flush();
  assert.equal(clock.timers.size, 0);
  assert.equal(a.toyEvents.handlers.size, 0);
  await clock.tick(30000);
  owns(connection, a);
  await connection.dispose();
});


for (const synchronous of [true, false]) test(`${synchronous ? 'synchronous' : 'asynchronous'} initial battery transport failure rejects connection and cleans listeners`, async () => {
  const clock = fakeClock();
  const a = sdk('BOLT+', { supported: MAINTENANCE_COMMANDS, battery: () => {
    const error = new Error('Bluetooth device disconnected');
    if (synchronous) throw error;
    return Promise.reject(error);
  } });
  const { connection } = fixtureWithTimers(clock, a);
  await assert.rejects(connection.connect(), /disconnected while connecting/);
  await clock.flush();
  assert.equal(connection.state, 'disconnected');
  assert.ok([...a.toyEvents.handlers.values()].every(handlers => handlers.length === 0));
  assert.equal(clock.timers.size, 0);
  a.sleep();
  assert.equal(countCalls(a, 'ping'), 0);
});

test('transport diagnostic measures age from the last actual battery reply', async () => {
  const clock = fakeClock(), a = sdk('BOLT+', { supported: MAINTENANCE_COMMANDS });
  const { connection, diagnostics } = fixtureWithTimers(clock, a);
  await connection.connect(); await clock.tick(1000);
  a.batteryReply(80);
  await clock.tick(2000);
  a.toybox.emit(a.toybox.EVENT.TOY_PUT_AWAY, {});
  assert.ok(diagnostics.some(value => value.includes('connected 3000ms; last battery reply age 2000ms')));
  assert.equal(clock.timers.size, 0);
});

test('late dispatch failure after a battery reply preserves the reply-based poll schedule', async () => {
  const clock = fakeClock(), dispatch = deferred();
  let reads = 0, a;
  a = sdk('BOLT+', { supported: ['getBatteryPercentage'], battery: () => {
    if (++reads === 1) { a.batteryReply(80); return Promise.resolve(); }
    return dispatch.promise;
  } });
  const { connection, diagnostics } = fixtureWithTimers(clock, a);
  await connection.connect();
  await clock.tick(10000);
  await clock.tick(1000); a.batteryReply(90);
  await clock.tick(1000); dispatch.reject(new Error('Late battery dispatch error'));
  await clock.flush();
  owns(connection, a);
  assert.ok(diagnostics.some(value => value.includes('battery dispatch failed')));
  await clock.tick(8999);
  assert.equal(countCalls(a, 'battery'), 2);
  await clock.tick(1);
  assert.equal(countCalls(a, 'battery'), 3, 'poll remains ten seconds after reply, not after dispatch failure');
  await clock.flush();
  await connection.dispose();
  assert.equal(clock.timers.size, 0);
});
