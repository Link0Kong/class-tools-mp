#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify_devtools_ignore.py —— 用真实微信开发者工具 auto-preview 独立复现「packOptions.ignore 生效」实验

背景（CODE_QUALITY_NOTES.md §7.3 的实验，本脚本独立重做一遍）：
  关掉 dev 模式的「无依赖文件过滤」(ignoreDevUnusedFiles=false) 让质量扫描编译语义包含所有
  未被引用的代码文件；此时：
    p3 = 副本（ignore=[]）         → ai/、agent/ 全部进入编译包 → TOTAL 应 ≈ 907,329 B
    p4 = p3 + ignore[ai,agent]     → ai/、agent/ 被剔除          → TOTAL 应 ≈ 549,039 B
  两者差值 ≈ 358,290 B = ai/agent 编译后体积，即可证明：ignore 条目（folder 类型）会被
  DevTools 编译器识别并从编译产物中移除 → 质量扫描 compiledPkg 不再包含 ai/、agent/。

副本均在 %TEMP%，只 auto-preview，不上传不发布；跑完 cli close 关闭副本项目。
"""
import json
import os
import shutil
import subprocess
import sys

TESTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT = os.path.abspath(os.path.join(TESTS, "..", "mp-class-tools"))
TEMP = os.environ.get("TEMP", ".")
ROOT = os.path.join(TEMP, "verify_devtools_ignore_b")
CLI = r"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat"
PROBLEMS = []


def rmtree_best_effort(path):
    """IDE 可能仍占用旧副本目录（file watcher）→ 清理失败不算错。"""
    if not os.path.isdir(path):
        return
    try:
        shutil.rmtree(path)
    except OSError as e:
        print("  （注意：旧副本目录暂被 IDE 占用，未删除：%s）" % e)


def set_setting_false(path):
    """向 project.config.json / project.private.config.json 注入 ignoreDev/ignoreUpload=false。"""
    with open(path, "r", encoding="utf-8-sig") as f:
        d = json.load(f)
    d.setdefault("setting", {})
    d["setting"]["ignoreDevUnusedFiles"] = False
    d["setting"]["ignoreUploadUnusedFiles"] = False
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(d, ensure_ascii=False, indent=2) + "\n")


def set_ignore(path, entries):
    with open(path, "r", encoding="utf-8-sig") as f:
        d = json.load(f)
    d.setdefault("packOptions", {})
    d["packOptions"]["ignore"] = entries
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(d, ensure_ascii=False, indent=2) + "\n")


def auto_preview(project, out_json):
    cmdline = '"%s" auto-preview --project "%s" --info-output "%s" --port 9433' % (CLI, project, out_json)
    print("$", cmdline)
    p = subprocess.run(cmdline, shell=True, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", env=dict(os.environ, PYTHONIOENCODING="utf-8"), timeout=420)
    out = ((p.stdout or "") + (p.stderr or "")).strip()
    for line in out.splitlines():
        print("    " + line)
    print("    [exit=%d]" % p.returncode)
    if p.returncode != 0:
        PROBLEMS.append("auto-preview 失败: %s" % project)
    data = None
    if os.path.exists(out_json):
        with open(out_json, "r", encoding="utf-8-sig") as f:
            data = json.load(f)
        print("    size:", json.dumps(data.get("size"), ensure_ascii=False))
    else:
        PROBLEMS.append("未生成 info-output: %s" % out_json)
    return data


def close_project(project):
    cmdline = '"%s" close --project "%s" --port 9433' % (CLI, project)
    try:
        p = subprocess.run(cmdline, shell=True, capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=120)
        print("    close:", ((p.stdout or "") + (p.stderr or "")).strip()[:200])
    except Exception as e:  # noqa: BLE001
        print("    close 失败（可忽略）:", e)


def main():
    rmtree_best_effort(ROOT)
    os.makedirs(ROOT)
    p3 = os.path.join(ROOT, "p3_nofilter")
    p4 = os.path.join(ROOT, "p4_nofilter_ignore")
    for dst in (p3, p4):
        shutil.copytree(PROJECT, dst)
    for d in (p3, p4):
        set_setting_false(os.path.join(d, "project.config.json"))
        set_setting_false(os.path.join(d, "project.private.config.json"))
    set_ignore(os.path.join(p3, "project.config.json"), [])
    set_ignore(os.path.join(p4, "project.config.json"),
               [{"type": "folder", "value": "ai"}, {"type": "folder", "value": "agent"}])

    print("=" * 78)
    print("p3: ignore=[] + ignoreDevUnusedFiles=false（模拟质量扫描编译，含全部未引用代码）")
    d3 = auto_preview(p3, os.path.join(ROOT, "out_p3.json"))
    close_project(p3)

    print("=" * 78)
    print("p4: p3 + packOptions.ignore=[ai,agent]")
    d4 = auto_preview(p4, os.path.join(ROOT, "out_p4.json"))
    close_project(p4)

    print("=" * 78)
    t3 = (d3 or {}).get("size", {}).get("total")
    t4 = (d4 or {}).get("size", {}).get("total")
    print("结果：p3 TOTAL=%s B, p4 TOTAL=%s B" % (t3, t4))
    if t3 and t4:
        print("差值 p3-p4 = %d B" % (t3 - t4))
    exp3, exp4 = 907329, 549039
    print("（CODE_QUALITY_NOTES §7.3 记录值：p3=907,329 B, p4=549,039 B，差值 358,290 B）")
    ok3 = t3 == exp3
    ok4 = t4 == exp4
    okdelta = t3 and t4 and (t3 - t4) == 358290
    print("  [%s] p3 与笔记一致" % ("OK" if ok3 else "FAIL"))
    print("  [%s] p4 与笔记一致" % ("OK" if ok4 else "FAIL"))
    print("  [%s] 差值 = 358,290 B（ai/agent 编译后体积，证明 ignore 生效）" % ("OK" if okdelta else "FAIL"))
    if not ok3:
        PROBLEMS.append("p3 total=%s != 907329" % t3)
    if not ok4:
        PROBLEMS.append("p4 total=%s != 549039" % t4)
    if not okdelta:
        PROBLEMS.append("p3-p4 差值 != 358290")
    # p3 必须包含 ai/ 分包，p4 不应包含（说明：auto-preview 的 info-output 在「无依赖过滤关闭」时
    # 只暴露 TOTAL 一个包，不列 main/分包名；p3 中 ai/ 文件被归入主包，因此这里按「总量差 + 分包名」双口径）
    pk3 = {p.get("name"): p.get("size") for p in (d3 or {}).get("size", {}).get("packages", [])}
    pk4 = {p.get("name"): p.get("size") for p in (d4 or {}).get("size", {}).get("packages", [])}
    print("  p3 packages:", pk3)
    print("  p4 packages:", pk4)
    delta = (t3 or 0) - (t4 or 0)
    okpkg = (delta == 358290) and ("/ai/" not in pk4)
    print("  [%s] p3->p4 总量差 = 358,290 B（= ai/agent 编译后体积）且 p4 无 /ai/ 分包名"
          % ("OK" if okpkg else "FAIL"))
    print("      （info-output 在 dev 无过滤模式下只给 TOTAL；ai/ 以普通文件并入主包，"
          "故按总量差 + 与笔记记录值逐一对上判定）")
    if not okpkg:
        PROBLEMS.append("packages/差值检查未通过")

    print("=" * 78)
    if PROBLEMS:
        print("DEVTOOLS IGNORE EXPERIMENT: FAIL")
        for p in PROBLEMS:
            print("  - " + p)
        return 1
    print("DEVTOOLS IGNORE EXPERIMENT: PASS —— 真实 DevTools 编译验证 packOptions.ignore 生效")
    print("（副本目录 %s 可删除）" % ROOT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
