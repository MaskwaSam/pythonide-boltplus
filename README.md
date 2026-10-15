# Python IDE with Sphero BOLT+

A browser Python editor with a Sphero BOLT+ connection, aiming controls, an async starter program, disconnect recovery, and a green connection dot.

[Download the Moodle-ready ZIP](pythonide-boltplus-moodle.zip?raw=1) or [the development ZIP](pythonide-boltplus.zip?raw=1).

## Open locally

From this folder run:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/python-ide.html` in current Chrome or Edge. Use HTTPS when hosting elsewhere. Opening the HTML directly as a `file:` URL is insufficient for the workers. Python and the optional CodeMirror editor download from their original CDNs, so internet access is required. If CodeMirror cannot load, the editor falls back to a text box.

## Connect and run

1. Close other Sphero tabs/apps. Charge and shake BOLT+ awake.
2. Click **Connect BOLT+**, select the `BP-` ID shown on your robot, and pair.
3. Wait for its name and green dot at the top right. The BOLT+ starter loads automatically if the editor still has the default program or is empty. Existing code is preserved; **BOLT+ starter** loads the example after a replacement confirmation.
4. The **Aim BOLT+** dialog opens. Place the robot on a clear floor, then rotate it with the slider or arrow buttons until the blue rear light points toward you. Choose **Done** to set the direction away from you as heading 0°. You can reopen **Aim BOLT+** before any program; each new connection requires aiming again.
5. Click **Run** (Ctrl/Cmd+Enter). If aiming was cancelled, Run reopens the dialog and waits for you to confirm forward. Press Run again afterward.
6. **Stop** terminates Python and sends a robot stop command. Python reloads afterward. **Disconnect BOLT+** closes the SDK connection. An unexpected disconnect cancels the running program and clears the dot.

The green dot reflects an initialized SDK session, not the operating system's “paired” label. Physical Bluetooth loss detection depends on the browser/SDK reporting the loss.

While connected, the IDE follows the supplied Sphero app's idle maintenance: it requests battery percentage immediately, schedules another check ten seconds after each actual battery reply, and sends a non-motion ping when the robot warns that it may sleep. This continues after a program finishes. Missing battery replies are logged and retried; they alone do not force a disconnect. Disconnecting removes these listeners and timers, and reconnecting creates a fresh maintenance session. This matches a verified behavior of the reference app. After this update, the user confirmed that the requested two-minute visible-tab test stayed connected after the program and while waiting on the Mac. Longer-duration, background-tab, and classroom Chromebook reliability remain unverified.

## Chromebook disconnect recovery

The Web Bluetooth transport includes a reviewed reconnect repair. Regression simulations reproduce delayed commands reaching an obsolete connection and notification setup reporting success before the browser finishes.

The transport now cancels affected reads, writes, and notification operations on a drop; removes old listeners; rejects queued commands for the lost device; and waits for native notification setup. Connection generations prevent late callbacks from changing a new session. Additional IDE guards ensure an old SDK cannot tear down a replacement connection, including when Chrome returns the same Bluetooth device object. Reconnecting does not replay a program or resume movement.

This addresses the reproduced recovery faults. The original cause of radio dropouts on classroom Chromebooks is still unconfirmed, and repeated physical BOLT+ checks remain necessary.

```python
from sphero import bolt

async def start_program():
    await bolt.set_color(0, 180, 80)  # RGB channels: whole numbers, 0–255
    await bolt.roll(heading=0, speed=20, duration=1)
    await bolt.stop()
