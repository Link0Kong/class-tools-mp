# -*- coding: utf-8 -*-
"""小程序既有门禁复跑入口（基线 vs 终验同一套命令）。

命令（cwd = mp-class-tools-tests）：
  node unit.js
  node sync_contract_test.js
  python staticcheck.py
可选（--with-ai，信息项）：node ai_unit_all.js / ai_contract_test.js / ai_eval_check.js --strict

结果：PASS/FAIL + 摘要行 + 退出码 + 耗时，日志落 _reports/existing_mp_<tag>/，JSON 落 _reports/existing_mp_<tag>.json。
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPORTS = os.path.join(HERE, "_reports")
TESTS = r"C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools-tests"
NODE = "node"

COMMANDS = [
    ("unit", [NODE, "unit.js"], r"(\d+ passed, \d+ failed)"),
    ("sync_contract", [NODE, "sync_contract_test.js"], r"(\d+ passed, \d+ failed)"),
    ("staticcheck", [sys.executable, "staticcheck.py"],
     r"(handlers missing \[\].*|handlers missing \[.*?\])"),
]
AI_COMMANDS = [
    ("ai_unit_all", [NODE, "ai_unit_all.js"], r"(\d+ passed, \d+ failed)"),
    ("ai_contract", [NODE, "ai_contract_test.js"], r"(\d+ passed, \d+ failed)"),
    ("ai_eval", [NODE, "ai_eval_check.js", "--strict"], r"(\d+ passed, \d+ failed)"),
]


def run(name, argv, pattern, tag, timeout):
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    t0 = time.time()
    try:
        p = subprocess.run(argv, cwd=TESTS, env=env, capture_output=True, timeout=timeout,
                           shell=False)
        out = (p.stdout or b"").decode("utf-8", "replace") + (p.stderr or b"").decode("utf-8", "replace")
        code = p.returncode
    except FileNotFoundError as e:
        out = "命令不存在: %s" % (argv,)
        code = -1
    except subprocess.TimeoutExpired as e:
        out = ((e.stdout or b"").decode("utf-8", "replace") if e.stdout else "") + "\n[TIMEOUT]"
        code = -9
    dt = time.time() - t0
    logdir = os.path.join(REPORTS, "existing_mp_" + tag)
    os.makedirs(logdir, exist_ok=True)
    with open(os.path.join(logdir, name + ".log"), "w", encoding="utf-8") as fh:
        fh.write("$ " + " ".join(argv) + "\n")
        fh.write("exit=%s time=%.1fs\n" % (code, dt))
        fh.write(out)
    m = re.search(pattern, out)
    summary = m.group(1).strip() if m else ""
    passed = (code == 0)
    print(("[PASS] " if passed else "[FAIL] ") + "%-14s %-7s %5.1fs  %s" %
          (name, "exit=%s" % code, dt, summary[:160]))
    return {"name": name, "argv": argv, "exit": code, "pass": passed,
            "seconds": round(dt, 1), "summary": summary,
            "tail": out.strip().splitlines()[-30:]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="run")
    ap.add_argument("--with-ai", action="store_true", help="附带 AI 侧信息项（较慢）")
    ap.add_argument("--only", default="")
    ap.add_argument("--timeout", type=int, default=600)
    args = ap.parse_args()
    os.makedirs(REPORTS, exist_ok=True)
    if not os.path.isdir(TESTS):
        raise SystemExit("mp-class-tools-tests 不存在: " + TESTS)
    only = set([s.strip() for s in args.only.split(",") if s.strip()])
    cmds = list(COMMANDS) + (list(AI_COMMANDS) if args.with_ai else [])
    rows = []
    for name, argv, pattern in cmds:
        if only and name not in only:
            continue
        rows.append(run(name, argv, pattern, args.tag, args.timeout))
    out_path = os.path.join(REPORTS, "existing_mp_%s.json" % args.tag)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump({"tests_dir": TESTS, "rows": rows}, fh, ensure_ascii=False, indent=1)
    fails = [r for r in rows if not r["pass"]]
    print("\n" + "=" * 66)
    print("existing mp gates [%s]: %d 项，PASS %d，FAIL %d" %
          (args.tag, len(rows), len(rows) - len(fails), len(fails)))
    print("结果 JSON:", out_path)
    print("=" * 66)
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
