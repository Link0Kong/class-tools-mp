#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ai_toggle.py —— 开发/发版切换：班级工具站小程序的「微信 AI 开发模式」配置

背景：
    微信 AI 开发模式（小程序 AI / 微信AI操作）目前是内测 beta，官方明确「暂未开放代码提审」。
    日常开发/体验可以保留 AI 适配；正式版本提审前若不想带 AI 配置，可用本脚本临时关闭，
    发版后再打开（源码目录 ai/、agent/ 始终保留，不会删除任何文件）。

    --off 同时做两件事：
      1) 从 <project>/app.json 移除 subPackages(/ai/) 与 agent 字段；
      2) 向 <project>/project.config.json 的 packOptions.ignore 增补两条 folder 排除项
         {"type":"folder","value":"ai"}、{"type":"folder","value":"agent"}，
         使 ai/、agent/ 不再进入微信开发者工具的编译包（「代码质量」的
         CONTAINS_UNUSED_COMPONENTS 不再把这 19 个 ai 组件算作「无使用组件」）。
    --on 精确撤销以上两项：恢复 app.json 的 AI 配置，并只删除本脚本写入的 ai/agent
        ignore 条目（用户已有的 ignore/include 条目原样保留）。

用法（任意目录）：
    python ai_toggle.py --status
    python ai_toggle.py --off      # 关闭 AI 配置 + 把 ai/、agent/ 排除出编译包（先备份）
    python ai_toggle.py --on       # 重新写入 8 个 SKILL 的 subPackages + agent 配置，并移除排除项
    python ai_toggle.py --project <小程序项目目录> --status   # 在副本上演练（默认 mp-class-tools）
    python ai_toggle.py --off --backup-dir <备份目录>          # 指定备份目录（自动化测试用）

