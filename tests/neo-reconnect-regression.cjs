// Usage: node tests/neo-reconnect-regression.cjs [SDK-or-main-bundle.js] [fixed|baseline|report]
// Faithful Neo fake-Bluetooth regression harness; this does not prove physical-device behavior.
const fs = require('fs');
const path = require('path');

const SOURCE = process.argv[2] || path.resolve(__dirname, '../vendor/sphero/sphero-sdk.js');
const unhandledRejections = [];
process.on('unhandledRejection', (reason) => unhandledRejections.push(String(reason && reason.message || reason)));

const OPS = {
  STARTSCAN: 'STARTSCAN',
  STOPSCAN: 'STOPSCAN',
  WRITE: 'WRITE',
  READ: 'READ',
  LISTEN: 'LISTEN',
  STOPLISTEN: 'STOPLISTEN',
  CONNECT: 'CONNECT',
  DISCONNECT: 'DISCONNECT',
};

const EVENTS = {
  DEVICE_FOUND: 'DEVICE_FOUND',
  DEVICE_DISCONNECTED: 'DEVICE_DISCONNECTED',
  CHARACTERISTIC_FOUND: 'CHARACTERISTIC_FOUND',
  OPERATION_COMPLETE: 'OPERATION_COMPLETE',
  OPERATION_FAILED: 'OPERATION_FAILED',
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  USER_CANCELLED: 'USER_CANCELLED',
  BLUETOOTH_STATE: 'BLUETOOTH_STATE',
};

class EventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(name, callback) {
    const list = this.listeners.get(name) || [];
    if (!list.includes(callback)) list.push(callback);
    this.listeners.set(name, list);
  }

  removeEventListener(name, callback) {
    const list = this.listeners.get(name) || [];
    this.listeners.set(name, list.filter((entry) => entry !== callback));
  }

  dispatchEvent(name, event = {}) {
    const list = [...(this.listeners.get(name) || [])];
    for (const callback of list) callback({ target: this, ...event });
  }

  listenerCount(name) {
    return (this.listeners.get(name) || []).length;
  }
}

class Emitter {
  constructor() {
    this.listeners = new Map();
    this.events = [];
  }

  on(name, callback) {
    const list = this.listeners.get(name) || [];
    list.push(callback);
    this.listeners.set(name, list);
  }

  off(name, callback) {
    this.listeners.set(name, (this.listeners.get(name) || []).filter((entry) => entry !== callback));
  }

  once(name, callback) {
    const wrapped = (...args) => {
      this.off(name, wrapped);
      callback(...args);
    };
    this.on(name, wrapped);
  }

  trigger(name, payload) {
    this.events.push({ name, payload });
    for (const callback of [...(this.listeners.get(name) || [])]) callback(payload);
  }
}

class Characteristic extends EventTarget {
  constructor(service, label, deferredStart = false) {
    super();
    this.service = service;
    this.uuid = 'CHAR';
    this.label = label;
    this.notifyIsOn = 0;
    this.writeCalls = 0;
    this.startCalls = 0;
    this.startDeferred = deferredStart ? deferred() : null;
    this.stopDeferred = null;
    this.readDeferred = null;
  }

  writeValueWithoutResponse() {
    this.writeCalls += 1;
    if (!this.service.device.gatt.connected) {
      return Promise.reject(new Error(`stale write reached ${this.label}`));
    }
    return Promise.resolve();
  }

  readValue() {
    if (!this.service.device.gatt.connected) return Promise.reject(new Error('read after disconnect'));
    if (this.readDeferred) return this.readDeferred.promise;
    return Promise.resolve(new Uint8Array([1]).buffer);
  }

  startNotifications() {
    this.startCalls += 1;
    return this.startDeferred ? this.startDeferred.promise : Promise.resolve(this);
  }

  stopNotifications() {
    return this.stopDeferred ? this.stopDeferred.promise : Promise.resolve(this);
  }
}

class Service {
  constructor(device) {
    this.device = device;
    this.uuid = 'SERVICE';
  }

  getCharacteristics() {
    return Promise.resolve([this.device.currentCharacteristic]);
  }
}

class Device extends EventTarget {
  constructor({ reuseCharacteristic = false } = {}) {
    super();
    this.id = 'device-1';
    this.name = 'BP-TEST';
    this.reuseCharacteristic = reuseCharacteristic;
    this.service = new Service(this);
    this.dropCount = 0;
    this.currentCharacteristic = new Characteristic(this.service, 'generation-1', true);
    this.gatt = {
      connected: false,
      connect: async () => {
        this.gatt.connected = true;
        if (this.dropCount > 0 && !this.reuseCharacteristic) {
          this.currentCharacteristic = new Characteristic(this.service, `generation-${this.dropCount + 2}`);
        }
        return this.gatt;
      },
      getPrimaryServices: () => this.getPrimaryServices(),
      disconnect: () => {
        this.gatt.connected = false;
      },
    };
  }

  getPrimaryServices() {
    return Promise.resolve([this.service]);
  }

