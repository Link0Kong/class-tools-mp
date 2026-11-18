# -*- coding: utf-8 -*-
"""render_export.py —— 用本机 Edge 无头渲染小程序 canvas.js 的 drawCard，落盘 PNG 供设计/回归核查。

为什么不直接跑真机：开发者工具里 canvas 节点在 automator evaluate 下拿不到（selector 回调不触发），
而 drawCard 是纯 Canvas 2D 代码，浏览器与小程序 2D canvas 基本一致；真机侧另由 unit/staticcheck 覆盖。

用法：
  python render_export.py draw
  python render_export.py group
  python render_export.py sum
  python render_export.py custom path\\to\\opt.json   # {"title":..., "config":[...], "blocks":[...]}
输出：mp-class-tools-tests/_shots/export/mp_<kind>.png
"""
import os, sys, json, re, time, base64, threading, http.server, socketserver, functools, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, "..", "mp-class-tools", "utils", "canvas.js"))
OUT = os.path.join(HERE, "_shots", "export")
os.makedirs(OUT, exist_ok=True)
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 8911; REPORT = os.path.join(HERE, "_report_%d.txt" % PORT)

# 与页面 exportImg() 同构的样例数据（视觉核查用，不写回项目）
DRAW = {
    "title": "抽签结果", "sub": "范围 1 – 70",
    "config": [["抽签 · 范围", "1 – 70"], ["抽签 · 个数", "10"], ["抽签 · 允许重复", "否"],
               ["抽签 · 排除", "无"], ["抽签 · 排序", "按抽取顺序"],
               ["抽签 · 参与名单", "未选择 · 只抽序号"]],
    "blocks": [{"label": "抽中结果（10）", "chips": [
        {"n": 2, "nm": "同学2"}, {"n": 42, "nm": "同学42"}, {"n": 17, "nm": "同学17"},
        {"n": 10, "nm": "同学10"}, {"n": 35, "nm": "同学35"}, {"n": 15, "nm": "同学15"},
        {"n": 11, "nm": "同学11"}, {"n": 32, "nm": "同学32"}, {"n": 27, "nm": "同学27"},
        {"n": 5, "nm": "同学5"}]}],
    "foot": "生成时间 2026-11-05 13:40", "rec": "DRAW-20261105-1340-TEST"
}
GROUP = {
    "title": "分组结果", "sub": "4 组 / 10 人",
    "config": [["分组 · 成员来源", "上一步抽签序号"], ["分组 · 方式", "按组数(4组)"],
               ["分组 · 人数", "10"], ["分组 · 组数", "4"], ["分组 · 成员分配", "按原顺序轮流分配"]],
    "blocks": [{"label": "分组结果", "groups": [
        [{"n": 2, "nm": "同学2"}, {"n": 35, "nm": "同学35"}, {"n": 11, "nm": "同学11"}],
        [{"n": 42, "nm": "同学42"}, {"n": 15, "nm": "同学15"}, {"n": 32, "nm": "同学32"}],
        [{"n": 17, "nm": "同学17"}, {"n": 10, "nm": "同学10"}],
        [{"n": 27, "nm": "同学27"}, {"n": 5, "nm": "同学5"}]]}],
    "foot": "生成时间 2026-11-05 13:40", "rec": "GROUP-20261105-1340-TEST"
}
SUM = {
    "title": "班级工具 · 结果单", "sub": "范围 1 – 70 · 4 组",
    "config": [["抽签 · 范围", "1 – 70"], ["抽签 · 个数", "10"], ["抽签 · 允许重复", "否"],
               ["抽签 · 排除", "无"], ["抽签 · 排序", "按抽取顺序"],
               ["分组 · 成员来源", "上一步抽签序号"], ["分组 · 方式", "按组数(4组)"],
               ["分组 · 人数", "10"], ["分组 · 组数", "4"], ["分组 · 成员分配", "按原顺序轮流分配"]],
    "blocks": [{"label": "抽签结果", "chips": [
                   {"n": 13, "nm": ""}, {"n": 44, "nm": ""}, {"n": 17, "nm": ""}, {"n": 21, "nm": ""},
                   {"n": 31, "nm": ""}, {"n": 68, "nm": ""}, {"n": 4, "nm": ""}, {"n": 37, "nm": ""},
                   {"n": 49, "nm": ""}, {"n": 24, "nm": ""}]},
               {"label": "分组结果", "groups": [
                   [{"n": 13, "nm": ""}, {"n": 31, "nm": ""}, {"n": 49, "nm": ""}],
                   [{"n": 44, "nm": ""}, {"n": 68, "nm": ""}, {"n": 24, "nm": ""}],
                   [{"n": 17, "nm": ""}, {"n": 4, "nm": ""}],
                   [{"n": 21, "nm": ""}, {"n": 37, "nm": ""}]]}],
    "foot": "生成时间 2026-11-05 13:40", "rec": "SUM-20261105-1340-TEST"
}
HW = {
    "title": "作业板", "sub": "@测试同学",
    "config": [["未完成", "3"], ["已完成", "5"], ["署名", "测试同学"]],
    "blocks": [{"label": "2099-01-01（还有 26355 天）", "lines": []},
               {"label": "2026-11-08（还有 3 天）", "lines": ["【英语】Unit 3 课后练习"]},
               {"label": "2026-11-10（还有 5 天）", "lines": ["【高等数学】习题 4.2 第 1-15 题"]},
               {"label": "2026-11-12（还有 7 天）", "lines": ["【大学计算机基础】实验报告 3（含截图）」"]}],
    "foot": "生成时间 2026-11-05 13:40", "rec": "HW-20261105-1340-TEST"
}
TT = {
    "title": "第 10 周课表", "sub": "11/2 – 11/8",
    "config": [["开学日期", "2026-08-31"], ["课程数", "3"], ["周次", "第 10 周"]],
    "blocks": [{"label": "周一 11/2", "lines": ["第1-2节 08:10–09:40　高等数学　@A301　王老师",
                                                 "第3-4节 09:50–11:25　大学英语　@B204　李老师"]},
               {"label": "周三 11/4", "lines": ["第5-6节 14:30–16:00　大学计算机基础　@机房2　张老师"]}],
    "foot": "生成时间 2026-11-05 13:40", "rec": "TT-20261105-1340-TEST"
}
FT = {
    "title": "体测成绩", "sub": "男 · 大一大二",
    "config": [["标准总分", "83.0"], ["加分", "2.0"], ["总评", "85.0"], ["等级", "良好"], ["缺项", "0"]],
    "blocks": [{"label": "单项成绩", "lines": ["身高体重（15%）：BMI 21.5  →  100 分",
                                               "肺活量（15%）：4300 ml  →  90 分",
                                               "50 米跑（20%）：7.1 s  →  85 分",
                                               "坐位体前屈（10%）：17.7 cm  →  88 分",
                                               "立定跳远（10%）：248 cm  →  86 分",
                                               "引体向上（10%）：15 个  →  92 分",
                                               "1000 米（20%）：3′42″  →  80 分"]}],
    "foot": "生成时间 2026-11-05 13:40", "rec": "FT-20261105-1340-TEST"
}
KINDS = {"draw": DRAW, "group": GROUP, "sum": SUM, "hw": HW, "tt": TT, "ft": FT}


