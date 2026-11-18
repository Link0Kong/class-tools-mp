import pyautogui, time, pyperclip
url='https://mp.weixin.qq.com/wxamp/wadevelopcode/privacy?ver=2&id=oSRRu3T0xU3BYfSdUU64Ggq8kcZQ&token=479073282&lang=zh_CN'
pyperclip.copy(url)
pyautogui.hotkey('ctrl','l'); time.sleep(0.2); pyautogui.hotkey('ctrl','v'); time.sleep(0.2); pyautogui.press('enter'); time.sleep(2)
