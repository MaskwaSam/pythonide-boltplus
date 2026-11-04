// Change this to self-host the runtime (e.g. a folder on your own server).
const PYODIDE_URL = window.PYODIDE_URL || "https://cdn.jsdelivr.net/pyodide/v0.29.5/full/";
const STORE_KEY = "cts-python-ide:" + location.pathname;

const STARTER = `# main.py
# Author: ________   Date: ________
# Purpose: ________

# ---------- CONSTANTS ----------

# ---------- INPUT ----------
name = input("What is your name? ")

# ---------- PROCESS ----------
greeting = "Hello, " + name

# ---------- OUTPUT ----------
print(greeting)
print(f"Your name has {len(name)} letters.")
`;

const $ = id => document.getElementById(id);
const out = $("out"), statusEl = $("status"), runBtn = $("run");

// ---------- Editor (CodeMirror if available, else textarea) ----------
let saved = null;
try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) {}
$("code").value = saved?.code ?? STARTER;
if (saved?.file) $("file").value = saved.file;

let cm = null;
if (window.CodeMirror) {
  cm = CodeMirror.fromTextArea($("code"), {
    mode: "python", lineNumbers: true, indentUnit: 4, tabSize: 4, indentWithTabs: false,
    matchBrackets: true, lineWrapping: false,
    extraKeys: {
      "Tab": c => c.somethingSelected() ? c.indentSelection("add") : c.replaceSelection("    "),
      "Shift-Tab": c => c.indentSelection("subtract"),
      "Ctrl-Enter": () => run(), "Cmd-Enter": () => run(),
      "Ctrl-S": () => saveFile(), "Cmd-S": () => saveFile()
    }
  });
  cm.on("cursorActivity", () => { const p = cm.getCursor(); $("cursor").textContent = `Ln ${p.line+1}, Col ${p.ch+1}`; });
  cm.on("change", () => { clearErrorMark(); persist(); });
} else {
  const ta = $("code");
  ta.addEventListener("keydown", e => {
    if (e.key === "Tab") { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText("    ", s, ta.selectionEnd, "end"); }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(); }
  });
  ta.addEventListener("input", persist);
}
const getCode = () => cm ? cm.getValue() : $("code").value;
const setCode = s => cm ? cm.setValue(s) : ($("code").value = s);

function persist(){ try { localStorage.setItem(STORE_KEY, JSON.stringify({code:getCode(), file:$("file").value})); } catch (e) {} }
$("file").addEventListener("input", persist);

let errMark = null;
function clearErrorMark(){ if (cm && errMark !== null) { cm.removeLineClass(errMark, "background", "cm-error-line"); errMark = null; } }
function markErrorLine(n){ if (!cm || !n) return; clearErrorMark(); errMark = n-1; cm.addLineClass(errMark, "background", "cm-error-line"); cm.scrollIntoView({line:errMark, ch:0}, 80); }

// ---------- Console ----------
function write(text, cls){
  const span = document.createElement("span");
  if (cls) span.className = cls;
  span.textContent = text;
  out.appendChild(span);
  out.scrollTop = out.scrollHeight;
}

const BOLT_STARTER = `# BOLT+ starter
# 1. Connect, then Aim BOLT+ to choose its forward direction.
# 2. Place it on a clear floor and press Run.
# Heading: 0–359 degrees. Speed: 0–100 percent. Duration: seconds.
from sphero import bolt

async def start_program():
    print("Hello, BOLT+!")
    await bolt.set_color(0, 180, 80)
    await bolt.sleep(1)

    try:
        await bolt.roll(heading=0, speed=20, duration=1)
    finally:
        await bolt.stop()

    await bolt.set_color(40, 100, 255)
    print("Done!")
`;

let worker = null, pythonReady = false, running = false, stopping = false, runId = 0;
let startedAt = 0, runAbort = null, inputRequest = null;
let robotQueue = Promise.resolve();
const stopBtn = $("stop"), boltBtn = $("bolt");
let aim = null;
let course = null;

function runtimeStatus(text) { statusEl.textContent = text; }

