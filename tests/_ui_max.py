import win32gui, win32con, pyautogui, time, os
hwnd = 593536
win32gui.ShowWindow(hwnd, win32con.SW_MAXIMIZE); time.sleep(1.5)
win32gui.SetForegroundWindow(hwnd); time.sleep(0.8)
r = win32gui.GetWindowRect(hwnd)
print("RECT", r)
img = pyautogui.screenshot(region=(r[0],r[1],r[2]-r[0],r[3]-r[1]))
img.save(os.path.join(os.getcwd(), "_maximized.png"))
print("SAVED", img.size)
