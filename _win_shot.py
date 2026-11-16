import win32gui, win32con
import pyautogui, os
res = []
def cb(hwnd, _):
    if not win32gui.IsWindowVisible(hwnd): return
    t = win32gui.GetWindowText(hwnd)
    if "开发者工具" in t or "mp-class-tools" in t:
        r = win32gui.GetWindowRect(hwnd)
        res.append((hwnd, t, r))
win32gui.EnumWindows(cb, None)
for hwnd, t, r in res:
    print(hwnd, repr(t), r)
if res:
    hwnd, t, r = res[0]
    win32gui.SetForegroundWindow(hwnd)
    import time; time.sleep(0.8)
    x1,y1,x2,y2 = r
    img = pyautogui.screenshot(region=(x1,y1,x2-x1,y2-y1))
    out = os.path.join(os.getcwd(), "_devtools_window.png")
    img.save(out)
    print("SAVED", out, img.size)
