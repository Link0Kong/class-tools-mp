import os, json
base = os.path.join(os.environ["LOCALAPPDATA"], "微信开发者工具")
for root, dirs, files in os.walk(base):
    depth = root[len(base):].count(os.sep)
    if depth > 4: 
        dirs[:] = []
        continue
    for f in files[:50]:
        p = os.path.join(root, f)
        try: sz = os.path.getsize(p)
        except: sz = -1
        print(p.encode("unicode_escape").decode(), sz)
