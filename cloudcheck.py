import os
os.chdir(r'C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools')
import os, json,re,urllib.request,urllib.error,time
cfg=open('utils/cloud-config.js',encoding='utf-8').read()
base=re.search(r"restBase:\s*'([^']+)'",cfg).group(1)
key=re.search(r"publishableKey:\s*'([^']+)'",cfg).group(1)
print('base host ok:',base.split('/')[2])
def get(path, extra_headers=None):
    url=base.rstrip('/')+'/'+path
    h={'Authorization':'Bearer '+key,'Content-Type':'application/json','Prefer':'count=exact'}
    if extra_headers:h.update(extra_headers)
    req=urllib.request.Request(url,headers=h)
    t=time.time()
    try:
        r=urllib.request.urlopen(req,timeout=20)
        body=r.read()
        try:data=json.loads(body)
        except Exception:data=None
        return r.status,len(body),data,r.headers.get('Content-Range')
    except urllib.error.HTTPError as e:
        return e.code,0,None,e.headers.get('Content-Range')
    except Exception as e:
        return 'ERR',0,str(e),None
checks=[
 ('homework','homework?select=id,ts&limit=3'),
 ('notices','notices?select=id,ts&limit=3'),
 ('marks','marks?select=id&limit=3'),
 ('userdata','userdata?select=id&limit=3'),
 ('feedback','feedback?select=id&limit=3'),
 ('visits','visits?select=slot,did&limit=3'),
 ('roster','roster?select=id&limit=3'),
 ('users-id-only','users?select=id&limit=3'),
 ('users-hash','users?select=h&limit=1'),
]
for name,path in checks:
    st,n,data,cr=get(path)
    cnt=len(data) if isinstance(data,list) else '-'
    print(f'{name:12} status={st} bytes={n} rows={cnt} range={cr}')
# admin existence, no hash output
st,n,data,cr=get('users?select=id&id=eq.admin')
print('admin exists:', st, isinstance(data,list) and len(data), (data[0].get('id') if isinstance(data,list) and data else None))
# roster main presence only
st,n,data,cr=get('roster?select=id&id=eq.main')
print('roster main:', st, isinstance(data,list) and len(data))
