import win32gui, pyautogui, time, os
hwnd = 593536
win32gui.SetForegroundWindow(hwnd); time.sleep(0.5)
pyautogui.click(2953+390, 385+65); time.sleep(0.9)   # 设置 menu
pyautogui.click(2953+452, 385+161); time.sleep(1.8)  # 外观设置
img = pyautogui.screenshot()
img.save(os.path.join(os.getcwd(), "_appearance2.png"))
print("SAVED settings shot")
