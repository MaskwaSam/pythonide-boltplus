import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const source = fs.readFileSync(new URL('../python-worker.js', import.meta.url), 'utf8');
function worker(load) {
  const messages = [];
  const globals = new Map();
  const runtime = {
    globals,
    setStdout(value) { this.stdout = value; },
    setStderr(value) { this.stderr = value; },
    runPython(code) { return code.startsWith('import sys') ? '3.13.2' : undefined; },
    async runPythonAsync() { return 0; }
  };
  const self = { postMessage: message => messages.push(message) };
  const imported = [];
  const context = vm.createContext({ self, TextDecoder, importScripts: path => imported.push(path), loadPyodide: load || (async () => runtime) });
  vm.runInContext(source, context);
  return { self, messages, globals, runtime, imported, context };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('bootstrap loads requested runtime and reports version; run preserves source and id', async () => {
  const w = worker();
  w.self.onmessage({ data: { type: 'init', indexURL: 'https://example.test/full' } });
  await tick();
  assert.equal(w.imported[0], 'https://example.test/full/pyodide.js');
  assert.equal(w.messages[0].type, 'ready');
  assert.equal(w.messages[0].version, '3.13.2');
  w.runtime.runPythonAsync = async () => {
    assert.equal(w.globals.get('_ide_source'), 'print("hello")');
    assert.equal(w.globals.get('_ide_filename'), 'lesson.py');
    return 0;
  };
  w.self.onmessage({ data: { type: 'run', code: 'print("hello")', filename: 'lesson.py', runId: 12 } });
  await tick();
  assert.equal(w.messages.at(-1).type, 'done');
  assert.equal(w.messages.at(-1).runId, 12);
  assert.equal(w.messages.at(-1).line, 0);
  assert.equal(w.globals.has('_ide_source'), false);
});

test('RPC correlates robot/input responses and forwards errors', async () => {
  const w = worker();
  w.self.onmessage({ data: { type: 'init', indexURL: 'https://example.test/' } });
  await tick();
  let finish;
  w.runtime.runPythonAsync = () => new Promise(resolve => { finish = resolve; });
  w.self.onmessage({ data: { type: 'run', code: '', runId: 7 } });
  await assert.rejects(w.self._ideRequest('robot', 'stop', '[]', 6), /Run the program/);
  const robot = w.self._ideRequest('robot', 'roll', '[90,30,1]', 7);
  const request = w.messages.at(-1);
  assert.equal(request.method, 'roll');
  assert.equal(request.runId, 7);
  assert.deepEqual(Array.from(request.args), [90, 30, 1]);
  w.self.onmessage({ data: { type: 'input-result', id: request.id, result: 'wrong response type' } });
  w.self.onmessage({ data: { type: 'robot-result', id: request.id, result: true } });
  assert.equal(await robot, 'true');
  const input = w.self._ideRequest('input', 'ask', '["Name?"]', 7);
  const inputRequest = w.messages.at(-1);
  assert.equal(inputRequest.prompt, 'Name?');
  w.self.onmessage({ data: { type: 'input-result', id: inputRequest.id, result: 'Sam' } });
  assert.equal(await input, '"Sam"');
  const failure = w.self._ideRequest('robot', 'stop', '[]', 7);
  w.self.onmessage({ data: { type: 'robot-result', id: w.messages.at(-1).id, error: 'Disconnected' } });
  await assert.rejects(failure, /Disconnected/);
  finish(0);
  await tick();
});

test('a stale task cannot send robot commands during a subsequent run', async () => {
  const w = worker();
  w.self.onmessage({ data: { type: 'init', indexURL: 'https://example.test/' } });
  await tick();
  w.self.onmessage({ data: { type: 'run', code: '', runId: 11 } });
  await tick();
  let finish;
  w.runtime.runPythonAsync = () => new Promise(resolve => { finish = resolve; });
  w.self.onmessage({ data: { type: 'run', code: '', runId: 12 } });
  const count = w.messages.length;
  await assert.rejects(w.self._ideRequest('robot', 'roll', '[0,20,1]', 11), /Run the program/);
  assert.equal(w.messages.length, count);
  const fresh = w.self._ideRequest('robot', 'stop', '[]', 12);
  const request = w.messages.at(-1);
  assert.equal(request.runId, 12);
  w.self.onmessage({ data: { type: 'robot-result', id: request.id, result: null } });
  await fresh;
  finish(0);
  await tick();
});

test('load failures emit a usable fatal message', async () => {
  const w = worker(async () => { throw new Error('Network unavailable'); });
  w.self.onmessage({ data: { type: 'init', indexURL: 'https://example.test/' } });
  await tick();
  assert.equal(w.messages[0].type, 'fatal');
  assert.equal(w.messages[0].message, 'Network unavailable');
});

test('Python helper executes scripts/await, reports exact student lines, and validates robot commands', () => {
  const w = worker();
  const helper = vm.runInContext('PYTHON_HELPER', w.context);
  const check = String.raw`
import asyncio, contextlib, io, json, sys, types
js = types.ModuleType('js')
requests = []
active_origin = 0
async def request(kind, method, args, origin):
    assert origin == active_origin
    requests.append((kind, method, json.loads(args)))
    return json.dumps('Sam' if kind == 'input' else None)
js._ideRequest = request
sys.modules['js'] = js
ffi = types.ModuleType('pyodide.ffi')
ffi.can_run_sync = lambda: False
ffi.run_sync = lambda value: None
sys.modules['pyodide'] = types.ModuleType('pyodide')
sys.modules['pyodide.ffi'] = ffi
exec(compile(HELPER, '<ide-worker>', 'exec'))
async def check():
    global active_origin
    output, errors = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
        assert await _ide_run('print(2 + 3)', 'student.py') == 0
        assert output.getvalue() == '5\n'
        assert await _ide_run('from sphero import bolt\nname = await ask("Name?")\nawait bolt.set_color(255, 0, 5)\nawait bolt.roll(90, 30, 0)\nawait bolt.set_heading(180)\nawait bolt.sleep(0)\nawait bolt.stop()\nprint(name)', 'student.py') == 0
        assert requests == [('input', 'ask', ['Name?']), ('robot', 'set_color', [255, 0, 5]), ('robot', 'roll', [90, 30, 0]), ('robot', 'set_heading', [180]), ('robot', 'stop', [])]
        assert await _ide_run('def broken():\n    return 1 / 0\nbroken()', 'student.py') == 2
        assert '<ide-worker>' not in errors.getvalue()
        assert 'line 2, in broken' in errors.getvalue()
        errors.seek(0); errors.truncate()
        assert await _ide_run('x = 1\nif True print(x)', 'student.py') == 2
        assert 'SyntaxError' in errors.getvalue()
        errors.seek(0); errors.truncate()
        assert await _ide_run('from sphero import bolt\nawait bolt.roll(0, 101, 1)', 'student.py') == 2
        assert 'speed must be 0 to 100' in errors.getvalue()
        assert '<ide-worker>' not in errors.getvalue()
        errors.seek(0); errors.truncate()
        assert await _ide_run('name = input("Name?")', 'student.py') == 1
        assert 'await ask' in errors.getvalue()
        requests.clear()
        active_origin = 11
        assert await _ide_run('import asyncio\nfrom sphero import bolt\nasync def later():\n    await asyncio.sleep(0.01)\n    await bolt.roll(0, 10, 1)\nasyncio.create_task(later())\nawait asyncio.sleep(0)', 'student.py', 11) == 0
        active_origin = 12
        assert await _ide_run('import asyncio\nawait asyncio.sleep(0.03)', 'student.py', 12) == 0
        assert requests == [], requests
        active_origin = 13
        assert await _ide_run('import asyncio\nfrom sphero import bolt\nasync def fresh():\n    await bolt.stop()\nawait asyncio.create_task(fresh())', 'student.py', 13) == 0
        assert requests == [('robot', 'stop', [])], requests
        requests.clear()
        active_origin = 14
        assert await _ide_run('from sphero import bolt\nasync def start_program():\n    await bolt.set_color(10, 20, 30)\n    await bolt.stop()', 'starter.py', 14) == 0
        assert requests == [('robot', 'set_color', [10, 20, 30]), ('robot', 'stop', [])], requests
        requests.clear()
        assert await _ide_run('from sphero import bolt\nasync def start_program():\n    await bolt.roll(0, 20, 1)\nawait start_program()', 'starter.py', 14) == 0
        assert requests == [('robot', 'roll', [0, 20, 1])], requests
        errors.seek(0); errors.truncate()
        assert await _ide_run('async def start_program():\n    print("starting")\n    1 / 0', 'starter.py', 14) == 3
        assert 'line 3, in start_program' in errors.getvalue()
        assert '<ide-worker>' not in errors.getvalue()
asyncio.run(check())
`;
  const result = spawnSync('python3', ['-c', `HELPER = ${JSON.stringify(helper)}\n${check}`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});

test('course API is async, importable, validates before RPC, and preserves raw speed and sensor results', () => {
  const helper = vm.runInContext('PYTHON_HELPER', worker().context);
  const check = String.raw`
import asyncio, inspect, json, sys, types
js = types.ModuleType('js')
requests, sleeps = [], []
async def request(kind, method, args, origin):
    assert kind == 'robot' and origin == 21
    requests.append((method, json.loads(args)))
    return json.dumps({'x': 1.25, 'y': -2, 'z': 3} if method == 'get_sensor_data' else (123.75 if method == 'get_ambient_light' else None))
js._ideRequest = request
sys.modules['js'] = js
_ide_display_library_json = json.dumps({'images': [{'id': 'cat', 'fwid': 642, 'constant': 'CAT'}, {'id': 'angry', 'fwid': 256, 'constant': 'ANGRY'}], 'animations': [{'id': 'fireworks', 'fwid': 1029, 'constant': 'FIREWORKS'}]})
ffi = types.ModuleType('pyodide.ffi')
ffi.can_run_sync = lambda: False
ffi.run_sync = lambda value: None
sys.modules['pyodide'] = types.ModuleType('pyodide')
sys.modules['pyodide.ffi'] = ffi
exec(compile(HELPER, '<ide-worker>', 'exec'))
from sphero import bolt, set_heading, roll_to_distance, stop_roll, set_main_led, set_display_text, get_ambient_light, delay, DisplayImage, DisplayAnimation, list_display_images, list_display_animations
rgb = {'r': 0, 'g': 128, 'b': 255}
async def check():
    token = _ide_origin.set(21)
    for name in ('set_heading', 'roll_to_distance', 'stop_roll', 'set_main_led', 'set_display_text', 'get_ambient_light', 'delay', 'set_display_color', 'clear_display', 'set_display_rotation', 'set_display_image', 'set_display_animation', 'set_live_sensor_data', 'set_front_led', 'set_back_led', 'set_left_led', 'set_right_led', 'get_sensor_data', 'get_acceleration', 'get_gyroscope', 'get_orientation', 'get_location', 'get_velocity', 'get_battery_percentage'):
        assert inspect.iscoroutinefunction(getattr(_sphero, name)), name
        assert getattr(_sphero, name) == getattr(bolt, name), name
    async def sleep(seconds):
        sleeps.append(seconds)
    original_sleep = _asyncio.sleep
    _asyncio.sleep = sleep
    try:
        await set_heading(359)
        await roll_to_distance(90, 25, 10.5)
        await bolt.roll_to_distance(0, 255, 0)
        await stop_roll()
        await bolt.stop_roll(0)
        await set_main_led(rgb)
        await set_display_text('Hello', rgb, {'r': 1, 'g': 2, 'b': 3}, 0)
        await set_display_text('Font one', font=1)
        await bolt.set_display_color(rgb)
        await bolt.clear_display()
        await bolt.set_display_rotation(90)
        await bolt.set_display_image(65535)
        await bolt.set_display_image(DisplayImage.CAT)
        await bolt.set_display_image('angry')
        await bolt.set_display_animation(4)
        await bolt.set_display_animation(DisplayAnimation.FIREWORKS, False)
        assert DisplayImage.CAT == 'cat' and DisplayImage.ANGRY == 'angry' and DisplayAnimation.FIREWORKS == 'fireworks'
        images = list_display_images()
        images.clear()
        assert len(list_display_images()) == 2 and len(list_display_animations()) == 1
        await bolt.set_live_sensor_data(64)
        for method in ('set_front_led', 'set_back_led', 'set_left_led', 'set_right_led'):
            await getattr(bolt, method)(rgb)
        light = await get_ambient_light()
        assert light == 123.75 and isinstance(light, float)
        assert await get_ambient_light(2) == 123.75
        sensor_result = {'x': 1.25, 'y': -2, 'z': 3}
        assert await bolt.get_sensor_data('orientation', 3) == sensor_result
        for method in ('get_acceleration', 'get_gyroscope', 'get_orientation', 'get_location', 'get_velocity'):
            assert await getattr(bolt, method)() == sensor_result
        await bolt.get_battery_percentage()
        await delay(0.25)
        await bolt.delay(0)
        assert sleeps == [0.25, 0]
        assert requests == [
            ('set_heading', [359]), ('roll_to_distance', [90, 25, 10.5]),
            ('roll_to_distance', [0, 255, 0]), ('stop_roll', []), ('stop_roll', [0]),
            ('set_main_led', [rgb]), ('set_display_text', ['Hello', rgb, {'r': 1, 'g': 2, 'b': 3}, 0]),
            ('set_display_text', ['Font one', {'r': 255, 'g': 255, 'b': 255}, {'r': 0, 'g': 0, 'b': 0}, 1]),
            ('set_display_color', [rgb]), ('clear_display', []), ('set_display_rotation', [90]),
            ('set_display_image', [65535]), ('set_display_image', ['cat']), ('set_display_image', ['angry']),
            ('set_display_animation', [4, True]), ('set_display_animation', ['fireworks', False]),
            ('set_live_sensor_data', [64]), ('set_front_led', [rgb]), ('set_back_led', [rgb]),
            ('set_left_led', [rgb]), ('set_right_led', [rgb]), ('get_ambient_light', []),
            ('get_ambient_light', [2]), ('get_sensor_data', ['orientation', 3]),
            ('get_sensor_data', ['accelerometer', 10]), ('get_sensor_data', ['gyroscope', 10]),
            ('get_sensor_data', ['orientation', 10]), ('get_sensor_data', ['locator', 10]),
            ('get_sensor_data', ['velocity', 10]), ('get_battery_percentage', [])
        ], requests
        before = len(requests)
        invalid = [
            lambda: set_heading(True), lambda: set_heading(360), lambda: set_heading(float('nan')),
            lambda: roll_to_distance(-1, 25, 10), lambda: roll_to_distance(0, 256, 10),
            lambda: roll_to_distance(0, True, 10), lambda: roll_to_distance(0, '25', 10),
            lambda: roll_to_distance(0, 25.5, 10),
            lambda: roll_to_distance(0, 25, -1), lambda: roll_to_distance(0, 25, float('inf')),
            lambda: stop_roll(False), lambda: stop_roll(-1),
            lambda: set_main_led([0, 1, 2]), lambda: set_main_led({'r': 0, 'g': 1}),
            lambda: set_main_led({'r': 1.5, 'g': 1, 'b': 2}),
            lambda: set_main_led({'r': True, 'g': 1, 'b': 2}),
            lambda: set_main_led({'r': 256, 'g': 1, 'b': 2}),
            lambda: set_display_text(42, rgb, rgb, 0),
            lambda: set_display_text('A', rgb, {'r': 0, 'g': -1, 'b': 0}, 0),
            lambda: set_display_text('A', rgb, rgb, 2), lambda: set_display_text('A', rgb, rgb, False),
            lambda: bolt.set_display_rotation(True), lambda: bolt.set_display_rotation(45),
            lambda: bolt.set_display_image(-1), lambda: bolt.set_display_image(65536),
            lambda: bolt.set_display_image('fireworks'), lambda: bolt.set_display_image('missing'),
            lambda: bolt.set_display_image('https://example/image.png'), lambda: bolt.set_display_image('custom.gif'),
            lambda: bolt.set_display_animation('cat'), lambda: bolt.set_display_animation('missing'),
            lambda: bolt.set_display_animation('custom.gif'),
            lambda: bolt.set_display_animation(0, 1), lambda: bolt.set_live_sensor_data(True),
            lambda: bolt.set_live_sensor_data(3), lambda: bolt.get_ambient_light(0),
            lambda: bolt.get_ambient_light(61), lambda: bolt.get_ambient_light(float('inf')),
            lambda: bolt.get_sensor_data('bad'), lambda: bolt.get_sensor_data('velocity', True),
            lambda: bolt.get_sensor_data('velocity', 0),
            lambda: delay(-1), lambda: delay(True), lambda: delay(float('nan')),
        ]
        for call in invalid:
            try:
                await call()
            except ValueError:
                pass
            else:
                raise AssertionError('Invalid command was accepted')
        assert len(requests) == before
        assert sleeps == [0.25, 0]
        requests.clear()
        program = 'from sphero import roll_to_distance, get_ambient_light, stop_roll\nasync def start_program():\n    await roll_to_distance(180, 25, 20)\n    assert await get_ambient_light() == 123.75\n    await stop_roll()'
        assert await _ide_run(program, 'course.py', 21) == 0
        assert requests == [('roll_to_distance', [180, 25, 20]), ('get_ambient_light', []), ('stop_roll', [])]
    finally:
        _asyncio.sleep = original_sleep
        _ide_origin.reset(token)
asyncio.run(check())
`;
  const result = spawnSync('python3', ['-c', `HELPER = ${JSON.stringify(helper)}\n${check}`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
