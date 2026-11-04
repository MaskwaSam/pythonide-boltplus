'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const patchFullBundle = require('../scripts/patch-original-transport.cjs');
const sourcePath = process.env.ORIGINAL_BUNDLE_SOURCE || path.resolve(__dirname, '../reference/static/js/main.55f08aa7.js');
const sdkPath = process.env.SDK_TRANSPORT_SOURCE || path.resolve(__dirname, '../vendor/sphero/sphero-sdk.js');
const originalBytes = fs.readFileSync(sourcePath);
const original = originalBytes.toString('utf8');
const patched = patchFullBundle(original);
const hash = source => crypto.createHash('sha256').update(source).digest('hex');
function modules(source) {
  const fullEntry = 'var __webpack_exports__=__webpack_require__(9366)';
  const entry = source.includes(fullEntry) ? fullEntry : 'window.SpheroSDK = __webpack_require__(13357)';
  assert.equal(source.split(entry).length, 2);
  const context = { window: {}, document: { baseURI: 'https://localhost/', currentScript: { src: 'https://localhost/static/js/main.js' } }, URL, Symbol, Object, Promise };
  context.self = context.window;
  vm.runInNewContext(source.replace(entry, 'window.__modules = __webpack_modules__'), context, { timeout: 1000 });
  return context.window.__modules;
}
const before = modules(original), after = modules(patched);

test('only module 6490 changes and the entire surrounding bundle stays byte-for-byte identical', () => {
  assert.deepEqual(Object.keys(after), Object.keys(before));
  const changed = Object.keys(before).filter(id => before[id].toString() !== after[id].toString());
  assert.deepEqual(changed, ['6490']);
  const oldFactory = before[6490].toString(), newFactory = after[6490].toString();
  const start = original.indexOf(oldFactory), patchedStart = patched.indexOf(newFactory);
  assert.equal(patchedStart, start);
  const prefix = Buffer.from(original.slice(0, start)), suffix = Buffer.from(original.slice(start + oldFactory.length));
  assert.ok(Buffer.from(patched.slice(0, patchedStart)).equals(prefix));
  assert.ok(Buffer.from(patched.slice(patchedStart + newFactory.length)).equals(suffix));
  new vm.Script(patched);
  console.log(JSON.stringify({ modules: Object.keys(before).length, changedModules: changed, unchangedModules: Object.keys(before).length - 1, prefixBytes: prefix.length, suffixBytes: suffix.length, originalFactoryBytes: Buffer.byteLength(oldFactory), patchedFactoryBytes: Buffer.byteLength(newFactory), sourceBytes: originalBytes.length, candidateBytes: Buffer.byteLength(patched), sourceSha256: hash(originalBytes), candidateSha256: hash(patched) }));
});

test('full-bundle factory uses the exact shared Neo and strengthened lifecycle transformations', () => {
  const neo = require('../scripts/neo-reconnect-patch.cjs');
  const lifecycle = require('../scripts/patch-ble-lifecycle.cjs');
  assert.equal(after[6490].toString(), lifecycle(neo(before[6490].toString())));
  assert.equal(after[6490].toString(), modules(fs.readFileSync(sdkPath, 'utf8'))[6490].toString(), 'original app and extracted SDK must use the same transport factory');
});

test('strict guards reject wrong, repeated, already patched and missing lifecycle inputs', () => {
  assert.throws(() => patchFullBundle(null), /must be a string/);
  assert.throws(() => patchFullBundle(original.replace('var __webpack_exports__=__webpack_require__(9366)', 'void 0')), /application entry: expected 1 match, got 0/);
  assert.throws(() => patchFullBundle(original + ';var __webpack_exports__=__webpack_require__(9366)'), /application entry: expected 1 match, got 2/);
  assert.throws(() => patchFullBundle(original + ';void (' + before[6490].toString() + ')'), /factory source: expected 1 match, got 2/);
  assert.throws(() => patchFullBundle(patched), /expected 1 match/);
  assert.throws(() => patchFullBundle(original.replace('destroy:function(){C(),M(),x.removeEventListener("availabilitychanged",X)}', 'destroy:function(){}')), /teardown/);
});

test('reading and patching leave the reference file immutable', () => {
  assert.ok(fs.readFileSync(sourcePath).equals(originalBytes));
});
