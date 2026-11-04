# Validation — BOLT+ display-library release

## Independent pre-merge review — November 4, 2026

Fresh verification: 79 unit tests, all reconnect scenario groups and four
full-bundle transport tests passed. All 18 browser checks passed with the same
pinned Pyodide v0.29.5 served from a temporary local mirror. Earlier fresh runs
hit CDN import/startup failures, retained in local receipts; those runs do not
establish CDN availability. Both restored Moodle layouts passed using the
normal CDN configuration. The runtime mirror is not part of either package.


The code review cleared sensor/display SDK contracts, stale-session cleanup,
Python entry dispatch and catalogue mappings. The separate artifact review
matched all published candidates and thumbnails to their sources. Its findings
were repaired before merge: builders now restrict output names to the current
release, reject source/historical archives and file aliases, and atomically
replace outputs only after verification; current downloads and release labels
are consistent; operational course notes remain private.

The optional historical course-browser suite could not complete because its
private adapted Q01 fixture is absent from this workspace. It is excluded from
the public distribution; its startup check passed before the missing fixture.
The four optional full-bundle transport tests passed using a temporary copy of
the pinned original bundle after the default extracted reference was absent.
Current runtime tests and device acceptance are reported separately below.


## November 4, 2026 emoji and animation library extension

- `npm test`: 77/77 tests passed. This includes catalogue integrity, all
  thumbnail hashes, named/random asset resolution and Python RPC validation.
- `node tests/browser.test.mjs`: final run 18/18 passed with real Chrome and
  Pyodide plus an explicit simulated robot. New checks search emoji, decode
  thumbnails, verify the narrow viewport, and run gallery-generated Python.
- Two preceding full-suite attempts timed out on initial runtime readiness;
  isolated startup probes and the final complete run passed. The cause of
  those readiness timeouts was not established. The saved timeout receipt
  remains in `verification/display-library-20261104/`.
- Independent Sol review checked every one of the 745 Python constant
  expressions and their routes, source archive SHA, random-choice kind
  membership and thumbnail bytes. A namespace mismatch was corrected before
  the final checks; no unresolved code findings remain.
- Restored five-file Moodle candidate passed both normal and nested pluginfile
  paths with real SDK/WASM/Python and embedded gallery thumbnails. Actual
  Moodle upload and physical Bluetooth/display tests were not performed.
- Development and Moodle candidates are separately named
  `pythonide-boltplus-display-library-20261104.zip` and
  `pythonide-boltplus-display-library-moodle-20261104.zip`. CRC and archived/
  restored byte checks passed. Earlier release archives are preserved.
- Catalogue: 649 concrete images (including 58 emoji graphics), 77 concrete
  animations, 19 random selectors, 726 unique PNG thumbnails. The source is
  the supplied app, not a verified inventory of every newer firmware asset.
- Raw custom GIF uploads and arbitrary Unicode emoji text are not exposed.
  No source upload, Moodle publication or robot firmware change occurred.


## November 4, 2026 local feature update

- `npm test`: 74/74 tests passed, including actual bundled ToyBox display
  encoders and the BOLT+ v2 ambient-light parser without `isValid`.
- `npm run test:neo`: reconnect regression checks passed.
- `node tests/browser.test.mjs`: 17/17 Chrome checks passed, using real
  CDN Pyodide in a worker and an explicit simulated robot. Includes the new
  command bridge and the complete stationary light/display example loaded by
  its button; ten readings printed, no drive command dispatched.
- Independent Sol reviewer identified delayed same-ID animation completion
  after cancellation. Fixed by quarantining uncertain non-looping animation
  waits on that SDK session; regression covers an old completion after retry.
- Syntax checks passed for `ide.js`, `python-worker.js`, `bolt-course-api.js`.
- Detailed command coverage and device checklist: `BOLTPLUS_FEATURES.md`.
- Evidence: `verification/features-20261104/`. Packaging writes a separate
  `pythonide-boltplus-features-20261104.zip` and verifies CRC, every archived
  source byte and extracted byte, and unchanged ToyBox/WASM hashes.
- No physical BOLT+ or Chromebook Bluetooth was tested. No firmware update,
  Moodle publication, or change to the old release ZIPs was performed.

The sections below describe earlier releases and their historical evidence.


## Automated checks

