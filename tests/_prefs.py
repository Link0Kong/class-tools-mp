import os, json, re
base = os.path.join(os.environ["APPDATA"], "微信开发者工具")
for f in ["Preferences", "Local State"]:
    p = os.path.join(base, f)
    if os.path.exists(p):
        s = open(p, "r", encoding="utf-8", errors="replace").read()
        print("=====", f, len(s))
        for m in re.finditer(r'"[^"]*[Tt]heme[^"]*"', s):
            print(" ", m.group(0))
# also grep all small json in base root
for f in os.listdir(base):
    p = os.path.join(base, f)
    if os.path.isfile(p) and os.path.getsize(p) < 3_000_000:
        try: s = open(p, "r", encoding="utf-8", errors="replace").read()
        except: continue
        hits = re.findall(r'[^"]{0,30}[Tt]heme[^"]{0,40}', s)
        if hits: print(f, len(s), hits[:6])
