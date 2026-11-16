import pyautogui, time
pyautogui.click(700,115); time.sleep(0.3)
pyautogui.hotkey('ctrl','l'); time.sleep(0.2)
pyautogui.write("javascript:alert(document.querySelectorAll('input,textarea,[contenteditable=true]').length)", interval=0.01)
pyautogui.press('enter'); time.sleep(1.5)