function boot() {
  const previous = worker;
  if (previous) previous.terminate();
  pythonReady = false;
  runBtn.disabled = true;
  runtimeStatus("Loading Python…");
  const activeWorker = new Worker(new URL('python-worker.js', document.baseURI));
  worker = activeWorker;
  activeWorker.onmessage = event => {
    if (worker !== activeWorker) return;
    const message = event.data;
    if (message.type === 'stdout' || message.type === 'stderr') write(message.text, message.type === 'stderr' ? 'err' : '');
    else if (message.type === 'ready') {
      pythonReady = true;
      $("pyver").textContent = 'Python ' + message.version;
      runtimeStatus('Ready — Ctrl+Enter to run');
      runBtn.disabled = running || stopping;
    } else if (message.type === 'fatal') {
      runtimeStatus('Python failed to load');
      write(message.message + '\nCheck your internet connection and reload the page.\n', 'err');
    } else if (message.type === 'done' && running && message.runId === runId) {
      void finishRun(message);
    } else if (message.type === 'robot') {
      robotQueue = robotQueue.then(() => handleRobot(message, activeWorker)).catch(error => write(error.message + '\n', 'err'));
    } else if (message.type === 'input' && running && message.runId === runId) {
      inputRequest = { ...message, worker: activeWorker };
      $("inputPrompt").textContent = message.prompt || 'Input:';
      $("inputReply").value = '';
      $("inputForm").hidden = false;
      write(message.prompt, 'in');
      $("inputReply").focus();
    }
  };
  activeWorker.onerror = event => {
    if (worker !== activeWorker) return;
    write('Python worker error: ' + event.message + '\n', 'err');
    if (running) void stopProgram('Program stopped after a Python worker error.');
    else runtimeStatus('Python failed to load — reload to retry');
  };
  activeWorker.postMessage({ type: 'init', indexURL: PYODIDE_URL, displayLibrary: window.BoltDisplayLibrary });
}

function hideInput() {
  inputRequest = null;
  $("inputForm").hidden = true;
}

$("inputForm").onsubmit = event => {
  event.preventDefault();
  const request = inputRequest;
  if (!request || request.runId !== runId || !running) return;
  const reply = $("inputReply").value;
  write(reply + '\n', 'in');
  hideInput();
  request.worker.postMessage({ type: 'input-result', id: request.id, result: reply });
  stopBtn.focus();
};

async function run() {
  if (!pythonReady || running || stopping) return;
  if (bolt.state === 'connected' && !aim.confirmed) {
    write('>>> Aim BOLT+ to choose forward, then press Run.\n', 'sys');
    await aim.open();
    return;
  }
  running = true;
  runId++;
  runAbort = new AbortController();
  runBtn.disabled = true;
  stopBtn.disabled = false;
  $("starter").disabled = true;
  aim.setRunning(true);
  clearErrorMark();
  const filename = $("file").value.trim() || 'main.py';
  write(`>>> Running ${filename}\n`, 'sys');
  runtimeStatus('Running…');
  startedAt = performance.now();
  const activeId = runId;
  try {
    await course?.drain();
    if (!running || runId !== activeId) return;
    if (bolt.state === 'connected') await bolt.prepareProgram();
    if (running && runId === activeId) worker.postMessage({ type: 'run', code: getCode(), filename, runId });
  } catch (error) {
    write(String(error.message || error) + '\n', 'err');
    if (running && runId === activeId) await finishRun({ runId, line: -1 });
  }
}

async function finishRun(message) {
  const finishedId = runId;
  // Invalidate queued robot calls, including any unawaited background tasks.
  runAbort.abort();
  hideInput();
  await stopRobotWork('The program has finished.');
  if (finishedId !== runId || !running) return;
  running = false;
  aim.setRunning(false);
  stopBtn.disabled = bolt.state !== 'connected';
  $("starter").disabled = false;
  runBtn.disabled = !pythonReady;
  runtimeStatus('Ready — Ctrl+Enter to run');
  if (message.line === 0) write(`>>> Finished in ${Math.round(performance.now() - startedAt)} ms\n\n`, 'sys');
  else {
    write(`>>> Stopped with an error${message.line > 0 ? ' on line ' + message.line : ''}\n\n`, 'sys');
    markErrorLine(message.line > 0 ? message.line : 0);
  }
}

