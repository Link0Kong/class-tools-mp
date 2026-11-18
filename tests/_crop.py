from PIL import Image
img = Image.open("_maximized.png")
crop = img.crop((3660, 2040, 3862, 2120)).resize((808, 320), Image.LANCZOS)
crop.save("_corner_icons.png")
crop2 = img.crop((1000, 2050, 2100, 2110)).resize((2200, 120), Image.LANCZOS)
crop2.save("_sim_toolbar.png")
print("OK")
