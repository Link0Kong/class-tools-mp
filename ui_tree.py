import uiautomation as auto
w=auto.WindowControl(searchDepth=1, Name='小程序 和另外 5 个页面 - 个人 - Microsoft\u200b Edge')
print('found', w.Exists(1))
def walk(c, depth, maxdepth):
    try:
        name=c.Name
        ct=c.ControlTypeName
        if name or depth<=2:
            print('  '*depth + ct + ' ' + repr(name)[:160])
    except Exception: pass
    if depth>=maxdepth: return
    try:
        for ch in c.GetChildren(): walk(ch, depth+1, maxdepth)
    except Exception: pass
walk(w,0,3)
