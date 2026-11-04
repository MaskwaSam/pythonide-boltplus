# CSE1240 Python API — updated November 4, 2026

The expanded display, LED and sensor commands are documented in
[BOLTPLUS_FEATURES.md](BOLTPLUS_FEATURES.md). Use the IDE's **Light + display
example** button for a stationary light-reading/message demonstration.

The course API uses explicit async calls. Import commands from `sphero`, place
the program in `async def start_program():`, and await each robot command.
The IDE calls that entry point automatically. The same commands are available
as methods on `bolt`.

| Command | Arguments and result |
| --- | --- |
| `await set_heading(heading)` | Stopped heading, 0–359 degrees relative to confirmed aim. |
| `await roll_to_distance(heading, raw_speed, distance_cm)` | Heading 0–359; whole raw speed 0–255; nonnegative centimetres. A positive distance needs positive speed. |
| `await stop_roll()` | Stop at the current heading. An optional heading selects the stopped heading. |
| `await set_main_led(color)` | RGB dictionary, for example `{'r': 0, 'g': 255, 'b': 0}`. Whole channels 0–255. |
| `await set_display_text(text, foreground=None, background=None, font=0)` | Text, optional RGB dictionaries (white on black), font 0 normal or 1 large. |
| `await set_display_color(color)` | Set the LCD to an RGB colour; separate from the body LEDs. |
| `light = await get_ambient_light()` | Stops first, then waits for a fresh valid sensor packet. Returns a number in lux; zero is valid darkness. |
| `await delay(seconds)` | Nonnegative seconds; yields to Python's event loop. |

Raw speed `25` is **not 25 percent**. The older `await bolt.roll(heading,
speed, duration)` API still takes percent speed and seconds; it is a separate
timed operation. Course distance calls do not use it.

```python
from sphero import set_heading, roll_to_distance, stop_roll, set_main_led

async def start_program():
    try:
        await set_heading(0)
        await roll_to_distance(0, 25, 20)
        await set_main_led({'r': 0, 'g': 255, 'b': 0})
    finally:
        await stop_roll()
```

Connect and confirm Aim BOLT+ before movement. Save/reopen programs with
Save .py and Open .py. The course's sensor check requires two changing real
readings while stopped before the movement task; typed sample values do not
replace that check. Unchanged or unavailable readings leave the robot stopped.

## Distance and recovery contract

`bolt-course-api.js` calls BOLT+'s native
`driveDistanceAtYawNormalized(-heading, raw_speed, distance_cm * 0.01)`.
The heading-to-yaw sign and centimetre-to-metre conversion match the supplied
Sphero Edu app. The raw byte is not rescaled. Inputs outside the native float32
distance range are rejected.

The operation subscribes before dispatch and requires both the successful
command acknowledgement and `REACHED_END_DRIVE_TO_DISTANCE_ASYNC` success.
Worker dispatch alone does not complete a move. A 120-second safety deadline
stops and fails a move; it is not a distance estimate. Cleanup always attempts
Stop on the captured robot, and stop errors are reported.

Firmware completion packets have no request ID. After an interrupted,
timed-out, or otherwise uncertain distance move, more movement is blocked on
that connection until disconnect/reconnect. This prevents an old completion
packet from finishing a later move. Manual Stop remains available. Reconnect
preserves code and does not replay movement.

Stop, normal completion, and Python-worker failure wait for old commands and
cleanup before another run. Connection ownership checks preserve the existing
Neo reconnect safeguards.

## Sensor contract

Fresh light requests use `sensorControl` streaming and a valid later
`AmbientLight` packet, after stopping. The bundled BOLT+ parser omits `isValid`;
finite nonnegative readings are accepted unless explicitly marked invalid.
They do not use the app's cached light
getter. Listeners, timeouts, and owned streams are removed on success, failure,
or cancellation. Existing sensor streams are preserved; old cleanup cannot
disable a newer lease. No light value is synthesized when a request fails.

## Validation scope

Software and simulated robot tests do not establish physical Bluetooth,
distance accuracy, aim direction, display rendering, changing real light
readings, Stop or Chromebook reconnect. See [BOLTPLUS_FEATURES.md](BOLTPLUS_FEATURES.md)
for current command coverage and the physical-device checklist. No Moodle
publication or robot firmware change is part of this local release.