说明：
    * 只改 <project>/app.json 与 <project>/project.config.json；每次写入前备份到
      _backup_ai_toggle/（app.json -> app.json.bak-<时间戳>；project.config.json ->
      project.config.json.bak-<时间戳>，同秒冲突自动加 -2、-3… 后缀）。
    * 两个 JSON 任一解析失败都直接退出、不写任何文件；未知字段、已有 ignore/include 条目原样保留。
    * --on 会先校验 ai/skills/*、agent/AGENTS.md、agent/page-meta.json 是否存在，缺失则拒绝。
    * 写回 JSON 保持 indent=2、UTF-8、原换行风格（CRLF/LF）并补末尾换行。
"""
import argparse
import json
import shutil
import sys
import time
from pathlib import Path

DEFAULT_MP = Path(__file__).resolve().parent.parent / "mp-class-tools"
MP = DEFAULT_MP
APP_JSON = MP / "app.json"
CONF_JSON = MP / "project.config.json"
BACKUP_DIR = Path(__file__).resolve().parent / "_backup_ai_toggle"

SKILLS = [
    ("classIdentity", "班级身份、名单、班委、我的数据概览、工作台总览、工具目录与使用说明", "ai/skills/identity"),
    ("homework", "作业：待交/已完成/详情/发布/删除/完成标记", "ai/skills/homework"),
    ("notice", "班级通知：简报/列表/详情/已处理/置顶", "ai/skills/notice"),
    ("timetable", "课表：本周/指定周/今天/下一节/课程详情/开学日期", "ai/skills/timetable"),
    ("lottery", "抽签、补抽、剔除、分组、结果单（三步工作流）", "ai/skills/lottery"),
    ("fitness", "体测：单项评分/总分/国标表/历史记录", "ai/skills/fitness"),
    ("rollCall", "点名：名单、到/假、统计、重置", "ai/skills/roll"),
    ("myAccount", "我的：同步状态/数据概览/导出/清除/反馈/访问统计", "ai/skills/account"),
]
AI_SUBPACKAGE = {"root": "ai", "independent": True, "pages": []}
IGNORE_FOLDERS = ("ai", "agent")
AI_IGNORE_ENTRIES = [{"type": "folder", "value": name} for name in IGNORE_FOLDERS]


# ---------------------------------------------------------------- 读写 & 备份

def _read_text(path):
    try:
        return path.read_bytes().decode("utf-8-sig")
    except UnicodeDecodeError as e:
        sys.exit(f"[ai_toggle] {path.name} 无法按 UTF-8 读取（未写盘）：{e}")


def load_json(path, label):
    if not path.exists():
        sys.exit(f"[ai_toggle] 找不到 {label}：{path}")
    try:
        return json.loads(_read_text(path))
    except SystemExit:
        raise
    except Exception as e:
        sys.exit(f"[ai_toggle] {label} 解析失败（未写盘）：{e}")


def load_app():
    return load_json(APP_JSON, "app.json")


def load_conf():
    return load_json(CONF_JSON, "project.config.json")


def load_conf_lenient():
    """--status 用：配置缺失/损坏时不退出，返回 (dict|None, 说明)。"""
    if not CONF_JSON.exists():
        return None, "缺失"
    try:
        return json.loads(_read_text(CONF_JSON)), "OK"
    except SystemExit:
        return None, "无法按 UTF-8 读取"
    except Exception as e:
        return None, f"解析失败：{e}"


def backup(path):
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dst = BACKUP_DIR / f"{path.name}.bak-{stamp}"
    seq = 2
    while dst.exists():
        dst = BACKUP_DIR / f"{path.name}.bak-{stamp}-{seq}"
        seq += 1
    shutil.copy2(path, dst)
    return dst


def write_json(path, obj):
    """写回 JSON（indent=2 / UTF-8 / 保留原换行风格 / 末尾换行），写前备份。"""
    raw = path.read_bytes()
    newline = "\r\n" if b"\r\n" in raw else "\n"
    text = json.dumps(obj, ensure_ascii=False, indent=2).replace("\n", newline) + newline
    bak = backup(path)
    path.write_bytes(text.encode("utf-8"))
    return bak


# ---------------------------------------------------------------- app.json

def ai_subpackage(app):
    for p in app.get("subPackages") or []:
        if isinstance(p, dict) and p.get("root") == "ai":
            return p
    return None


def ai_enabled(app):
    return bool(app.get("agent")) or ai_subpackage(app) is not None


def missing_required():
    missing = []
    for _name, _desc, path in SKILLS:
        for f in ("SKILL.md", "mcp.json", "index.js"):
            if not (MP / path / f).exists():
                missing.append(f"{path}/{f}")
    for f in ("agent/AGENTS.md", "agent/page-meta.json"):
        if not (MP / f).exists():
            missing.append(f)
    return missing


def enable(app):
    missing = missing_required()
    if missing:
        sys.exit("[ai_toggle] 拒绝开启，缺少文件：\n  " + "\n  ".join(missing))
    subs = [p for p in (app.get("subPackages") or []) if not (isinstance(p, dict) and p.get("root") == "ai")]
    subs.insert(0, dict(AI_SUBPACKAGE))
    app["subPackages"] = subs
    app["agent"] = {
        "instruction": "agent/AGENTS.md",
        "pageMetadata": "agent/page-meta.json",
        "skills": [{"name": n, "description": d, "path": p} for n, d, p in SKILLS],
    }
    app.setdefault("lazyCodeLoading", "requiredComponents")
    return app


def disable(app):
    app.pop("agent", None)
    subs = [p for p in (app.get("subPackages") or []) if not (isinstance(p, dict) and p.get("root") == "ai")]
    if subs:
        app["subPackages"] = subs
    else:
        app.pop("subPackages", None)
    return app


# ---------------------------------------------------------------- project.config.json packOptions.ignore

def _ignore_list(conf, create=False):
    """取 packOptions.ignore 列表；create=True 时按需补出 packOptions/ignore。结构异常直接拒绝。"""
    pack = conf.get("packOptions")
    if pack is None:
        if not create:
            return None
        pack = conf["packOptions"] = {}
    if not isinstance(pack, dict):
        sys.exit("[ai_toggle] project.config.json 的 packOptions 不是对象，拒绝修改（未写盘）")
    ignore = pack.get("ignore")
    if ignore is None:
        if not create:
            return None
        ignore = pack["ignore"] = []
    if not isinstance(ignore, list):
        sys.exit("[ai_toggle] project.config.json 的 packOptions.ignore 不是数组，拒绝修改（未写盘）")
    return ignore


def _is_ai_ignore(entry):
    return (
        isinstance(entry, dict)
        and entry.get("type") == "folder"
        and entry.get("value") in IGNORE_FOLDERS
    )


def ignore_present(conf):
    """返回 packOptions.ignore 中已存在的 ai/agent folder 排除项（按 IGNORE_FOLDERS 顺序）。"""
    ignore = _ignore_list(conf) or []
    present = {e["value"] for e in ignore if _is_ai_ignore(e)}
    return [name for name in IGNORE_FOLDERS if name in present]


def add_ai_ignore(conf):
    """向 packOptions.ignore 末尾增补缺失的 ai/agent folder 条目（去重），返回新增的 value 列表。"""
    ignore = _ignore_list(conf, create=True)
    present = set(ignore_present(conf))
    added = []
    for name in IGNORE_FOLDERS:
        if name not in present:
            ignore.append({"type": "folder", "value": name})
            added.append(name)
    return added


def remove_ai_ignore(conf):
    """只移除 ai/agent folder 排除项，用户其他 ignore 条目（含 include）不动，返回被移除的 value 列表。"""
    ignore = _ignore_list(conf)
    if not ignore:
        return []
    removed = [name for name in IGNORE_FOLDERS if name in {e["value"] for e in ignore if _is_ai_ignore(e)}]
    if removed:
        conf["packOptions"]["ignore"] = [e for e in ignore if not _is_ai_ignore(e)]
    return removed


def _folder_values_lenient(conf):
    try:
        pack = conf.get("packOptions")
        if not isinstance(pack, dict):
            return set()
        ignore = pack.get("ignore")
        if not isinstance(ignore, list):
            return set()
        return {e.get("value") for e in ignore if isinstance(e, dict) and e.get("type") == "folder"}
    except Exception:
        return set()


# ---------------------------------------------------------------- status

def dir_info(path):
    if not path.exists():
        return "不存在"
    if not path.is_dir():
        return "不是目录"
    count = sum(1 for p in path.rglob("*") if p.is_file())
    return f"存在（{count} 个文件）"


def backup_status():
    if not BACKUP_DIR.exists():
        print(f"备份目录: {BACKUP_DIR}（不存在，尚无备份）")
        return
    files = sorted(BACKUP_DIR.glob("*.bak-*"))
    print(f"备份目录: {BACKUP_DIR}（{len(files)} 个备份）")
    for f in files[-3:]:
        try:
            size = f.stat().st_size
        except OSError:
            size = -1
        print(f"  - {f.name}  {size} B")


def status(app, conf, conf_note="OK"):
    ai_sub = ai_subpackage(app)
    print("项目:", MP)
    print("app.json:", APP_JSON)
    print("project.config.json:", CONF_JSON)
    print("pages:", len(app.get("pages", [])))
    print("AI 分包:", "已启用" if ai_sub else "未启用")
    print("agent:", "已启用" if app.get("agent") else "未启用")
    if app.get("agent"):
        print("  instruction:", app["agent"].get("instruction"))
        print("  pageMetadata:", app["agent"].get("pageMetadata"))
        print("  skills:", len(app["agent"].get("skills", [])))
    if isinstance(conf, dict):
        names = _folder_values_lenient(conf)
        pack = conf.get("packOptions")
        ignore = pack.get("ignore") if isinstance(pack, dict) else None
        count = len(ignore) if isinstance(ignore, list) else 0
        print(
            f"packOptions.ignore: {count} 条（ai: {'已排除' if 'ai' in names else '未排除'}，"
            f"agent: {'已排除' if 'agent' in names else '未排除'}）"
        )
    else:
        print(f"packOptions.ignore: 无法读取（project.config.json {conf_note}）")
    print("ai/ 目录:", dir_info(MP / "ai"))
    print("agent/ 目录:", dir_info(MP / "agent"))
    for name, _desc, path in SKILLS:
        ok = (MP / path / "SKILL.md").exists() and (MP / path / "mcp.json").exists() and (MP / path / "index.js").exists()
        print(f"  - {name:14s} {path:22s} {'OK' if ok else 'MISSING'}")
    backup_status()


# ---------------------------------------------------------------- main

def main():
    global MP, APP_JSON, CONF_JSON, BACKUP_DIR
    parser = argparse.ArgumentParser(description="班级工具站 · 微信 AI 开发模式配置开关")
    g = parser.add_mutually_exclusive_group(required=True)
    g.add_argument("--on", action="store_true", help="写入 subPackages(/ai/) + agent 配置，并移除 ai/agent 编译排除项")
    g.add_argument("--off", action="store_true", help="移除 AI 配置并把 ai/、agent/ 排除出编译包（保留源码）")
    g.add_argument("--status", action="store_true", help="查看当前状态")
    parser.add_argument("--project", default="", help="小程序项目目录（默认 mp-class-tools；副本演练用）")
    parser.add_argument("--backup-dir", default="", help="备份目录（默认脚本旁 _backup_ai_toggle）")
    args = parser.parse_args()
    if args.project:
        MP = Path(args.project).resolve()
        APP_JSON = MP / "app.json"
        CONF_JSON = MP / "project.config.json"
    if args.backup_dir:
        BACKUP_DIR = Path(args.backup_dir).resolve()
    if not MP.is_dir():
        sys.exit(f"[ai_toggle] 项目目录不存在：{MP}")

    if args.status:
        app = load_app()
        conf, note = load_conf_lenient()
        status(app, conf, note)
        return 0

    app = load_app()
    conf = load_conf()

    if args.on:
        app_ready = bool(app.get("agent")) and ai_subpackage(app) is not None
        removed = remove_ai_ignore(conf)
        if app_ready and not removed:
            print("[ai_toggle] 已是开启状态，无需修改")
            status(app, conf)
            return 0
        if not app_ready:
            bak = write_json(APP_JSON, enable(app))
            print(f"[ai_toggle] 已开启 AI 配置；备份：{bak}")
        else:
            print("[ai_toggle] app.json 已是开启状态，未改动")
        if removed:
            bak = write_json(CONF_JSON, conf)
            print(f"[ai_toggle] 已移除 packOptions.ignore 排除项：{', '.join(removed)}；备份：{bak}")
        else:
            print("[ai_toggle] packOptions.ignore 无 ai/agent 排除项，未改动")
        status(load_app(), load_conf_lenient()[0])
        return 0

    if args.off:
        app_changed = ai_enabled(app)
        added = add_ai_ignore(conf)
        if not app_changed and not added:
            print("[ai_toggle] 已是关闭状态，无需修改")
            status(app, conf)
            return 0
        if app_changed:
            bak = write_json(APP_JSON, disable(app))
            print(f"[ai_toggle] 已移除 AI 配置（源码 ai/ 与 agent/ 保留）；备份：{bak}")
        else:
            print("[ai_toggle] app.json 已是关闭状态，未改动")
        if added:
            bak = write_json(CONF_JSON, conf)
            print(f"[ai_toggle] 已写入 packOptions.ignore 排除项：{', '.join(added)}；备份：{bak}")
        else:
            print("[ai_toggle] packOptions.ignore 已含 ai/agent 排除项，未改动")
        status(load_app(), load_conf_lenient()[0])
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