async function stopProgram(reason = 'Program stopped.') {
  if (stopping) return;
  if (!running) {
    stopping = true;
    runBtn.disabled = true;
    stopBtn.disabled = true;
    try { await stopRobotWork(reason); }
    finally {
      stopping = false;
      runBtn.disabled = !pythonReady;
      stopBtn.disabled = bolt.state !== 'connected';
    }
    return;
  }
  stopping = true;
  running = false;
  aim.setRunning(false);
  runId++;
  runAbort?.abort();
  hideInput();
  worker?.terminate();
  worker = null;
  pythonReady = false;
  runBtn.disabled = true;
  stopBtn.disabled = true;
  $("starter").disabled = false;
  write('>>> ' + reason + '\n', 'sys');
  await stopRobotWork(reason);
  robotQueue = Promise.resolve();
  stopping = false;
  stopBtn.disabled = bolt.state !== 'connected';
  boot();
}

async function stopRobotWork(reason) {
  const cleanup = course?.cancelAll(reason);
  const previousQueue = robotQueue;
  // Send Stop immediately, then finish old callbacks before a new run can start.
  try { await bolt.stop(); } catch (error) { write(error.message + '\n', 'err'); }
  await Promise.allSettled([cleanup, previousQueue]);
}

function pause(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Program stopped.')); return; }
    const abort = () => { clearTimeout(timer); reject(new Error('Program stopped.')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function handleRobot(message, activeWorker) {
  const signal = runAbort?.signal;
  const sdk = bolt.sdk;
  const isCurrent = () => worker === activeWorker && running && message.runId === runId && !signal?.aborted;
  if (!isCurrent()) return;
  let error = null, result = null;
  try {
    if (bolt.state !== 'connected') throw new Error('Connect BOLT+ before running robot commands.');
    if (['roll', 'set_heading', 'roll_to_distance'].includes(message.method) && !aim.confirmed) throw new Error('Aim BOLT+ before running movement commands.');
    if (['roll', 'set_heading', 'roll_to_distance'].includes(message.method)) course.assertMovementReady();
    const args = message.args;
    if (!Array.isArray(args)) throw new Error('Robot command arguments must be a list.');
    const numeric = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
    const rgb = color => color && typeof color === 'object' && !Array.isArray(color) &&
      ['r', 'g', 'b'].every(channel => numeric(color[channel], 0, 255) && Number.isInteger(color[channel]));
    const channels = color => [color.r, color.g, color.b];
    if (message.method === 'set_color' && args.length === 3 && args.every(n => numeric(n, 0, 255) && Number.isInteger(n))) {
      await bolt.setColor(...args);
    } else if (message.method === 'roll' && args.length === 3 && numeric(args[0], 0, 359) && numeric(args[1], 0, 100) && numeric(args[2], 0, 86400)) {
      try {
        await bolt.drive(args[0], args[1]);
        if (isCurrent()) await pause(args[2] * 1000, signal);
      } finally {
        if (bolt.sdk === sdk && worker === activeWorker && message.runId === runId) await bolt.stop();
      }
    } else if (message.method === 'stop' && args.length === 0) await bolt.stop();
    else if (message.method === 'set_heading' && args.length === 1 && numeric(args[0], 0, 359)) {
      await course.set_heading(args[0], { signal });
    } else if (message.method === 'roll_to_distance' && args.length === 3 && numeric(args[0], 0, 359) &&
      numeric(args[1], 0, 255) && Number.isInteger(args[1]) && numeric(args[2], 0, Number.MAX_VALUE)) {
      await course.roll_to_distance(...args, { signal });
    } else if (message.method === 'stop_roll' && (args.length === 0 || (args.length === 1 && numeric(args[0], 0, 359)))) {
      if (args.length && !aim.confirmed) throw new Error('Aim BOLT+ before choosing a stopped heading.');
      await course.stop_roll(args[0] ?? null, { signal });
    } else if (message.method === 'set_main_led' && args.length === 1 && rgb(args[0])) {
      await course.set_main_led(channels(args[0]), { signal });
    } else if (message.method === 'set_display_text' && args.length === 4 && typeof args[0] === 'string' &&
      rgb(args[1]) && rgb(args[2]) && [0, 1].includes(args[3])) {
      await course.set_display_text(args[0], channels(args[1]), channels(args[2]), args[3], { signal });
    } else if (message.method === 'set_display_color' && args.length === 1 && rgb(args[0])) {
      await course.set_display_color(channels(args[0]), { signal });
    } else if (message.method === 'clear_display' && args.length === 0) {
      await course.clear_display({ signal });
    } else if (message.method === 'set_display_rotation' && args.length === 1 && [0, 90, 180, 270].includes(args[0])) {
      await course.set_display_rotation(args[0], { signal });
    } else if (message.method === 'set_live_sensor_data' && args.length === 1 && [1, 2, 4, 8, 16, 32, 64, 128].includes(args[0])) {
      await course.set_live_sensor_data(args[0], { signal });
    } else if (message.method === 'set_display_image' && args.length === 1 && (typeof args[0] === 'string' || (Number.isInteger(args[0]) && numeric(args[0], 0, 65535)))) {
      await course.set_display_image(args[0], { signal });
    } else if (message.method === 'set_display_animation' && args.length === 2 && (typeof args[0] === 'string' || (Number.isInteger(args[0]) && numeric(args[0], 0, 65535))) && typeof args[1] === 'boolean') {
      await course.set_display_animation(...args, { signal });
    } else if (['set_front_led', 'set_back_led', 'set_left_led', 'set_right_led'].includes(message.method) && args.length === 1 && rgb(args[0])) {
      await course.set_led(message.method.split('_')[1], channels(args[0]), { signal });
    } else if (message.method === 'get_ambient_light' && (args.length === 0 || (args.length === 1 && numeric(args[0], Number.MIN_VALUE, 60)))) {
      result = await course.get_ambient_light({ signal, ...(args.length ? { timeoutMs: args[0] * 1000 } : {}) });
    } else if (message.method === 'get_sensor_data' && args.length === 2 &&
      ['accelerometer', 'gyroscope', 'orientation', 'locator', 'velocity'].includes(args[0]) && numeric(args[1], Number.MIN_VALUE, 60)) {
      result = await course.get_sensor_data(args[0], { signal, timeoutMs: args[1] * 1000 });
    } else if (message.method === 'get_battery_percentage' && args.length === 0) {
      result = await course.get_battery_percentage({ signal });
    } else throw new Error('Unsupported BOLT+ command or invalid arguments.');
  } catch (failure) { error = String(failure.message || failure); }
  if (isCurrent()) activeWorker.postMessage({ type: 'robot-result', id: message.id, result, error });
}

const bolt = new window.BoltConnection((state, name) => {
  $("robotDot").className = state === 'connected' ? 'connected' : state === 'connecting' ? 'connecting' : '';
  $("robotStatus").textContent = state === 'connected' ? (name || 'BOLT+') + ' connected' : state === 'connecting' ? 'Connecting BOLT+…' : 'BOLT+ disconnected';
  boltBtn.textContent = state === 'connected' ? 'Disconnect BOLT+' : 'Connect BOLT+';
  boltBtn.disabled = state === 'connecting';
  stopBtn.disabled = stopping || (!running && state !== 'connected');
  aim?.onConnectionState(state);
  if (state === 'disconnected' && running) void stopProgram('BOLT+ disconnected. Program stopped.');
}, message => write('>>> BOLT+ ' + message + '\n', 'sys'));
aim = new window.BoltAim(bolt, { onMessage: (message, cls) => write(message + '\n', cls) });
course = new window.BoltCourseApi(bolt);

boltBtn.onclick = async () => {
  boltBtn.disabled = true;
  try {
    if (bolt.state === 'connected') {
      if (running) await stopProgram();
      await bolt.disconnect();
    } else {
      await bolt.connect();
      write('>>> BOLT+ connected. Choose its forward direction with Aim BOLT+.\n', 'sys');
      if (!running && (getCode() === STARTER || getCode().trim() === '')) loadStarter(false);
      await aim.open();
    }
  } catch (error) { write(String(error.message || error) + '\n', 'err'); }
  finally { boltBtn.disabled = bolt.state === 'connecting'; }
};

function loadStarter(ask = true) {
  if (running) return;
  if (ask && getCode().trim() && getCode() !== STARTER && getCode() !== BOLT_STARTER && !confirm('Replace the current code with the BOLT+ starter? Save your .py file first if you want to keep it.')) return;
  setCode(BOLT_STARTER);
  $("file").value = 'bolt_starter.py';
  persist();
  if (cm) cm.focus(); else $("code").focus();
}

const BOLT_LIGHT_DISPLAY = `# BOLT+ light, colour, and messages (no driving)
# Connect and confirm Aim, then Run. Cover/uncover the light sensor.
from sphero import set_main_led, set_display_color, set_display_text
from sphero import get_ambient_light, delay

async def start_program():
    green = {'r': 0, 'g': 255, 'b': 0}
    white = {'r': 255, 'g': 255, 'b': 255}
    black = {'r': 0, 'g': 0, 'b': 0}
    await set_main_led(green)
    await set_display_color(green)
    await delay(2)
    await set_display_text("Hello\\nBOLT+!", white, black)
    await delay(2)
    for sample in range(10):
        light = await get_ambient_light()
        print(f"Light: {light:.1f} lux")
        await set_display_text(f"Light\\n{light:.1f}\\nlux", white, black)
        await delay(1)
`;

$("lightDisplay").onclick = () => {
  if (running || stopping) return;
  if (getCode().trim() && ![STARTER, BOLT_LIGHT_DISPLAY].includes(getCode()) && !confirm('Replace the current code with the light and display example? Save your .py file first if you want to keep it.')) return;
  setCode(BOLT_LIGHT_DISPLAY);
  $("file").value = 'bolt_light_display.py';
  persist();
};

new window.BoltDisplayBrowser({
  isBusy: () => running || stopping,
  onUseExample(code, filename) {
    if (running || stopping) return false;
    if (getCode().trim() && getCode() !== STARTER && !confirm('Replace the current code with this display example? Save your .py file first if you want to keep it.')) return false;
    setCode(code);
    $("file").value = filename;
    persist();
    return true;
  }
});

// ---------- File buttons ----------
function saveFile() {
  let name = $("file").value.trim() || 'main.py';
  if (!/\.py$/i.test(name)) name += '.py';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([getCode()], { type: 'text/x-python' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
runBtn.onclick = run;
stopBtn.onclick = () => void stopProgram();
$("starter").onclick = () => loadStarter();
$("save").onclick = saveFile;
$("clear").onclick = () => { out.textContent = ''; clearErrorMark(); };
$("open").onclick = () => $("picker").click();
$("picker").onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  if (getCode().trim() && getCode() !== STARTER && !confirm('Replace the current editor contents with this file?')) { event.target.value = ''; return; }
  setCode(await file.text()); $("file").value = file.name; persist(); event.target.value = '';
};
$("reset").onclick = () => {
  if (confirm('Start a new file? Save your .py file first if you want to keep the current code.')) {
    setCode(STARTER); $("file").value = 'main.py'; persist();
  }
};
window.addEventListener('pagehide', () => {
  runAbort?.abort();
  void course?.cancelAll('The page was closed.');
  worker?.terminate();
  // Start stopping before tearing down the SDK's BLE bridge.
  void bolt.disconnect();
});

boot();
bolt.initialize().then(() => { boltBtn.disabled = false; }).catch(error => {
  boltBtn.disabled = false;
  $("help").textContent = error.message + ' Python programs can still run.';
});
