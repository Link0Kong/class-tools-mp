#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify_config_diff.py —— 校验真实项目的 app.json / project.config.json 相对备份只应有预期改动

预期改动（本次代码质量修复）：
  * project.config.json: packOptions.ignore 由 [] -> [{"type":"folder","value":"ai"},{"type":"folder","value":"agent"}]，
    且没有其它任何字段变化。
  * app.json: 无改动（应保持 ai_toggle.py --off 之后的状态：无 subPackages(/ai/) 与 agent 字段；
    与 _backup_ai_toggle/app.json.bak-*（AI 开启版）相比，只少了这两块配置）。
  * 编码/换行：UTF-8 无 BOM、JSON 可解析、CRLF/LF 风格与备份一致（ai_toggle 要求保留原换行风格）。
"""
import json
import os
import sys

TESTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT = os.path.abspath(os.path.join(TESTS, "..", "mp-class-tools"))
BAK = os.path.join(TESTS, "_backup_ai_toggle")

PROBLEMS = []


def read(path):
    with open(path, "rb") as f:
        return f.read()


def load(path):
    return json.loads(read(path).decode("utf-8-sig"))


def newline_style(raw):
    crlf = raw.count(b"\r\n")
    lf = raw.count(b"\n") - crlf
    return {"crlf": crlf, "lf": lf, "endsWithNewline": raw.endswith(b"\n")}


def diff_flat(a, b, prefix=""):
    """返回 (added, removed, changed) 的路径级差异（仅 dict/list 顶层递归）。"""
    added, removed, changed = [], [], []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            p = prefix + "/" + k
            if k not in a:
                added.append(p)
            elif k not in b:
                removed.append(p)
            else:
                x, y, z = diff_flat(a[k], b[k], p)
                added += x
                removed += y
                changed += z
    else:
        if type(a) is not type(b) or a != b:
            changed.append((prefix, a, b))
    return added, removed, changed


def main():
    print("项目:", PROJECT)

    # ---------- project.config.json ----------
    cur_cfg_p = os.path.join(PROJECT, "project.config.json")
    bak_cfg_p = None
    for name in sorted(os.listdir(BAK)):
        if name.startswith("project.config.json.bak-"):
            bak_cfg_p = os.path.join(BAK, name)
    print("\n[1] project.config.json vs %s" % (os.path.basename(bak_cfg_p) if bak_cfg_p else "N/A"))
    cur_raw, bak_raw = read(cur_cfg_p), read(bak_cfg_p)
    cur, bak = load(cur_cfg_p), load(bak_cfg_p)
    expected_ignore = [{"type": "folder", "value": "ai"}, {"type": "folder", "value": "agent"}]
    if cur.get("packOptions", {}).get("ignore") != expected_ignore:
        PROBLEMS.append("packOptions.ignore 不等于预期两条 folder 条目: %r" % (cur.get("packOptions", {}).get("ignore"),))
    else:
        print("   ✓ packOptions.ignore 精确为:", json.dumps(cur["packOptions"]["ignore"], ensure_ascii=False))
    added, removed, changed = diff_flat(bak, cur)
    # ignore 展开的差异属于预期，剔除
    expected_changed = {"/packOptions/ignore"}
    bad_changed = [c for c in changed if c[0] not in expected_changed
                   and not c[0].startswith("/packOptions/ignore/")]
    if added or removed or bad_changed:
        PROBLEMS.append("project.config.json 存在非预期差异: added=%s removed=%s changed=%s"
                        % (added, removed, bad_changed))
    else:
        print("   ✓ 除 packOptions.ignore 外字段无任何变化（added/removed/changed 均为空）")
    print("   换行风格: 当前=%s 备份=%s" % (newline_style(cur_raw), newline_style(bak_raw)))
    print("   字节数: %d -> %d (%+d)" % (len(bak_raw), len(cur_raw), len(cur_raw) - len(bak_raw)))
    if b"\r\n" in bak_raw and cur_raw.count(b"\r\n") != bak_raw.count(b"\r\n"):
        # 允许行数变化带来的 CRLF 行数变化，只要求仍是 CRLF 风格
        if cur_raw.count(b"\r\n") == 0:
            PROBLEMS.append("project.config.json 丢失了 CRLF 换行风格")
        else:
            print("   CRLF 行数变化: %d -> %d（新增 ignore 条目导致，风格仍为 CRLF）"
                  % (bak_raw.count(b"\r\n"), cur_raw.count(b"\r\n")))
    if not cur_raw.endswith(b"\n"):
        PROBLEMS.append("project.config.json 缺少末尾换行")
    if cur_raw[:3] == b"\xef\xbb\xbf":
        PROBLEMS.append("project.config.json 写成了带 BOM 的 UTF-8（原文件无 BOM? 备份=%r）" % (bak_raw[:3],))

    # ---------- app.json ----------
    cur_app_p = os.path.join(PROJECT, "app.json")
    bak_app_p = None
    for name in sorted(os.listdir(BAK)):
        if name.startswith("app.json.bak-"):
            bak_app_p = os.path.join(BAK, name)
    cur_app_raw = read(cur_app_p)
    cur_app = load(cur_app_p)
    print("\n[2] app.json 当前状态（AI off 期望）")
    print("   有 subPackages:", "subPackages" in cur_app, " 有 agent:", "agent" in cur_app)
    if "subPackages" in cur_app or "agent" in cur_app:
        PROBLEMS.append("app.json 仍含 subPackages/agent（AI 未真正关闭）")
    else:
        print("   ✓ 无 subPackages、无 agent 字段")
    print("   pages=%d; 顶层键: %s" % (len(cur_app.get("pages", [])), sorted(cur_app.keys())))
    print("   换行风格: %s; 末尾换行=%s; BOM=%s; 字节=%d"
          % (newline_style(cur_app_raw), cur_app_raw.endswith(b"\n"), cur_app_raw[:3] == b"\xef\xbb\xbf",
             len(cur_app_raw)))

    print("\n[3] app.json vs AI 开启版备份（应只少 subPackages + agent）")
    bak_app = load(bak_app_p)
    print("   备份:", os.path.basename(bak_app_p), "字节=", len(read(bak_app_p)))
    only_expected = {"subPackages", "agent"}
    added, removed, changed = diff_flat(bak_app, cur_app)
    # 整块字段缺失时 diff_flat 只报顶层路径，故 removed 应精确等于 {/subPackages, /agent}
    top_removed = {p.strip("/") for p in removed}
    if top_removed != only_expected or added or changed:
        PROBLEMS.append("app.json 与 AI 开启版差异不符合预期: removed=%s added=%s changed=%s"
                        % (sorted(top_removed), added, changed))
    else:
        print("   ✓ 仅移除了 %s，无其它 added/changed" % sorted(top_removed))
        print("     （被移除的 AI 配置块：subPackages=%r, agent.skills=%d 项）"
              % (bak_app.get("subPackages"), len((bak_app.get("agent") or {}).get("skills", []))))

    # ---------- 当前 AI-off 的 app.json 与 v21(7:45) 的差异应只有 pages 等历史演进 ----------
    print("\n[4] 结论")
    if PROBLEMS:
        print("   CONFIG DIFF: FAIL")
        for p in PROBLEMS:
            print("   - " + p)
        return 1
    print("   CONFIG DIFF: PASS（两个配置文件只有 ai_toggle 预期的两处变化）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
