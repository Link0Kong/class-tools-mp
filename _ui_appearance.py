import win32gui, pyautogui, time, os
pyautogui.click(2953+452, 385+161); time.sleep(1.8)
img = pyautogui.screenshot()
img.save(os.path.join(os.getcwd(), "_appearance.png"))
print("SAVED", img.size)
# list windows now
def cb(hwnd, _):
    if not win32gui.IsWindowVisible(hwnd): return
    t = win32gui.GetWindowText(hwnd)
    if t and ("开发者" in t or "设置" in t or "mp-class" in t):
        print(hwnd, repr(t), win32gui.GetWindowRect(hwnd))
win32gui.EnumWindows(cb, None)
