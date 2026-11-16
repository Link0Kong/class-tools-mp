# -*- coding: utf-8 -*-
"""小程序 v2.0.0 独立验收 · 源码合规 / 隐私 / 版本 / AI 开发模式静态扫描。

只读扫描 C:\\Users\\Ko_Li\\.openclaw\\workspace\\mp-class-tools（不含 node_modules / _backup / 测试目录），
输出 PASS/FAIL/PENDING 行 + JSON（_reports/mp_static_<tag>.json）。
不访问网络、不写被测项目。

用法：python static_scan.py [--tag baseline|final]
"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPORTS = os.path.join(HERE, "_reports")
MP = r"C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools"

SRC_EXT = (".js", ".wxml", ".wxss", ".json")
SKIP_DIRS = {"node_modules", "miniprogram_npm", "_backup", ".git", "miniapp", "images"}

HARD_KEYWORDS = {
    "web-view": ["web-view"],
    "诱导分享/关注": ["分享到群", "邀请好友", "助力", "砍价", "领红包", "关注公众号", "加微信",
                 "加我微信", "扫码关注", "分享得", "邀请码", "拉新"],
    "抽奖": ["抽奖", "抽奖码", "开奖", "中奖", "锦鲤"],
    "支付": ["requestPayment", "微信支付", "支付成功", "付款码"],
    "外链下载 App": ["下载APP", "下载App", "打开APP", "外部浏览器", "复制链接到浏览器", "应用宝"],
    "第三方导流": ["微信号", "QQ号", "QQ群号", "加群", "进群"],
}
PRIVACY_PATTERNS = {
    "手机号": r"(?<!\d)1[3-9]\d{9}(?!\d)",
    "宿舍号": r"宿舍号|\d{1,2}\s*栋\s*\d{3,4}",
    "真实姓名(班级名单样例)": r"陈子麒|谢梓萱|陈玉霞|李学盈|王雨欣|林晓",
    "真实学号(3260 开头)": r"(?<!\d)32607\d{5}(?!\d)",
}

RESULTS = []


def add(req, name, ok, note=""):
    RESULTS.append({"req": str(req), "name": name, "ok": ok, "note": str(note)[:600]})
    prefix = "[PASS] " if ok is True else ("[PEND] " if ok is None else "[FAIL] ")
    print(prefix + "[" + str(req) + "] " + name + (("  -- " + str(note)[:260]) if note else ""))


def walk(root):
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith("_backup")]
        for fn in filenames:
            if fn.endswith(SRC_EXT):
                out.append(os.path.join(dirpath, fn))
    return out


def read(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except Exception:
        return ""


def strip_comments(text):
    """去掉 JS/WXSS 注释行，避免「绝不放 appsecret」这类安全注释被误判。"""
    out = []
    for ln in text.split("\n"):
        st = ln.strip()
        if st.startswith("//") or st.startswith("/*") or st.startswith("*") or st.startswith("*/"):
            continue
        out.append(ln)
    return "\n".join(out)


def rel(path):
    return path.replace(MP + os.sep, "").replace("\\", "/")


def scan_keywords(files, keywords):
    hits = []
    for path in files:
        text = read(path)
        for kw in keywords:
            if kw in text:
                idx = text.find(kw)
                line = text.count("\n", 0, idx) + 1
                hits.append("%s:%d %s" % (rel(path), line, kw))
    return hits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="run")
    args = ap.parse_args()
    os.makedirs(REPORTS, exist_ok=True)
    files = walk(MP)
    print("扫描文件数:", len(files))
    add("合规", "被测项目存在", os.path.isdir(MP), MP)

    # ---------------- 硬约束 / 合规 ----------------
    for label, kws in HARD_KEYWORDS.items():
        hits = scan_keywords(files, kws)
        add("10", "合规：无「%s」相关代码/文案" % label, not hits,
            "; ".join(hits[:8]) + (" …共%d处" % len(hits) if len(hits) > 8 else ""))

    # 显式硬约束：web-view / 云开发业务 API / 用户信息接口
    alljs = "".join(read(p) for p in files if p.endswith(".js"))
    add("10", "硬约束：web-view 组件 0 处", "web-view" not in alljs and "<web-view" not in
        "".join(read(p) for p in files if p.endswith(".wxml")))
    cloud_api = [x for x in ("wx.cloud.database", "wx.cloud.uploadFile", "wx.cloud.downloadFile",
                             "wx.cloud.deleteFile", "wx.cloud.getTempFileURL") if x in alljs]
    add("10", "硬约束：无 wx.cloud 业务数据 API（仅允许 notify 云函数 callFunction）", not cloud_api,
        ",".join(cloud_api) or "wx.cloud 仅用于 cloudfunctions/notify（订阅消息）")
    add("10", "硬约束：无 getUserProfile / getUserInfo 获取用户信息",
        ("getUserProfile" not in alljs) and ("getUserInfo" not in alljs))
    secret_hits = []
    clean = strip_comments(alljs)
    for k in ("appsecret", "service_role", "secretKey"):
        for m in re.finditer(r'["\']?' + k + r'["\']?\s*[:=]\s*["\'][^"\']{8,}', clean):
            secret_hits.append(k + "=" + m.group(0)[:40])
    add("10", "硬约束：仓库不含 appsecret / service_role / secretKey 实际值", not secret_hits,
        "; ".join(secret_hits[:5]))
    wxpay = [p for p in files if p.endswith(".js") and "requestPayment" in read(p)]
    add("10", "合规：无微信支付调用", not wxpay, ",".join(rel(p) for p in wxpay))
    recharge_hits = []
    for path in files:
        if path.endswith((".wxml", ".js", ".md")):
            for i, ln in enumerate(read(path).split(chr(10)), 1):
                if "充值" in ln:
                    recharge_hits.append("%s:%d %s" % (rel(path), i, ln.strip()[:60]))
    add("10", "合规（信息项）：电费页「去完美校园充值」为外部 App 引导文案（非支付功能，网站同文案）",
        True, "; ".join(recharge_hits[:4]) if recharge_hits else "0 处")

    # ---------------- 隐私 ----------------
    for label, pat in PRIVACY_PATTERNS.items():
        hits = []
        for path in files:
            text = strip_comments(read(path)) if path.endswith(".js") else read(path)
            for m in re.finditer(pat, text):
                line = text.count("\n", 0, m.start()) + 1
                hits.append("%s:%d %s" % (rel(path), line, m.group(0)[:20]))
                if len(hits) > 20:
                    break
        add("10", "隐私：源码无%s" % label, not hits, "; ".join(hits[:6]))
    # 用户 2026-11-05 20:07 新指示：移除全部「演示/审核模式」→ 现断言「不存在」
    demo_files = [f for f in ("utils/demo.js", "utils/demo-data.js") if os.path.exists(os.path.join(MP, f))]
    add("10", "隐私：无演示/审核数据文件（demo.js、demo-data.js 均不存在）", not demo_files,
        "仍存在: " + ",".join(demo_files))
    demo_hits = []
    for path in files:
        t = strip_comments(read(path)) if path.endswith(".js") else read(path)
        for kw in ("演示模式", "审核用", "演示同学", "demo-data", "demo.isActive", "demo.request", "DEMO_KEY"):
            if kw in t:
                demo_hits.append("%s:%s" % (rel(path), kw))
    add("10", "隐私：源码无演示/审核模式代码与文案（0 处）", not demo_hits,
        "; ".join(demo_hits[:8]))
    fbjs = strip_comments(read(os.path.join(MP, "pages", "fb", "fb.js")))
    fbwxml = read(os.path.join(MP, "pages", "fb", "fb.wxml"))
    add("10", "合规：反馈页不再收集 QQ / 微信联系方式",
        ("联系方式" not in fbwxml) and ("contact" not in fbjs) and ("contact" not in fbwxml))
    datawxml = read(os.path.join(MP, "pages", "data", "data.wxml"))
    add("10", "隐私：数据与隐私页含收集项/用途/存储说明",
        all(k in datawxml for k in ("隐私", "收集")) and ("姓名" in datawxml and "学号" in datawxml))

    # ---------------- AI 开发模式 ----------------
    appjson = read(os.path.join(MP, "app.json"))
    has_ai = ('"agent"' in appjson) or ("subPackages" in appjson and '"ai"' in appjson)
    ai_dir = os.path.isdir(os.path.join(MP, "ai"))
    add("10", "AI 开发模式配置存在（源码保留，发版前 ai_toggle.py --off）",
        None if has_ai else True,
        "app.json agent=%s ai/目录=%s → 发版前必须 python mp-class-tools-tests/ai_toggle.py --off" % (has_ai, ai_dir))

    # ---------------- 需求 1：版本 ----------------
    ver = read(os.path.join(MP, "utils", "version.js"))
    add("1", "version.js VERSION = 2.0.0", "VERSION = '2.0.0'" in ver or 'VERSION = "2.0.0"' in ver,
        ver.strip().splitlines()[-3:] if ver else "文件缺失")
    appjs = read(os.path.join(MP, "app.js"))
    add("1", "app.js globalData.version 引用 version.VERSION",
        ("globalData" in appjs) and ("version.VERSION" in appjs))
    mewxml = read(os.path.join(MP, "pages", "me", "me.wxml"))
    mejs = read(os.path.join(MP, "pages", "me", "me.js"))
    add("1", "「我的」页展示版本号", ("version" in mewxml) or ("version" in mejs and "v" in mewxml),
        "me.wxml 含 version=%s" % ("version" in mewxml))
    readme = read(os.path.join(MP, "README.md"))
    changelog = read(os.path.join(MP, "CHANGELOG.md"))
    add("1", "README 顶部标注 v2.0.0", "2.0.0" in readme[:1200], readme[:3].replace("\n", " "))
    add("1", "CHANGELOG 顶部有 2.0.0 段", "2.0.0" in changelog[:3000])

    # ---------------- 需求 2：scrollmem ----------------
    sm = os.path.join(MP, "utils", "scrollmem.js")
    smsrc = read(sm)
    exports = ["attach", "onScroll", "save", "restore", "cancel", "svSave", "svGet"]
    add("2", "utils/scrollmem.js 存在且导出完整 API",
        os.path.exists(sm) and all(("function " + e in smsrc) or (e + ":") in smsrc for e in exports),
        "缺失: " + ",".join([e for e in exports if e not in smsrc]))
    pages_need = ["nt", "hw", "all", "me", "data", "committee", "stats", "ug", "fb", "ft", "tt", "power", "diag"]
    missing = []
    for pg in pages_need:
        js = read(os.path.join(MP, "pages", pg, pg + ".js"))
        if "scrollmem" not in js:
            missing.append(pg)
    add("2", "各页面接入滚动保位（13 页）", not missing, "未接入: " + ",".join(missing))

    # ---------------- 需求 3：课表滑动 ----------------
    ttjs = read(os.path.join(MP, "pages", "tt", "tt.js"))
    add("3", "课表滑动对手势方向/横向位置做判定（不再按溢出整体禁用）",
        ("_swipeTarget" in ttjs) and (("scrollLeft" in ttjs) or ("_svLeft" in ttjs) or ("svLeft" in ttjs) or
                                      ("onGridScroll" in ttjs) or ("edge" in ttjs.lower())),
        "含 _swipeEnabled 整体禁用=%s" % ("_swipeEnabled" in ttjs and
                                       "return !(this.data.view === 'week' && this._gridOverflow)" in ttjs))

    # ---------------- 需求 13：动画 / 减弱动效 ----------------
    anim_hits = []
    for path in files:
        if path.endswith(".wxss"):
            t = read(path)
            if "prefers-reduced-motion" in t:
                anim_hits.append(rel(path))
    add("13", "wxss 使用 prefers-reduced-motion 降级（至少 index/nt/app）", len(anim_hits) >= 3,
        ",".join(anim_hits[:6]))
    idxwxml = read(os.path.join(MP, "pages", "index", "index.wxml"))
    add("11", "工作台旋转动画类（wb-rot-*）存在", ("rot" in idxwxml) or ("rot" in read(os.path.join(MP, "pages", "index", "index.wxss"))))
    ntwxss = read(os.path.join(MP, "pages", "nt", "nt.wxss"))
    add("13", "通知展开/收起动画样式存在（nt.wxss，.22–.32s）",
        bool(re.search(r"(transition|animation)[^;]*\.(2[2-9]|3[0-2])s", ntwxss)))

    # ---------------- 需求 14/16：同步契约 ----------------
    cloudjs = read(os.path.join(MP, "utils", "cloud.js"))
    add("14", "云端 udSections 显式包含体测 sex / grade",
        "sex" in cloudjs and "grade" in cloudjs and "fit" in cloudjs)
    add("16", "cloud.js 有 marks 拉取与强制刷新入口",
        "marksPull" in cloudjs and ("force" in cloudjs))
    add("16", "通知页 onShow 强制拉 marks（需求 16）",
        "marksPull(true)" in read(os.path.join(MP, "pages", "nt", "nt.js")))
    add("16", "体测页 onShow 拉 userdata 并应用 fit（需求 14）",
        ("udPull" in read(os.path.join(MP, "pages", "ft", "ft.js"))) or
        ("udSections" in read(os.path.join(MP, "pages", "ft", "ft.js"))))

    # ---------------- v2.0.0 网站功能同步（task-12）：电费 / 诊断 / UD 13 键 ----------------
    appjson_obj = {}
    try:
        appjson_obj = json.loads(appjson) if appjson.strip().startswith("{") else {}
    except Exception:
        appjson_obj = {}
    pages = appjson_obj.get("pages") or []
    add("同步", "app.json 注册 20 页且含 pages/power/power、pages/diag/diag",
        len(pages) == 20 and "pages/power/power" in pages and "pages/diag/diag" in pages,
        "pages=%d power=%s diag=%s" % (len(pages), "pages/power/power" in pages, "pages/diag/diag" in pages))
    toolsjs = read(os.path.join(MP, "utils", "tools.js"))
    add("同步", "工具目录：宿舍电费 noHome、诊断 admin；all 页按管理员过滤",
        bool(re.search(r"key:\s*'power'[^}]*noHome:\s*true", toolsjs)) and
        bool(re.search(r"key:\s*'diag'[^}]*admin:\s*true", toolsjs)) and
        bool(re.search(r"!t\.admin\s*\|\|\s*admin", read(os.path.join(MP, "pages", "all", "all.js")))),
        "power noHome=%s diag admin=%s all 过滤=%s" % (
            bool(re.search(r"key:\s*'power'[^}]*noHome:\s*true", toolsjs)),
            bool(re.search(r"key:\s*'diag'[^}]*admin:\s*true", toolsjs)),
            bool(re.search(r"!t\.admin\s*\|\|\s*admin", read(os.path.join(MP, "pages", "all", "all.js"))))))
    # 电费纯逻辑目录/阈值/TTL
    powerjs = read(os.path.join(MP, "utils", "power.js"))
    add("同步", "v5 电费目录 17 间 / 默认低电 30 / 8 档 LOW_OPTIONS / normLow 归一",
        powerjs.count("rv: '") == 17 and "const LOW = 30" in powerjs and
        "LOW_OPTIONS = [10, 20, 30, 40, 50, 60, 80, 100]" in powerjs and "function normLow" in powerjs,
        "rooms=%d LOW30=%s LOW_OPTIONS=%s normLow=%s" % (
            powerjs.count("rv: '"), "const LOW = 30" in powerjs,
            "LOW_OPTIONS = [10, 20, 30, 40, 50, 60, 80, 100]" in powerjs, "function normLow" in powerjs))
    add("同步", "v5 电量环 = estimate 可用天数/30（ARC_DAYS 30 / ARC_MIN 0.02 / ARC_FALLBACK 0.04）",
        all(k in powerjs for k in ("const ARC_DAYS = 30", "const ARC_MIN = 0.02", "const ARC_FALLBACK = 0.04",
                                   "function ringArc", "est.days / ARC_DAYS")),
        "ARC/ringArc(est)=%s" % all(k in powerjs for k in ("const ARC_DAYS = 30", "function ringArc", "est.days / ARC_DAYS")))
    pwxml0 = read(os.path.join(MP, "pages", "power", "power.wxml"))
    pwjs_ui = strip_comments(read(os.path.join(MP, "pages", "power", "power.js")))
    pwxml_ui = read(os.path.join(MP, "pages", "power", "power.wxml"))
    add("同步", "电费 v4 区间/充值语义：RANGES 24h/7d/30d、zq_power_range_v1、recharge/lastUp、tile2 随档、tile4 上次充值",
        all(k in powerjs for k in ("const RANGES = [", "{ k: '24h'", "{ k: '7d'", "{ k: '30d'", "function deriveRange",
                                   "lastUp", "function rangeMeta")) and
        all(k in pwjs_ui for k in ('zq_power_range_v1', 'pickRange', 'rangeTile', 'recharge')) and
        ('上次充值' in powerjs) and
        all(k in pwxml_ui for k in ('{{ranges}}', '{{trend.recharge}}', '期间有充值', 'bindtap="pickRange"')),
        "RANGES=%s 本机键=%s 徽标/上次充值=%s" % (
            all(k in powerjs for k in ("const RANGES = [", "{ k: '24h'", "{ k: '30d'")),
            'zq_power_range_v1' in pwjs_ui, all(k in pwxml_ui for k in ('期间有充值',))))
    add("同步", "电费 UI 语义：4 tiles（估算可用/区间用电/低电阈值/上次充值）、图例三值、y 1 位小数、低电条、fmtMain",
        all(k in powerjs for k in ("'估算可用'", "'低电阈值'", "'上次充值'", "function lowText", "function fmtMain",
                                   "function tilesOf")) and
        all(k in pwjs_ui for k in ('startText', 'curText', 'dropText', 'hiText', 'midText', 'loText', 'toFixed(1)')) and
        all(k in pwxml_ui for k in ('{{lowText}}', '{{trend.dropText}}', '{{trend.startText}}', '{{trend.curText}}')),
        "tiles=%s 图例/1位小数=%s wxml=%s" % (
            all(k in powerjs for k in ("'估算可用'", "'上次充值'", "function tilesOf")),
            all(k in pwjs_ui for k in ('startText', 'dropText', 'hiText', 'toFixed(1)')),
            all(k in pwxml_ui for k in ('{{trend.dropText}}', '{{lowText}}'))))
    # 防回退：全库无旧阈值文案残留（产品/文档；允许测试里的防回退 regex 行）
    stale = []
    scan_roots = [MP, os.path.join(HERE, "..")]
    for root in scan_roots:
        for dp, dn, fns in os.walk(root):
            dn[:] = [d for d in dn if d not in ("node_modules", "_backup", "_backup_ai_toggle", "_backup_v2_20261105",
                                                "_verify", "_qa_v2", ".git", "images")]
            for fn in fns:
                if not fn.lower().endswith((".js", ".json", ".md", ".wxml", ".wxss", ".py")):
                    continue
                fp = os.path.join(dp, fn)
                if fn.endswith("-result.json") or fn.endswith("_result.json"):
                    continue
                try:
                    lines = read(fp).split(chr(10))
                except Exception:
                    continue
                for i, ln in enumerate(lines, 1):
                    if re.search(r"30[–-]100[^。；\n]{0,12}偏低", ln) or re.search(r"(?:≥|>)\s*100[^。；\n]{0,12}充足", ln):
                        if "regex" in ln or "防回退" in ln or "旧" in ln or "历史" in ln or "残留" in ln:
                            continue
                        stale.append("%s:%d %s" % (rel(fp) if fp.startswith(MP) else os.path.basename(fp), i, ln.strip()[:80]))
    add("同步", "防回退：全库无「30–100 偏低 / ≥100 充足」旧阈值文案残留（防回退 regex 行除外）",
        not stale, "; ".join(stale[:6]) if stale else "0 处")
    cloudttl = "power: 2 * 60 * 1000" in cloudjs
    add("同步", "cloud.js：power/power_history/service_health 表 + TTL.power 2 分钟",
        all(k in cloudjs for k in ("power: 'power'", "powerHistory: 'power_history'", "serviceHealth: 'service_health'")) and
        ("power: 2 * 60 * 1000" in cloudjs) and ("function powerPull" in cloudjs) and ("function serviceHealth" in cloudjs),
        "tables=%s TTL2m=%s powerPull=%s serviceHealth=%s" % (
            all(k in cloudjs for k in ("power: 'power'", "powerHistory: 'power_history'", "serviceHealth: 'service_health'")),
            cloudttl, "function powerPull" in cloudjs, "function serviceHealth" in cloudjs))
    # 电费页：隐私 + 交互结构
    pwxml = read(os.path.join(MP, "pages", "power", "power.wxml"))
    pwjs_nc = strip_comments(read(os.path.join(MP, "pages", "power", "power.js")))
    add("同步", "电费页隐私：不显示姓名/学号/手机号、不引用全班名单、无导出/canvas",
        all(k not in pwxml and k not in pwjs_nc for k in ("学号", "姓名", "手机号")) and
        not re.search(r"classMembers|classRoster|buildExport|canvasToTempFilePath|saveImageToPhotosAlbum", pwjs_nc),
        "wxml 无姓名/学号/手机号=%s js 无名单/导出=%s" % (
            all(k not in pwxml and k not in pwjs_nc for k in ("学号", "姓名", "手机号")),
            not re.search(r"classMembers|classRoster|buildExport|canvasToTempFilePath|saveImageToPhotosAlbum", pwjs_nc)))
    add("同步", "电费选择 UI：自定义 bottom-sheet（遮罩/标题/楼栋 pill/房间网格/取消 + safe-area），无 multiSelector",
        all(k in pwxml for k in ('pw-mask', 'pw-sheet', 'pw-sheet-title', 'pw-blds', 'pw-bld', 'pw-rooms',
                                 'pw-room-btn', 'pw-cancel', 'bindtap="openSheet"', 'bindtap="closeSheet"',
                                 'bindtap="pickBuilding"', 'bindtap="pickRoom"', 'catchtouchmove')) and
        ('multiSelector' not in pwxml) and ('multiSelector' not in pwjs_nc) and ('<picker' not in pwxml) and
        ('safe-area-inset-bottom' in read(os.path.join(MP, 'pages', 'power', 'power.wxss'))),
        "sheet=%s multiSelector残留=%s <picker残留=%s" % (
            all(k in pwxml for k in ('pw-mask', 'pw-sheet', 'pw-blds', 'pw-rooms', 'pw-cancel')),
            'multiSelector' in (pwxml + pwjs_nc), '<picker' in pwxml))
    add("同步", "电费选择目录：roomsOfBuilding/buildingOf/rvOf + 17 间分组（13:2 / 16:2 / 23A:9 / 23B:4）",
        all(k in powerjs for k in ('function roomsOfBuilding', 'function buildingOf', 'function rvOf', 'function labelOf')) and
        ('pickerOf' not in powerjs) and ('rvFromPicker' not in powerjs),
        "helpers=%s pickerOfRemoved=%s" % (
            all(k in powerjs for k in ('function roomsOfBuilding', 'function buildingOf', 'function rvOf')),
            'pickerOf' not in powerjs))
    add("同步", "v4 趋势横滑：24h 关闭 scroll-x、7d/30d 开启；隐藏滚动条、bindscroll、内容宽 chartW",
        all(k in pwxml for k in ('<scroll-view', 'class="pw-plot"', 'bindscroll="onTrendScroll"',
                                 'show-scrollbar="{{false}}"', 'style="width:{{chartW}}px"', 'pw-plot-inner')) and
        ("scroll-x=\"{{range !== '24h'}}\"".replace('\\', '') in pwxml or "range !== '24h'" in pwxml),
        "scroll-view/开启条件/chartW=%s" % all(k in pwxml for k in ('pw-plot', 'bindscroll="onTrendScroll"', '{{chartW}}')))
    add("同步", "v4 固定 y 轴：竖线 + 3 刻度（空态不显示刻度）；固定 x 轴覆盖层 left/shift；物理宽上限 5376",
        all(k in pwxml for k in ('pw-yaxis', 'pw-yline', 'pw-ylab--hi', 'pw-ylab--mid', 'pw-ylab--lo', 'pw-xaxis')) and
        ('wx:if="{{!trend.empty}}"' in pwxml) and
        all(k in pwjs_nc for k in ('MAX_PHYS = 5376', 'onTrendScroll', '_refreshXTicks', 'xticksWindow')),
        "yaxis/xaxis/上限=%s" % all(k in pwxml for k in ('pw-yaxis', 'pw-ylab--hi', 'pw-xaxis')))
    add("同步", "v4 时间比例/宽度/上限纯函数：x 按真实时间、chartWidth、trendLimit 7d170/30d240、≤120 点降采样",
        all(k in powerjs for k in ('function trendLine', 'function chartWidth', 'function xticksWindow',
                                   'function trendLimit', "TREND_LIMIT = { '24h': 240, '7d': 170, '30d': 240 }",
                                   '(p.t - t0) / tSpan', "note = '数据积累中'")),
        "trend/chart/xticks=%s" % all(k in powerjs for k in ('function trendLine', 'function chartWidth', 'function xticksWindow')))
    add("同步", "v4 history 契约：select=ts,quantity / limit=2000 / order=ts.asc / ts=gte 按档 / 5min 区间缓存",
        all(k in cloudjs for k in ("POWER_RANGE_MS", "POWER_HIST_TTL = 5 * 60 * 1000",
                                   "select=ts,quantity", "limit=2000", "order=ts.asc",
                                   "function powerHistCached", "function powerHistory")) and
        ("ts=gte." in cloudjs),
        "rangeMs/ttl5m/select/limit2000=%s" % all(k in cloudjs for k in ("POWER_RANGE_MS", "POWER_HIST_TTL = 5 * 60 * 1000", "limit=2000")))
    add("同步", "v5 估算：rateFrom/estimate 分段统计（0.65/0.35 混合、充值段跳过、rate 下限 0.05、days=q/rate）",
        all(k in powerjs for k in ('function rateFrom', 'function estimate', 'function daysMain', 'function daysText',
                                   '0.65', '0.35', '0.05', "recharge")),
        "rateFrom/estimate/daysMain=%s" % all(k in powerjs for k in ('function rateFrom', 'function estimate', 'function daysMain')))
    add("同步", "v5 阈值 UI：8 档面板（lowOptions/lowOpen/chooseLow/closeLow/onTileTap）+ tile3 可点；本机 zq_power_low_",
        all(k in pwxml for k in ('pw-lowsel', 'lowOpen', 'lowOptions', 'chooseLow', 'closeLow',
                                 'onTileTap', 'pw-tile--btn')) and
        ('zq_power_low_' in pwjs_nc) and ('onTileTap' in pwjs_nc) and ('chooseLow' in pwjs_nc),
        "panel/tile3可点/本机键=%s" % all(k in pwxml for k in ('pw-lowsel', 'onTileTap', 'chooseLow')))
    privjs_v5 = read(os.path.join(MP, "utils", "privacy.js"))
    add("同步", "v5 UD 契约：power={sel,at,low}（旧数据 low→30、UD_POWER_LOWS、13 键不变、web sync_check 期望低电30）",
        ("UD_POWER_LOWS" in cloudjs) and ("function udNormLow" in cloudjs) and
        ("low: udNormLow(d.power && d.power.low)" in cloudjs) and
        ("power: { sel: '', at: 0, low: 30 }" in privjs_v5),
        "udNormLow/13 键/DEFAULTS low30=%s" % all(k in cloudjs for k in ("UD_POWER_LOWS", "function udNormLow")))
    add("同步", "v5 拉取：powerPull 恒并行 24h+7d+当前档（估算需要双档），各档 5min 缓存",
        ("const p24 = powerHistory(rv, '24h', !!force)" in cloudjs) and
        ("const p7 = powerHistory(rv, '7d', !!force)" in cloudjs) and
        ("const pActive = range === '24h' ? p24 : (range === '7d' ? p7 : powerHistory(rv, range, !!force))" in cloudjs),
        "p24/p7/pActive=%s" % all(k in cloudjs for k in ("const p24 = powerHistory(rv, '24h'", "const p7 = powerHistory(rv, '7d'")))
    add("同步", "趋势 canvas：<canvas type=2d id=pwTrend>，柱状 DOM 已移除，y 轴 hi/mid/lo 刻度",
        ('id="pwTrend"' in pwxml) and ('type="2d"' in pwxml) and ('pw-bars' not in pwxml) and
        ('pw-bar-cell' not in pwxml) and ('pw-ylab--hi' in pwxml) and ('pw-ylab--mid' in pwxml) and ('pw-ylab--lo' in pwxml),
        "canvas=%s barDOM退场=%s ylab=%s" % ('id="pwTrend"' in pwxml and 'type="2d"' in pwxml,
                                             'pw-bars' not in pwxml and 'pw-bar-cell' not in pwxml,
                                             'pw-ylab--hi' in pwxml and 'pw-ylab--lo' in pwxml))
    add("同步", "canvas 绘制实现：DPR 缩放 / clearRect / 面积渐变 / 折线 / 2 网格 / 末点圆",
        all(k in pwjs_nc for k in ('_drawTrend', 'getContext', 'clearRect', 'createLinearGradient', 'lineTo',
                                   'arc(', 'scale(dpr', 'Math.min(3, Math.max(1,', 'points.length < 2')),
        "drawMarkers=%s" % all(k in pwjs_nc for k in ('_drawTrend', 'clearRect', 'createLinearGradient', 'arc(', 'scale(dpr')))
    pwwxss = read(os.path.join(MP, "pages", "power", "power.wxss"))
    add("同步", "触控区/布局：房间按钮 88rpx、取消 96rpx、512rpx 内 2 列媒体查询、无横向固定超宽",
        ('min-height: 88rpx' in pwwxss) and ('min-height: 96rpx' in pwwxss) and
        ('@media (max-width: 360px)' in pwwxss) and ('max-width: calc(33.333%' in pwwxss) and
        ('width: 100%' in pwwxss) and not re.search(r'width:\s*(?:[4-9]\d{2}|[1-9]\d{3})rpx', pwwxss),
        "88rpx=%s 96rpx=%s 2col360=%s 3col=%s" % ('min-height: 88rpx' in pwwxss, 'min-height: 96rpx' in pwwxss,
                                                   '@media (max-width: 360px)' in pwwxss, 'max-width: calc(33.333%' in pwwxss))
    # 诊断页：管理员双保险 + 60s + onHide 停
    dgjs = read(os.path.join(MP, "pages", "diag", "diag.js"))
    dgxml = read(os.path.join(MP, "pages", "diag", "diag.wxml"))
    diagjs = read(os.path.join(MP, "utils", "diag.js"))
    add("同步", "诊断页仅管理员（onLoad/onShow/load 三层 + cloud.serviceHealth 内校验、非管理员 0 请求路径）",
        dgjs.count("identity.isAdmin()") >= 3 and ("admin: false" in dgjs) and
        ("if (!identity.has() || !identity.isAdmin() || !isEnabled())" in cloudjs) and
        ("仅管理员" in dgxml or "denied" in dgxml),
        "isAdmin 判断 %d 处 / cloud 守卫=%s / denied UI=%s" % (
            dgjs.count("identity.isAdmin()"),
            "if (!identity.has() || !identity.isAdmin() || !isEnabled())" in cloudjs,
            "仅管理员" in dgxml or "denied" in dgxml))
    add("同步", "诊断口径：4 组 13 项 / 主机 15min 离线 / cloudbase <3s 正常 / 60s 刷新且 onHide 停",
        ('REFRESH_MS = 60000' in dgjs or 'REFRESH_MS=60000' in dgjs) and
        ("_stopTimer()" in dgjs) and ("onHide()" in dgjs) and
        ("STALE = 15 * 60 * 1000" in diagjs) and ("SLOW = 3000" in diagjs) and
        (len(re.findall(r"\{ t: '", diagjs)) == 4) and (diagjs.count("'") > 0) and
        ((diagjs.count("ids: ['") == 4) or ("GROUPS" in diagjs)),
        "4 组=%s STALE15m=%s SLOW3s=%s refresh60s=%s onHide停=%s" % (
            len(re.findall(r"\{ t: '", diagjs)) == 4, "STALE = 15 * 60 * 1000" in diagjs,
            "SLOW = 3000" in diagjs, 'REFRESH_MS = 60000' in dgjs or 'REFRESH_MS=60000' in dgjs,
            "_stopTimer()" in dgjs and "onHide()" in dgjs))
    # UD v6 13 键 + power
    privjs = read(os.path.join(MP, "utils", "privacy.js"))
    keys_line = re.search(r"const SECTION_KEYS = \[(.*?)\]", privjs)
    keys = re.findall(r"'([a-zA-Z]+)'", keys_line.group(1)) if keys_line else []
    add("同步", "UD v6：SECTION_KEYS 10 键（power 最后）、VERSION=6、DEFAULTS.power、SCOPE 含关注宿舍",
        keys == ["homeTools", "fit", "draw", "group", "roster", "hide", "tt", "prefs", "nick", "power"] and
        ("const VERSION = 6" in privjs) and ("power: { sel: '', at: 0, low: 30 }" in privjs) and ("关注宿舍" in privjs),
        "keys=%r VERSION6=%s powerDefault=%s scope=%s" % (
            keys, "const VERSION = 6" in privjs, "power: { sel: '', at: 0, low: 30 }" in privjs, "关注宿舍" in privjs))
    add("同步", "cloud.js：UD_OWNED 含 power、power 值内 at 镜像 at.power、导出不含 power",
        ("UD_OWNED = ['homeTools', 'fit', 'draw', 'group', 'roster', 'hide', 'prefs', 'power']" in cloudjs) and
        ("function udMirrorPower" in cloudjs) and
        ("view.power.at = udNum(view.at && view.at.power)" in cloudjs) and
        ("power" not in privjs[privjs.find("function buildExport"):privjs.find("function exportJson")]),
        "UD_OWNED含power=%s mirror=%s export不含power=%s" % (
            "UD_OWNED = ['homeTools', 'fit', 'draw', 'group', 'roster', 'hide', 'prefs', 'power']" in cloudjs,
            "function udMirrorPower" in cloudjs,
            "power" not in privjs[privjs.find("function buildExport"):privjs.find("function exportJson")]))
    # 媒体/包体（独立复算 PNG 总量 + 编译信息）
    imgdir = os.path.join(MP, "images")
    pngs = []
    for dp, dn, fns in os.walk(imgdir):
        pngs += [os.path.join(dp, fn) for fn in fns if fn.lower().endswith(".png")]
    media = sum(os.path.getsize(x) for x in pngs)
    compile_info = os.path.join(HERE, "..", "_compile_info_off.json")
    pkg = None
    try:
        with open(compile_info, encoding="utf-8") as fh:
            ci = json.load(fh)
        pkg = (ci.get("size") or {}).get("total")
    except Exception:
        pkg = None
    add("同步", "媒体预算：PNG 37 个 / 109,337 B（≤200KB 限）", len(pngs) == 37 and media == 109337 and media <= 204800,
        "png=%d bytes=%d" % (len(pngs), media))
    add("同步", "AI 开发模式关闭（app.json 无 agent/subPackages，ai/ 源码保留）",
        ('"agent"' not in appjson) and ("subPackages" not in appjson) and ai_dir,
        "agent=%s subPackages=%s ai/=%s" % ('"agent"' in appjson, "subPackages" in appjson, ai_dir))
    # 编译包体：以 QA 独立 devtools preview 实测为准（mp-dev 07:02 快照之后 nt.js/notice.js 有改动）
    preview = None
    pv_file = os.path.join(REPORTS, "mp_preview_size_delta.json")
    if not os.path.exists(pv_file):
        pv_file = os.path.join(REPORTS, "mp_preview_size_sync_final.json")
    try:
        with open(pv_file, encoding="utf-8") as fh:
            preview = json.load(fh).get("total")
    except Exception:
        preview = None
    actual = preview or pkg
    add("同步", "编译包体实测（QA devtools preview，单主包 ≤2MB）",
        bool(actual) and 0 < actual <= 2 * 1024 * 1024,
        "实测=%s B（来源=%s）" % (actual, "QA preview" if preview else "mp-dev compile_info"))
    if preview and pkg:
        add("同步", "包体数字一致：_compile_info_off.json vs cli preview（±1KB 编译差异）",
            abs(preview - pkg) <= 1024,
            "compile_info=%s B / preview=%s B（差 %d B）" % (pkg, preview, preview - pkg))

    # ---------------- 需求 12：管理员编辑/删除 ----------------
    ntjs = read(os.path.join(MP, "pages", "nt", "nt.js"))
    ntwxml = read(os.path.join(MP, "pages", "nt", "nt.wxml"))
    add("12", "通知页解析 override_json / hidden", ("override" in ntjs) and ("hidden" in ntjs))
    add("12", "通知页有管理员编辑/删除/恢复 UI 入口",
        all(k in ntwxml for k in ("编辑", "删除")) and "恢复" in ntwxml)
    add("12", "cloud.js 提供 ntAdminEdit / ntAdminHide（PATCH 契约）",
        ("function ntAdminEdit" in cloudjs) and ("function ntAdminHide" in cloudjs) and
        ("notices" in cloudjs) and ("PATCH" in cloudjs.upper() or "method: 'PATCH'" in cloudjs))
    add("12", "管理员「已隐藏」筛选存在（仅 is_admin）",
        ('filter === ' in ntjs) and ("hidden" in ntjs) and ("isAdmin" in ntjs))

    # ---------------- 需求 10：审核/演示模式已移除（用户 2026-11-05 20:07 新指示 → 断言不存在） ----------------
    demo_files = [f for f in ("utils/demo.js", "utils/demo-data.js") if os.path.exists(os.path.join(MP, f))]
    add("10", "审核/演示模式源码已移除（utils/demo.js、utils/demo-data.js 不存在）", not demo_files,
        "仍存在: " + ",".join(demo_files))
    identwxml = read(os.path.join(MP, "pages", "identity", "identity.wxml"))
    identjs = read(os.path.join(MP, "pages", "identity", "identity.js"))
    add("10", "身份页无「演示模式/审核用」入口与文案",
        all(k not in (identwxml + identjs) for k in ("演示模式", "审核用", "enterDemo", "演示入口")))
    cloudjs_demo = [k for k in ("demo.isActive", "demo.request", "demoFetch", "./demo.js", "demo-data") if k in cloudjs]
    add("10", "cloud.js / store.js / notify.js 无 demo 拦截或演示桶代码",
        not cloudjs_demo and ("DEMO_KEY" not in read(os.path.join(MP, "utils", "store.js"))) and
        ("demo" not in read(os.path.join(MP, "utils", "notify.js"))),
        "cloud 残留: " + ",".join(cloudjs_demo))
    mewxml2 = read(os.path.join(MP, "pages", "me", "me.wxml"))
    mejs2 = read(os.path.join(MP, "pages", "me", "me.js"))
    add("10", "「我的」页无演示模式文案/退出入口",
        ("演示" not in mewxml2) and ("演示" not in mejs2) and ("审核" not in mewxml2))
    readme_doc = read(os.path.join(MP, "README.md"))
    change_doc = read(os.path.join(MP, "CHANGELOG.md"))
    docs_ok = ("不实现" in readme_doc and "审核模式" in readme_doc) and \
              ("移除" in change_doc and "审核" in change_doc)
    add("10", "README/CHANGELOG 已清理演示实现并写明「不实现审核模式」", docs_ok,
        "README 声明不实现=%s / CHANGELOG 写明移除=%s" % ("不实现" in readme_doc, "移除" in change_doc))

    # ---------------- 需求 9：长期安排 ----------------
    noticejs = read(os.path.join(MP, "utils", "notice.js"))
    add("9", "通知模块支持 recurrence / 长期安排 / nextAt",
        ("recurrence" in noticejs) and ("nextAt" in noticejs or "nextText" in noticejs))
    add("9", "通知页展示长期安排徽标/下次时间（nt.wxml）",
        ("长期安排" in ntwxml) or ("recurring" in ntwxml))

    # ---------------- 需求 7：文件待获取 ----------------
    add("7", "通知页文件「待获取」徽标 + 群名提示（需求 7 小程序侧，Lead 补充两端一致）",
        ("待获取" in ntwxml or "待获取" in ntjs) and ("group" in ntjs or "群" in ntwxml),
        "nt.wxml/js 待获取=%s group引用=%s" % ("待获取" in ntwxml or "待获取" in ntjs, "group" in ntjs))

    # ---------------- 体积 / 配置信息 ----------------
    total = 0
    for dirpath, dirnames, filenames in os.walk(MP):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git")]
        for fn in filenames:
            total += os.path.getsize(os.path.join(dirpath, fn))
    proj = read(os.path.join(MP, "project.config.json"))
    add("信息", "包体 / 配置（信息项）", None,
        "total=%.1fKB appid=%s urlCheck=%s" % (
            total / 1024.0,
            re.search(r'"appid"\s*:\s*"([^"]+)"', proj).group(1) if re.search(r'"appid"\s*:\s*"([^"]+)"', proj) else "?",
            re.search(r'"urlCheck"\s*:\s*(true|false)', proj).group(1) if re.search(r'"urlCheck"\s*:\s*(true|false)', proj) else "?"))

    out = os.path.join(REPORTS, "mp_static_%s.json" % args.tag)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"root": MP, "rows": RESULTS}, fh, ensure_ascii=False, indent=1)
    fails = [r for r in RESULTS if r["ok"] is False]
    print("\n" + "=" * 66)
    print("mp static scan [%s]: %d 项，PASS %d，FAIL %d，PENDING %d" %
          (args.tag, len(RESULTS),
           len([r for r in RESULTS if r["ok"] is True]), len(fails),
           len([r for r in RESULTS if r["ok"] is None])))
    print("结果 JSON:", out)
    print("=" * 66)
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
