import pyautogui, time
pyautogui.click(1900,1380); time.sleep(0.3)
pyautogui.hotkey('ctrl','l'); time.sleep(0.4)
pyautogui.write('document.title', interval=0.03); pyautogui.press('enter'); time.sleep(1)
