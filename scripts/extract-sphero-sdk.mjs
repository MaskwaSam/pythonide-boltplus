// Rebuild the minimal SDK from the user's extracted Sphero Edu ZIP (reference/).
// Only Node built-ins are needed. The Sphero application entry point never runs.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const patchNeoReconnect = require('./neo-reconnect-patch.cjs');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'reference');
const outputDir = path.join(root, 'vendor/sphero');
const original = fs.readFileSync(path.join(sourceDir, 'static/js/main.55f08aa7.js'), 'utf8');
const entry = 'var __webpack_exports__=__webpack_require__(9366)';
if (original.split(entry).length !== 2) throw new Error('Unexpected upstream app entry. Recheck SDK extraction.');
const context = { window: {}, document: { baseURI: 'https://localhost/', currentScript: { src: 'https://localhost/static/js/main.js' } }, URL, Symbol, Object, Promise };
context.self = context.window;
vm.runInNewContext(original.replace(entry, 'window.__spheroModules = __webpack_modules__'), context);
const modules = context.window.__spheroModules;
const selected = new Set();
function visit(id) {
  if (selected.has(id)) return;
  selected.add(id);
  const code = modules[id]?.toString();
  if (!code) throw new Error('Missing module ' + id);
  const args = code.slice(0, code.indexOf('=>')).replace(/[()\s]/g, '').split(',');
  const requireName = args[2];
  if (!requireName) return;
  for (const match of code.matchAll(new RegExp('\\b' + requireName + '\\((\\d+)\\)', 'g'))) visit(Number(match[1]));
}
visit(13357);
const tail = original.slice(original.indexOf('__webpack_module_cache__={}'))
  .replace(entry, 'window.SpheroSDK = __webpack_require__(13357)')
  .replace('//# sourceMappingURL=main.55f08aa7.js.map', '');
let output = '/*! SDK modules extracted from the user-supplied Sphero Edu archive. See PROVENANCE.txt. */\n' +
  '(()=>{var __webpack_modules__={' + [...selected].sort((a, b) => a - b).map(id => id + ':' + (id === 6490 ? patchNeoReconnect(modules[id].toString()) : modules[id].toString())).join(',') + '},' + tail;
// Upstream destroy clears its device list before disconnecting GATT or timers.
// Releasing those handles is needed after cancellation, timeouts, and retry.
const oldDestroy = 'destroy:function(){C(),M(),x.removeEventListener("availabilitychanged",X)}';
const newDestroy = 'destroy:function(){++_ideEpoch;M();for(var e of s.slice())if(e){e.removeEventListener("gattserverdisconnected",I);var t=_ideDeviceOwners.get(e);if(!t||t.adapter===_ideAdapterOwner)try{e.gatt.disconnect()}catch(t){}}C();x.removeEventListener("availabilitychanged",X)}';
if (output.split(oldDestroy).length !== 2) throw new Error('Unexpected Web Bluetooth teardown. Recheck patch.');
output = output.replace(oldDestroy, newDestroy);
const lifecyclePatches = [
  ['o=n(6082);e.exports=function(e){const t=new i,n=new o({"Class Name":"WebBluetooth"});', 'o=n(6082);const _ideDeviceOwners=new WeakMap;e.exports=function(e){const t=new i,n=new o({"Class Name":"WebBluetooth"});'],
  ['var s,l,u,c,p,d,h,m,f,g,b,y,v,x=navigator.bluetooth', 'var s,l,u,c,p,d,h,m,f,g,b,y,v,_ideEpoch=0,_ideAdapterOwner={},x=navigator.bluetooth'],
  ['N=function(e){return n.log("Looking for devices.")', 'N=function(e){const _ideScanEpoch=_ideEpoch,_ideScanOwner={adapter:_ideAdapterOwner};return n.log("Looking for devices.")'],
  ['init:function(){return C(),x.addEventListener("availabilitychanged",X)', 'init:function(){return ++_ideEpoch,C(),x.addEventListener("availabilitychanged",X)'],
  ['x.requestDevice(r).then((e=>(z(e),n.log("Selected device:",e),e.gatt.connect())))',
   'x.requestDevice(r).then((e=>{if(_ideScanEpoch!==_ideEpoch)throw new Error("Connection cancelled");_ideDeviceOwners.set(e,_ideScanOwner);z(e);n.log("Selected device:",e);return e.gatt.connect().then(t=>{if(_ideScanEpoch!==_ideEpoch){_ideDeviceOwners.get(e)===_ideScanOwner&&e.gatt.disconnect();throw new Error("Connection cancelled")}return t})}))']
];
for (const [before, after] of lifecyclePatches) {
  if (output.split(before).length !== 2) throw new Error('Unexpected Bluetooth scan lifecycle. Recheck patch.');
  output = output.replace(before, after);
}
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'sphero-sdk.js'), output);
for (const name of ['toybox.js', 'core-4.6.0.wasm']) fs.copyFileSync(path.join(sourceDir, 'sdk', name), path.join(outputDir, name));
const sourceHash = crypto.createHash('sha256').update(original).digest('hex');
fs.writeFileSync(path.join(outputDir, 'PROVENANCE.txt'),
  'Source: user-supplied sphero-boltplus-ev3-file-resource-20260927.zip\n' +
  'Sphero Edu SDK remains third-party Sphero code. No new license is granted here.\n' +
  'The supplied archive did not contain the .LICENSE.txt files named in its bundle headers. Original toybox.js header is preserved.\n' +
  'toybox.js and core-4.6.0.wasm are copied without modification.\n' +
  'sphero-sdk.js contains the reachable SDK modules and webpack bootstrap; the Edu UI entry is excluded.\n' +
  'Local SDK patch: WebBluetooth.destroy clears timers before state reset and disconnects tracked GATT devices before dropping handles; late chooser/connect results cannot reopen a disposed session.\n' +
  'IDE session protection: monotonic scan epochs and module-shared device ownership preserve replacement connections when old native results arrive.\n' +
  'Recovery patch: reviewed module-6490 transformations adapted to this archive before local teardown/scan epoch safeguards.\n' +
  'Neo build-candidate.cjs SHA-256: 05d05e46aa0f7d4503014a7eb5f26cb3cf1a168c11003e4e9e8a9e18319cb743\n' +
  'Rebuild: node scripts/extract-sphero-sdk.mjs (requires extracted reference/).\n' +
  'Original main.55f08aa7.js SHA-256: ' + sourceHash + '\n' +
  'SDK modules: ' + [...selected].sort((a, b) => a - b).join(', ') + '\n');
console.log('Extracted ' + selected.size + ' SDK modules (' + Buffer.byteLength(output) + ' bytes).');
