import os
os.chdir(r'C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools')
import os, json,re,urllib.request,urllib.error
cfg=open('utils/cloud-config.js',encoding='utf-8').read()
base=re.search(r"restBase:\s*'([^']+)'",cfg).group(1).rstrip('/')+'/'
key=re.search(r"publishableKey:\s*'([^']+)'",cfg).group(1)
def get(path):
    req=urllib.request.Request(base+path,headers={'Authorization':'Bearer '+key})
    try:
        r=urllib.request.urlopen(req,timeout=20); b=r.read()
        return r.status,len(b)
    except urllib.error.HTTPError as e: return e.code,0
for name,path in [('roster.data','roster?select=data&id=eq.main'),('userdata.blob','userdata?select=blob&limit=1'),('marks.seat','marks?select=seat&limit=3'),('feedback.all','feedback?select=*&limit=3'),('fitrecs','fitrecs?select=*&limit=3')]:
    st,n=get(path); print(f'{name:14} status={st} bytes={n} readable={st==200 and n>2}')
