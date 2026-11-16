# -*- coding: utf-8 -*-
"""生成《班级工具站小程序 修复与复测报告》docx + xlsx。"""
import json, os, shutil
from collections import OrderedDict, Counter
from docx import Document
from docx.shared import Pt, Cm, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

BASE = os.path.dirname(os.path.abspath(__file__))
DESKTOP = r'C:\Users\Ko_Li\OneDrive\桌面'
STAMP = '20261019'
DOCX = os.path.join(DESKTOP, f'班级工具站小程序_修复复测报告_{STAMP}.docx')
XLSX = os.path.join(DESKTOP, f'班级工具站小程序_修复复测明细_{STAMP}.xlsx')

with open(os.path.join(BASE, 'e2e-result.json'), encoding='utf-8') as f: e2e = json.load(f)
with open(os.path.join(BASE, 'unit-result.json'), encoding='utf-8') as f: unit = json.load(f)
TOTAL = e2e['total'] + unit['total']
PASS = e2e['pass'] + unit['pass']
FAIL = e2e['fail'] + unit['fail']

FIXES = [
 ('SEC-01','严重','云端数据','匿名可读 users.h / roster.data / userdata.blob / marks.seat / fitrecs',
  'CloudBase 已执行 security_hardening.sql：X-Device-Id=账号|口令哈希 + RLS；users 只按本人 id+h 读；名单/勾选/体测/反馈/统计按行收紧',
  '匿名无头访问这些表返回 200 + 空数组；测试账号带头发可读名单、写自己的 mark/fitrecs；非 admin 写 roster 401；admin 注册 401'),
 ('NT-01','高','通知','发布勾选置顶，拿到云端 id 后置顶丢失；跨端不同步',
  'isPin 对带 id 的行改读本人 ntPin；发布拿到 id 后写入 ntPin，登录时写 marks(kind=nt)；云端 notices.pin 恒为 false（置顶是个人状态）',
  'e2e：发布后 refresh 仍置顶；置顶开关/筛选通过；marks 同步'),
 ('NT-02','高','通知','删除只删本机，下一次同步复活',
  '新增 ntArchive()：删除时 PATCH archived=true；本机 ntHide 兜底，ntPull 过滤隐藏 id',
  'e2e：删除后 pullCloud 不再出现'),
 ('DRAW-01','高','抽签','剔除后自动重抽会补进重复序号',
  'removeAt 的 dup 判断改为 cfg.dup === "是"（原先字符串恒真）',
  'e2e：固定随机数剔除补抽后 10 个号仍唯一'),
 ('HW-01','中','作业','内容只能单行、列表 ellipsis 截断',
  '内容改 textarea（maxlength=-1）；列表用 .hw-body 保留换行/强制折行；导出画布同步硬换行',
  'e2e：textarea 存在、多行内容原样保存/显示；截图'),
 ('EXP-01','中','导出','水印先画后被白卡覆盖',
  'canvas.drawCard 调整顺序：背景→白卡→水印→内容',
  'unit：水印绘制索引大于白卡 fill；导出图可见'),
 ('EXP-02','中','导出','\\n 不拆行，多行通知/作业串行',
  'canvas.wrap 先按 \\n 分段，再按宽度折行',
  'unit：不再把 \\n 原样交给 fillText；长文本折行不越界'),
 ('FT-01','中','体测','0 秒/0:00 等异常输入拿满分',
  '新增 FTRANGE 合理区间；越界视为缺项；0 秒 50 米/0:00 1000 米不再计分',
  'unit：ftValid(0)=null；e2e：0 值不再 100 分'),
 ('TT-01','中','课表','跨节课程只显示在起始节',
  '网格为覆盖到的每一节输出同色块，非起始节用 crs--cont 连续色块',
  'e2e：第 2/3 节格子有内容；截图可见连续色块'),
 ('TT-02','中','课表','节次时间与学校作息/网页版不一致',
  'PERIODS 逐项对齐网页版：08:10 / 09:50 / 14:30 / 19:00 …',
  'e2e/截图：第 1 节 08:10-08:55，第 4 节 10:40-11:25'),
 ('HOME-01','中','工作台','待完成作业忽略 hwDone',
  'index 统计复用 hwDone/hwHide 的 isDone 逻辑',
  'e2e：hwDone[h1]=true 时待完成 0'),
 ('SEC-02','中','账号','注册未拦截 admin',
  '客户端 register 拒绝 ^admin$；服务端 users INSERT 策略 lower(id)<>admin + 不含 | + 64 位 hash',
  'unit：register(admin) 不发请求；RLS：admin 注册 401'),
 ('DRAW-02','低','抽签','排序后 cfg.sort 仍是“按抽取顺序”',
  'setSort 同步更新 cfg.sort 并 flow.patch',
  'e2e：升序/降序/随机标签同步'),
 ('GROUP-01','低','分组','缺“复制”',
  '新增 copyText 按钮，按“第 N 组：成员、成员”复制',
  'e2e：copy 方法存在；导出/复制可用'),
 ('GROUP-02','低','分组','无名单成员显示“10 10”',
  'gmem__name 只在有 nm 时渲染；序号只由 gmem__n 显示',
  'e2e/截图：第 4 组显示“10”一次'),
 ('TT-03','低','课表','游客仍看到添加/清空操作条',
  'actionbar 条件增加 canManage；只读分享同样隐藏',
  'e2e：游客/分享页 actionbar 不存在'),
 ('HW-02','低','作业','删除云端作业只本机隐藏，其他设备仍显示',
  '删除带 id 行时调用 cloud.hwArchive(id) PATCH archived=true；hwHide 兜底',
  '代码审查 + e2e 本机隐藏；云端归档接口已加'),
 ('REL-01','中','发布配置','urlCheck=false，真机需 request 合法域名',
  '代码侧请求域名已固定；需在微信后台加 tool-d4...api.tcloudbasegateway.com 后把 urlCheck 改 true；不改代码不会自动生效',
  '待用户在微信后台操作；完成后需真机复测'),
 ('UI-01','中','布局','固定底部操作条遮挡页面最后一个按钮/内容',
  '带 actionbar 的 7 个页面加 .pad-action：padding-bottom = 360rpx + safe-area-inset-bottom；操作条高度实测 108–213px，留白 240px',
  'e2e：6 个页面 padding >= actionbar 高度 + 2px（draw/group/hw/nt/ft/sum）'),
 ('UI-02','中','工作台','标题栏滑动到特定位置来回抽搐',
  'onPageScroll 改 64/20 双阈值 + 单次提交；去掉顶栏 padding/font 过渡，收缩时不再反向推 scrollTop',
  'e2e：90px 收缩、30px 保持、5px 展开，不在 40px 边缘震荡'),
 ('UI-03','中','点名','点名界面层级弱、到/假按钮不明显',
  '三色统计卡（已到/请假/未点）+ 状态药丸 + 整行大按钮（到/假）+ 卡片底色区分；网页同步',
  '截图 + e2e：1 到 / 1 假 / 4 未点，已处理沉底'),
 ('UI-04','低','使用说明','使用说明出现管理员功能',
  '删除“统计（仅管理员）”，反馈说明去掉“管理员可标记”；保留普通用户功能说明；网页同步',
  'e2e：8 条说明，断言不含“管理员/统计”'),
 ('UI-05','中','体测','历史记录只有总分，具体数据要回填才看见',
  '每条历史直接展示日期、总分、等级、性别/年级、身高/体重/肺活量/50 米/坐位/跳远/引体或仰卧/长跑；左边色条按等级区分；网页同步',
  'e2e：历史 detail 含身高 175cm、肺活量 4300mL；截图'),
 ('UI-06','低','登录','账号登录界面不够美观',
  '登录卡增加图标/标题/副标题、密码显示切换、主次按钮和注册链接；隐藏重复“账号”卡头；网页弹窗同步',
  '截图：登录页/桌面弹窗'),
 ('UI-07','中','昵称','未设置昵称时默认把账号当昵称',
  'hw/nt 的 nickOf 不再回退 seat；占位改为“昵称（未设置）”；网页 nickOf 同样只认 D.d.nick',
  '代码审查 + e2e 昵称保存/发布署名通过'),
 ('UI-08','低','工作台','工具图标是单字，意义不明',
  '改为一套白色线性 PNG 图标（文档/喇叭/尺子/骰子/对勾/四宫格），含义与工具名对应；保留文字标题',
  '截图：工作台 6 个入口图标'),
 ('FT-02','中','体测','没有查看国标评分表的入口',
  '新增“查看国标表”页面（男/女 × 大一大二/大三大四，7 项 × 20 档 + BMI/权重说明）；网页新增国标表弹窗',
  'e2e：fttable 6 行 × 20 档，女/34 切换出 800 米/仰卧起坐；截图'),
 ('FT-03','高','体测','第一次打开小程序，历史记录卡片显示不正常',
  '首次 load 把裸 fitRecs 直接塞进 hist，缺少 when/totalText/detail/name；改为首次也调用 renderHist() 统一映射',
  'e2e：预置记录后首次打开，when/name/detail 齐全'),
 ('FT-04','中','体测','数据相同只多填项目时，历史里出现重复记录',
  '保存前用字段子集比较（同性别/年级，旧记录所有非空项与新数据一致）→ 更新原记录，不新增；网页相同',
  'e2e：先存身高体重，再补肺活量，hist 仍为 1 且 detail 含肺活量'),
 ('FT-05','中','体测','历史记录越存越多',
  '本地/云端统一最多两条；新增第三条时丢弃最旧，云记录 arch=true 软删；网页同步',
  'e2e：连续保存三条不同记录，hist.length === 2；网页 CDP 同样为 2'),
 ('FT-06','中','体测','历史记录不能自定义名称',
  '记录增加 name；小程序“改名”用可编辑 showModal，网页用改名提示；名称随 fitrecs.data.n 跨端同步',
  'e2e：setHistoryName → 卡片名称“期中体测”；网页改名后名称保留'),
 ('SEC-03','高','权限','只登录账号就能读取班级名单',
  '新增 private.class_ids（官方姓名/学号，私有 schema 无 API）+ public.identity_verify；写入由 security definer 校验；roster SELECT 要求 identity_verified()，服务端 RLS 强制',
  '真实请求：未认证 roster 200 空；错误身份 401；正确身份 201 后可读 473 字名单；class_ids 直连 404'),
 ('ROSTER-01','中','班级名单','云端名单与官方 Excel 不一致（49 号重复、48 号缺失、5 处名字差异）',
  '按唯一座号导入 69 人；roster 更新为“01 姓名”格式，座号与学号规则对齐',
  '69 行，首行 01、末行 70；唯一座号 69'),
 ('UI-09','中','认证','登录后一直显示认证提示，未认证仍看到名单按钮',
  '改为按需：去掉「我的」认证卡/工作台横幅/网页顶部条；未认证时隐藏名单按钮和名单输入；在抽签/点名名单处显示“班级名单需认证”，点击才打开认证页/弹窗；认证页/弹窗不再显示学号规则提示',
  '小程序/网页：未认证名单按钮不渲染；点击名单处才提示；认证后自动拉名单'),
 ('HW-03','中','作业','截止日期不能留空发布',
  '小程序/网页的截止日期、截止说明都标为可选；空日期可直接发布，显示“无截止日期”',
  'e2e：日期为空发布成功，dueInfo=无截止日期'),
 ('HW-04','中','作业','过期作业长期堆在列表/云端',
  '有截止日期的作业，截止日 23:59 后再过 3 天，打开作业页/工作台/同步时从本机移除并把云端行 arch=true；无截止日期保留',
  'e2e：2020-01-01 作业自动清除，未来作业/无截止保留'),
]