  dropUnexpectedly() {
    this.dropCount += 1;
    this.gatt.connected = false;
    this.dispatchEvent('gattserverdisconnected');
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function loader(constants, emitter) {
  return (id) => {
    if (id === 39481) return class extends Emitter {
      constructor() {
        super();
        Object.assign(this, emitter);
      }
    };
    if (id === 76559) return {};
    if (id === 8267) return { ADAPTOR: EVENTS };
    if (id === 61757) return constants;
    if (id === 6082) return class {
      requireOptions() { return true; }
      log() {}
      error() {}
    };
    throw new Error(`Unexpected module ${id}`);
  };
}

function extractFactory(bundle) {
  const source = fs.readFileSync(bundle, 'utf8');
  const start = source.indexOf('6490:');
  if (start < 0) throw new Error('module 6490 not found');
  const relativeEnd = source.slice(start + 5).search(/},\d+:/);
  if (relativeEnd < 0) throw new Error('module 6490 end not found');
  const end = start + 5 + relativeEnd + 1;
  return Function(`return (${source.slice(start + 5, end)})`)();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function makeAdaptor(options = {}) {
  const device = new Device(options);
  const bluetooth = new EventTarget();
  bluetooth.getAvailability = async () => true;
  bluetooth.requestDevice = async () => device;
  Object.defineProperty(globalThis, 'navigator', { value: { bluetooth }, configurable: true, writable: true });

  const constants = {
    ENUM_PLATFORM_ADAPTOR_TYPE_BLE: 'BLE',
    ENUM_PLATFORM_OP_BLE_STARTSCAN: OPS.STARTSCAN,
    ENUM_PLATFORM_OP_BLE_STOPSCAN: OPS.STOPSCAN,
    ENUM_PLATFORM_OP_BLE_WRITE: OPS.WRITE,
    ENUM_PLATFORM_OP_BLE_READ: OPS.READ,
    ENUM_PLATFORM_OP_BLE_LISTENTOCHARACTERISTIC: OPS.LISTEN,
    ENUM_PLATFORM_OP_BLE_STOPLISTENINGTOCHARACTERISTIC: OPS.STOPLISTEN,
    ENUM_PLATFORM_OP_BLE_CONNECT: OPS.CONNECT,
    ENUM_PLATFORM_OP_BLE_DISCONNECT: OPS.DISCONNECT,
    SISTR_BRIDGE_GETBLUETOOTHSTATE_STATE_ON: 'ON',
    SISTR_BRIDGE_GETBLUETOOTHSTATE_STATE_NOTSUPPORTED: 'NOTSUPPORTED',
    SISTR_BRIDGE_GETBLUETOOTHSTATE_STATE_OFF: 'OFF',
  };
  const emitter = new Emitter();
  const factory = extractFactory(SOURCE);
  const module = { exports: {} };
  factory(module, {}, loader(constants, emitter));
  const adaptor = module.exports({});
  await adaptor.init();
  return { adaptor, device, emitter };
}

async function operation(adaptor, emitter, opperation, options, id) {
  const operationId = id || `${opperation}-${Date.now()}-${Math.random()}`;
  adaptor.performOperation({ opperation, opperationId: operationId, ...options });
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const event = emitter.events.find(({ name, payload }) =>
      (name === EVENTS.OPERATION_COMPLETE || name === EVENTS.OPERATION_FAILED || name === EVENTS.CONNECTION_FAILED || name === EVENTS.USER_CANCELLED) &&
      payload && ((Array.isArray(payload) && payload.some((item) => item && Object.values(item).includes(operationId))) || (!Array.isArray(payload) && Object.values(payload).includes(operationId))));
    if (event) return event;
    await sleep(2);
  }
  throw new Error(`operation ${opperation} did not settle; events=${JSON.stringify(emitter.events)}; keys=${emitter.events.map(({ payload }) => payload && Object.keys(payload))}`);
}

function operationEvents(emitter, operationId) {
  return emitter.events.filter(({ name, payload }) =>
    (name === EVENTS.OPERATION_COMPLETE || name === EVENTS.OPERATION_FAILED || name === EVENTS.CONNECTION_FAILED || name === EVENTS.USER_CANCELLED) &&
    payload && ((Array.isArray(payload) && payload.some((item) => item && Object.values(item).includes(operationId))) || (!Array.isArray(payload) && Object.values(payload).includes(operationId))));
}

function enqueueOperation(adaptor, opperation, options, id) {
  adaptor.performOperation({ opperation, opperationId: id, ...options });
  return id;
}

async function waitForOperation(emitter, operationId, timeout = 250) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const events = operationEvents(emitter, operationId);
    if (events.length) return events[events.length - 1];
    await sleep(2);
  }
  return null;
}

async function setup(options = {}) {
  const state = await makeAdaptor(options);
  await operation(state.adaptor, state.emitter, OPS.STARTSCAN, { uuidFilterList: 'SERVICE' }, 'scan');
  await operation(state.adaptor, state.emitter, OPS.CONNECT, { deviceId: 1 }, 'connect-1');
  await sleep(10);
  return state;
}

