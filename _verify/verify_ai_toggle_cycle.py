#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify_ai_toggle_cycle.py —— 独立验收 ai_toggle.py 的完整 --on/--off/--status 周期

全部在 %TEMP% 副本上做（不碰真实项目）；结束时校验真实项目 app.json / project.config.json 哈希未变。
校验点：
  1. 初始副本 = 真实项目当前状态（AI off + ignore ai/agent）
  2. --off 幂等：输出「已是关闭状态」且文件字节不变
  3. --status：AI 分包/agent 未启用、ignore 两条已排除
  4. --on：app.json 与「AI 开启版备份」语义完全一致（subPackages + agent 8 skills）、ignore 中 ai/agent 被移除、
     且备份文件写入 --backup-dir
  5. --on 幂等：输出「已是开启状态」且文件不变
  6. --off：app.json / project.config.json 与初始字节完全一致（往返无损）、ignore 精确两条
  7. --off 幂等
  8. 损坏 JSON 防御：任一 JSON 非法 → 非 0 退出且两个文件都不写
  9. --on 前置校验：ai/skills 缺失 → 拒绝开启且不写文件
 10. 真实项目全程零改动
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

TESTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT = os.path.abspath(os.path.join(TESTS, "..", "mp-class-tools"))
TOGGLE = os.path.join(TESTS, "ai_toggle.py")
AI_ON_BACKUP = os.path.join(TESTS, "_backup_ai_toggle", "app.json.bak-20261105-192803")
EXPECTED_IGNORE = [{"type": "folder", "value": "ai"}, {"type": "folder", "value": "agent"}]
PROBLEMS = []
TEMP_ROOT = os.path.join(os.environ.get("TEMP", tempfile.gettempdir()), "verifier_cycle_auto")


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def read_bytes(path):
    with open(path, "rb") as f:
        return f.read()


def load(path):
    return json.loads(read_bytes(path).decode("utf-8-sig"))


def run(args, expect=0):
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    p = subprocess.run([sys.executable, TOGGLE] + args, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=env)
    out = (p.stdout or "") + (p.stderr or "")
    print("$ python ai_toggle.py " + " ".join(args))
    for line in out.strip().splitlines():
        print("    " + line)
    print("    [exit=%d]" % p.returncode)
    if expect is not None and p.returncode != expect:
        PROBLEMS.append("ai_toggle %s 退出码 %d != 期望 %d" % (" ".join(args), p.returncode, expect))
    return p.returncode, out


def check(name, cond, detail=""):
    print(("  [%s] %s%s" % ("OK" if cond else "FAIL", name, ("" if not detail else "  -> " + detail))))
    if not cond:
        PROBLEMS.append(name)


def ignore_values(conf):
    return [e.get("value") for e in (conf.get("packOptions") or {}).get("ignore") or []
            if isinstance(e, dict) and e.get("type") == "folder"]


