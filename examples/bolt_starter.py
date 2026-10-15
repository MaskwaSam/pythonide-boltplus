# BOLT+ starter
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
