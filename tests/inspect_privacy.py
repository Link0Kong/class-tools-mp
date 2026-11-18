import json,urllib.request,websocket
ts=json.load(urllib.request.urlopen('http://127.0.0.1:9222/json'))
t=[x for x in ts if 'mp.weixin.qq.com' in x.get('url','')][0]
print('TARGET',t['title'],t['url'][:120])
ws=websocket.create_connection(t['webSocketDebuggerUrl'],timeout=20); n=0
def send(m,p=None):
 global n
 n+=1; ws.send(json.dumps({'id':n,'method':m,'params':p or {}}))
 while True:
  r=json.loads(ws.recv())
  if r.get('id')==n:return r
send('Runtime.enable')
expr="""JSON.stringify({title:document.title,url:location.href,text:document.body.innerText.slice(0,500),els:[...document.querySelectorAll('input,textarea,select,button,a,[contenteditable=true]')].map((e,i)=>({i,tag:e.tagName,type:e.type,id:e.id,cls:e.className,ph:e.placeholder,ce:e.isContentEditable,txt:(e.innerText||e.value||'').slice(0,60)})).slice(0,200)})"""
r=send('Runtime.evaluate',{'expression':expr,'returnByValue':True})
v=r.get('result',{}).get('result',{}).get('value')
print(v[:8000] if v else r)
