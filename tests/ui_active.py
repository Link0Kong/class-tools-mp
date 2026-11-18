import uiautomation as auto, time
w=auto.WindowControl(searchDepth=1, Name='小程序 和另外 5 个页面 - 个人 - Microsoft\u200b Edge')
print(w.Exists(1)); w.SetActive(); time.sleep(0.5); print('active')