async function runWriteScenario() {
  const state = await setup();
  const oldCharacteristic = state.device.currentCharacteristic;
  const pending = operation(state.adaptor, state.emitter, OPS.WRITE, { deviceId: 1, characteristicUuid: 'CHAR', data: [1] }, 'write-old');
  await sleep(20);
  state.device.dropUnexpectedly();
  const firstWriteResult = await pending;
  await sleep(260);
  const staleWriteCalls = oldCharacteristic.writeCalls;

  const reconnectResult = await operation(state.adaptor, state.emitter, OPS.CONNECT, { deviceId: 1 }, 'connect-2');
  await sleep(10);
  const newCharacteristic = state.device.currentCharacteristic;
  const secondWriteResult = await operation(state.adaptor, state.emitter, OPS.WRITE, { deviceId: 1, characteristicUuid: 'CHAR', data: [2] }, 'write-new');
  return {
    firstWrite: firstWriteResult.name,
    staleWriteCalls,
    reconnect: reconnectResult.name,
    secondWrite: secondWriteResult.name,
    newWriteCalls: newCharacteristic.writeCalls,
    eventCounts: {
      firstWrite: operationEvents(state.emitter, 'write-old').length,
      reconnect: operationEvents(state.emitter, 'connect-2').length,
      secondWrite: operationEvents(state.emitter, 'write-new').length,
    },
  };
}

async function runNotificationScenario() {
  const state = await setup();
  const oldCharacteristic = state.device.currentCharacteristic;
  const pending = operation(state.adaptor, state.emitter, OPS.LISTEN, { deviceId: 1, characteristicUuid: 'CHAR' }, 'listen-old');
  await sleep(10);
  state.device.dropUnexpectedly();
  const firstListenResult = await pending;
  oldCharacteristic.startDeferred.resolve(oldCharacteristic);
  await sleep(10);
  const staleListenerCount = oldCharacteristic.listenerCount('characteristicvaluechanged');

  const reconnectResult = await operation(state.adaptor, state.emitter, OPS.CONNECT, { deviceId: 1 }, 'connect-listen-2');
  await sleep(10);
  const newCharacteristic = state.device.currentCharacteristic;
  const secondListenResult = await operation(state.adaptor, state.emitter, OPS.LISTEN, { deviceId: 1, characteristicUuid: 'CHAR' }, 'listen-new');
  return {
    firstListen: firstListenResult.name,
    staleListenerCount,
    reconnect: reconnectResult.name,
    secondListen: secondListenResult.name,
    newListenerCount: newCharacteristic.listenerCount('characteristicvaluechanged'),
    newNotifyIsOn: newCharacteristic.notifyIsOn,
    eventCounts: {
      firstListen: operationEvents(state.emitter, 'listen-old').length,
      reconnect: operationEvents(state.emitter, 'connect-listen-2').length,
      secondListen: operationEvents(state.emitter, 'listen-new').length,
    },
  };
}

async function runQueuedWriteScenario() {
  const state = await setup();
  const oldCharacteristic = state.device.currentCharacteristic;
  let retryEnqueued = false;
  state.emitter.on(EVENTS.OPERATION_FAILED, (payload) => {
    const item = Array.isArray(payload) ? payload[0] : payload;
    if (!retryEnqueued && item && item.opperationId === 'write-queued-second') {
      retryEnqueued = true;
      enqueueOperation(state.adaptor, OPS.WRITE, { deviceId: 1, characteristicUuid: 'CHAR', data: [3] }, 'write-reentrant-retry');
    }
  });
  const first = operation(state.adaptor, state.emitter, OPS.WRITE, { deviceId: 1, characteristicUuid: 'CHAR', data: [1] }, 'write-queued-first');
  await sleep(20);
  const queued = operation(state.adaptor, state.emitter, OPS.WRITE, { deviceId: 1, characteristicUuid: 'CHAR', data: [2] }, 'write-queued-second');
  await sleep(5);
  state.device.dropUnexpectedly();
  const [firstResult, queuedResult] = await Promise.all([first, queued]);
  await sleep(260);
  const retryEvents = operationEvents(state.emitter, 'write-reentrant-retry');
  return {
    firstWrite: firstResult.name,
    queuedWrite: queuedResult.name,
    staleWriteCalls: oldCharacteristic.writeCalls,
    retryEnqueued,
    reentrantRetry: retryEvents.length ? retryEvents[retryEvents.length - 1].name : 'MISSING',
    eventCounts: {
      firstWrite: operationEvents(state.emitter, 'write-queued-first').length,
      queuedWrite: operationEvents(state.emitter, 'write-queued-second').length,
      reentrantRetry: retryEvents.length,
    },
  };
}