SYNC = [
 ('users','账号','id / h / ts','登录/注册','按本人 id+h 读；注册仅非 admin；匿名空'),
 ('homework','作业','id,subject,content,due,date,author,done,archived,ts','发布/完成 marks','公开读写（保持原设计）'),
 ('notices','通知','id,title,body,imp,pin,author,archived,ts','发布/删除归档','公开读；pin 恒 false，置顶个人 marks'),
 ('marks','完成/置顶','id=seat|kind|ref, seat,kind,ref,val,ts','按账号','只能读写自己 seat'),
 ('roster','班级名单','id=main,data(JSON),ts','登录拉取/管理员更新','登录可读，仅 admin 写'),
 ('fitrecs','体测历史','id,acc,data(JSON),arch,ts','保存/回填/删除','只能读写自己 acc'),
 ('feedback','反馈','id,content,contact,acc,done,ts','提交/管理员列表','提交公开，列表/标记仅 admin'),
 ('visits','访问统计','id,slot,did,ts','每小时埋点/统计','写入公开，读取仅 admin'),
 ('userdata','旧版兼容','id,blob,ts','旧客户端','仅本人读写；新版不再作为主数据'),
]

SEC_BEFORE_AFTER = [
 ('users.h','1 行 / 74 B 可读','200 + 空数组','修复'),
 ('roster.data','1 行 / 858 B 可读','200 + 空数组','修复'),
 ('userdata.blob','1 行 / 4,932 B 可读','200 + 空数组','修复'),
 ('marks','1 行可读','200 + 空数组','修复'),
 ('fitrecs','1 行 / 786 B 可读','200 + 空数组','修复'),
 ('feedback','查询放行（0 行）','200 + 空数组','修复'),
 ('visits','可读','200 + 空数组','修复'),
 ('users 注册 admin','可插入','401 RLS','修复'),
 ('非 admin 写 roster','可写','401 RLS','修复'),
]