```

The IDE calls `async def start_program():` automatically, matching [Sphero Edu's entry-point structure](https://sites.google.com/sphero.com/sphero-edu-javascript-wiki/getting-started). It also preserves top-level Python programs; explicitly awaiting `start_program()` does not cause a second automatic invocation.

The IDE's small `sphero` Python module exposes `bolt.set_color(r, g, b)`, `bolt.roll(heading, speed, duration)`, `bolt.stop()`, `bolt.set_heading(heading)`, and `bolt.sleep(seconds)`. Await each command. Heading is 0–359 degrees relative to the robot's confirmed aim; speed is 0–100 percent; duration is seconds. `set_heading` changes the stopped heading. This compact API is specific to the IDE: it does not implement every Sphero Edu command, and Sphero Edu's documented speed scale of -255 to 255 differs from this IDE's percent scale. Programs use Python in the browser; commands cross to the supplied Sphero SDK on the page.

BOLT+ colors use the SDK's 18 front/rear LED channel masks through LED control. Unsupported program commands report errors without intentionally closing a healthy Bluetooth session. Transport loss and command timeouts still clear the connection; bounded SDK diagnostics appear in the output to help distinguish those cases.

Ordinary `input()` uses Pyodide's JSPI support in current Chrome/Edge and opens an inline console field. `await ask("Your question")` also works when JSPI is unavailable. Infinite loops can be stopped because Python runs in a dedicated worker. Output, errors and input appear in the console; downloaded `.py` files remain ordinary source text. Editor contents are saved locally in the browser when storage is available.

## Moodle or another HTTPS host

For Moodle, use **`pythonide-boltplus-moodle.zip`**. Create a new **File** resource for testing, upload the ZIP, click it and choose **Unzip**, then click **`index.html` → Set main file**. Choose **Appearance → Display → Open**, then **Save and display**. Keep all five extracted files together. This flat package bundles the SDK, adapter, aiming dialog, and IDE scripts into `index.html`; `python-worker.js`, `toybox.js`, and `core-4.6.0.wasm` sit beside it, with `README-MOODLE.txt`. It avoids the nested `vendor` script path that was unavailable in the reported Moodle test. Build it with `python3 scripts/package-moodle.py`; `node scripts/check-moodle-package.mjs` checks both extracted layouts against the local server.

The general development ZIP, `pythonide-boltplus.zip`, still uses `python-ide.html` plus separate scripts and its `vendor/sphero/` folders. It must also be extracted with all supporting files intact. For either package, use **Open** or **In pop-up** so the page runs at the top level. Embedded pages need explicit Bluetooth permission and may be blocked by the host's permissions policy. Moodle installation and physical classroom devices must be checked on the actual destination.

The original IDE is retained as `python-ide.original.html`. The supplied Sphero ZIP and extracted `reference/` are unchanged reference material, excluded from the small IDE distribution.

## Validation and source

Node.js, npm, and Python 3 are needed for development checks. Install the test dependency and run the unit and reconnect suites:

```sh
npm ci
npm test
npm run test:neo
```

With the local server running on port 8765 and Google Chrome installed, run `npm run test:browser`. Rebuild the packages with `npm run package` and `npm run package:moodle`, then check the extracted Moodle ZIP with `npm run check:moodle`. The browser checks use real Pyodide plus a separate simulated robot connection. Simulation does not validate a real robot. See [VALIDATION.md](VALIDATION.md) for the checks actually completed.

Sphero's transport comes from the supplied ZIP. `scripts/extract-sphero-sdk.mjs` reproducibly selects the 14 SDK modules from the original bundle and applies `scripts/neo-reconnect-patch.cjs` before the IDE lifecycle safeguards. The ToyBox worker and WASM core are copied unchanged. See `vendor/sphero/PROVENANCE.txt` for hashes and provenance. This copy does not add the full Edu app, user accounts, cloud saving, EV3, or sensor interfaces.

The original supplied reference archive, extracted full Sphero app, local verification records, and saved device-test files are excluded from this repository. The committed SDK supports normal use, tests, and packaging without that reference archive; optional SDK re-extraction requires the matching archive extracted to `reference/`. Third-party attribution is retained in `vendor/sphero/PROVENANCE.txt`; no blanket license is applied to the Sphero runtime files.
