import win32gui, pyautogui, os
img = pyautogui.screenshot(region=(1200,540,1440,1080))
img.save(os.path.join(os.getcwd(), "_settings_win.png"))
print("SAVED", img.size)
