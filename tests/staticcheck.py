import os
os.chdir(r'C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools')
import os, json,re,glob
app=json.load(open('app.json',encoding='utf-8'))
print('pages',len(app['pages']))
for p in app['pages']:
    for ext in ('.js','.wxml','.json','.wxss'):
        f=p+ext
        if not os.path.exists(f): print('MISSING',f)
print('tabBar',[(x['pagePath'],x['text']) for x in app['tabBar']['list']])
# page json components
for p in app['pages']:
    j=json.load(open(p+'.json',encoding='utf-8'))
    for name,path in (j.get('usingComponents') or {}).items():
        if path.startswith('plugin://'): continue
        cand=path[1:] if path.startswith('/') else os.path.normpath(os.path.join(os.path.dirname(p),path))
        if not (os.path.exists(cand+'.json') or os.path.exists(cand+'.js')): print('COMPONENT MISSING',p,name,path)
# event handlers
missing=[]
for p in app['pages']:
    js=open(p+'.js',encoding='utf-8').read(); wxml=open(p+'.wxml',encoding='utf-8').read()
    handlers=set(re.findall(r'(?:bind|catch)[:]?[a-zA-Z]+="([A-Za-z_$][\w$]*)"',wxml))
    for h in sorted(handlers):
        if not re.search(r'\b(function\s+'+re.escape(h)+r'\b|'+re.escape(h)+r'\s*[:(])',js):
            missing.append((p,h))
print('handlers missing',missing)
# 微信原生分享（v1.4.0）：每页都要有转发 + 朋友圈的 handler，且引用的分享封面在包内存在
share_missing=[]
for p in app['pages']:
    js=open(p+'.js',encoding='utf-8').read()
    if 'onShareAppMessage' not in js or 'onShareTimeline' not in js or 'share.enable()' not in js or 'utils/share.js' not in js:
        share_missing.append(p)
print('share handlers missing',share_missing)
share_imgs=set(re.findall(r'/images/share/([a-z0-9_-]+\.png)', ''.join(open(p+'.js',encoding='utf-8').read() for p in app['pages'])))
share_imgs|= {'default.png'}
for name in sorted(share_imgs):
    if not os.path.exists(os.path.join('images','share',name)): print('SHARE IMAGE MISSING','images/share/'+name)
print('share images',len(share_imgs))
# hard constraints
alljs=''.join(open(f,encoding='utf-8').read() for f in glob.glob('**/*.js',recursive=True))
for pat in ['wx.cloud','cloudfunctions','web-view','getUserProfile','getUserInfo','appsecret','service_role','secretKey']:
    print(pat, alljs.count(pat))
# size
total=0
for root,dirs,files in os.walk('.'):
    if 'node_modules' in root: continue
    for f in files: total+=os.path.getsize(os.path.join(root,f))
print('total bytes',total,round(total/1024,1),'KB')
print('urlCheck',json.load(open('project.config.json',encoding='utf-8'))['setting']['urlCheck'])
