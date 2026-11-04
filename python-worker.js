/* Dedicated classic worker; kept dependency-free so the IDE can embed it as a Blob. */
'use strict';
let runtime = null;
let initializing = false;
let running = false;
let currentRunId = null;
let requestId = 0;
const pending = new Map();

// Python sends JSON, avoiding PyProxy objects in postMessage's structured clone.
self._ideRequest = (type, method, argsJSON, originRunId) => {
  if (!running || originRunId !== currentRunId) return Promise.reject(new Error('Run the program before using this command.'));
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, type });
    const args = JSON.parse(argsJSON);
    if (type === 'input') self.postMessage({ type, id, runId: currentRunId, prompt: args[0] });
    else self.postMessage({ type: 'robot', id, runId: currentRunId, method, args });
  });
};

const PYTHON_HELPER = String.raw`
import ast as _ast
import asyncio as _asyncio
import builtins as _builtins
import contextvars as _contextvars
import functools as _functools
import inspect as _inspect
import json as _json
import linecache as _linecache
import math as _math
import sys as _sys
import traceback as _traceback
import types as _types
import js as _js
from pyodide.ffi import run_sync as _run_sync, can_run_sync as _can_run_sync

_ide_origin = _contextvars.ContextVar("ide_run_origin", default=None)
_ide_display_library = _json.loads(globals().get('_ide_display_library_json', '{"images":[],"animations":[]}'))
_ide_display_images = list(_ide_display_library.get('images', []))
_ide_display_animations = list(_ide_display_library.get('animations', []))

def list_display_images():
    return _json.loads(_json.dumps(_ide_display_images))

def list_display_animations():
    return _json.loads(_json.dumps(_ide_display_animations))

def _ide_display_asset(value, kind, assets):
    if isinstance(value, str):
        if value.lower().endswith('.gif') or '://' in value:
            raise ValueError("Only built-in display assets are supported; GIF uploads and URLs are not supported")
        if any(asset.get('id') == value for asset in assets):
            return value
        raise ValueError(f"Unknown display {kind} {value!r}; use list_display_{'images' if kind == 'image' else 'animations'}() to see built-in assets")
    return _ide_whole(value, kind + '_id', 0, 65535)

def _ide_number(value, name, minimum=0, maximum=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not _math.isfinite(value):
        raise ValueError(f"{name} must be a finite number")
    if value < minimum or (maximum is not None and value > maximum):
        limit = f"{minimum} to {maximum}" if maximum is not None else f"at least {minimum}"
        raise ValueError(f"{name} must be {limit}")
    return value

def _ide_rgb(value, name):
    if not isinstance(value, dict) or any(channel not in value for channel in ("r", "g", "b")):
        raise ValueError(f"{name} must be a dictionary with r, g, and b channels")
    result = {}
    for channel in ("r", "g", "b"):
        number = _ide_number(value[channel], f"{name}.{channel}", 0, 255)
        if int(number) != number:
            raise ValueError(f"{name}.{channel} must be a whole number from 0 to 255")
        result[channel] = int(number)
    return result

def _ide_whole(value, name, minimum, maximum):
    number = _ide_number(value, name, minimum, maximum)
    if int(number) != number:
        raise ValueError(f"{name} must be a whole number from {minimum} to {maximum}")
    return int(number)

async def _ide_request(method, args):
    return _json.loads(str(await _js._ideRequest("robot", method, _json.dumps(args), _ide_origin.get())))

class _IdeBolt:
    async def set_color(self, r, g, b):
        colors = [_ide_number(value, name, 0, 255) for name, value in zip(("red", "green", "blue"), (r, g, b))]
        if any(int(value) != value for value in colors):
            raise ValueError("Color channels must be whole numbers from 0 to 255")
        return await _ide_request("set_color", [int(value) for value in colors])

    async def roll(self, heading, speed, duration):
        return await _ide_request("roll", [_ide_number(heading, "heading", 0, 359), _ide_number(speed, "speed", 0, 100), _ide_number(duration, "duration")])

    async def stop(self):
        return await _ide_request("stop", [])

    async def set_heading(self, heading):
        return await _ide_request("set_heading", [_ide_number(heading, "heading", 0, 359)])

    async def roll_to_distance(self, heading, raw_speed, distance_cm):
        speed = _ide_number(raw_speed, "raw_speed", 0, 255)
        if int(speed) != speed:
            raise ValueError("raw_speed must be a whole number from 0 to 255")
        return await _ide_request("roll_to_distance", [_ide_number(heading, "heading", 0, 359), int(speed), _ide_number(distance_cm, "distance_cm")])

    async def stop_roll(self, heading=None):
        args = [] if heading is None else [_ide_number(heading, "heading", 0, 359)]
        return await _ide_request("stop_roll", args)

    async def set_main_led(self, color):
        return await _ide_request("set_main_led", [_ide_rgb(color, "color")])

    async def set_display_color(self, color):
        return await _ide_request("set_display_color", [_ide_rgb(color, "color")])

    async def clear_display(self):
        return await _ide_request("clear_display", [])

    async def set_display_rotation(self, degrees):
        degrees = _ide_whole(degrees, "degrees", 0, 270)
        if degrees not in (0, 90, 180, 270):
            raise ValueError("degrees must be 0, 90, 180, or 270")
        return await _ide_request("set_display_rotation", [degrees])

    async def set_display_image(self, image_id):
        return await _ide_request("set_display_image", [_ide_display_asset(image_id, "image", _ide_display_images)])

    async def set_display_animation(self, animation_id, looping=True):
        animation_id = _ide_display_asset(animation_id, "animation", _ide_display_animations)
        if not isinstance(looping, bool):
            raise ValueError("looping must be a bool")
        return await _ide_request("set_display_animation", [animation_id, looping])

    async def set_live_sensor_data(self, sensor):
        sensor = _ide_whole(sensor, "sensor", 1, 128)
        if sensor not in (1, 2, 4, 8, 16, 32, 64, 128):
            raise ValueError("sensor must be one supported sensor mask")
        return await _ide_request("set_live_sensor_data", [sensor])

    async def set_front_led(self, color):
        return await _ide_request("set_front_led", [_ide_rgb(color, "color")])

    async def set_back_led(self, color):
        return await _ide_request("set_back_led", [_ide_rgb(color, "color")])

    async def set_left_led(self, color):
        return await _ide_request("set_left_led", [_ide_rgb(color, "color")])

    async def set_right_led(self, color):
        return await _ide_request("set_right_led", [_ide_rgb(color, "color")])

    async def set_display_text(self, text, foreground=None, background=None, font=0):
        if not isinstance(text, str):
            raise ValueError("text must be a string")
        if foreground is None:
            foreground = {"r": 255, "g": 255, "b": 255}
        if background is None:
            background = {"r": 0, "g": 0, "b": 0}
        foreground = _ide_rgb(foreground, "foreground")
        background = _ide_rgb(background, "background")
        font = _ide_whole(font, "font", 0, 1)
        return await _ide_request("set_display_text", [text, foreground, background, font])

    async def get_ambient_light(self, timeout=10):
        timeout = _ide_number(timeout, "timeout", 0, 60)
        if timeout == 0:
            raise ValueError("timeout must be greater than 0 and at most 60")
        return await _ide_request("get_ambient_light", [] if timeout == 10 else [timeout])

    async def get_sensor_data(self, sensor, timeout=10):
        if sensor not in ("accelerometer", "gyroscope", "orientation", "locator", "velocity"):
            raise ValueError("sensor must be a supported sensor name")
        timeout = _ide_number(timeout, "timeout", 0, 60)
        if timeout == 0:
            raise ValueError("timeout must be greater than 0 and at most 60")
        return await _ide_request("get_sensor_data", [sensor, timeout])

    async def get_acceleration(self, timeout=10):
        return await self.get_sensor_data("accelerometer", timeout)

    async def get_gyroscope(self, timeout=10):
        return await self.get_sensor_data("gyroscope", timeout)

    async def get_orientation(self, timeout=10):
        return await self.get_sensor_data("orientation", timeout)

    async def get_location(self, timeout=10):
        return await self.get_sensor_data("locator", timeout)

    async def get_velocity(self, timeout=10):
        return await self.get_sensor_data("velocity", timeout)

    async def get_battery_percentage(self):
        return await _ide_request("get_battery_percentage", [])

    async def delay(self, seconds):
        await _asyncio.sleep(_ide_number(seconds, "seconds"))

    async def sleep(self, seconds):
        await _asyncio.sleep(_ide_number(seconds, "seconds"))

async def _ide_ask(prompt=""):
    return _json.loads(str(await _js._ideRequest("input", "ask", _json.dumps([str(prompt)]), _ide_origin.get())))

def _ide_input(prompt=""):
    if _can_run_sync():
        return _run_sync(_ide_ask(prompt))
    raise RuntimeError('Use await ask("your question") for input in this IDE, for example: name = await ask("Name? ")')

_builtins.input = _ide_input
_builtins.ask = _ide_ask
_sphero = _types.ModuleType("sphero")
_sphero.bolt = _IdeBolt()
for _method in ("set_heading", "roll_to_distance", "stop_roll", "set_main_led", "set_display_color", "clear_display", "set_display_rotation", "set_display_image", "set_display_animation", "set_live_sensor_data", "set_front_led", "set_back_led", "set_left_led", "set_right_led", "set_display_text", "get_ambient_light", "get_sensor_data", "get_acceleration", "get_gyroscope", "get_orientation", "get_location", "get_velocity", "get_battery_percentage", "delay"):
    setattr(_sphero, _method, getattr(_sphero.bolt, _method))
_sphero.DisplayImage = _types.SimpleNamespace(**{
    asset['constant']: asset['id'] for asset in _ide_display_images
    if isinstance(asset.get('constant'), str) and asset['constant'].isidentifier()
})
_sphero.DisplayAnimation = _types.SimpleNamespace(**{
    asset['constant']: asset['id'] for asset in _ide_display_animations
    if isinstance(asset.get('constant'), str) and asset['constant'].isidentifier()
})
_sphero.list_display_images = list_display_images
_sphero.list_display_animations = list_display_animations
_sys.modules["sphero"] = _sphero

def _ide_hide_frames(exception):
    exception.stack = _traceback.StackSummary.from_list([frame for frame in exception.stack if frame.filename != "<ide-worker>"])
    if exception.__cause__ is not None:
        _ide_hide_frames(exception.__cause__)
    if exception.__context__ is not None:
        _ide_hide_frames(exception.__context__)
    for child in getattr(exception, "exceptions", None) or []:
        _ide_hide_frames(child)

async def _ide_run(source, filename, run_id=0):
    token = _ide_origin.set(run_id)
    existing_tasks = _asyncio.all_tasks()
    namespace = {"__name__": "__main__", "__file__": filename, "__builtins__": _builtins}
    started_entries = set()
    def track_entry(entry):
        @_functools.wraps(entry)
        def invoke(*args, **kwargs):
            started_entries.add(invoke)
            return entry(*args, **kwargs)
        return invoke
    namespace["_ide_track_start_entry"] = track_entry
    _linecache.cache[filename] = (len(source), None, source.splitlines(True), filename)
    try:
        tree = compile(source, filename, "exec", flags=_ast.PyCF_ONLY_AST | _ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
        for statement in tree.body:
            if isinstance(statement, _ast.AsyncFunctionDef) and statement.name == "start_program":
                # Track explicit calls too, so an existing top-level invocation
                # cannot cause a second run of the robot program.
                statement.decorator_list.insert(0, _ast.copy_location(_ast.Name(id="_ide_track_start_entry", ctx=_ast.Load()), statement))
        program = compile(_ast.fix_missing_locations(tree), filename, "exec", flags=_ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
        result = eval(program, namespace)
        if _inspect.isawaitable(result):
            await result
        entry = namespace.get("start_program")
        if entry is not None:
            if not _inspect.iscoroutinefunction(_inspect.unwrap(entry)):
                raise TypeError("Use async def start_program(): for a Sphero program")
            if entry not in started_entries:
                await entry()
        return 0
    except SystemExit:
        return 0
    except BaseException as error:
        line = error.lineno if isinstance(error, SyntaxError) and error.filename == filename else None
        frame = error.__traceback__
        while frame is not None:
            if frame.tb_frame.f_code.co_filename == filename:
                line = frame.tb_lineno
            frame = frame.tb_next
        formatted = _traceback.TracebackException.from_exception(error)
        _ide_hide_frames(formatted)
        _sys.stderr.write("".join(formatted.format()))
        return line or -1
    finally:
        # Tasks inherit their originating run's context. Cancel background work
        # before announcing completion, and bound cleanup if a task suppresses it.
        created_tasks = _asyncio.all_tasks() - existing_tasks
        for task in created_tasks:
            task.cancel()
        if created_tasks:
            await _asyncio.wait(created_tasks, timeout=0.1)
        _ide_origin.reset(token)
`;