async function runLateCallbackScenario() {
  const state = await setup();
  const oldCharacteristic = state.device.currentCharacteristic;
  const oldStart = oldCharacteristic.startDeferred;
  const oldListen = operation(state.adaptor, state.emitter, OPS.LISTEN, { deviceId: 1, characteristicUuid: 'CHAR' }, 'listen-late-old');
  await sleep(10);
  state.device.dropUnexpectedly();
  const oldListenResult = await waitForOperation(state.emitter, 'listen-late-old', 250);
  const reconnectResult = await operation(state.adaptor, state.emitter, OPS.CONNECT, { deviceId: 1 }, 'connect-late-1');
  await sleep(10);

  const newStart = deferred();
  const newCharacteristic = state.device.currentCharacteristic;
  newCharacteristic.startDeferred = newStart;
  enqueueOperation(state.adaptor, OPS.LISTEN, { deviceId: 1, characteristicUuid: 'CHAR' }, 'listen-late-new');
  await sleep(10);
  const beforeOldCallback = operationEvents(state.emitter, 'listen-late-new').length;
  oldStart.resolve(oldCharacteristic);
  await sleep(10);
  const afterOldCallback = operationEvents(state.emitter, 'listen-late-new').length;
  const beforeSecondDrop = afterOldCallback;
  state.device.dropUnexpectedly();
  await sleep(20);
  const afterSecondDrop = operationEvents(state.emitter, 'listen-late-new');
  return {
    oldListen: oldListenResult && oldListenResult.name,
    reconnect: reconnectResult.name,
    staleListenerCount: oldCharacteristic.listenerCount('characteristicvaluechanged'),
    beforeOldCallback,
    afterOldCallback,
    newOperationPendingBeforeSecondDrop: beforeSecondDrop === 0,
    secondDropResult: afterSecondDrop.length ? afterSecondDrop[afterSecondDrop.length - 1].name : 'PENDING',
    secondDropEventDelta: afterSecondDrop.length - beforeSecondDrop,
    oldListenPromiseSettled: await Promise.race([oldListen.then(() => true), sleep(20).then(() => false)]),
  };
}

async function runReusedCharacteristicScenario() {
  const startState = await setup({ reuseCharacteristic: true });
  const characteristic = startState.device.currentCharacteristic;
  const oldStart = characteristic.startDeferred;
  const oldListen = operation(startState.adaptor, startState.emitter, OPS.LISTEN, { deviceId: 1, characteristicUuid: 'CHAR' }, 'reuse-listen-old');
  await sleep(10);
  startState.device.dropUnexpectedly();
  const oldListenResult = await waitForOperation(startState.emitter, 'reuse-listen-old', 250);
  const reconnectResult = await operation(startState.adaptor, startState.emitter, OPS.CONNECT, { deviceId: 1 }, 'reuse-connect-1');
  const newStart = deferred();
  characteristic.startDeferred = newStart;
  enqueueOperation(startState.adaptor, OPS.LISTEN, { deviceId: 1, characteristicUuid: 'CHAR' }, 'reuse-listen-new');
  await sleep(10);
  oldStart.resolve(characteristic);
  await sleep(10);
  const listenerAfterOldStart = characteristic.listenerCount('characteristicvaluechanged');
  const notifyAfterOldStart = characteristic.notifyIsOn;
  startState.device.dropUnexpectedly();
  await sleep(20);
  const newListenEvents = operationEvents(startState.emitter, 'reuse-listen-new');
  const reconnectAgain = await operation(startState.adaptor, startState.emitter, OPS.CONNECT, { deviceId: 1 }, 'reuse-connect-2');
  characteristic.startDeferred = null;
  const finalListen = await operation(startState.adaptor, startState.emitter, OPS.LISTEN, { deviceId: 1, characteristicUuid: 'CHAR' }, 'reuse-listen-final');

  const stopState = await setup({ reuseCharacteristic: true });
  const stopCharacteristic = stopState.device.currentCharacteristic;
  const initialStart = stopCharacteristic.startDeferred;
  const initialListen = operation(stopState.adaptor, stopState.emitter, OPS.LISTEN, { deviceId: 1, characteristicUuid: 'CHAR' }, 'reuse-stop-listen');
  await sleep(5);
  initialStart.resolve(stopCharacteristic);
  await initialListen;
  stopCharacteristic.stopDeferred = deferred();
  enqueueOperation(stopState.adaptor, OPS.STOPLISTEN, { deviceId: 1, characteristicUuid: 'CHAR' }, 'reuse-stop-old');
  await sleep(10);
  const stopBeforeDrop = operationEvents(stopState.emitter, 'reuse-stop-old').length;
  stopState.device.dropUnexpectedly();
  await sleep(20);
  const stopAfterDrop = operationEvents(stopState.emitter, 'reuse-stop-old');
  const stopReconnect = await operation(stopState.adaptor, stopState.emitter, OPS.CONNECT, { deviceId: 1 }, 'reuse-stop-connect');
  stopCharacteristic.startDeferred = null;
  const listenAfterStop = await operation(stopState.adaptor, stopState.emitter, OPS.LISTEN, { deviceId: 1, characteristicUuid: 'CHAR' }, 'reuse-stop-listen-new');
  stopCharacteristic.stopDeferred.resolve(stopCharacteristic);
  await sleep(20);
  return {
    staleStart: {
      oldListen: oldListenResult && oldListenResult.name,
      reconnect: reconnectResult.name,
      listenerAfterOldStart,
      notifyAfterOldStart,
      secondListen: newListenEvents.length ? newListenEvents[newListenEvents.length - 1].name : 'PENDING',
      reconnectAgain: reconnectAgain.name,
      finalListen: finalListen.name,
      finalListenerCount: characteristic.listenerCount('characteristicvaluechanged'),
      finalNotifyIsOn: characteristic.notifyIsOn,
    },
    staleStop: {
      stopBeforeDrop,
      stopAfterDrop: stopAfterDrop.length ? stopAfterDrop[stopAfterDrop.length - 1].name : 'PENDING',
      stopEventDelta: stopAfterDrop.length - stopBeforeDrop,
      reconnect: stopReconnect.name,
      listenAfterStop: listenAfterStop.name,
      listenerAfterLateStop: stopCharacteristic.listenerCount('characteristicvaluechanged'),
      notifyAfterLateStop: stopCharacteristic.notifyIsOn,
    },
  };
}

