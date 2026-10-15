# Validation — October 15, 2026

## Automated checks

- 37 unit tests pass with `npm test`. They cover Python worker bootstrap, RPC matching, source line reporting, automatic async entry dispatch without duplicate execution, cross-run task isolation, BOLT+ LED mapping, stationary aiming, connection ownership, teardown, late callbacks, and idle maintenance.
- The reconnect regression passes all nine scenario groups with `npm run test:neo`. The matching unpatched reference reproduces the recovery faults. The installed SDK prevents obsolete reads/writes/notifications, queued work, and native callbacks from crossing connection generations.
- 15 Chrome checks pass with `npm run test:browser`: real Pyodide, ordinary `input()`, exception lines, interrupting Python, source persistence, a 375px viewport, keyboard aiming, required aim confirmation, async entry dispatch, command-error preservation, simulated disconnect/reconnect without movement replay, and idle-maintenance cleanup.
- The Moodle ZIP is reopened, CRC/byte-checked, and restored at both root and Moodle-style nested paths. `npm run check:moodle` loads the real Sphero SDK, ToyBox/WASM, Python, input, and async starter in both copies. All local runtime assets return HTTP 200 and no vendor-folder requests are required.
- Targeted reviews covered connection ownership, asynchronous cleanup, idle maintenance, startup failure reporting, and package asset paths. Findings were fixed and rechecked.

## Physical observations and limits

On a Mac in Chrome, physical BOLT+ testing confirmed connection, stationary aiming, movement in the chosen forward direction, stopping, and running again after reconnecting. After idle maintenance was added, the requested two-minute visible-tab test stayed connected after the program and while waiting.

Actual uploaded Moodle, classroom Chromebooks, longer-duration idle use, and background-tab reliability have not been established. A prior Moodle upload reported that the external SDK was unavailable; its exact cause was not isolated. The separate flat Moodle ZIP removes that nested external-script dependency. Local static-path tests do not establish the uploaded resource's security policy or Bluetooth access.

## Transport and maintenance evidence

The adapter requests battery percentage immediately and schedules another read ten seconds after an actual successful response. It answers `WILL_SLEEP_NOTIFY` with a supported ping, matching the supplied reference app's behavior. Dispatch completion is distinct from the battery response. Missing replies are diagnosed and retried; disconnecting clears maintenance timers/listeners. Reconnect creates a new session without resuming a program.

The SDK's put-away event follows transport loss and does not identify its original radio/firmware cause. Simulated recovery checks and a successful Mac retest do not establish general Chromebook radio stability.

## Provenance and packages

The SDK was extracted from the supplied `sphero-boltplus-ev3-file-resource-20260927.zip`. The full reference archive and local device/session evidence are not published here. SDK attribution and original-source hashes are retained in `vendor/sphero/PROVENANCE.txt`. ToyBox and the WASM core are unchanged; the extracted Bluetooth adapter contains the reviewed recovery and lifecycle repairs.

The development and Moodle package builders reopen each ZIP, verify its inventory and bytes, and restore it for browser checks. The Moodle package has five files at one level: bundled `index.html`, `python-worker.js`, `toybox.js`, `core-4.6.0.wasm`, and `README-MOODLE.txt`.

## References

- [Sphero: Connecting BOLT+](https://help.sphero.com/sphero-support/connecting-bolt-plus)
- [Sphero Python entry point](https://sites.google.com/sphero.com/sphero-edu-javascript-wiki/getting-started)
- [Sphero movement and heading](https://sites.google.com/sphero.com/sphero-edu-javascript-wiki/movement)
- [Pyodide JavaScript Promise Integration](https://blog.pyodide.org/posts/jspi/)