async function initialize(indexURL, displayLibrary = { images: [], animations: [] }) {
  if (runtime || initializing) return;
  initializing = true;
  try {
    if (typeof indexURL !== 'string' || !indexURL) throw new Error('A Python runtime URL is required.');
    const baseURL = indexURL.endsWith('/') ? indexURL : indexURL + '/';
    importScripts(baseURL + 'pyodide.js');
    runtime = await loadPyodide({ indexURL: baseURL });
    const stdoutDecoder = new TextDecoder();
    const stderrDecoder = new TextDecoder();
    runtime.setStdout({ write(bytes) { self.postMessage({ type: 'stdout', text: stdoutDecoder.decode(bytes, { stream: true }) }); return bytes.length; } });
    runtime.setStderr({ write(bytes) { self.postMessage({ type: 'stderr', text: stderrDecoder.decode(bytes, { stream: true }) }); return bytes.length; } });
    runtime.globals.set('_ide_display_library_json', JSON.stringify(displayLibrary));
    // Give all helper frames a stable filename so student tracebacks can remove them.
    runtime.globals.set('_ide_helper_source', PYTHON_HELPER);
    runtime.runPython('exec(compile(_ide_helper_source, "<ide-worker>", "exec"))');
    runtime.globals.delete('_ide_helper_source');
    runtime.globals.delete('_ide_display_library_json');
    const version = runtime.runPython('import sys; sys.version.split()[0]');
    self.postMessage({ type: 'ready', version: String(version) });
  } catch (error) {
    runtime = null;
    self.postMessage({ type: 'fatal', message: String(error.message || error) });
  } finally {
    initializing = false;
  }
}

