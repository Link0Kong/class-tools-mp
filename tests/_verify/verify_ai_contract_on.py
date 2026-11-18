#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify_ai_contract_on.py —— 在 %TEMP% 副本上把 AI 切回 ON，跑 ai_contract_test.js --final

目的：确认「发版 --off 只是配置切换」，AI 适配源码/契约完整，--on 后 AI 契约测试仍全绿
（即修复没有破坏 AI 功能本身）。ai_contract_test.js 不支持 --project 参数，靠脚本目录的
上一级找 mp-class-tools，所以在 %TEMP% 里搭一个 {mp-class-tools, mp-class-tools-tests} 布局。
"""
import json
import os
import shutil
import subprocess
import sys

TESTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT = os.path.abspath(os.path.join(TESTS, "..", "mp-class-tools"))
TOGGLE = os.path.join(TESTS, "ai_toggle.py")
TEMP = os.environ.get("TEMP", ".")
ROOT = os.path.join(TEMP, "verify_ai_contract_probe")
PROBLEMS = []


def run(cmd, cwd, env_extra=None):
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    if env_extra:
        env.update(env_extra)
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=env)
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def main():
    if os.path.isdir(ROOT):
        shutil.rmtree(ROOT)
    proj = os.path.join(ROOT, "mp-class-tools")
    tests = os.path.join(ROOT, "mp-class-tools-tests")
    os.makedirs(ROOT)
    shutil.copytree(PROJECT, proj)
    os.makedirs(tests)
    for fn in ("ai_contract_test.js", "_ai_harness.js"):
        shutil.copy2(os.path.join(TESTS, fn), os.path.join(tests, fn))

    print("=" * 78)
    print("1. 副本上切 AI 为 ON")
    rc, out = run([sys.executable, TOGGLE, "--project", proj, "--on"], cwd=TESTS)
    print(out.strip()[:1500])
    app = json.load(open(os.path.join(proj, "app.json"), encoding="utf-8-sig"))
    conf = json.load(open(os.path.join(proj, "project.config.json"), encoding="utf-8-sig"))
    ok_on = ("subPackages" in app and "agent" in app and
             not (conf.get("packOptions") or {}).get("ignore"))
    print("  [%s] 副本 app.json 含 subPackages+agent，ignore 为空" % ("OK" if ok_on else "FAIL"))
    if not ok_on:
        PROBLEMS.append("副本未成功切到 AI ON")

    print("=" * 78)
    print("2. node ai_contract_test.js --final --json（AI ON 状态，严格模式）")
    rc, out = run(["node", "ai_contract_test.js", "--final", "--json"], cwd=tests)
    print("  [exit=%d]" % rc)
    # JSON 输出可能很大；解析并汇总
    js = out.strip()
    start = js.find("{")
    end = js.rfind("}")
    summary = None
    if start >= 0 and end > start:
        try:
            data = json.loads(js[start:end + 1])
            summary = data.get("summary") or data.get("sum") or data
        except Exception as e:  # noqa: BLE001
            print("  解析 JSON 失败:", e)
    print("  JSON summary:", json.dumps(summary, ensure_ascii=False)[:800] if isinstance(summary, dict) else summary)
    print("  尾部输出:")
    for line in out.strip().splitlines()[-12:]:
        print("    " + line)
    ok_contract = rc == 0
    print("  [%s] ai_contract_test.js --final 退出码 0（AI ON 契约全绿）" % ("OK" if ok_contract else "FAIL"))
    if not ok_contract:
        PROBLEMS.append("AI ON 状态下 ai_contract_test.js --final 未全绿（exit=%d）" % rc)
    # 额外：--final 模式下不允许 FAIL；从输出统计 FAIL 行
    fails = [l for l in out.splitlines() if l.strip().startswith("FAIL")]
    print("  FAIL 行数:", len(fails))
    for f in fails[:10]:
        print("    " + f)

    print("=" * 78)
    if PROBLEMS:
        print("AI CONTRACT (ON): FAIL")
        for p in PROBLEMS:
            print("  - " + p)
        return 1
    print("AI CONTRACT (ON): PASS —— 副本 AI ON 后契约测试 --final 全绿")
    return 0


if __name__ == "__main__":
    sys.exit(main())