async function runNativeNotificationScenario() {
  const state = await setup();
  const characteristic = state.device.currentCharacteristic;
  const startDeferred = characteristic.startDeferred;
  enqueueOperation(state.adaptor, OPS.LISTEN, { deviceId: 1, characteristicUuid: 'CHAR' }, 'native-start-reject');
  await sleep(10);
  const startBeforeReject = operationEvents(state.emitter, 'native-start-reject').length;
  startDeferred.reject(new Error('native start rejected'));
  await sleep(20);
  const startAfterReject = operationEvents(state.emitter, 'native-start-reject');
  characteristic.startDeferred = null;
  const startSuccess = await operation(state.adaptor, state.emitter, OPS.LISTEN, { deviceId: 1, characteristicUuid: 'CHAR' }, 'native-start-success');

  const stopDeferred = deferred();
  characteristic.stopDeferred = stopDeferred;
  enqueueOperation(state.adaptor, OPS.STOPLISTEN, { deviceId: 1, characteristicUuid: 'CHAR' }, 'native-stop-reject');
  await sleep(10);
  const stopBeforeReject = operationEvents(state.emitter, 'native-stop-reject').length;
  stopDeferred.reject(new Error('native stop rejected'));
  await sleep(20);
  const stopAfterReject = operationEvents(state.emitter, 'native-stop-reject');
  characteristic.stopDeferred = null;
  const stopSuccess = await operation(state.adaptor, state.emitter, OPS.STOPLISTEN, { deviceId: 1, characteristicUuid: 'CHAR' }, 'native-stop-success');
  return {
    startBeforeReject,
    startAfterReject: startAfterReject.length ? startAfterReject[startAfterReject.length - 1].name : 'PENDING',
    startRejectEventCount: startAfterReject.length,
    startSuccess: startSuccess.name,
    stopBeforeReject,
    stopAfterReject: stopAfterReject.length ? stopAfterReject[stopAfterReject.length - 1].name : 'PENDING',
    stopRejectEventCount: stopAfterReject.length,
    stopSuccess: stopSuccess.name,
    unhandledRejectionDelta: unhandledRejections.length,
  };
}

async function runImmediateReadScenario() {
  const state = await setup();
  const characteristic = state.device.currentCharacteristic;
  const prime = await operation(state.adaptor, state.emitter, OPS.READ, { deviceId: 1, characteristicUuid: 'CHAR' }, 'read-prime');
  const readDeferred = deferred();
  characteristic.readDeferred = readDeferred;
  enqueueOperation(state.adaptor, OPS.READ, { deviceId: 1, characteristicUuid: 'CHAR' }, 'read-old');
  await sleep(10);
  const beforeDrop = operationEvents(state.emitter, 'read-old').length;
  state.device.dropUnexpectedly();
  await sleep(40);
  const afterDrop = operationEvents(state.emitter, 'read-old');
  const reconnectPromise = operation(state.adaptor, state.emitter, OPS.CONNECT, { deviceId: 1 }, 'read-reconnect');
  const reconnectBeforeResolve = await Promise.race([reconnectPromise.then(() => true), sleep(40).then(() => false)]);
  readDeferred.resolve(new Uint8Array([2]).buffer);
  await sleep(20);
  const readEventsAfterResolve = operationEvents(state.emitter, 'read-old');
  const reconnectResult = await reconnectPromise;
  const delayedState = await setup();
  const delayedCharacteristic = delayedState.device.currentCharacteristic;
  const delayedRead = deferred();
  delayedCharacteristic.readDeferred = delayedRead;
  enqueueOperation(delayedState.adaptor, OPS.READ, { deviceId: 1, characteristicUuid: 'CHAR' }, 'read-delayed-old');
  await sleep(230);
  const delayedBeforeDrop = operationEvents(delayedState.emitter, 'read-delayed-old').length;
  delayedState.device.dropUnexpectedly();
  await sleep(40);
  const delayedAfterDrop = operationEvents(delayedState.emitter, 'read-delayed-old');
  const delayedReconnectPromise = operation(delayedState.adaptor, delayedState.emitter, OPS.CONNECT, { deviceId: 1 }, 'read-delayed-reconnect');
  const delayedReconnectBeforeResolve = await Promise.race([delayedReconnectPromise.then(() => true), sleep(40).then(() => false)]);
  delayedRead.resolve(new Uint8Array([3]).buffer);
  await sleep(20);
  const delayedReadEventsAfterResolve = operationEvents(delayedState.emitter, 'read-delayed-old');
  const delayedReconnectResult = await delayedReconnectPromise;
  return {
    prime: prime.name,
    beforeDrop,
    afterDrop: afterDrop.length ? afterDrop[afterDrop.length - 1].name : 'PENDING',
    readEventDeltaAfterResolve: readEventsAfterResolve.length - beforeDrop,
    reconnect: reconnectResult.name,
    reconnectBeforeResolve,
    delayedFirstRead: {
      beforeDrop: delayedBeforeDrop,
      afterDrop: delayedAfterDrop.length ? delayedAfterDrop[delayedAfterDrop.length - 1].name : 'PENDING',
      eventDeltaAfterResolve: delayedReadEventsAfterResolve.length - delayedBeforeDrop,
      reconnect: delayedReconnectResult.name,
      reconnectBeforeResolve: delayedReconnectBeforeResolve,
    },
  };
}

