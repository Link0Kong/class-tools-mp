import ctypes
from ctypes import wintypes
u=ctypes.windll.user32
hwnd=u.FindWindowW(None,'小程序 和另外 5 个页面 - 个人 - Microsoft\u200b Edge')
print('hwnd',hwnd)
r=wintypes.RECT(); u.GetWindowRect(hwnd,ctypes.byref(r)); print(r.left,r.top,r.right,r.bottom,'size',r.right-r.left,r.bottom-r.top)
print('show',u.ShowWindow(hwnd,3))  # SW_MAXIMIZE
