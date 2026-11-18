import win32gui, pyautogui, time, os
hwnd = 593536
r = win32gui.GetWindowRect(hwnd)
x1,y1,x2,y2 = r
def snap(name, region=None):
    img = pyautogui.screenshot(region=region or (x1,y1,x2-x1,y2-y1))
    img.save(os.path.join(os.getcwd(), name))
    print("SAVED", name, img.size, "rect", region or (x1,y1,x2-x1,y2-y1))
# focus
win32gui.SetForegroundWindow(hwnd); time.sleep(0.6)
# click 界面 menu: window-relative (383,65)
pyautogui.click(x1+383, y1+65); time.sleep(1.2)
snap("_menu_ui.png")
