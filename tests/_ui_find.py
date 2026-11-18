import win32gui, pyautogui, time, os
# find settings window rect
def cb(hwnd, _):
    if not win32gui.IsWindowVisible(hwnd): return
    t = win32gui.GetWindowText(hwnd)
    if "设置" in t or "外观" in t:
        print(hwnd, repr(t), win32gui.GetWindowRect(hwnd))
win32gui.EnumWindows(cb, None)
