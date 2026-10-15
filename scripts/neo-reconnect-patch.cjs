// Exact reviewed Neo module-6490 transformations, reconstructed from saved evidence.
// Original build-candidate.cjs SHA-256: 05d05e46aa0f7d4503014a7eb5f26cb3cf1a168c11003e4e9e8a9e18319cb743
// Input and output are the webpack module factory source (without the numeric key).
'use strict';

function patchModule(moduleSource) {
  if (typeof moduleSource !== 'string') throw new TypeError('moduleSource must be a string');
function replaceOnce(oldText, newText, label) {
  const count = moduleSource.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, got ${count}`);
  moduleSource = moduleSource.replace(oldText, newText);
}

replaceOnce(
  'S=null,E=null,C=function(){d=[],h=[],s=[],l=[],u=[],c=[],b={},p=!1,m=!1,g="",y=0,v=Promise.resolve(),S=null,E=null,k[a.ENUM_PLATFORM_OP_BLE_STARTSCAN]=N',
  'S=null,E=null,R0={},G0={},C=function(){M(),d&&h&&Q0();for(var e=0;s&&e<s.length;e++)s[e]&&O(e+1);d=[],h=[],s=[],l=[],u=[],c=[],b={},p=!1,m=!1,g="",y=0,v=Promise.resolve(),S=null,E=null,R0={},k[a.ENUM_PLATFORM_OP_BLE_STARTSCAN]=N',
  'state and initializer'
);

replaceOnce(
  'M=function(){null!==S&&(clearTimeout(S),S=null),null!==E&&(clearTimeout(E),E=null)},D=function(e){return n.error(e),new Error(e)},T=function(e){',
  'M=function(e){var t=!1,i;if(void 0!==e){if(i=R0[e]){null!==S&&(clearTimeout(S),S=null),null!==E&&(clearTimeout(E),E=null),i.reject(D("Bluetooth device disconnected")),delete R0[e],t=!0}}else{for(var o in R0)i=R0[o],i&&(i.reject(D("Bluetooth device disconnected")),delete R0[o],t=!0);null!==S&&(clearTimeout(S),S=null),null!==E&&(clearTimeout(E),E=null)}return t},D=function(e){return n.error(e),new Error(e)},N0=function(e){R0[e.deviceId]===e&&delete R0[e.deviceId]},Q0=function(e){if(d&&h){var n=d.splice(0),i=h.splice(0),o=[],s=[];for(var l=0;l<i.length;l++){var u=i[l];!e||void 0!==u.deviceId&&u.deviceId==e?t.trigger(r.ADAPTOR.OPERATION_FAILED,[{opperation:u.opperation,opperationId:u.opperationId,message:"Bluetooth device disconnected"}]):(o.push(n[l]),s.push(u))}d=o.concat(d),h=s.concat(h)}},T=function(e){',
  'cleanup, per-operation token, and queued-operation helper'
);

replaceOnce(
  'O=function(e){u[e-1]={},l[e-1]={},delete b[e]},B=function(e){',
  'O=function(e){G0[e]=(G0[e]||0)+1;var t=u[e-1];if(t)for(var i in t){var o=t[i];o&&(o.removeEventListener&&o.removeEventListener("characteristicvaluechanged",L),o.notifyIsOn=0)}u[e-1]={},l[e-1]={},delete b[e]},B=function(e){',
  'characteristic listener cleanup'
);

replaceOnce(
  'I=function(e){var i=e.target,a=F(i);if(a){var o=B(a),s=o.gatt.connected;n.log("Device was disconnected! connected = ",s),a in b&&!s&&(n.log("Cleaning up after disconnection"),o.removeEventListener("gattserverdisconnected",I),o.gatt.disconnect(),O(a),n.log("Sending disconnected event",a),t.trigger(r.ADAPTOR.DEVICE_DISCONNECTED,[a]))}},L=function(e){',
  'I=function(e){var i=e.target,a=F(i);if(a){var o=B(a),s=o.gatt.connected;n.log("Device was disconnected! connected = ",s),a in b&&!s&&(n.log("Cleaning up after disconnection"),M(a)&&(v=Promise.resolve()),Q0(a),o.removeEventListener("gattserverdisconnected",I),o.gatt.disconnect(),O(a),n.log("Sending disconnected event",a),t.trigger(r.ADAPTOR.DEVICE_DISCONNECTED,[a]))}},L=function(e){',
  'automatic-disconnect cleanup'
);

const kStart = moduleSource.indexOf('K=function(e){');
const kEnd = moduleSource.indexOf('},q=function(e){', kStart);
if (kStart < 0 || kEnd < 0) throw new Error('read operation bounds not found');
moduleSource = moduleSource.slice(0, kStart) +
  'K=function(e){if(!n.requireOptions(["deviceId","characteristicUuid"],e))return-1;var t=e.deviceId,i=e.characteristicUuid;return n.log("Reading characteristic.",i),new Promise((function(e,n){var r=R(t,i),o=B(t);if(!r)return n("Invalid characteristic!");if(!o||!o.gatt.connected)return n(D("Bluetooth device is not connected"));if(!A){const p={reject:n,deviceId:t,generation:G0[t]||0};R0[t]=p;return Promise.resolve().then((function(){return r.readValue()})).then((function(a){if(!o.gatt.connected||B(t)!==o||R(t,i)!==r||(G0[t]||0)!==p.generation)return N0(p),n(D("Bluetooth device disconnected before read"));N0(p),e(a)}),(function(a){return N0(p),n(a)}))}A=!1,null!==E&&clearTimeout(E);const p={reject:n,deviceId:t,generation:G0[t]||0};R0[t]=p,E=setTimeout((()=>{if(E=null,!o.gatt.connected||B(t)!==o||R(t,i)!==r||(G0[t]||0)!==p.generation)return N0(p),p.reject(D("Bluetooth device disconnected before read"));try{var a=r.readValue();Promise.resolve(a).then((function(a){if(!o.gatt.connected||B(t)!==o||R(t,i)!==r||(G0[t]||0)!==p.generation)return N0(p),n(D("Bluetooth device disconnected before read"));N0(p),e(a)}),(function(a){N0(p),n(a)}))}catch(e){N0(p),n(D("Error occurred during read"))}}),200)}))' +
  moduleSource.slice(kEnd);

const qStart = moduleSource.indexOf('q=function(e){');
const qEnd = moduleSource.indexOf('},Y=function(e){', qStart);
if (qStart < 0 || qEnd < 0) throw new Error('write operation bounds not found');
moduleSource = moduleSource.slice(0, qStart) +
  'q=function(e){if(!n.requireOptions(["deviceId","characteristicUuid","data"],e))return-1;var t=e.deviceId,i=e.characteristicUuid,r=e.data;return n.log("Writing to characteristic.",i,r,t),new Promise((function(e,a){var o=B(t);if(!o)return n.log("Bluetooth Device was not found while trying to write"),e();if(!o.gatt.connected)return a(D("Bluetooth device is not connected"));var s=R(t,i);if(!s)return a("Invalid characteristic!");var l=new Uint8Array(r);v=v.then((function(){return new Promise((function(e,r){if(!o.gatt.connected||B(t)!==o||R(t,i)!==s)return r(D("Bluetooth device disconnected before write"));const n=performance.now()-y,p={reject:r,deviceId:t,generation:G0[t]||0};if(w||n<5){const c=w?200:5-n;w=!1,null!==S&&clearTimeout(S),R0[t]=p,S=setTimeout((()=>{if(S=null,!o.gatt.connected||B(t)!==o||R(t,i)!==s||(G0[t]||0)!==p.generation)return N0(p),p.reject(D("Bluetooth device disconnected before write"));s.writeValueWithoutResponse(l.buffer).then((function(){R0[t]===p&&(delete R0[t],y=performance.now()),e()})).catch((e=>{N0(p),r(D("Error occurred during writeValueWithoutResponse"))}))}),c)}else R0[t]=p,s.writeValueWithoutResponse(l.buffer).then((function(){if((G0[t]||0)!==p.generation)return N0(p),r(D("Bluetooth device disconnected before write"));R0[t]===p&&(delete R0[t],y=performance.now()),e()})).catch((e=>{N0(p),r(D("Error occurred during writeValueWithoutResponse"))}))}))})).then((function(){return e()})).catch((function(e){return a(e)}))}))' +
  moduleSource.slice(qEnd);

const yStart = moduleSource.indexOf('Y=function(e){');
const yEnd = moduleSource.indexOf('},Z=function(e){', yStart);
if (yStart < 0 || yEnd < 0) throw new Error('notification operation bounds not found');
moduleSource = moduleSource.slice(0, yStart) +
  'Y=function(e){if(!n.requireOptions(["deviceId","characteristicUuid"],e))return-1;var t=e.deviceId,i=e.characteristicUuid;return n.log("Listening to characteristic value changes.",i,t),new Promise((function(e,r){var o=B(t),a=R(t,i);if(!o||!a)return r("Invalid characteristic!");if(1===a.notifyIsOn)return n.log("Characteristic notify is already on.",i,t),e();const p={reject:r,deviceId:t,generation:G0[t]||0};R0[t]=p,a.startNotifications().then((function(n){if(!o.gatt.connected||B(t)!==o||R(t,i)!==a||(G0[t]||0)!==p.generation)return N0(p),p.reject(D("Bluetooth device disconnected before notifications started"));(n||a).addEventListener("characteristicvaluechanged",L),a.notifyIsOn=1,N0(p),e()})).catch((function(e){return N0(p),r(e)}))}))' +
  moduleSource.slice(yEnd);

const zStart = moduleSource.indexOf('Z=function(e){');
const zEnd = moduleSource.indexOf('},J=function(){', zStart);
if (zStart < 0 || zEnd < 0) throw new Error('stop-notification operation bounds not found');
moduleSource = moduleSource.slice(0, zStart) +
  'Z=function(e){if(!n.requireOptions(["deviceId","characteristicUuid"],e))return-1;var t=e.deviceId,i=e.characteristicUuid;return n.log("No longer listening to characteristic value changes.",i),new Promise((function(e,r){var a=R(t,i);if(!a)return r("Invalid characteristic!");if(1!==a.notifyIsOn)return n.log("Characteristic notify is already off.",i,t),e();const p={reject:r,deviceId:t,generation:G0[t]||0};R0[t]=p,a.stopNotifications().then((function(){(G0[t]||0)===p.generation&&R(t,i)===a&&(a.removeEventListener("characteristicvaluechanged",L),a.notifyIsOn=0),N0(p),e()})).catch((function(e){return N0(p),r(e)}))}))' +
  moduleSource.slice(zEnd);

const wStart = moduleSource.indexOf('W=function(e){');
const wEnd = moduleSource.indexOf('},K=function(e){', wStart);
if (wStart < 0 || wEnd < 0) throw new Error('disconnect operation bounds not found');
let disconnect = moduleSource.slice(wStart, wEnd);
  replaceInDisconnect('M(),v=Promise.resolve();', 'M(t),v=Promise.resolve(),Q0(t);');
function replaceInDisconnect(oldText, newText) {
  const count = disconnect.split(oldText).length - 1;
  if (count !== 1) throw new Error(`explicit disconnect cleanup: expected 1 match, got ${count}`);
  disconnect = disconnect.replace(oldText, newText);
}
moduleSource = moduleSource.slice(0, wStart) + disconnect + moduleSource.slice(wEnd);

  return moduleSource;
}

module.exports = patchModule;
module.exports.patchModule = patchModule;