def build_html(opt):
    src = open(SRC, encoding="utf-8").read()
    # 去掉 require（浏览器里 util 只用于 export/save 流程，drawCard 不依赖）
    src = re.sub(r"const util = require\('\./util\.js'\);", "const util = { toast: function () {} };", src)
    src = src.replace("module.exports = {", ";window.__canvasMod = {").replace(
        "W: W, PAD: PAD, DPR: DPR, fontOf: fontOf, wrap: wrap, rr: rr,", "W: W, PAD: PAD, DPR: DPR,")
    return """<!doctype html><html><head><meta charset="utf-8"><title>mp-render</title>
<style>body{margin:0;background:#888}</style></head><body>
<canvas id="c"></canvas>
<script>%s</script>
<script>
try{
  var c=document.getElementById('c'), g=c.getContext('2d');
  var H=window.__canvasMod.drawCard(g,c,%s);
  var d=c.toDataURL('image/png');
  document.title='H='+H;
  fetch('/_report',{method:'POST',body:'H='+H+'\\n'+d});
}catch(e){
  fetch('/_report',{method:'POST',body:'ERR:'+(e&&e.message)});
}
</script></body></html>""" % (src, json.dumps(opt, ensure_ascii=False))


class H(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        open(REPORT, "wb").write(self.rfile.read(n))
        self.send_response(200); self.end_headers()
    def log_message(self, *a): pass


def main():
    kind = sys.argv[1] if len(sys.argv) > 1 else "draw"
    if kind == "custom":
        opt = json.load(open(sys.argv[2], encoding="utf-8"))
        out_name = "custom"
    else:
        opt = KINDS[kind]
        out_name = kind
    html = build_html(opt)
    tmp = os.path.join(HERE, "_mp_render_preview.html")
    open(tmp, "w", encoding="utf-8").write(html)
    Handler = functools.partial(H, directory=HERE)
    class Q(socketserver.TCPServer):
        allow_reuse_address = True
    httpd = Q(("127.0.0.1", PORT), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(0.3)
    if os.path.exists(REPORT): os.remove(REPORT)
    try:
        subprocess.run([EDGE, "--headless=new", "--disable-gpu", "--no-first-run",
                        "--virtual-time-budget=3000",
                        "http://127.0.0.1:%d/%s" % (PORT, os.path.basename(tmp))],
                       capture_output=True, timeout=120)
        body = "NOT FOUND"
        for _ in range(40):
            if os.path.exists(REPORT):
                time.sleep(0.2); body = open(REPORT, encoding="utf-8", errors="replace").read(); break
            time.sleep(0.25)
        if body.startswith("ERR:"):
            print("渲染失败:", body[:300]); sys.exit(1)
        m = re.search(r"data:image/png;base64,([A-Za-z0-9+/=]+)", body)
        if not m:
            print("没有 PNG:", body[:300]); sys.exit(1)
        p = os.path.join(OUT, "mp_%s.png" % out_name)
        data = base64.b64decode(m.group(1))
        open(p, "wb").write(data)
        print("H=%s  已保存 %s (%d bytes)" % (re.search(r"H=(\d+)", body).group(1), p, len(data)))
    finally:
        httpd.shutdown()
        try: os.remove(tmp)
        except OSError: pass


if __name__ == "__main__":
    main()