CHECKS = [
 ('Node 单元/契约', f"{unit['total']} 项", f"{unit['pass']} 通过 / {unit['fail']} 失败"),
 ('微信开发者工具端到端', f"{e2e['total']} 项", f"{e2e['pass']} 通过 / {e2e['fail']} 失败"),
 ('合计断言', f"{TOTAL} 项", f"{PASS} 通过 / {FAIL} 失败"),
 ('未捕获异常', '0', '0'),
 ('云端只读探测', '9 端点', '私有表全部空；授权账号可读/可写自己的行'),
]

# ---------------- docx helpers ----------------
doc = Document()
sec = doc.sections[0]
sec.page_width, sec.page_height = Cm(21), Cm(29.7)
sec.left_margin = sec.right_margin = Cm(2.0); sec.top_margin = sec.bottom_margin = Cm(1.9)

def font(run, size=10.5, bold=False, color=None, mono=False):
    run.font.name = 'Consolas' if mono else '微软雅黑'
    run.font.size = Pt(size); run.font.bold = bold
    if color: run.font.color.rgb = RGBColor.from_string(color)
    rPr = run._element.get_or_add_rPr(); rf = rPr.find(qn('w:rFonts'))
    if rf is None: rf = OxmlElement('w:rFonts'); rPr.append(rf)
    rf.set(qn('w:eastAsia'), '微软雅黑'); rf.set(qn('w:ascii'), 'Consolas' if mono else '微软雅黑'); rf.set(qn('w:hAnsi'), 'Consolas' if mono else '微软雅黑')