async function runScopedQueueScenario() {
  const state = await setup();
  const first = operation(state.adaptor, state.emitter, OPS.WRITE, { deviceId: 1, characteristicUuid: 'CHAR', data: [1] }, 'scope-first');
  await sleep(20);
  enqueueOperation(state.adaptor, OPS.WRITE, { deviceId: 2, characteristicUuid: 'CHAR', data: [2] }, 'scope-second-device');
  await sleep(5);
  state.device.dropUnexpectedly();
  const firstResult = await first;
  await sleep(30);
  const secondEvents = operationEvents(state.emitter, 'scope-second-device');
  return {
    first: firstResult.name,
    secondDeviceQueued: secondEvents.length ? secondEvents[secondEvents.length - 1].name : 'PENDING',
    secondDeviceEventCount: secondEvents.length,
  };
}

async function runDestroyReuseScenario() {
  const state = await setup({ reuseCharacteristic: true });
  const characteristic = state.device.currentCharacteristic;
  const oldStart = characteristic.startDeferred;
  enqueueOperation(state.adaptor, OPS.LISTEN, { deviceId: 1, characteristicUuid: 'CHAR' }, 'destroy-listen-old');
  await sleep(10);
  await state.adaptor.destroy();
  await state.adaptor.init();
  await operation(state.adaptor, state.emitter, OPS.STARTSCAN, { uuidFilterList: 'SERVICE' }, 'destroy-scan-new');
  await operation(state.adaptor, state.emitter, OPS.CONNECT, { deviceId: 1 }, 'destroy-connect-new');
  characteristic.startDeferred = deferred();
  enqueueOperation(state.adaptor, OPS.LISTEN, { deviceId: 1, characteristicUuid: 'CHAR' }, 'destroy-listen-new');
  await sleep(10);
  oldStart.resolve(characteristic);
  await sleep(10);
  const beforeDrop = operationEvents(state.emitter, 'destroy-listen-new').length;
  const listenerBeforeDrop = characteristic.listenerCount('characteristicvaluechanged');
  const notifyBeforeDrop = characteristic.notifyIsOn;
  state.device.dropUnexpectedly();
  await sleep(20);
  const afterDrop = operationEvents(state.emitter, 'destroy-listen-new');
  return {
    beforeDrop,
    listenerBeforeDrop,
    notifyBeforeDrop,
    afterDrop: afterDrop.length ? afterDrop[afterDrop.length - 1].name : 'PENDING',
    eventCount: afterDrop.length,
    listenerCount: characteristic.listenerCount('characteristicvaluechanged'),
    notifyIsOn: characteristic.notifyIsOn,
  };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertFixed(result) {
  const write = result.write;
  assertEqual(write.firstWrite, 'OPERATION_FAILED', 'fixed write first result');
  assertEqual(write.staleWriteCalls, 0, 'fixed stale write calls');
  assertEqual(write.reconnect, 'OPERATION_COMPLETE', 'fixed write reconnect');
  assertEqual(write.secondWrite, 'OPERATION_COMPLETE', 'fixed write second result');
  assertEqual(write.newWriteCalls, 1, 'fixed new write calls');
  assertEqual(write.eventCounts.firstWrite, 1, 'fixed write first event count');
  assertEqual(write.eventCounts.reconnect, 1, 'fixed write reconnect event count');
  assertEqual(write.eventCounts.secondWrite, 1, 'fixed write second event count');

  const notification = result.notification;
  assertEqual(notification.firstListen, 'OPERATION_FAILED', 'fixed first listen result');
  assertEqual(notification.staleListenerCount, 0, 'fixed stale listener count');
  assertEqual(notification.reconnect, 'OPERATION_COMPLETE', 'fixed notification reconnect');
  assertEqual(notification.secondListen, 'OPERATION_COMPLETE', 'fixed second listen result');
  assertEqual(notification.newListenerCount, 1, 'fixed new listener count');
  assertEqual(notification.newNotifyIsOn, 1, 'fixed new notify state');
  assertEqual(notification.eventCounts.firstListen, 1, 'fixed first listen event count');
  assertEqual(notification.eventCounts.reconnect, 1, 'fixed notification reconnect event count');
  assertEqual(notification.eventCounts.secondListen, 1, 'fixed second listen event count');

  const queued = result.queuedWrite;
  assertEqual(queued.firstWrite, 'OPERATION_FAILED', 'fixed queued first result');
  assertEqual(queued.queuedWrite, 'OPERATION_FAILED', 'fixed queued second result');
  assertEqual(queued.staleWriteCalls, 0, 'fixed queued stale writes');
  assertEqual(queued.retryEnqueued, true, 'fixed reentrant retry enqueued');
  assertEqual(queued.reentrantRetry, 'OPERATION_FAILED', 'fixed reentrant retry result');
  assertEqual(queued.eventCounts.firstWrite, 1, 'fixed queued first event count');
  assertEqual(queued.eventCounts.queuedWrite, 1, 'fixed queued second event count');
  assertEqual(queued.eventCounts.reentrantRetry, 1, 'fixed reentrant retry event count');

  const late = result.lateCallback;
  assertEqual(late.oldListen, 'OPERATION_FAILED', 'fixed late old listen result');
  assertEqual(late.reconnect, 'OPERATION_COMPLETE', 'fixed late callback reconnect');
  assertEqual(late.staleListenerCount, 0, 'fixed late stale listener count');
  assertEqual(late.beforeOldCallback, 0, 'fixed late callback pre-resolution event count');
  assertEqual(late.afterOldCallback, 0, 'fixed late callback event count before second drop');
  assertEqual(late.newOperationPendingBeforeSecondDrop, true, 'fixed late operation remains pending');
  assertEqual(late.secondDropResult, 'OPERATION_FAILED', 'fixed second drop rejects new operation');
  assertEqual(late.secondDropEventDelta, 1, 'fixed second drop event count');
  assertEqual(late.oldListenPromiseSettled, true, 'fixed old listen promise settled');

  const reused = result.reusedCharacteristic;
  const staleStart = reused.staleStart;
  assertEqual(staleStart.oldListen, 'OPERATION_FAILED', 'fixed reused old listen result');
  assertEqual(staleStart.listenerAfterOldStart, 0, 'fixed reused stale start listeners');
  assertEqual(staleStart.notifyAfterOldStart, 0, 'fixed reused stale start notify state');
  assertEqual(staleStart.secondListen, 'OPERATION_FAILED', 'fixed reused second listen result');
  assertEqual(staleStart.reconnectAgain, 'OPERATION_COMPLETE', 'fixed reused second reconnect');
  assertEqual(staleStart.finalListen, 'OPERATION_COMPLETE', 'fixed reused final listen');
  assertEqual(staleStart.finalListenerCount, 1, 'fixed reused final listener count');
  assertEqual(staleStart.finalNotifyIsOn, 1, 'fixed reused final notify state');
  const staleStop = reused.staleStop;
  assertEqual(staleStop.stopBeforeDrop, 0, 'fixed stale stop pending before drop');
  assertEqual(staleStop.stopAfterDrop, 'OPERATION_FAILED', 'fixed stale stop result');
  assertEqual(staleStop.stopEventDelta, 1, 'fixed stale stop event count');
  assertEqual(staleStop.reconnect, 'OPERATION_COMPLETE', 'fixed stale stop reconnect');
  assertEqual(staleStop.listenAfterStop, 'OPERATION_COMPLETE', 'fixed listen after stale stop');
  assertEqual(staleStop.listenerAfterLateStop, 1, 'fixed listener after stale stop callback');
  assertEqual(staleStop.notifyAfterLateStop, 1, 'fixed notify after stale stop callback');

  const native = result.nativeNotification;
  assertEqual(native.startBeforeReject, 0, 'fixed native start remains pending');
  assertEqual(native.startAfterReject, 'OPERATION_FAILED', 'fixed native start rejection');
  assertEqual(native.startRejectEventCount, 1, 'fixed native start event count');
  assertEqual(native.startSuccess, 'OPERATION_COMPLETE', 'fixed native start recovery');
  assertEqual(native.stopBeforeReject, 0, 'fixed native stop remains pending');
  assertEqual(native.stopAfterReject, 'OPERATION_FAILED', 'fixed native stop rejection');
  assertEqual(native.stopRejectEventCount, 1, 'fixed native stop event count');
  assertEqual(native.stopSuccess, 'OPERATION_COMPLETE', 'fixed native stop recovery');
  assertEqual(native.unhandledRejectionDelta, 0, 'fixed native rejection handling');

  const read = result.immediateRead;
  assertEqual(read.prime, 'OPERATION_COMPLETE', 'fixed read prime');
  assertEqual(read.beforeDrop, 0, 'fixed immediate read pending before drop');
  assertEqual(read.afterDrop, 'OPERATION_FAILED', 'fixed immediate read rejection');
  assertEqual(read.readEventDeltaAfterResolve, 1, 'fixed immediate read event count after late resolve');
  assertEqual(read.reconnectBeforeResolve, true, 'fixed reconnect is unblocked by read drop');
  assertEqual(read.reconnect, 'OPERATION_COMPLETE', 'fixed read reconnect');
  assertEqual(read.delayedFirstRead.beforeDrop, 0, 'fixed delayed first read pending before drop');
  assertEqual(read.delayedFirstRead.afterDrop, 'OPERATION_FAILED', 'fixed delayed first read rejection');
  assertEqual(read.delayedFirstRead.eventDeltaAfterResolve, 1, 'fixed delayed read event count after late resolve');
  assertEqual(read.delayedFirstRead.reconnectBeforeResolve, true, 'fixed delayed read unblocks reconnect');
  assertEqual(read.delayedFirstRead.reconnect, 'OPERATION_COMPLETE', 'fixed delayed read reconnect');

  const scoped = result.scopedQueue;
  assertEqual(scoped.first, 'OPERATION_FAILED', 'fixed scoped queue first result');
  assertEqual(scoped.secondDeviceQueued, 'OPERATION_COMPLETE', 'fixed other-device queue survives drop');
  assertEqual(scoped.secondDeviceEventCount, 1, 'fixed other-device queue event count');

  const destroyReuse = result.destroyReuse;
  assertEqual(destroyReuse.beforeDrop, 0, 'fixed destroy reused listen remains pending');
  assertEqual(destroyReuse.listenerBeforeDrop, 0, 'fixed destroy reused stale listener before drop');
  assertEqual(destroyReuse.notifyBeforeDrop, 0, 'fixed destroy reused notify before drop');
  assertEqual(destroyReuse.afterDrop, 'OPERATION_FAILED', 'fixed destroy reused listen rejection');
  assertEqual(destroyReuse.eventCount, 1, 'fixed destroy reused event count');
  assertEqual(destroyReuse.listenerCount, 0, 'fixed destroy reused stale listener count');
  assertEqual(destroyReuse.notifyIsOn, 0, 'fixed destroy reused notify state');
}

function assertBaseline(result) {
  assertEqual(result.write.staleWriteCalls, 1, 'baseline stale write calls');
  assertEqual(result.notification.firstListen, 'OPERATION_COMPLETE', 'baseline first listen result');
  assertEqual(result.notification.staleListenerCount, 1, 'baseline stale listener count');
  assertEqual(result.queuedWrite.queuedWrite, 'OPERATION_COMPLETE', 'baseline queued write result');
  assertEqual(result.queuedWrite.staleWriteCalls, 1, 'baseline queued stale writes');
  assertEqual(result.queuedWrite.retryEnqueued, false, 'baseline reentrant retry absent');
  assertEqual(result.queuedWrite.reentrantRetry, 'MISSING', 'baseline reentrant retry result');
  assertEqual(result.lateCallback.oldListen, 'OPERATION_COMPLETE', 'baseline late old listen result');
  assertEqual(result.lateCallback.staleListenerCount, 1, 'baseline late stale listener count');
  assertEqual(result.lateCallback.secondDropEventDelta, 0, 'baseline late second drop event count');
  assertEqual(result.reusedCharacteristic.staleStart.listenerAfterOldStart, 1, 'baseline reused stale start listener count');
  assertEqual(result.reusedCharacteristic.staleStop.stopBeforeDrop, 1, 'baseline stale stop completes before drop');
  assertEqual(result.reusedCharacteristic.staleStop.stopAfterDrop, 'OPERATION_COMPLETE', 'baseline stale stop result');
  assertEqual(result.reusedCharacteristic.staleStop.listenerAfterLateStop, 0, 'baseline late stop listener count');
  assertEqual(result.nativeNotification.startBeforeReject, 1, 'baseline native start completes early');
  assertEqual(result.nativeNotification.startAfterReject, 'OPERATION_COMPLETE', 'baseline native start result');
  assertEqual(result.nativeNotification.stopBeforeReject, 1, 'baseline native stop completes early');
  assertEqual(result.nativeNotification.stopAfterReject, 'OPERATION_COMPLETE', 'baseline native stop result');
  assertEqual(result.immediateRead.prime, 'OPERATION_COMPLETE', 'baseline read prime');
  assertEqual(result.immediateRead.beforeDrop, 0, 'baseline immediate read pending before drop');
  assertEqual(result.immediateRead.afterDrop, 'PENDING', 'baseline immediate read remains pending after drop');
  assertEqual(result.immediateRead.reconnectBeforeResolve, false, 'baseline reconnect waits for read');
  assertEqual(result.immediateRead.delayedFirstRead.afterDrop, 'PENDING', 'baseline delayed read remains pending after drop');
  assertEqual(result.immediateRead.delayedFirstRead.reconnectBeforeResolve, false, 'baseline delayed read blocks reconnect');
  assertEqual(result.scopedQueue.secondDeviceQueued, 'OPERATION_COMPLETE', 'baseline other-device queue result');
  assertEqual(result.destroyReuse.beforeDrop, 1, 'baseline destroy reused listen completes early');
  assertEqual(result.destroyReuse.listenerBeforeDrop, 1, 'baseline destroy reused stale listener before drop');
  assertEqual(result.destroyReuse.notifyBeforeDrop, 1, 'baseline destroy reused notify before drop');
  assertEqual(result.destroyReuse.listenerCount, 1, 'baseline destroy reused stale listener');
}

(async () => {
  const result = {
    source: SOURCE,
    write: await runWriteScenario(),
    notification: await runNotificationScenario(),
    queuedWrite: await runQueuedWriteScenario(),
    lateCallback: await runLateCallbackScenario(),
    reusedCharacteristic: await runReusedCharacteristicScenario(),
    nativeNotification: await runNativeNotificationScenario(),
    immediateRead: await runImmediateReadScenario(),
    scopedQueue: await runScopedQueueScenario(),
    destroyReuse: await runDestroyReuseScenario(),
  };
  const mode = process.argv[3] || 'report';
  if (mode === 'fixed') assertFixed(result);
  if (mode === 'baseline') assertBaseline(result);
  console.log(JSON.stringify(result, null, 2));
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
