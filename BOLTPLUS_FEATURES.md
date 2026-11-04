# BOLT+ Python features — November 4, 2026

## Emoji and animation library

Choose **Emoji + animations** in the IDE to search the complete named asset set
from the supplied Sphero app. Filter images by the **emoji** category to browse
58 emoji graphics. The catalogue contains 649 concrete images (647 canvas
images and two logo assets), 77 concrete animations, and 19 random-category
selectors. Thumbnails are bundled locally and are static previews.

```python
from sphero import DisplayImage, DisplayAnimation
from sphero import set_display_image, set_display_animation, delay

async def start_program():
    await set_display_image(DisplayImage.HEART_EYES)
    await delay(2)
    await set_display_image("thinking")
    await delay(2)
    await set_display_animation(DisplayAnimation.FIREWORKS, looping=True)
    await delay(3)
```

`DisplayImage` and `DisplayAnimation` constants are canonical asset-name
strings. Both named strings and integer firmware IDs work. For a random emoji,
use `DisplayImage.RANDOM_EMOJI`. Discover all available names and constants with
the synchronous local functions `list_display_images()` and
`list_display_animations()`, imported from `sphero`; each returns independent
metadata dictionaries. The generator preserves the supplied enum's complete
named asset inventory; it does not silently include unrelated app artwork.

**GIF limitation:** animation playback selects an asset already on the robot.
The supplied app uses Lottie/PNG preview resources and contains no GIF files.
The official display API documents built-in assets, not custom GIF uploads.
This IDE therefore does not accept `.gif` files or image/animation URLs.
Arbitrary Unicode emoji in `set_display_text("😀")` are also outside BOLT+'s
documented text character sets; use the corresponding library graphic.

The source is the supplied September 27 Sphero app, pinned by SHA-256 in
`display-library-manifest.json`. This is not a claim that the catalogue contains
every asset in newer firmware. The current official wiki's catalogue images
could not be fetched for a live count comparison. Individual assets still need
physical testing against the robot's installed firmware.

`scripts/extract-display-library.mjs` reproduces the catalogue and selected PNG
thumbnails from the original ZIP without modifying it. Display artwork remains
third-party Sphero content; this copy grants no new licence. All 745 named constant
expressions and catalogue mappings were checked during independent review.

Open `python-ide.html` in Chrome or Edge on HTTPS or localhost. Connect BOLT+,
confirm Aim, then choose **Light + display example** and Run. Save existing
work before replacing it. The example does not drive the robot. Cover and
uncover the light sensor to change the readings printed in the console and on
the robot's LCD. The source is also in `examples/bolt_light_display.py`.

All commands below are asynchronous. Import them from `sphero` and `await`
them inside `async def start_program():`. They are also methods on `bolt`.

```python
from sphero import set_display_color, set_display_text, get_ambient_light, delay

async def start_program():
    await set_display_color({'r': 0, 'g': 255, 'b': 0})
    await delay(2)
    light = await get_ambient_light()
    print(f"Light: {light:.1f} lux")
    await set_display_text(f"Light\n{light:.1f}\nlux")
```

## Commands available in this IDE

| Feature | Commands and accepted values |
| --- | --- |
| Body LED colour | `set_main_led(color)`; legacy `bolt.set_color(r, g, b)` |
| Separate LED groups | `set_front_led(color)`, `set_back_led(color)`, `set_left_led(color)`, `set_right_led(color)` |
| LCD colour | `set_display_color(color)` |
| LCD messages | `set_display_text(text, foreground=None, background=None, font=0)`; defaults to white on black; font 0 normal or 1 large |
| Clear / rotate LCD | `clear_display()`, `set_display_rotation(0/90/180/270)` |
| Built-in images | `set_display_image(image_id)`; name, `DisplayImage` constant, or integer firmware ID, e.g. `"cat"`, `DisplayImage.CAT`, or `642` |
| Built-in animations | `set_display_animation(animation_id, looping=True)`; e.g. `"fireworks"`, `DisplayAnimation.FIREWORKS`, or `1029`. Looping returns after dispatch; `False` waits for completion, up to 30 seconds. |
| Live LCD sensor data | `set_live_sensor_data(mask)`; the robot renders readings directly on its screen |
| Ambient light | `get_ambient_light(timeout=10)` returns fresh lux, including zero; stops the robot before measuring |
| Accelerometer | `get_acceleration(timeout=10)` returns `{'x', 'y', 'z'}` in g |
| Gyroscope | `get_gyroscope(timeout=10)` returns `{'x', 'y', 'z'}` in degrees/second |
| Orientation | `get_orientation(timeout=10)` returns `{'pitch', 'roll', 'yaw'}` in degrees |
| Location / velocity | `get_location(timeout=10)` returns `{'x', 'y'}` in cm; `get_velocity(timeout=10)` returns cm/s, relative to the robot's current locator origin |
| Generic motion sensor read | `get_sensor_data(sensor, timeout=10)`; `accelerometer`, `gyroscope`, `orientation`, `locator`, or `velocity` |
| Battery | `get_battery_percentage()` returns an actual response from 0–100 |
| Movement | Existing `set_heading`, `roll_to_distance`, `stop_roll`; legacy `bolt.roll(heading, speed, duration)` and `bolt.stop()` |
| Timing / input | `delay(seconds)`, `bolt.sleep(seconds)`, `await ask(prompt)`; ordinary `input()` where supported by the browser |

