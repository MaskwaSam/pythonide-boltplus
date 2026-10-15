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

let worker = null, pythonReady = false, running = false, runId = 0;
let startedAt = 0, runAbort = null, inputRequest = null;
let robotQueue = Promise.resolve();
const stopBtn = $("stop"), boltBtn = $("bolt");
let aim = null;

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
      runBtn.disabled = running;
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
  activeWorker.postMessage({ type: 'init', indexURL: PYODIDE_URL });
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
  if (!pythonReady || running) return;
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
  try { await bolt.stop(); } catch (error) { write(error.message + '\n', 'err'); }
  if (finishedId !== runId || !running) return;
  running = false;
  aim.setRunning(false);
  stopBtn.disabled = true;
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
  if (!running) return;
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
  try { await bolt.stop(); } catch (error) { write(error.message + '\n', 'err'); }
  robotQueue = Promise.resolve();
  boot();
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
  let error = null;
  try {
    if (bolt.state !== 'connected') throw new Error('Connect BOLT+ before running robot commands.');
    if ((message.method === 'roll' || message.method === 'set_heading') && !aim.confirmed) throw new Error('Aim BOLT+ before running movement commands.');
    const args = message.args;
    const numeric = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
    if (message.method === 'set_color' && args.length === 3 && args.every(n => numeric(n, 0, 255) && Number.isInteger(n))) {
      await bolt.setColor(...args);
    } else if (message.method === 'roll' && args.length === 3 && numeric(args[0], 0, 359) && numeric(args[1], 0, 100) && numeric(args[2], 0, 86400)) {
      try {
        await bolt.drive(args[0], args[1]);
        if (isCurrent()) await pause(args[2] * 1000, signal);
      } finally { if (bolt.sdk === sdk) await bolt.stop(); }
    } else if (message.method === 'stop' && args.length === 0) await bolt.stop();
    else if (message.method === 'set_heading' && args.length === 1 && numeric(args[0], 0, 359)) {
      bolt.heading = args[0];
      await bolt.stop();
    } else throw new Error('Unsupported BOLT+ command or invalid arguments.');
  } catch (failure) { error = String(failure.message || failure); }
  if (isCurrent()) activeWorker.postMessage({ type: 'robot-result', id: message.id, result: null, error });
}

const bolt = new window.BoltConnection((state, name) => {
  $("robotDot").className = state === 'connected' ? 'connected' : state === 'connecting' ? 'connecting' : '';
  $("robotStatus").textContent = state === 'connected' ? (name || 'BOLT+') + ' connected' : state === 'connecting' ? 'Connecting BOLT+…' : 'BOLT+ disconnected';
  boltBtn.textContent = state === 'connected' ? 'Disconnect BOLT+' : 'Connect BOLT+';
  boltBtn.disabled = state === 'connecting';
  aim?.onConnectionState(state);
  if (state === 'disconnected' && running) void stopProgram('BOLT+ disconnected. Program stopped.');
}, message => write('>>> BOLT+ ' + message + '\n', 'sys'));
aim = new window.BoltAim(bolt, { onMessage: (message, cls) => write(message + '\n', cls) });

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
  worker?.terminate();
  // Start stopping before tearing down the SDK's BLE bridge.
  void bolt.disconnect();
});

boot();
bolt.initialize().then(() => { boltBtn.disabled = false; }).catch(error => {
  boltBtn.disabled = false;
  $("help").textContent = error.message + ' Python programs can still run.';
});