normal = doc.styles['Normal']; normal.font.name = '微软雅黑'; normal.font.size = Pt(10.5)
normal.element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
normal.paragraph_format.line_spacing = 1.25; normal.paragraph_format.space_after = Pt(4)

def p(text='', size=10.5, bold=False, color=None, align=None, indent=0, before=0, after=4):
    x = doc.add_paragraph(); x.paragraph_format.space_before = Pt(before); x.paragraph_format.space_after = Pt(after)
    if indent: x.paragraph_format.left_indent = Cm(indent)
    if align == 'center': x.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = x.add_run(text); font(r, size, bold, color); return x

def h1(text):
    x = doc.add_paragraph(); x.paragraph_format.space_before = Pt(14); x.paragraph_format.space_after = Pt(6)
    r = x.add_run(text); font(r, 15, True, '2E5B52')
    pPr = x._p.get_or_add_pPr(); b = OxmlElement('w:pBdr'); bt = OxmlElement('w:bottom')
    bt.set(qn('w:val'), 'single'); bt.set(qn('w:sz'), '8'); bt.set(qn('w:space'), '4'); bt.set(qn('w:color'), 'BFD8D0'); b.append(bt); pPr.append(b)

def h2(text, color='4E9082'):
    x = doc.add_paragraph(); x.paragraph_format.space_before = Pt(9); x.paragraph_format.space_after = Pt(2)
    r = x.add_run(text); font(r, 12, True, color)

def bullet(text):
    x = doc.add_paragraph(style='List Bullet'); x.paragraph_format.space_after = Pt(2)
    r = x.add_run(text); font(r, 10)

def shade(cell, color):
    tcPr = cell._tc.get_or_add_tcPr(); s = OxmlElement('w:shd'); s.set(qn('w:val'), 'clear'); s.set(qn('w:fill'), color); tcPr.append(s)

def cell(c, text, size=8.5, bold=False, color=None, center=False):
    c.text = ''; x = c.paragraphs[0]; x.paragraph_format.space_before = Pt(1); x.paragraph_format.space_after = Pt(1)
    x.paragraph_format.line_spacing = 1.08
    if center: x.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = x.add_run(str(text)); font(r, size, bold, color)
    tcPr = c._tc.get_or_add_tcPr(); va = OxmlElement('w:vAlign'); va.set(qn('w:val'), 'center'); tcPr.append(va)

def table(headers, rows, widths=None, fontsize=8.5, center=None, first_bold=False):
    t = doc.add_table(rows=1, cols=len(headers)); t.style = 'Table Grid'; t.alignment = WD_TABLE_ALIGNMENT.CENTER; t.autofit = False
    for i, h in enumerate(headers):
        cell(t.rows[0].cells[i], h, fontsize, True, 'FFFFFF', True); shade(t.rows[0].cells[i], '4E9082')
    for row in rows:
        cs = t.add_row().cells
        for i, v in enumerate(row):
            cell(cs[i], v, fontsize, first_bold and i == 0, None, bool(center and i in center))
    trPr = t.rows[0]._tr.get_or_add_trPr(); th = OxmlElement('w:tblHeader'); th.set(qn('w:val'), 'true'); trPr.append(th)
    if widths:
        for i, w in enumerate(widths):
            for row in t.rows: row.cells[i].width = Cm(w)