async function run(message) {
  if (!runtime || running) return;
  running = true;
  currentRunId = message.runId;
  let line = -1;
  try {
    runtime.globals.set('_ide_source', String(message.code ?? ''));
    runtime.globals.set('_ide_filename', String(message.filename || 'main.py'));
    runtime.globals.set('_ide_run_id', message.runId);
    line = Number(await runtime.runPythonAsync('await _ide_run(_ide_source, _ide_filename, _ide_run_id)'));
  } catch (error) {
    self.postMessage({ type: 'stderr', text: String(error.message || error) + '\n' });
  } finally {
    runtime.globals.delete('_ide_source');
    runtime.globals.delete('_ide_filename');
    runtime.globals.delete('_ide_run_id');
    for (const [id, request] of pending) {
      pending.delete(id);
      request.reject(new Error('The program has finished.'));
    }
    self.postMessage({ type: 'done', runId: currentRunId, line });
    running = false;
    currentRunId = null;
  }
}

self.onmessage = event => {
  const message = event.data || {};
  if (message.type === 'init') void initialize(message.indexURL, message.displayLibrary);
  else if (message.type === 'run') void run(message);
  else if (message.type === 'robot-result' || message.type === 'input-result') {
    const request = pending.get(message.id);
    if (!request || message.type !== request.type + '-result') return;
    pending.delete(message.id);
    if (message.error != null) request.reject(new Error(String(message.error)));
    else request.resolve(JSON.stringify(message.result ?? null));
  }
};
