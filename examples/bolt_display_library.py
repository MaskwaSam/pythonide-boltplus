# BOLT+ emoji graphics and built-in animation. No driving.
from sphero import DisplayImage, DisplayAnimation
from sphero import set_display_image, set_display_animation, delay

async def start_program():
    await set_display_image(DisplayImage.HEART_EYES)
    await delay(2)
    await set_display_image("thinking")
    await delay(2)
    await set_display_image(DisplayImage.RANDOM_EMOJI)
    await delay(2)
    await set_display_animation(DisplayAnimation.FIREWORKS, looping=True)
    await delay(3)
