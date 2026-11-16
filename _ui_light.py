import win32gui, pyautogui, time, os
pyautogui.click(1753, 862); time.sleep(2.5)
hwnd = 593536
win32gui.SetForegroundWindow(hwnd); time.sleep(0.8)
img = pyautogui.screenshot(region=(2953,385,630,1356))
img.save(os.path.join(os.getcwd(), "_after_light.png"))
print("SAVED")
