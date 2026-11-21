import os
# 以本文件所在目录的上一级（仓库根）为工作目录，仓库可放在任意路径
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import json,re,glob
app=json.load(open('app.json',encoding='utf-8'))

subs=app.get('subPackages') or app.get('subpackages') or []
main_pages=list(app.get('pages') or [])
sub_pages=[]
sub_roots=set()
sub_names=set()
for sp in subs:
    root=str(sp.get('root') or '').strip('/')
    if root:
        sub_roots.add(root)
    if sp.get('name'):
        sub_names.add(str(sp['name']))
    for p in (sp.get('pages') or []):
        sub_pages.append((root + '/' + str(p)).strip('/'))
pages=main_pages+sub_pages
print('pages',len(pages),'(main',len(main_pages),'/ sub',len(sub_pages),')')
print('subPackages',[(sp.get('root'),sp.get('name'),len(sp.get('pages') or [])) for sp in subs])

# 分包根目录 / 页面路径：不能重复、不能把 tabBar 页放进分包
if len(set(pages)) != len(pages):
    print('DUPLICATE PAGES', sorted([p for p in set(pages) if pages.count(p)>1]))
tab_paths={x.get('pagePath') for x in (app.get('tabBar',{}).get('list') or [])}
for p in sub_pages:
    if p in tab_paths:
        print('TAB PAGE IN SUBPACKAGE',p)
for root in sorted(sub_roots):
    if not os.path.isdir(root):
        print('SUBPACKAGE ROOT MISSING',root)
# preloadRule：key 必须是已注册页面；packages 必须是分包 root 或 name
for key,rule in (app.get('preloadRule') or {}).items():
    if key not in pages:
        print('PRELOAD PAGE MISSING',key)
    for pkg in ((rule or {}).get('packages') or []):
        if pkg not in sub_roots and pkg not in sub_names:
            print('PRELOAD PACKAGE MISSING',pkg)

for p in pages:
    for ext in ('.js','.wxml','.json','.wxss'):
        f=p+ext
        if not os.path.exists(f): print('MISSING',f)
print('tabBar',[(x['pagePath'],x['text']) for x in app['tabBar']['list']])
# page json components
for p in pages:
    j=json.load(open(p+'.json',encoding='utf-8'))
    for name,path in (j.get('usingComponents') or {}).items():
        if path.startswith('plugin://'): continue
        cand=path[1:] if path.startswith('/') else os.path.normpath(os.path.join(os.path.dirname(p),path))
        if not (os.path.exists(cand+'.json') or os.path.exists(cand+'.js')): print('COMPONENT MISSING',p,name,path)
# event handlers
missing=[]
for p in pages:
    js=open(p+'.js',encoding='utf-8').read(); wxml=open(p+'.wxml',encoding='utf-8').read()
    handlers=set(re.findall(r'(?:bind|catch)[:]?[a-zA-Z]+="([A-Za-z_$][\w$]*)"',wxml))
    for h in sorted(handlers):
        if not re.search(r'\b(function\s+'+re.escape(h)+r'\b|'+re.escape(h)+r'\s*[:(])',js):
            missing.append((p,h))
print('handlers missing',missing)
# 微信原生分享（v1.4.0）：每页都要有转发 + 朋友圈的 handler，且引用的分享封面在包内存在
share_missing=[]
for p in pages:
    js=open(p+'.js',encoding='utf-8').read()
    if 'onShareAppMessage' not in js or 'onShareTimeline' not in js or 'share.enable()' not in js or 'utils/share.js' not in js:
        share_missing.append(p)
print('share handlers missing',share_missing)
share_imgs=set(re.findall(r'/images/share/([a-z0-9_-]+\.png)', ''.join(open(p+'.js',encoding='utf-8').read() for p in pages)))
share_imgs|= {'default.png'}
for name in sorted(share_imgs):
    if not os.path.exists(os.path.join('images','share',name)): print('SHARE IMAGE MISSING','images/share/'+name)
print('share images',len(share_imgs))
# hard constraints
# 法律正文（utils/legal-data.js）会引用 "WebView"/"getUserProfile" 等术语（隐私政策声明「未使用」），
# 属于文字而非代码调用，排除以免误报；其余 JS 仍全量扫描。
alljs=''.join(open(f,encoding='utf-8').read() for f in glob.glob('**/*.js',recursive=True)
              if not f.replace('\\','/').endswith('utils/legal-data.js'))
for pat in ['wx.cloud','cloudfunctions','web-view','getUserProfile','getUserInfo','appsecret','service_role','secretKey']:
    print(pat, alljs.count(pat))
# size
total=0
for root,dirs,files in os.walk('.'):
    if 'node_modules' in root: continue
    for f in files: total+=os.path.getsize(os.path.join(root,f))
print('total bytes',total,round(total/1024,1),'KB')
print('urlCheck',json.load(open('project.config.json',encoding='utf-8'))['setting']['urlCheck'])
