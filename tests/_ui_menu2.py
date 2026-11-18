import win32gui, pyautogui, time, os
hwnd = 593536
win32gui.SetForegroundWindow(hwnd); time.sleep(0.6)
pyautogui.click(2953+520, 385+600); time.sleep(0.5)  # dismiss dropdown
win32gui.SetForegroundWindow(hwnd); time.sleep(0.4)
pyautogui.click(2953+338, 385+65); time.sleep(1.2)
img = pyautogui.screenshot(region=(2953, 385, 630, 1000))
img.save(os.path.join(os.getcwd(), "_menu_interface.png"))
print("SAVED")