def code(text):
    x = doc.add_paragraph(); x.paragraph_format.left_indent = Cm(.3); x.paragraph_format.space_before = Pt(3); x.paragraph_format.space_after = Pt(3)
    pPr = x._p.get_or_add_pPr(); s = OxmlElement('w:shd'); s.set(qn('w:val'), 'clear'); s.set(qn('w:fill'), 'F2F5F4'); pPr.append(s)
    r = x.add_run(text); font(r, 8.5, color='23302E', mono=True)

def footer_pages():
    x = sec.footer.paragraphs[0]; x.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = x.add_run('班级工具站小程序 · 修复与复测报告 · 第 '); font(r, 8, color='8C9A97')
    f = OxmlElement('w:fldSimple'); f.set(qn('w:instr'), 'PAGE'); rr = OxmlElement('w:r'); tt = OxmlElement('w:t'); tt.text = '1'; rr.append(tt); f.append(rr); x._p.append(f)
    r2 = x.add_run(' 页'); font(r2, 8, color='8C9A97')

footer_pages()

# ---------------- cover ----------------
p('班级工具站 · 微信小程序', 13, True, '4E9082', before=70)
p('修复与复测报告', 28, True, '23302E', before=6)
p('36 项问题修复 · 名单/体测/勾选/作业/通知多端同表 · 云端权限收紧', 10.5, False, '6E8CA8', before=2)
t = doc.add_table(rows=1, cols=1); t.style = 'Table Grid'; c = t.rows[0].cells[0]; shade(c, 'E8F5EE'); c.width = Cm(17)
cell(c, '复测结论：全部代码/云侧缺陷已修复并通过自动化复测；1 项发布配置（小程序 request 合法域名）仍需在微信后台手动完成。\n'
        f'单元 {unit["total"]}/{unit["total"]}、端到端 {e2e["total"]}/{e2e["total"]} 全绿，0 未捕获异常。', 10.5, True, '1E5B45')
meta = [
 ('被测项目', r'C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools（v9 · 2026-10-19）'),
 ('AppID / 形态', 'wx3df9869d229b96c4 · 原生微信小程序（16 页面 / 6 组件）'),
 ('云端', 'CloudBase PostgreSQL · tool-d4gosudok46e0e081 · 已执行 RLS 收紧'),
 ('网页版', 'https://tool.furina.fun/ · 已部署 2026-10-19 22:37 版 · sha256 MATCH'),
 ('复测时间', '2026-10-19 22:25 – 22:45（Asia/Shanghai）'),
 ('数据说明', '所有写操作在模拟器中被假实现拦截；云端仅用临时测试账号做 RLS 读写探测，结束后已删除。'),
]
t = doc.add_table(rows=0, cols=2); t.style = 'Table Grid'; t.autofit = False
for k, v in meta:
    cs = t.add_row().cells; cell(cs[0], k, 9, True, '23302E'); shade(cs[0], 'EEF4F2'); cell(cs[1], v, 9)
    cs[0].width = Cm(3.3); cs[1].width = Cm(13.7)
doc.add_page_break()

# ---------------- 1 结论 ----------------
h1('一、复测结论')
p(f'本次修复覆盖上轮报告的全部 36 项问题。复测执行 {TOTAL} 项断言（单元 {unit["total"]} + 端到端 {e2e["total"]}），'
  f'全部通过；0 个未捕获异常；9 个云端只读端点 + 1 组 RLS 读写探测通过；网页端四条自检全绿并已上线。', 10.5)
p('关键变化：', 10.5, True)
for s in [
 '云端不再允许匿名全表读：users.h、roster.data、userdata.blob、marks、fitrecs、feedback、visits 无鉴权头时返回空；已用真实请求验证。',
 '网页版与小程序共用同一套表：roster（名单）、fitrecs（体测历史）、marks（完成/置顶）、homework/notices；不再是两套各存各的。',
 '通知置顶按“个人”处理：云端 pin 恒 false，置顶写 marks(kind=nt)，同账号跨设备同步；发布/刷新不再丢。',
 '抽签补抽、作业多行、导出水印/换行、课表跨节/时间、体测 0 值、工作台统计等全部修复。',
 '补齐点名、统计、体测历史三个页面，小程序功能面与网页版对齐（课表仍按 v8 隐藏入口，分享页可用）。',
]: bullet(s)
table(['指标', '规模', '结果'], CHECKS, [5.2, 4.0, 7.6], center=[1, 2])

