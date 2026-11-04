'use strict';

// Module-6490 lifecycle safeguards shared by the original app and minimal SDK.
function patchBleLifecycle(moduleSource) {
  function replaceOnce(before, after, label) {
    const count = moduleSource.split(before).length - 1;
    if (count !== 1) throw new Error(`${label}: expected 1 match, got ${count}`);
    moduleSource = moduleSource.replace(before, after);
  }
const oldDestroy = 'destroy:function(){C(),M(),x.removeEventListener("availabilitychanged",X)}';
const newDestroy = 'destroy:function(){++_ideEpoch;M();for(var e of s.slice())if(e){e.removeEventListener("gattserverdisconnected",I);var t=_ideDeviceOwners.get(e);if(!t||t.adapter===_ideAdapterOwner)try{e.gatt.disconnect()}catch(t){}}C();x.removeEventListener("availabilitychanged",X)}';
if (moduleSource.split(oldDestroy).length !== 2) throw new Error('Unexpected Web Bluetooth teardown. Recheck patch.');
moduleSource = moduleSource.replace(oldDestroy, newDestroy);
const lifecyclePatches = [
  ['o=n(6082);e.exports=function(e){const t=new i,n=new o({"Class Name":"WebBluetooth"});', 'o=n(6082);const _ideDeviceOwners=new WeakMap;e.exports=function(e){const t=new i,n=new o({"Class Name":"WebBluetooth"});'],
  ['var s,l,u,c,p,d,h,m,f,g,b,y,v,x=navigator.bluetooth', 'var s,l,u,c,p,d,h,m,f,g,b,y,v,_ideEpoch=0,_ideAdapterOwner={},x=navigator.bluetooth'],
  ['N=function(e){return n.log("Looking for devices.")', 'N=function(e){const _ideScanEpoch=_ideEpoch,_ideScanOwner={adapter:_ideAdapterOwner};return n.log("Looking for devices.")'],
  ['init:function(){return C(),x.addEventListener("availabilitychanged",X)', 'init:function(){return ++_ideEpoch,C(),x.addEventListener("availabilitychanged",X)'],
  ['x.requestDevice(r).then((e=>(z(e),n.log("Selected device:",e),e.gatt.connect())))',
   'x.requestDevice(r).then((e=>{if(_ideScanEpoch!==_ideEpoch)throw new Error("Connection cancelled");_ideDeviceOwners.set(e,_ideScanOwner);z(e);n.log("Selected device:",e);return e.gatt.connect().then(t=>{if(_ideScanEpoch!==_ideEpoch){_ideDeviceOwners.get(e)===_ideScanOwner&&e.gatt.disconnect();throw new Error("Connection cancelled")}return t})}))']
];
for (const [before, after] of lifecyclePatches) {
  if (moduleSource.split(before).length !== 2) throw new Error('Unexpected Bluetooth scan lifecycle. Recheck patch.');
  moduleSource = moduleSource.replace(before, after);
}

  // Continue the epoch/ownership contract through discovery and CONNECT retries.
  // Dispatch promises may settle after native work has been cancelled; ownership
  // checks prevent that work from reopening or mutating replacement sessions.
  const helpers = `
const _idePending=new Set;
function _ideClose(token){if(token.device&&_ideDeviceOwners.get(token.device)===token.owner)try{token.device.gatt.disconnect()}catch(error){}}
function _ideCheck(token){if(token.done||token.epoch!==_ideEpoch||(token.device&&_ideDeviceOwners.get(token.device)!==token.owner)||(token.id!=null&&(B(token.id)!==token.device||(G0[token.id]||0)!==token.generation))){_ideClose(token);throw new Error("Connection cancelled")}}
function _ideFinish(token){token.done=true;clearTimeout(token.timer);_idePending.delete(token)}
function _ideCancelPending(device){for(const token of Array.from(_idePending))if(!device||token.device===device){_ideFinish(token);token.reject(new Error("Connection cancelled"))}}
function _ideRun(device,action){return new Promise((resolve,reject)=>{const token={epoch:_ideEpoch,owner:{adapter:_ideAdapterOwner},device:device||null,id:device?F(device):null,done:false,reject,timer:null};if(device){token.generation=G0[token.id]||0;_ideDeviceOwners.set(device,token.owner)}_idePending.add(token);Promise.resolve().then(()=>{_ideCheck(token);return action(token)}).then(value=>{_ideCheck(token);_ideFinish(token);resolve(value)},error=>{_ideFinish(token);reject(error)}).catch(error=>{_ideFinish(token);reject(error)})})}
`;
  replaceOnce('const t=new i,n=new o({"Class Name":"WebBluetooth"});', 'const t=new i,n=new o({"Class Name":"WebBluetooth"});' + helpers, 'lifecycle token helpers');
  replaceOnce('destroy:function(){++_ideEpoch;M();', 'destroy:function(){++_ideEpoch;_ideCancelPending();M();', 'cancel pending native operations on destroy');
  replaceOnce('init:function(){return ++_ideEpoch,C()', 'init:function(){return ++_ideEpoch,_ideCancelPending(),C()', 'cancel old operations on initialize');

  function replaceRange(start, end, replacement, label) {
    for (const anchor of [start, end]) {
      const count = moduleSource.split(anchor).length - 1;
      if (count !== 1) throw new Error(`${label}: expected 1 boundary match, got ${count}`);
    }
    const a = moduleSource.indexOf(start), b = moduleSource.indexOf(end, a);
    if (b < a) throw new Error(`${label}: invalid boundary order`);
    moduleSource = moduleSource.slice(0, a) + replacement + moduleSource.slice(b);
  }
  replaceRange('T=function(e){', ',R=function(e,t){', `T=async function(e,token){_ideCheck(token);const id=F(e.device);if(!id||e.device!==token.device||B(id)!==token.device||!l[id-1])throw new Error("Connection cancelled");l[id-1][e.uuid]=e;const characteristics=await e.getCharacteristics();_ideCheck(token);for(const characteristic of characteristics)j(id,characteristic.service.uuid,characteristic,token)},j=function(e,i,a,token){_ideCheck(token);if(!u[e-1])throw new Error("Connection cancelled");u[e-1][a.uuid.toUpperCase()]=a;t.trigger(r.ADAPTOR.CHARACTERISTIC_FOUND,[{deviceId:e,service:i,characteristic:a.uuid}])}`, 'await guarded service and characteristic discovery');
  replaceRange('z=function(e){', ',P=function(e){', `z=function(e,token){if(!p||!e||!c.length)return Promise.resolve();return Promise.resolve().then(function(){_ideCheck(token);const id=P(e);token.id=id;token.generation=G0[id]||0;t.trigger(r.ADAPTOR.DEVICE_FOUND,[{id:id,name:e.name,address:e.id,rssi:-40,power:80}])})}`, 'guard discovered device publication');
  const scanStart = 'N=function(e){';
  const scanEnd = ',V=function(e){';
  const scan = moduleSource.slice(moduleSource.indexOf(scanStart), moduleSource.indexOf(scanEnd));
  const filterStart = scan.indexOf('var r={filters:[]};');
  const filterEnd = scan.indexOf('function(){for(var e=0;e<s.length;');
  if (filterStart < 0 || filterEnd < filterStart) throw new Error('scan filter bounds missing');
  const filters = scan.slice(filterStart, filterEnd);
  // Preserve upstream filter creation and its BOLT+ optional service UUIDs.
  replaceRange(scanStart, scanEnd, `N=function(e){p=!0;return _ideRun(null,async token=>{${filters}void 0;for(var index=0;index<s.length;index++){const device=s[index];if(device){O(index+1);device.removeEventListener("gattserverdisconnected",I);const owner=_ideDeviceOwners.get(device);if(!owner||owner.adapter===_ideAdapterOwner)device.gatt.disconnect()}}s=[];const device=await x.requestDevice(r);_ideCheck(token);token.device=device;_ideDeviceOwners.set(device,token.owner);await z(device,token);_ideCheck(token);const server=await device.gatt.connect();_ideCheck(token);const services=await server.getPrimaryServices();_ideCheck(token);await Promise.all(services.map(service=>T(service,token)));_ideCheck(token)}).catch(error=>{if(String(error&&error.message||error).includes("User cancelled"))throw "User cancelled request for devices";throw error})}`, 'guard complete scan discovery');
  replaceRange('H=function(e,t,i){', 'var W=function(e){', `H=function(e,t,i){_ideRun(e,token=>U(token,3,2,async function(){_ideCheck(token);const server=await e.gatt.connect();_ideCheck(token);e.addEventListener("gattserverdisconnected",I);const services=await server.getPrimaryServices();_ideCheck(token);await Promise.all(services.map(service=>T(service,token)));_ideCheck(token);b[F(e)]=!0;w=!0;A=!0})).then(t,i)};async function U(token,tries,delay,attempt){_ideCheck(token);try{return await attempt()}catch(error){_ideCheck(token);if(!tries)throw new Error("Failed on max reconnect attempts!");await new Promise(resolve=>{token.timer=setTimeout(resolve,1000*delay)});_ideCheck(token);return U(token,tries-1,delay*2,attempt)}}`, 'guard reconnect attempts and cancel retry timers');
  replaceOnce('M(t),v=Promise.resolve(),Q0(t);', '_ideCancelPending(B(t)),M(t),v=Promise.resolve(),Q0(t);', 'cancel pending explicit disconnect work');
  replaceOnce('M(a)&&(v=Promise.resolve()),Q0(a)', '_ideCancelPending(o),M(a)&&(v=Promise.resolve()),Q0(a)', 'cancel pending unexpected disconnect work');
  replaceOnce('m=!0,f=d[0];var e=h[0];', 'm=!0,f=d[0];const _ideOperationEpoch=_ideEpoch;var e=h[0];', 'operation completion epoch');
  const queueCompletion = 'm=!1,J()';
  if (moduleSource.split(queueCompletion).length !== 3) throw new Error('expected exactly two queue completion callbacks');
  moduleSource = moduleSource.split(queueCompletion).join('_ideOperationEpoch===_ideEpoch&&(m=!1,J())');

  return moduleSource;
}
module.exports = patchBleLifecycle;
module.exports.patchBleLifecycle = patchBleLifecycle;
