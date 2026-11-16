import uiautomation as auto
for w in auto.GetRootControl().GetChildren():
    try:
        if w.Name:
            print(w.ControlTypeName, repr(w.Name)[:160])
    except Exception as e: pass
