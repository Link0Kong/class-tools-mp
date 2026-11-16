import win32gui, pyautogui, time
hwnd = 593536
win32gui.SetForegroundWindow(hwnd); time.sleep(0.6)
# hover reload icon
pyautogui.moveTo(1767, 2090); time.sleep(1.5)
img = pyautogui.screenshot(region=(1600, 1980, 500, 120)).resize((1500, 360), 3)
img.save("_hover_reload.png")
