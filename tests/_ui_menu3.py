import win32gui, pyautogui, time, os
pyautogui.click(2953+368, 385+112); time.sleep(1.2)
img = pyautogui.screenshot(region=(2953, 385, 630, 1000))
img.save(os.path.join(os.getcwd(), "_menu_sim.png"))
print("SAVED")
