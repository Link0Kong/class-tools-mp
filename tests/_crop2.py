from PIL import Image
import pyautogui, os
img = pyautogui.screenshot()
img.save("_screen_now.png")
print(img.size)
w,h = img.size
crop = img.crop((w-700, h-90, w, h)).resize((1400, 180), Image.LANCZOS)
crop.save("_corner_icons2.png")
crop2 = img.crop((900, h-90, 2400, h)).resize((3000, 180), Image.LANCZOS)
crop2.save("_sim_toolbar2.png")
