# BOLT+ light, colour, and messages (no driving)
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
    await set_display_text("Hello\nBOLT+!", white, black)
    await delay(2)
    for sample in range(10):
        light = await get_ambient_light()
        print(f"Light: {light:.1f} lux")
        await set_display_text(f"Light\n{light:.1f}\nlux", white, black)
        await delay(1)