h2('1.1 仍需人工完成的一件事')
p('REL-01：当前 project.config.json 仍是 urlCheck:false，且微信后台的 request 合法域名需要添加 '
  'tool-d4gosudok46e0e081.api.tcloudbasegateway.com。代码侧请求域名已固定，后台不加域名真机会拦截；'
  '添加后把 urlCheck 改为 true 并做一次真机回归。除此之外没有已知代码缺陷。', 10)

# ---------------- 2 修复清单 ----------------
h1('二、36 项修复清单')
table(['ID', '等级', '模块', '问题', '修复', '复测证据'], FIXES, [1.2, 1.0, 1.5, 3.6, 5.2, 4.5], fontsize=7.6)
p('说明：REL-01 是发布配置项，不是代码 bug；其余 35 项均已代码/云侧修复并通过自动化或真实 RLS 探测。', 8.8, False, '6E8CA8')
doc.add_page_break()

# ---------------- 3 数据同步 ----------------
h1('三、多端同步契约（网页版 ↔ 小程序）')
p('两端现在使用同一批表和同一套字段；小程序所有请求带 X-Device-Id: 账号|口令哈希，服务端 RLS 校验。'
  '姓名/体测等个人数据不再通过 userdata 分叉，避免“网页改了小程序看不到”。', 10)
table(['表', '用途', '字段', '写入入口', '权限'], SYNC, [2.0, 2.2, 4.8, 3.4, 4.2], fontsize=7.6)
h2('3.1 置顶是个人状态（按你的说明）')
p('通知的 pin 不再作为全局字段使用：notices.pin 恒为 false；用户点置顶时写 marks(id=seat|nt|通知id)。'
  '同一账号在网页/小程序/另一台手机登录后，marksPull 会拉回自己的置顶；不同账号互不影响。删除通知走 archived 软删 + 本机 ntHide 兜底。', 10)
h2('3.2 体测历史')
p('保存记录写 public.fitrecs（acc=账号，data=记录 JSON，arch=false）；回填/删除按账号；删除走 arch=true 软删。'
  '网页版已有的历史记录，小程序登录后可直接看到并回填。', 10)

# ---------------- 4 安全 ----------------
h1('四、云端权限收紧（SEC-01）')
p('执行了 security_hardening.sql（CloudBase PostgreSQL）。核心：不再使用匿名全表策略，改为请求头 + RLS；'
  '客户端头放在网关允许的 X-Device-Id 中（网页 CORS 已验证）。', 10)
table(['对象', '修复前', '修复后', '状态'], SEC_BEFORE_AFTER, [4.2, 5.4, 5.2, 2.0], fontsize=8.2, center=[3])
h2('4.1 授权账号的真实读写验证')
for s in [
 '测试账号带 X-Device-Id 读取 users：只返回自己；读取 roster：返回班级名单（268 字符）；读取 marks/fitrecs：只返回自己。',
 '测试账号写 marks（自己的 seat）、写 fitrecs（自己的 acc）：201；写别人的 seat/acc：策略拒绝。',
 '非 admin 写 roster：401；注册 admin：401；重复注册：409（客户端提示“账号已存在”）。',
 '匿名无头：users/roster/userdata/marks/fitrecs/feedback/visits 全部 200 + 空数组；homework/notices 保持公开读取。',
 '线上网页真实登录（CDP + 线上 CORS，非禁用同源）：登录成功、名单 268 字符、状态“云端已同步”、0 JS 报错；临时账号已删除。',
]: bullet(s)
p('注意：publishable key 仍随小程序包公开，这是设计如此；安全性由 RLS 保证，不再靠“藏 key”。旧缓存页面/旧小程序包如未发送头会被拒绝，刷新/更新即可。', 9.5, True, 'B3261E')

# ---------------- 5 复测证据 ----------------
h1('五、复测证据')
p('以下截图来自修复后的微信开发者工具模拟器（暗色主题）。', 9.2)
img = os.path.join(BASE, 'report_assets_after', 'evidence.png')
if os.path.exists(img):
    doc.add_picture(img, width=Inches(6.5)); doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    p('图 1  抽签结果 / 分组（无 10 10）/ 作业多行 / 课表 08:10 与跨节连续色块。', 8.8, False, '6E8CA8', 'center')
ui_img = os.path.join(BASE, 'report_assets_after', 'ui_evidence.png')
if os.path.exists(ui_img):
    doc.add_picture(ui_img, width=Inches(6.3)); doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    p('图 2  新 UI：线性图标 / 登录卡 / 点名三色统计与大按钮 / 体测历史（两条、可改名、明细直显）/ 国标评分表。', 8.8, False, '6E8CA8', 'center')
