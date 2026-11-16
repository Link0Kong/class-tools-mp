import win32gui, pyautogui, time, os
# close settings window
pyautogui.click(2624, 568); time.sleep(1.0)
hwnd = 593536
win32gui.SetForegroundWindow(hwnd); time.sleep(0.8)
# click device dropdown "iPhone 12/..." at window-rel (287,1259)
pyautogui.click(2953+287, 385+1259); time.sleep(1.2)
img = pyautogui.screenshot(region=(2953-400, 385, 630+400, 1356))
img.save(os.path.join(os.getcwd(), "_device_dd.png"))
print("SAVED", img.size)
