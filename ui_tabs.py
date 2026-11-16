import pyautogui, time, subprocess
for x in [525,975,1425,2400]:
    pyautogui.click(x,30); time.sleep(0.6)
    pyautogui.hotkey('ctrl','l'); time.sleep(0.2); pyautogui.hotkey('ctrl','c'); time.sleep(0.2)
    u=subprocess.check_output(['powershell','-NoProfile','-Command','Get-Clipboard -Raw'],text=True).strip()
    print(x, u[:180])
    pyautogui.press('esc')