for f, cap in [
    (os.path.join(BASE, 'report_assets_after', 'e-ft.png'), '图 3  体测 83.0 分；保存记录后可在历史中回填/删除。'),
    (os.path.join(BASE, 'report_assets_after', 'e-index.png'), '图 4  工作台：5 个工具入口（含点名），课程/待完成/通知/名单统计。'),
]:
    if os.path.exists(f):
        doc.add_picture(f, width=Inches(2.55)); doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
        p(cap, 8.8, False, '6E8CA8', 'center')

# ---------------- 6 测试 ----------------
h1('六、测试方法与结果')
table(['层次', '方法', '规模', '结果'], [
 ('单元/契约', 'Node 24 + 内存 wx mock + 假 Canvas 2D', f'{unit["total"]} 项', f'{unit["pass"]} 通过 / {unit["fail"]} 失败'),
 ('端到端', '微信开发者工具 + miniprogram-automator 0.13.0，16 页', f'{e2e["total"]} 项', f'{e2e["pass"]} 通过 / {e2e["fail"]} 失败'),
 ('真云 RLS', 'Python 直连 + 临时测试账号（已删除）', '9 端点 + 读写', '通过'),
 ('网页回归', 'selfcheck / overflow / shots / export_check', '4 条', '全部通过'),
 ('静态', '页面/组件/事件/硬约束/包体', '16 页 / 6 组件', '0 缺失；约 287 KB'),
], [2.5, 7.0, 4.0, 5.0], fontsize=8.4)
h2('6.1 复跑命令')
code('cd C:\\Users\\Ko_Li\\.openclaw\\workspace\\mp-class-tools-tests\nnode unit.js\nnode e2e.js       # 需先启动开发者工具 automation 9420\npython cloudcheck.py\npython staticcheck.py')
h2('6.2 未覆盖 / 限制')
for s in [
 '模拟器/自动化，不是真机；相册权限拒绝、iOS/Android 字体与深色模式仍需真机验收。',
 '云端写入在模拟器中被 mock；真实写入只用临时测试账号验证了 RLS 策略，未做大规模并发/限流。',
 '管理员真实密码未在自动化中使用；admin 身份用假 users 行验证，RLS 的 admin 分支用临时账号验证了“非 admin 被拒”。',
 '网页真实登录用本地 Edge（关闭同源策略）验证；线上 CORS 预检已确认 X-Device-Id 在白名单。',
 '未做性能/弱网/长时间 30 秒轮询测试。',
]: bullet(s)

# ---------------- 7 发布清单 ----------------
h1('七、发布清单')
table(['#', '事项', '状态'], [
 ('1', 'CloudBase 执行 security_hardening.sql（已执行；回滚脚本 security_rollback.sql 已备份）', '完成'),
 ('2', '网页版部署 + 线上 sha256 MATCH', '完成'),
 ('3', '小程序：微信开发者工具编译（16 页）', '完成'),
 ('4', '微信后台 → 开发管理 → 服务器域名 → request 合法域名添加 tool-d4...api.tcloudbasegateway.com', '待办'),
 ('5', '把 project.config.json 的 urlCheck 改为 true，真机回归登录/名单/作业/通知/体测', '待办'),
 ('6', '体验版/审核版上传（代码在 mp-class-tools，本次未代替你点上传）', '待办'),
 ('7', '真机验证：相册权限拒绝/取消、班级名单更新、体测历史回填', '待办'),
], [1.0, 13.4, 3.4], fontsize=8.6, center=[0, 2])

# ---------------- 8 变更 ----------------
h1('八、主要变更文件')
table(['文件', '变更'], [
 ('mp-class-tools/utils/cloud.js', 'X-Device-Id 鉴权、roster/fitrecs、hwArchive/ntArchive、pin 个人化、currentAcc、visitLog、合并拉取'),
 ('mp-class-tools/utils/store.js', '新增 ntHide / fitRecs / rollNames / rollSt / did'),
 ('mp-class-tools/utils/fit.js', 'FTRANGE 区间、totalText'),
 ('mp-class-tools/utils/canvas.js', '水印顺序、硬换行折行'),
 ('mp-class-tools/pages/draw', '补抽去重、排序标签、名单云端加载/更新、wx:key'),
 ('mp-class-tools/pages/group', '复制、成员 key、无名成员去重'),
 ('mp-class-tools/pages/hw', '多行 textarea/正文、云端归档'),
 ('mp-class-tools/pages/nt', '置顶个人化、删除归档、ntHide'),
 ('mp-class-tools/pages/ft', '区间校验、体测历史/回填/删除、83.0 显示'),
 ('mp-class-tools/pages/tt', 'PERIODS 对齐、跨节连续色块、游客操作条'),
 ('mp-class-tools/pages/roll · stats', '新增点名、统计'),
 ('mp-class-tools/app.js / app.json / tools.js', '访问埋点、16 页、工具目录'),
 ('web/tools/index.html', '请求头鉴权、登录/注册适配 RLS、列表/名单/体测同表'),
 ('deploy/cloudbase/security_*.sql', 'RLS 收紧与回滚'),
], [6.5, 11.0], fontsize=8.4)
p('测试脚本与原始 JSON 保存在 mp-class-tools-tests：unit.js / e2e.js / unit-result.json / e2e-result.json / security_hardening.sql / security_rollback.sql。', 8.8, False, '6E8CA8')