Colours are dictionaries with whole-number channels from 0–255:
`{'r': 255, 'g': 80, 'b': 0}`. Body LEDs and the LCD are separate controls.
Front/back address the centre RGB LED at that end; left/right address the two
corner LEDs on that side, matching the supplied Sphero Edu mapping.
`set_main_led` addresses all six RGB LEDs and overwrites their colours.

Text does not automatically wrap on BOLT+. Use `\n` for line breaks. Normal
font fits 10 characters per line and 6 lines; large fits 7 characters per line
and 5 lines. Fonts support limited character sets. Emoji graphics use the image
library rather than the text font. Display assets must already exist in the
robot firmware; names/constants resolve to their supplied firmware IDs.

Live display masks (one at a time):

| Reading | Mask |
| --- | ---: |
| Orientation | 1 |
| Accelerometer | 2 |
| Total acceleration | 4 |
| Location | 8 |
| Velocity | 16 |
| Speed | 32 |
| Gyroscope | 64 |
| Ambient light | 128 |

For example, `await set_live_sensor_data(128)` displays light directly on the
robot. Use `await get_ambient_light()` when Python needs the number for a
calculation or an `if` statement. Sensor timeouts accept greater than 0 and up
to 60 seconds and never substitute sample data on failure. Readings must arrive
after subscription and sensor setup. Motion sensor reads do not intentionally
stop the robot; ambient-light reads retain the course's stop-first contract.

## Coverage boundaries

This is an expanded Python bridge, not complete Sphero Edu app parity. Infrared
robot messaging/following/evading, collision callbacks, the simulated 8×8 matrix
drawing API, raw motor/stabilization commands, and app-side drive controls,
button events, sounds and speech are not exposed here. They must not be
described as working in this IDE. The SDK advertises some commands for other
robot models; generic command presence is not proof BOLT+ supports them.

BOLT+ has no BOLT compass/magnetometer or RVR colour sensor. Light intensity
is different from sensing a surface's colour. This change does not update
firmware or publish anything to Moodle.

## Fix and verification

The supplied ToyBox BOLT+ v2 light parser emits
`{'AmbientLight': {'ambientLight': value}}` without an `isValid` field. The old
wrapper required `isValid == True`, discarding these readings. It now accepts
finite, nonnegative readings with that field absent, still rejects an explicit
invalid flag, and accepts real darkness (zero lux).

SDK contract tests execute the bundled sensor parser and display command
encoders, alongside Python helper tests and bridge/session regression tests.
These establish software behaviour, not Bluetooth or physical display output.
No physical robot was connected during this change.

On a real BOLT+, verify the following before classroom acceptance:

1. Show green on the LCD and on the body LEDs separately.
2. Show a two-line message in both fonts with readable foreground/background.
3. Cover/uncover the sensor and obtain two changing lux readings, including
   a dark reading if possible; compare with live LCD mask 128.
4. Show cat 642 and fireworks 1029; verify both looping and once behaviour.
5. Rotate the display, clear it, read motion sensors and battery, then Stop.
6. Disconnect/reconnect on the intended Chromebook, retain code, and confirm
   no old movement is replayed.

After an interrupted/timed-out non-looping animation, reconnect before waiting
for another one; native completion packets have no playback request ID. Colour,
text and looping animation commands remain available. Existing distance-move
reconnect safeguards remain in force.

Official references checked November 4, 2026:
[Display programming](https://sites.google.com/sphero.com/sphero-edu-javascript-wiki/display),
[Sensors](https://sites.google.com/sphero.com/sphero-edu-javascript-wiki/sensors),
[BOLT vs BOLT+](https://help.sphero.com/sphero-support/bolt-vs-bolt).
The supplied SDK is the authority for this bridge's actual wire arguments.