- 44 unit tests pass with `npm test`. They cover Python worker bootstrap, RPC matching, source line reporting, automatic async entry dispatch without duplicate execution, cross-run task isolation, BOLT+ LED mapping, stationary aiming, connection ownership, teardown, late callbacks, cancelled native connects, delayed service/characteristic discovery, and idle maintenance.
- The reconnect regression passes all nine scenario groups with `npm run test:neo`. The matching unpatched reference reproduces the recovery faults. The installed SDK prevents obsolete reads/writes/notifications, queued work, and native callbacks from crossing connection generations.
- 15 Chrome checks pass with `npm run test:browser`: real Pyodide, ordinary `input()`, exception lines, interrupting Python, source persistence, a 375px viewport, keyboard aiming, required aim confirmation, async entry dispatch, command-error preservation, simulated disconnect/reconnect without movement replay, and idle-maintenance cleanup.
- The Moodle ZIP is reopened, CRC/byte-checked, and restored at both root and Moodle-style nested paths. `npm run check:moodle` loads the real Sphero SDK, ToyBox/WASM, Python, input, and async starter in both copies. All local runtime assets return HTTP 200 and no vendor-folder requests are required.
- Targeted reviews covered connection ownership, asynchronous cleanup, idle maintenance, startup failure reporting, and package asset paths. Findings were fixed and rechecked.

## Physical observations and limits

On a Mac in Chrome, physical BOLT+ testing confirmed connection, stationary aiming, movement in the chosen forward direction, stopping, and running again after reconnecting. After idle maintenance was added, the requested two-minute visible-tab test stayed connected after the program and while waiting.

Physical Bluetooth use through the uploaded Moodle resource, classroom Chromebooks, longer-duration idle use, and background-tab reliability have not been established. A prior Moodle upload reported that the external SDK was unavailable; its exact cause was not isolated. The separate flat Moodle ZIP removes that nested external-script dependency. Local static-path tests do not establish the uploaded resource's security policy or Bluetooth access.

## Transport and maintenance evidence

The adapter requests battery percentage immediately and schedules another read ten seconds after an actual successful response. It answers `WILL_SLEEP_NOTIFY` with a supported ping, matching the supplied reference app's behavior. Dispatch completion is distinct from the battery response. Missing replies are diagnosed and retried; disconnecting clears maintenance timers/listeners. Reconnect creates a new session without resuming a program.

The SDK's put-away event follows transport loss and does not identify its original radio/firmware cause. Simulated recovery checks and a successful Mac retest do not establish general Chromebook radio stability.

## Provenance and packages

The SDK was extracted from the supplied `sphero-boltplus-ev3-file-resource-20260927.zip`. The full reference archive and local device/session evidence are not published here. SDK attribution and original-source hashes are retained in `vendor/sphero/PROVENANCE.txt`. ToyBox and the WASM core are unchanged; the extracted Bluetooth adapter contains the reviewed recovery and lifecycle repairs.

The development and Moodle package builders reopen each ZIP, verify its inventory and bytes, and restore it for browser checks. The Moodle package has five files at one level: bundled `index.html`, `python-worker.js`, `toybox.js`, `core-4.6.0.wasm`, and `README-MOODLE.txt`.

## Original full-resource update

The supplied full Sphero/EV3 resource is repaired separately from the barebones
Python IDE. Its Bluetooth module uses the same guarded Neo reconnect and
lifecycle transformations as the extracted SDK. Four full-bundle tests prove
that only module 6490 changes; the other 531 modules and the surrounding bundle
bytes are identical. Thirteen lifecycle tests include native connects and
service/characteristic discovery finishing after teardown. A focused independent
review cleared the final transport candidate.

`python3 scripts/package-original-resource.py` validates the immutable source
archive, updates the resource cache identity, refreshes the manifest, builds a
full replacement and a five-file patch, and checks ZIP/restored bytes. The
original app's battery polling, sleep-warning ping, and hidden-page
stop/disconnect policy remain. Worker-registration cleanup is limited to this
resource directory; no saved programs or storage are cleared.

The source archive and local recovery evidence are excluded from public
publication. Earlier full-resource and course publication notes remain local;
they are not acceptance evidence for this display-library release. The current
release still needs physical Chromebook/BOLT+ testing of connect, aim,
run/stop, visible idle and repeated reconnect. No firmware update or Moodle
publication is included in this GitHub change.

## References

- [Sphero: Connecting BOLT+](https://help.sphero.com/sphero-support/connecting-bolt-plus)
- [Sphero Python entry point](https://sites.google.com/sphero.com/sphero-edu-javascript-wiki/getting-started)
- [Sphero movement and heading](https://sites.google.com/sphero.com/sphero-edu-javascript-wiki/movement)
- [Pyodide JavaScript Promise Integration](https://blog.pyodide.org/posts/jspi/)