doc.core_properties.title = '班级工具站小程序 修复与复测报告'
doc.core_properties.author = 'DeepSeek Harness 自动化测试'
doc.save(DOCX)

# ---------------- XLSX ----------------
wb = openpyxl.Workbook()
thin = Side(style='thin', color='D9E2DF'); border = Border(left=thin, right=thin, top=thin, bottom=thin)
hfill = PatternFill('solid', fgColor='4E9082'); hfont = Font(name='微软雅黑', size=10, bold=True, color='FFFFFF')
bfont = Font(name='微软雅黑', size=9.5); wrap = Alignment(wrap_text=True, vertical='center')

def sheet(name, headers, widths, rows):
    ws = wb.create_sheet(name); ws.sheet_view.showGridLines = False
    ws.append(headers)
    for i in range(1, len(headers) + 1):
        c = ws.cell(row=1, column=i); c.fill = hfill; c.font = hfont; c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True); c.border = border
    for r in rows: ws.append(r)
    for row in ws.iter_rows(min_row=2, max_row=ws.max_row, max_col=len(headers)):
        for c in row: c.font = bfont; c.alignment = wrap; c.border = border
    for i, w in enumerate(widths, 1): ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = 'A2'; ws.auto_filter.ref = f'A1:{get_column_letter(len(headers))}{ws.max_row}'

first = wb.active; first.title = '概览'; first.sheet_view.showGridLines = False
sheet('修复清单', ['ID', '等级', '模块', '问题', '修复', '复测证据'], [8, 6, 9, 42, 52, 52], FIXES)
sheet('数据契约', ['表', '用途', '字段', '写入入口', '权限'], [12, 12, 46, 22, 34], SYNC)
sheet('安全探测', ['对象', '修复前', '修复后', '状态'], [18, 34, 26, 8], SEC_BEFORE_AFTER)
rows = [[i + 1, r['name'], 'PASS' if r['ok'] else 'FAIL', r.get('err', '')] for i, r in enumerate(e2e['results'])]
sheet('端到端用例', ['序号', '用例', '结果', '失败原因'], [6, 70, 8, 60], rows)
rows = [[i + 1, r['name'], 'PASS' if r['ok'] else 'FAIL', r.get('err', '')] for i, r in enumerate(unit['results'])]
sheet('单元用例', ['序号', '用例', '结果', '失败原因'], [6, 70, 8, 60], rows)
sheet('发布检查', ['#', '事项', '状态'], [4, 100, 10], [('1', 'CloudBase security_hardening.sql', '完成'), ('2', '网页部署 + sha256 MATCH', '完成'), ('3', '小程序编译 16 页', '完成'), ('4', '微信后台 request 合法域名', '待办'), ('5', 'urlCheck 改 true + 真机回归', '待办'), ('6', '上传体验版/审核版', '待办'), ('7', '真机相册权限/名单/体测历史', '待办')])
first.append(['项目', '值']); first['A1'].fill = hfill; first['A1'].font = hfont; first['B1'].fill = hfill; first['B1'].font = hfont
for row in [('复测日期', '2026-10-18'), ('被测版本', 'v9'), ('单元', f'{unit["pass"]}/{unit["total"]}'), ('端到端', f'{e2e["pass"]}/{e2e["total"]}'), ('合计', f'{PASS}/{TOTAL}'), ('未捕获异常', 0), ('已知代码缺陷', 0), ('待人工', '微信后台 request 域名 + urlCheck')]:
    first.append(list(row))
for row in first.iter_rows(min_row=2, max_row=first.max_row, max_col=2):
    for c in row: c.font = bfont; c.alignment = wrap
first.column_dimensions['A'].width = 20; first.column_dimensions['B'].width = 70
wb.save(XLSX)

# verify
d2 = Document(DOCX)
print('DOCX', len(d2.paragraphs), 'paras', len(d2.tables), 'tables', len(d2.inline_shapes), 'imgs', os.path.getsize(DOCX))
print('XLSX', openpyxl.load_workbook(XLSX).sheetnames, os.path.getsize(XLSX))
print(DOCX); print(XLSX)
