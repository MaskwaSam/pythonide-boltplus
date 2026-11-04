// Patch only the original full application's WebBluetooth module 6490.
// The application entry is suppressed while reading factories; no app module runs.
'use strict';
const vm = require('node:vm');
const patchNeoReconnect = require('./neo-reconnect-patch.cjs');
const patchBleLifecycle = require('./patch-ble-lifecycle.cjs');
const ENTRY = 'var __webpack_exports__=__webpack_require__(9366)';

function requireOnce(source, text, label) {
  const count = source.split(text).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, got ${count}`);
}

function patchFullBundle(source) {
  if (typeof source !== 'string') throw new TypeError('source must be a string');
  requireOnce(source, ENTRY, 'original application entry');
  const context = {
    window: {},
    document: { baseURI: 'https://localhost/', currentScript: { src: 'https://localhost/static/js/main.js' } },
    URL, Symbol, Object, Promise
  };
  context.self = context.window;
  vm.runInNewContext(source.replace(ENTRY, 'window.__spheroModules = __webpack_modules__'), context, { timeout: 1000 });
  const factory = context.window.__spheroModules?.[6490];
  if (typeof factory !== 'function') throw new Error('WebBluetooth module 6490 is missing');
  const originalModule = factory.toString();
  requireOnce(source, originalModule, 'WebBluetooth factory source');
  const start = source.indexOf(originalModule), end = start + originalModule.length;
  if (source.slice(start - 5, start) !== '6490:' || !/^,\d+:/.test(source.slice(end, end + 20))) {
    throw new Error('Unexpected WebBluetooth module boundaries');
  }
  // The reviewed Neo helper uses these anchors to replace bounded operations.
  // Reject ambiguity before invoking it, in addition to its exact text guards.
  for (const anchor of ['K=function(e){', '},q=function(e){', 'q=function(e){', '},Y=function(e){',
    'Y=function(e){', '},Z=function(e){', 'Z=function(e){', '},J=function(){',
    'W=function(e){', '},K=function(e){']) requireOnce(originalModule, anchor, 'Neo operation boundary ' + anchor);
  let moduleSource = patchNeoReconnect(originalModule);
  moduleSource = patchBleLifecycle(moduleSource);
  // Splice the single factory back into its original byte positions. The app,
  // EV3, runtime, source map trailer, and every other module remain verbatim.
  const result = source.slice(0, start) + moduleSource + source.slice(end);
  new vm.Script(result, { filename: 'patched-original-main.js' });
  return result;
}

module.exports = patchFullBundle;
module.exports.patchFullBundle = patchFullBundle;
