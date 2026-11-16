import win32gui, pyautogui, time, os
hwnd = 593536
win32gui.SetForegroundWindow(hwnd); time.sleep(0.5)
x0,y0 = 2953, 385
# move mouse away first
pyautogui.moveTo(x0+600, y0+600); time.sleep(0.3)
for i, x in enumerate([330, 384, 442, 485]):
    pyautogui.moveTo(x0+x, y0+1259); time.sleep(1.6)
    img = pyautogui.screenshot(region=(x0, y0+1180, 630, 130))
    img.save(os.path.join(os.getcwd(), f"_tip_{i}.png"))
print("SAVED")
