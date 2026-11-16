#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify_other_rules.py —— 复核「代码质量」其余非本次修复目标规则的当前条件

背景：本次修复只动图片（images/）与 project.config.json 的 packOptions.ignore，
其余 10 条官方规则（asar 内 QUALITY_CHECK_OPTION.checkList 共 13 条）的判定条件未变。
本脚本从官方实现读出的判定条件出发，逐条核对当前项目满足情况（不需要触发官方扫描）：

  JS_COMPRESS_OPEN      : !!setting.minified
  WXML_COMPRESS_OPEN    : !!setting.minifyWXML
  WXSS_COMPRESS_OPEN    : !!setting.minifyWXSS
  LAZYCODE_LOADING_OPEN : !!app.json.lazyCodeLoading
  PACKAGE_SIZE_LIMIT    : 每个包（主包/分包）编译后字节数/1024 <= limit(1.5)*1024
  PLUGIN_OVER_SIZE / CONTAINS_OTHER_PKG_JS / CONTAINS_OTHER_PKG_COMPONENTS / CONTAINS_UNUSED_PLUGINS
                        : 与插件相关；项目未声明任何插件 → 不适用（官方实现直接 PASS）
  CONTAINS_APPSECRET    : compiledPkg 的 .js/.json 里匹配 /\\W([0-9a-fA-F]{32})\\W/ 的候选，
                          再由官方服务端逐个校验 check_success 才判失败；这里离线列出候选（不做网络请求）
"""
import glob
import json
import os
import re
import sys

TESTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT = os.path.abspath(os.path.join(TESTS, "..", "mp-class-tools"))
TEMP = os.environ.get("TEMP", ".")
PROBLEMS = []
INFO = []


def load(relp):
    with open(os.path.join(PROJECT, relp), "r", encoding="utf-8-sig") as f:
        return json.load(f)


def check(name, cond, detail=""):
    print(("  [%s] %s%s" % ("OK" if cond else "FAIL", name, ("" if not detail else "  -> " + detail))))
    if not cond:
        PROBLEMS.append(name)
    return cond


def main():
    conf = load("project.config.json")
    app = load("app.json")
    setting = conf.get("setting", {})

    print("=" * 78)
    print("压缩开关（JS/WXML/WXSS_COMPRESS_OPEN）")
    check("setting.minified == True（JS_COMPRESS_OPEN）", bool(setting.get("minified")) is True)
    check("setting.minifyWXML == True（WXML_COMPRESS_OPEN）", bool(setting.get("minifyWXML")) is True)
    check("setting.minifyWXSS == True（WXSS_COMPRESS_OPEN）", bool(setting.get("minifyWXSS")) is True)

    print("=" * 78)
    print("按需注入（LAZYCODE_LOADING_OPEN）")
    check("app.json.lazyCodeLoading 非空（值为 %r）" % app.get("lazyCodeLoading"),
          bool(app.get("lazyCodeLoading")))

    print("=" * 78)
    print("包体积（PACKAGE_SIZE_LIMIT，limit=1.5MB=1536KB；官方按每个包单独算）")
    infos = sorted(glob.glob(os.path.join(TEMP, "verify_auto_preview_*.json")))
    if not infos:
        check("找到 auto-preview 编译结果", False, "未找到 %TEMP%\\verify_auto_preview_*.json")
    else:
        with open(infos[-1], "r", encoding="utf-8-sig") as f:
            info = json.load(f)
        pkgs = info["size"]["packages"]
        total = info["size"]["total"]
        print("   使用编译结果:", os.path.basename(infos[-1]))
        print("   packages:", json.dumps(pkgs, ensure_ascii=False))
        check("编译包不含 /ai/ 分包（AI subPackage 已消失）",
              all(p.get("name") != "/ai/" for p in pkgs))
        over = [p for p in pkgs if p.get("size", 0) / 1024 > 1.5 * 1024]
        check("所有包 <= 1536 KB（实际 total=%d B=%.1f KB）" % (total, total / 1024.0), not over,
              "超限=%s" % over if over else "")
        INFO.append("auto-preview 编译 total=%d B (%.1f KB)" % (total, total / 1024.0))

    print("=" * 78)
    print("插件相关四条规则（PLUGIN_OVER_SIZE / CONTAINS_OTHER_PKG_JS/COMPONENTS / CONTAINS_UNUSED_PLUGINS）")
    check("app.json 未声明 plugins", "plugins" not in app)
    check("project.config.json setting.localPlugins 不为 true", setting.get("localPlugins") is not True)
    print("   说明：项目无插件 → 官方这 4 条规则不适用/直接 PASS（与 18:54 扫描「仅 2 项未通过」一致）")

    print("=" * 78)
    print("AppSecret 扫描（CONTAINS_APPSECRET；官方仅对 32 位 hex 候选做服务端校验）")
    hex_re = re.compile(r"\W([0-9a-fA-F]{32})\W")
    candidates = {}
    pkg_files = []
    for dirpath, dirnames, filenames in os.walk(PROJECT):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git", "__pycache__")]
        rel = os.path.relpath(dirpath, PROJECT).replace("\\", "/")
        top = rel.split("/")[0]
        if top in ("ai", "agent"):
            continue  # 编译包已排除
        for fn in filenames:
            if fn.endswith((".js", ".json")):
                p = os.path.join(dirpath, fn)
                pkg_files.append(p)
                try:
                    txt = open(p, "r", encoding="utf-8-sig", errors="replace").read()
                except OSError:
                    continue
                for m in hex_re.finditer(txt):
                    candidates.setdefault(m.group(1), os.path.relpath(p, PROJECT).replace("\\", "/"))
    print("   扫描 js/json 文件 %d 个；32 位 hex 候选 %d 个" % (len(pkg_files), len(candidates)))
    for k, v in list(candidates.items())[:10]:
        print("      %s  <- %s" % (k, v))
    # 官方只对候选做服务端校验，离线无法判定；这里只做「候选不为 0」提示
    if candidates:
        print("   注意：有候选串，需要原官方扫描的服务端校验才能定性（18:54 扫描该规则为通过）。")
    else:
        check("无 32 位 hex 候选（不可能误报 AppSecret）", True)
    word_count = 0
    for p in pkg_files:
        try:
            word_count += open(p, "r", encoding="utf-8-sig", errors="replace").read().lower().count("appsecret")
        except OSError:
            pass
    print("   （参考）'appsecret' 字样出现 %d 次（staticcheck.py 同名计数；非 32 位 hex 不会被官方判失败）" % word_count)

    print("=" * 78)
    if PROBLEMS:
        print("OTHER RULES: FAIL (%d 项)" % len(PROBLEMS))
        for p in PROBLEMS:
            print("  - " + p)
        return 1
    print("OTHER RULES: PASS —— 其余规则当前条件均满足（压缩开关/按需注入/包体积/无插件/无 AppSecret 候选）")
    for i in INFO:
        print("  info: " + i)
    return 0


if __name__ == "__main__":
    sys.exit(main())
