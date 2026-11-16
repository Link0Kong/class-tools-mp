from PIL import Image
img = Image.open("_screen_now.png")
crop = img.crop((1150, 1990, 2500, 2120)).resize((2700, 260), Image.LANCZOS)
crop.save("_sim_toolbar3.png")
print("OK")