def main():
    if os.path.isdir(TEMP_ROOT):
        shutil.rmtree(TEMP_ROOT)
    os.makedirs(TEMP_ROOT)
    work = os.path.join(TEMP_ROOT, "proj")
    shutil.copytree(PROJECT, work)
    bak = os.path.join(TEMP_ROOT, "bak")
    print("副本:", work)
    print("备份目录:", bak)

    app = os.path.join(work, "app.json")
    conf = os.path.join(work, "project.config.json")
    real_app, real_conf = os.path.join(PROJECT, "app.json"), os.path.join(PROJECT, "project.config.json")
    real_hashes = {real_app: sha(real_app), real_conf: sha(real_conf)}
    init = {app: sha(app), conf: sha(conf)}

    print("=" * 78)
    print("1. 初始状态")
    check("副本 app.json 与真实项目一致", init[app] == real_hashes[real_app])
    check("副本 project.config.json 与真实项目一致", init[conf] == real_hashes[real_conf])
    a0, c0 = load(app), load(conf)
    check("app.json 无 subPackages/agent（AI off）", "subPackages" not in a0 and "agent" not in a0)
    check("ignore 精确为 ai/agent 两条 folder", c0.get("packOptions", {}).get("ignore") == EXPECTED_IGNORE)

    print("=" * 78)
    print("2. --off 幂等（当前已是 off）")
    rc, out = run(["--project", work, "--backup-dir", bak, "--off"])
    check("输出『已是关闭状态，无需修改』", "已是关闭状态" in out)
    check("app.json 字节未变", sha(app) == init[app])
    check("project.config.json 字节未变", sha(conf) == init[conf])
    check("幂等 --off 未产生新备份", not (os.path.isdir(bak) and os.listdir(bak)))

    print("=" * 78)
    print("3. --status")
    rc, out = run(["--project", work, "--status"])
    check("status: AI 分包未启用", "AI 分包: 未启用" in out)
    check("status: agent 未启用", "agent: 未启用" in out)
    check("status: ai 已排除", "ai: 已排除" in out)
    check("status: agent 已排除", "agent: 已排除" in out)

    print("=" * 78)
    print("4. --on：恢复 AI 配置 + 移除排除项")
    rc, out = run(["--project", work, "--backup-dir", bak, "--on"])
    a1, c1 = load(app), load(conf)
    on_ref = load(AI_ON_BACKUP)
    check("app.json 语义与 AI 开启版备份完全一致", a1 == on_ref)
    check("app.json 含 subPackages(/ai/, independent)", a1.get("subPackages") == [{"root": "ai", "independent": True, "pages": []}])
    check("agent.skills 8 项且路径未变", len((a1.get("agent") or {}).get("skills", [])) == 8)
    check("ignore 中 ai/agent 已移除", ignore_values(c1) == [], "实际=%s" % ignore_values(c1))
    check("其它 ignore 条目保留（include 未动）", c1.get("packOptions", {}).get("include") == [])
    baks = sorted(os.listdir(bak)) if os.path.isdir(bak) else []
    check("备份目录写入 app.json + project.config.json 备份", len(baks) == 2 and
          any(x.startswith("app.json.bak-") for x in baks) and
          any(x.startswith("project.config.json.bak-") for x in baks), str(baks))
    on_hashes = {app: sha(app), conf: sha(conf)}

    print("=" * 78)
    print("5. --on 幂等")
    rc, out = run(["--project", work, "--backup-dir", bak, "--on"])
    check("输出『已是开启状态，无需修改』", "已是开启状态" in out)
    check("app.json 字节未变", sha(app) == on_hashes[app])
    check("project.config.json 字节未变", sha(conf) == on_hashes[conf])

    print("=" * 78)
    print("6. --off：往返恢复到与初始完全相同的字节")
    rc, out = run(["--project", work, "--backup-dir", bak, "--off"])
    check("app.json 与初始字节完全一致（往返无损）", sha(app) == init[app],
          "%s vs %s" % (sha(app), init[app]))
    check("project.config.json 与初始字节完全一致（往返无损）", sha(conf) == init[conf])
    check("ignore 精确恢复两条 folder", load(conf).get("packOptions", {}).get("ignore") == EXPECTED_IGNORE)
    a2 = load(app)
    check("app.json 无 subPackages/agent", "subPackages" not in a2 and "agent" not in a2)

    print("=" * 78)
    print("7. --off 幂等")
    rc, out = run(["--project", work, "--backup-dir", bak, "--off"])
    check("输出『已是关闭状态，无需修改』", "已是关闭状态" in out)
    check("字节仍未变", sha(app) == init[app] and sha(conf) == init[conf])

    print("=" * 78)
    print("8. 损坏 JSON 防御（不写任何文件）")
    bad = os.path.join(TEMP_ROOT, "proj_bad")
    shutil.copytree(PROJECT, bad)
    bad_app, bad_conf = os.path.join(bad, "app.json"), os.path.join(bad, "project.config.json")
    bad_hashes = {bad_app: sha(bad_app), bad_conf: sha(bad_conf)}
    with open(bad_app, "wb") as f:
        f.write(b'{"pages": [broken json')
    rc, out = run(["--project", bad, "--backup-dir", bak, "--off"], expect=None)
    check("app.json 非法 → 非 0 退出", rc != 0, "exit=%d" % rc)
    check("非法 app.json 未被改写", sha(bad_app) == hashlib.sha256(b'{"pages": [broken json').hexdigest())
    check("project.config.json 未被写入（全有或全无）", sha(bad_conf) == bad_hashes[bad_conf])

    bad2 = os.path.join(TEMP_ROOT, "proj_bad2")
    shutil.copytree(PROJECT, bad2)
    bad2_app, bad2_conf = os.path.join(bad2, "app.json"), os.path.join(bad2, "project.config.json")
    h2 = {bad2_app: sha(bad2_app), bad2_conf: sha(bad2_conf)}
    with open(bad2_conf, "wb") as f:
        f.write(b"not-json")
    rc, out = run(["--project", bad2, "--backup-dir", bak, "--off"], expect=None)
    check("project.config.json 非法 → 非 0 退出", rc != 0, "exit=%d" % rc)
    check("非法 project.config.json 未被改写", sha(bad2_conf) == hashlib.sha256(b"not-json").hexdigest())
    check("app.json 未被写入（全有或全无）", sha(bad2_app) == h2[bad2_app])

    print("=" * 78)
    print("9. --on 前置校验（ai/skills 缺失时拒绝）")
    noai = os.path.join(TEMP_ROOT, "proj_noai")
    shutil.copytree(PROJECT, noai)
    shutil.rmtree(os.path.join(noai, "ai"))
    h3 = {p: sha(p) for p in (os.path.join(noai, "app.json"), os.path.join(noai, "project.config.json"))}
    rc, out = run(["--project", noai, "--backup-dir", bak, "--on"], expect=None)
    check("ai/ 缺失 → --on 拒绝（非 0 退出）", rc != 0, "exit=%d" % rc)
    check("拒绝时两个文件都未写", all(sha(p) == h for p, h in h3.items()))

    print("=" * 78)
    print("10. 真实项目零改动")
    check("真实 app.json 哈希未变", sha(real_app) == real_hashes[real_app])
    check("真实 project.config.json 哈希未变", sha(real_conf) == real_hashes[real_conf])

    print("=" * 78)
    if PROBLEMS:
        print("AI_TOGGLE CYCLE: FAIL (%d 项)" % len(PROBLEMS))
        for p in PROBLEMS:
            print("  - " + p)
        return 1
    print("AI_TOGGLE CYCLE: PASS（on/off/status/幂等/防御/真实项目零改动 全部通过）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
