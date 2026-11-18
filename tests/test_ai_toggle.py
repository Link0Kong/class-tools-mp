#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""test_ai_toggle.py —— ai_toggle.py 的端到端测试（纯 stdlib，Windows/Linux 通用）

思路：
    在 %TEMP% 建一份 <mp-class-tools> 的最小副本（app.json、project.config.json、
    agent/、ai/ 整体复制），所有命令都通过 subprocess 调 ai_toggle.py --project <副本>，
    覆盖 on/off 完整周期、packOptions.ignore 增删、幂等、防御性拒绝、备份与真实项目零改动。

用法：
    cd C:\\Users\\Ko_Li\\.openclaw\\workspace\\mp-class-tools-tests
    python test_ai_toggle.py          # 退出码 0 = 全部 PASS

说明：
    * 测试只写 %TEMP% 副本与其中的备份目录；通过在命令行传 --backup-dir 把备份也放进临时目录。
    * 若真实项目当前处于 AI 开发态（app.json 有 agent），测试会先在副本上归一化为关闭态
      再继续，因此发版态/开发态下都可以独立运行。
    * 结束时清理临时目录；脚本自身不修改真实项目的 app.json / project.config.json。
"""
import copy
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOGGLE = HERE / "ai_toggle.py"
SRC = HERE.parent / "mp-class-tools"
REAL_BACKUP_DIR = HERE / "_backup_ai_toggle"

PASS = 0
FAILS = []


def check(name, cond, detail=""):
    global PASS
    if cond:
        PASS += 1
        print(f"PASS {PASS}: {name}")
    else:
        FAILS.append((name, detail))
        print(f"FAIL {len(FAILS)}: {name}")
        if detail != "":
            print(f"      detail: {str(detail)[:1500]}")


# ---------------------------------------------------------------- 工具函数

def run(*args):
    cmd = [sys.executable, str(TOGGLE)] + [str(a) for a in args]
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", env=env)
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def jload(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def jbytes(path):
    return Path(path).read_bytes()


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def has_ai(app):
    subs = app.get("subPackages") or []
    return bool(app.get("agent")) or any(
        isinstance(p, dict) and p.get("root") == "ai" for p in subs
    )


def ignore_entries(conf):
    pack = conf.get("packOptions") or {}
    ignore = pack.get("ignore") if isinstance(pack, dict) else None
    return ignore if isinstance(ignore, list) else []


def folder_values(conf):
    return [e.get("value") for e in ignore_entries(conf)
            if isinstance(e, dict) and e.get("type") == "folder"]


def backups(backup_dir):
    if not backup_dir.exists():
        return []
    return sorted(p.name for p in backup_dir.glob("*.bak-*"))


def latest_backup(backup_dir, name):
    if not backup_dir.exists():
        return None
    files = sorted(backup_dir.glob(name + ".bak-*"))
    return files[-1] if files else None


def backup_counts(backup_dir):
    """返回 (app.json 备份数, project.config.json 备份数, 总备份数)。"""
    names = backups(backup_dir)
    return (
        sum(n.startswith("app.json.bak-") for n in names),
        sum(n.startswith("project.config.json.bak-") for n in names),
        len(names),
    )


def is_ai_ignore_entry(entry):
    return (isinstance(entry, dict) and entry.get("type") == "folder"
            and entry.get("value") in ("ai", "agent"))


def write_conf_style(path, obj):
    """按 ai_toggle.py 的写法（indent=2 / 保留原换行 / 末尾换行）写回，保证可做字节级比较。"""
    raw = Path(path).read_bytes()
    newline = "\r\n" if b"\r\n" in raw else "\n"
    text = json.dumps(obj, ensure_ascii=False, indent=2).replace("\n", newline) + newline
    Path(path).write_bytes(text.encode("utf-8"))


# ---------------------------------------------------------------- 测试主体

def main():
    check("ai_toggle.py 存在", TOGGLE.is_file())
    check("真实项目 app.json 存在", (SRC / "app.json").is_file())
    check("真实项目 project.config.json 存在", (SRC / "project.config.json").is_file())

    real_app_before = sha(SRC / "app.json")
    real_conf_before = sha(SRC / "project.config.json")
    real_backup_before = backups(REAL_BACKUP_DIR)

    temp = Path(tempfile.mkdtemp(prefix="ai_toggle_test_"))
    proj = temp / "mp-class-tools"
    backup_dir = temp / "_backup_ai_toggle"
    try:
        # ---------- 0. 复制真实项目最小副本 ----------
        proj.mkdir()
        shutil.copy2(SRC / "app.json", proj / "app.json")
        shutil.copy2(SRC / "project.config.json", proj / "project.config.json")
        shutil.copytree(SRC / "agent", proj / "agent")
        shutil.copytree(SRC / "ai", proj / "ai")
        check("副本 ai/ 复制完整（184 文件）",
              (proj / "ai" / "skills" / "identity" / "SKILL.md").is_file())
        check("副本 agent/ 复制完整", (proj / "agent" / "AGENTS.md").is_file())

        base = ("--project", proj, "--backup-dir", backup_dir)

        def toggle(flag):
            return run(*(base + (flag,)))

        app_path = proj / "app.json"
        conf_path = proj / "project.config.json"

        # ---------- 1. 初始状态：复制真实项目当前状态 ----------
        rc, out = toggle("--status")
        check("初始 --status 退出码 0", rc == 0, out)
        check("初始 status 含 packOptions.ignore 行", "packOptions.ignore:" in out, out)
        check("初始 status 显示 ai/ 目录存在", "ai/ 目录: 存在" in out, out)
        check("初始 status 显示 agent/ 目录存在", "agent/ 目录: 存在" in out, out)
        check("初始 status 显示备份目录", "备份目录:" in out, out)
        check("--status 为只读（无备份产生）", backups(backup_dir) == [], backups(backup_dir))

        base_app = jload(app_path)
        if not has_ai(base_app):
            check("初始 status 显示「AI 分包: 未启用」", "AI 分包: 未启用" in out, out)
            check("初始 status 显示「agent: 未启用」", "agent: 未启用" in out, out)
        else:
            # 真实项目处于日常 AI 开发态时，先在副本上归一化为发版关闭态，测试仍可独立运行。
            check("真实项目当前为 AI 开发态：初始 status 显示「AI 分包: 已启用」",
                  "AI 分包: 已启用" in out, out)
            print("NOTE: 真实项目当前为 AI 开启态，先在副本上归一化为关闭态再继续测试")
            rc, out = toggle("--off")
            check("副本归一化 --off 退出码 0", rc == 0, out)
            norm = jload(conf_path)
            pack = norm.setdefault("packOptions", {})
            pack["ignore"] = [e for e in pack.get("ignore") or [] if not is_ai_ignore_entry(e)]
            write_conf_style(conf_path, norm)
            base_app = jload(app_path)
            check("归一化后副本 app.json 为 AI 关闭态", not has_ai(base_app),
                  json.dumps(base_app, ensure_ascii=False)[:400])

        # 给副本的 project.config.json 预置「用户已有的」ignore 条目，用于验证不被破坏。
        base_conf = jload(conf_path)
        base_conf.setdefault("packOptions", {})
        base_conf["packOptions"]["ignore"] = [
            {"type": "file", "value": "README.md"},
            {"type": "folder", "value": "docs"},
        ]
        base_conf["packOptions"].setdefault("include", [])
        write_conf_style(conf_path, base_conf)
        base_conf = jload(conf_path)          # 语义基线
        base_conf_bytes = jbytes(conf_path)   # 字节基线（工具写回风格一致）
        app_bak0, conf_bak0, _n0 = backup_counts(backup_dir)

        rc, out = toggle("--status")
        check("预置 ignore 后 status 显示「ai: 未排除」", "ai: 未排除" in out, out)
        check("预置 ignore 后 status 显示「agent: 未排除」", "agent: 未排除" in out, out)

        # ---------- 2. --on：开启 AI 配置（不应动 project.config.json） ----------
        rc, out = toggle("--on")
        check("--on 退出码 0", rc == 0, out)
        check("--on 输出含「已开启 AI 配置」", "已开启 AI 配置" in out, out)
        app_on = jload(app_path)
        check("--on 后 app.json 有 agent 字段", bool(app_on.get("agent")))
        ai_subs = [p for p in (app_on.get("subPackages") or [])
                   if isinstance(p, dict) and p.get("root") == "ai"]
        check("--on 后 app.json 有 ai 独立分包",
              len(ai_subs) == 1 and ai_subs[0].get("independent") is True
              and ai_subs[0].get("pages") == [], ai_subs)
        check("--on 后 agent.skills 为 8 个",
              len((app_on.get("agent") or {}).get("skills") or []) == 8)
        changed = {k for k in set(base_app) | set(app_on) if base_app.get(k) != app_on.get(k)}
        check("--on 只新增 subPackages/agent（其余字段不变）",
              changed <= {"subPackages", "agent", "lazyCodeLoading"}, changed)
        check("--on 后 project.config.json 语义 == 基线（用户 ignore 保留、无 ai/agent 排除项）",
              jload(conf_path) == base_conf)
        check("--on 不写 project.config.json（字节不变）",
              jbytes(conf_path) == base_conf_bytes)
        app_now, conf_now, _n = backup_counts(backup_dir)
        check("--on 备份：仅新增 1 个 app.json 备份",
              app_now == app_bak0 + 1 and conf_now == conf_bak0, backups(backup_dir))
        bak = latest_backup(backup_dir, "app.json")
        check("--on 备份内容 = 改动前（关闭态）app.json",
              bak is not None and jload(bak) == base_app)
        app_on_bytes = jbytes(app_path)
        app_on_sem = jload(app_path)
        conf_on_bytes = jbytes(conf_path)

        # ---------- 3. --off：关闭 AI 配置 + 写入 packOptions.ignore ----------
        rc, out = toggle("--off")
        check("--off 退出码 0", rc == 0, out)
        check("--off 输出含「已移除 AI 配置」", "已移除 AI 配置" in out, out)
        check("--off 输出含写入了 ai/agent 排除项", "packOptions.ignore" in out, out)
        app_off = jload(app_path)
        check("--off 后 app.json 无 agent", not app_off.get("agent"))
        check("--off 后 app.json 无 ai 分包", not any(
            isinstance(p, dict) and p.get("root") == "ai"
            for p in app_off.get("subPackages") or []))
        check("--off 后 app.json 语义 == 关闭态基线", app_off == base_app,
              json.dumps(app_off, ensure_ascii=False)[:400])
        conf_off = jload(conf_path)
        expected_off = copy.deepcopy(base_conf)
        expected_off["packOptions"]["ignore"] = list(base_conf["packOptions"]["ignore"]) + [
            {"type": "folder", "value": "ai"},
            {"type": "folder", "value": "agent"},
        ]
        check("--off 后 project.config.json == 基线 + 两条 ai/agent 排除项",
              conf_off == expected_off,
              json.dumps(conf_off.get("packOptions"), ensure_ascii=False))
        check("--off 的 ignore 精确含 {type:folder,value:ai} 与 {type:folder,value:agent}",
              {"type": "folder", "value": "ai"} in ignore_entries(conf_off)
              and {"type": "folder", "value": "agent"} in ignore_entries(conf_off))
        check("--off 保留用户原有 ignore 条目（顺序不变）",
              ignore_entries(conf_off)[:2] == base_conf["packOptions"]["ignore"])
        check("--off 未改动 packOptions.include",
              conf_off["packOptions"]["include"] == base_conf["packOptions"]["include"])
        app_now, conf_now, _n = backup_counts(backup_dir)
        check("--off 新增 app.json + project.config.json 各 1 个备份",
              app_now == app_bak0 + 2 and conf_now == conf_bak0 + 1,
              backups(backup_dir))
        conf_bak = latest_backup(backup_dir, "project.config.json")
        check("--off 备份内容 = 改动前 project.config.json",
              conf_bak is not None and jload(conf_bak) == base_conf)
        app_bak = latest_backup(backup_dir, "app.json")
        check("--off 备份内容 = 改动前（开启态）app.json",
              app_bak is not None and jload(app_bak) == app_on_sem)
        app_off_bytes = jbytes(app_path)
        conf_off_bytes = jbytes(conf_path)

        rc, out = toggle("--status")
        check("关闭态 status 显示「ai: 已排除」", "ai: 已排除" in out, out)
        check("关闭态 status 显示「agent: 已排除」", "agent: 已排除" in out, out)
        check("关闭态 status 显示「AI 分包: 未启用」", "AI 分包: 未启用" in out, out)

        # ---------- 4. 幂等：再次 --off 应 no-op ----------
        n_before = len(backups(backup_dir))
        rc, out = toggle("--off")
        check("再次 --off 退出码 0", rc == 0, out)
        check("再次 --off 提示「已是关闭状态，无需修改」",
              "已是关闭状态，无需修改" in out, out)
        check("再次 --off 不写文件（两文件字节不变）",
              jbytes(app_path) == app_off_bytes and jbytes(conf_path) == conf_off_bytes)
        check("再次 --off 不产生备份", len(backups(backup_dir)) == n_before,
              backups(backup_dir))

        # ---------- 5. --on：完整恢复 ----------
        rc, out = toggle("--on")
        check("恢复 --on 退出码 0", rc == 0, out)
        check("恢复 --on 输出含「已开启 AI 配置」", "已开启 AI 配置" in out, out)
        check("恢复 --on 后 app.json 语义 == 首次开启态", jload(app_path) == app_on_sem)
        check("恢复 --on 后 app.json 字节 == 首次开启态", jbytes(app_path) == app_on_bytes)
        check("恢复 --on 后 project.config.json 语义 == 基线（ignore 无 ai/agent，用户条目保留）",
              jload(conf_path) == base_conf)
        check("恢复 --on 后 project.config.json 字节 == 基线",
              jbytes(conf_path) == base_conf_bytes)
        check("恢复 --on 新增 2 个备份（app + project.config）",
              len(backups(backup_dir)) == n_before + 2, backups(backup_dir))

        # ---------- 6. 幂等：再次 --on 应 no-op ----------
        n_before = len(backups(backup_dir))
        on_bytes = jbytes(app_path)
        conf_bytes = jbytes(conf_path)
        rc, out = toggle("--on")
        check("再次 --on 退出码 0", rc == 0, out)
        check("再次 --on 提示「已是开启状态，无需修改」",
              "已是开启状态，无需修改" in out, out)
        check("再次 --on 不写文件（两文件字节不变）",
              jbytes(app_path) == on_bytes and jbytes(conf_path) == conf_bytes)
        check("再次 --on 不产生备份", len(backups(backup_dir)) == n_before)

        # ---------- 7. 部分状态：app 已关但 ignore 被清掉 → --off 应补写 ----------
        rc, out = toggle("--off")
        check("回到关闭态（为部分状态测试准备）",
              rc == 0 and not has_ai(jload(app_path)), out)
        stale = jload(conf_path)
        stale["packOptions"]["ignore"] = [
            e for e in stale["packOptions"]["ignore"]
            if not (isinstance(e, dict) and e.get("type") == "folder"
                    and e.get("value") in ("ai", "agent"))
        ]
        write_conf_style(conf_path, stale)
        app_bytes_before = jbytes(app_path)
        n_before = len(backups(backup_dir))
        rc, out = toggle("--off")
        check("app 已关、ignore 缺失时 --off 退出码 0", rc == 0, out)
        check("…输出含「已写入 packOptions.ignore 排除项」",
              "已写入 packOptions.ignore 排除项" in out, out)
        check("…不再提示「已是关闭状态，无需修改」",
              "已是关闭状态，无需修改" not in out, out)
        check("…app.json 未被改动（字节不变）", jbytes(app_path) == app_bytes_before)
        check("…ignore 重新包含 ai/agent folder 项",
              {"type": "folder", "value": "ai"} in ignore_entries(jload(conf_path))
              and {"type": "folder", "value": "agent"} in ignore_entries(jload(conf_path)))
        check("…只新增 1 个 project.config.json 备份",
              len(backups(backup_dir)) == n_before + 1
              and backups(backup_dir)[-1].startswith("project.config.json.bak-"),
              backups(backup_dir))

        # ---------- 8. 防御：解析失败 / 缺失时不写盘 ----------
        app_before = jbytes(app_path)
        conf_before = jbytes(conf_path)

        conf_path.write_bytes(b'{ "packOptions": broken ')
        rc, out = toggle("--off")
        check("project.config.json 损坏时 --off 拒绝执行（非 0）", rc != 0, out)
        check("…app.json 未被修改", jbytes(app_path) == app_before)
        check("…损坏文件保持原样", jbytes(conf_path) == b'{ "packOptions": broken ')
        conf_path.write_bytes(conf_before)

        app_path.write_bytes(b'{ "pages": broken ')
        rc, out = toggle("--on")
        check("app.json 损坏时 --on 拒绝执行（非 0）", rc != 0, out)
        check("…project.config.json 未被修改", jbytes(conf_path) == conf_before)
        app_path.write_bytes(app_before)

        missing_conf = temp / "project.config.json.missing"
        conf_path.rename(missing_conf)
        rc, out = toggle("--off")
        check("project.config.json 缺失时 --off 拒绝执行（非 0）", rc != 0, out)
        check("…app.json 未被修改", jbytes(app_path) == app_before)
        missing_conf.rename(conf_path)

        agent_dir = proj / "agent"
        agent_stash = temp / "agent_stash"
        agent_dir.rename(agent_stash)
        app_before = jbytes(app_path)
        conf_before = jbytes(conf_path)
        rc, out = toggle("--on")
        check("agent/ 缺失时 --on 拒绝执行（非 0）", rc != 0, out)
        check("…输出含「拒绝开启」", "拒绝开启" in out, out)
        check("…app.json / project.config.json 均未被修改",
              jbytes(app_path) == app_before and jbytes(conf_path) == conf_before)
        agent_stash.rename(agent_dir)

        # 防御测试后状态完好：仍可正常 --status
        rc, out = toggle("--status")
        check("防御测试后 --status 仍可正常执行", rc == 0 and "AI 分包:" in out, out)
    finally:
        try:
            shutil.rmtree(temp, ignore_errors=True)
        except Exception:
            pass

    # ---------- 9. 真实项目 / 真实备份目录零改动 ----------
    check("真实项目 app.json 未被测试修改", sha(SRC / "app.json") == real_app_before)
    check("真实项目 project.config.json 未被测试修改",
          sha(SRC / "project.config.json") == real_conf_before)
    check("真实 _backup_ai_toggle 未被测试写入",
          backups(REAL_BACKUP_DIR) == real_backup_before, backups(REAL_BACKUP_DIR))
    check("%TEMP% 测试副本已清理", not temp.exists(), temp)

    print()
    if FAILS:
        print(f"===== 结果：{PASS} PASS / {len(FAILS)} FAIL =====")
        for name, _detail in FAILS:
            print("  FAILED:", name)
        return 1
    print(f"===== 结果：{PASS} PASS / 0 FAIL —— ALL PASS =====")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
