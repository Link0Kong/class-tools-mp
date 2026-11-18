#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify_asar.py —— 独立从 DevTools app.asar 取证，复核 CODE_QUALITY_NOTES.md 的关键论断

不修改 app.asar；只读 + 解析 asar 头部 + 按偏移取出少量模块到 %TEMP% 做字符串核对。
校验点（全部对应本次修复的成败关键）：
  1. asar 头部可解析（files 条目数 / data_start 与笔记一致）
  2. qualityChecker（js/3b6b930…js）确实含 checkImageAndAudioSizeLimit / checkUnusedComponents /
     checkUnusedCodes 三个 handler
  3. QUALITY_CHECK_OPTION（js/9223b7e8….json）里 IMAGE_AND_AUDIO_LIMIT limit=200、扩展名表 18 项
  4. CodeDenpendencyQualityChecker（js/a3164a4a…js）的 checkUnusedComponents 遍历类型只有
     Page/Component/MainPackage/SubPackage（不含 Agent）；checkUnusedCodeFiles 的 setting 放行表达式
  5. SummerCompiler.filterFactory 同时应用 isIgnoredByRules(packOptions.ignore) 与
     isIgnoreByUnusedFiles(无依赖过滤)；packOptionsHelper.updateState 里 ignoreDevUnusedFiles/
     ignoreUploadUnusedFiles 的来源
  6. filerules.js 里 folder 规则的匹配实现（验证 {"type":"folder","value":"ai"} 会被识别为
     「路径以 ai/ 开头」，即本次写入 ignore 的格式有效）
  7. 质量扫描编译入口 resultType="dev"（compile task / getCompiledResult）
"""
import json
import os
import re
import struct
import sys

ASAR = r"C:\Program Files (x86)\Tencent\微信web开发者工具\resources\app.asar"
OUT = os.path.join(os.environ.get("TEMP", "."), "verify_asar_extract")
PROBLEMS = []


def parse_asar(path):
    with open(path, "rb") as f:
        head = f.read(16)
        u = struct.unpack("<4I", head)  # [4, header_pickle_size, payload2, json_len]
        assert u[0] == 4, "unexpected asar header[0]=%d" % u[0]
        header_pickle_size = u[1]
        json_len = u[3]
        f.seek(16)
        raw_json = f.read(json_len)
        header = json.loads(raw_json.decode("utf-8"))
    data_start = 8 + header_pickle_size
    return header, data_start, header_pickle_size, json_len


def get_entry(header, asar_path):
    node = header
    parts = [p for p in asar_path.split("/") if p]
    for p in parts:
        node = node["files"][p]
    return node


def read_module(f, data_start, header, asar_path):
    ent = get_entry(header, asar_path)
    if "size" not in ent:
        return None
    f.seek(data_start + int(ent["offset"]))
    return f.read(int(ent["size"]))


def count_files(node):
    n = 0
    if "files" in node:
        for v in node["files"].values():
            n += count_files(v)
    else:
        n += 1
    return n


def snippet(text, needle, before=80, after=520):
    i = text.find(needle)
    if i < 0:
        return None
    return text[max(0, i - before): i + len(needle) + after]


def check(name, cond, detail=""):
    print(("  [%s] %s%s" % ("OK" if cond else "FAIL", name, ("" if not detail else "  -> " + detail))))
    if not cond:
        PROBLEMS.append(name)
    return cond


def main():
    print("=" * 78)
    print("0. asar 头部解析")
    header, data_start, hps, jlen = parse_asar(ASAR)
    nfiles = count_files(header)
    print("   data_start=%d header_pickle_size=%d json_len=%d files=%d" % (data_start, hps, jlen, nfiles))
    check("asar 可解析且 files 条目数与笔记(30,831)一致", nfiles == 30831, "actual=%d" % nfiles)
    check("data_start 与笔记(8,111,404)一致", data_start == 8111404, "actual=%d" % data_start)

    os.makedirs(OUT, exist_ok=True)
    mods = {
        "qualityChecker": "js/3b6b93029b234f57c8b150f8796c7aef.js",
        "qcOptionJson": "js/9223b7e8fdc904a1d4c72f9829351a93.json",
        "depChecker": "js/a3164a4a59bfa8f8b04e4f49fdd1d52e.js",
        "baseCodeQuality": "js/38e3192aa3ebeac77282a639969ddde0.js",
        "getCompiledResult": "js/404a7ad98cd64f16ad7d64d414e3d3f4.js",
        "compileTask": "js/96e2c678762ca81d19246b2ba1cdbc0d.js",
        "summerCompiler": "js/common/miniprogram-builder/modules/corecompiler/summerCompiler.js",
        "packOptionsHelper": "js/common/miniprogram-builder/utils/packOptionsHelper.js",
        "filerules": "js/common/miniprogram-builder/utils/filerules.js",
        "builderIndex": "js/common/miniprogram-builder/modules/index.js",
        "analyzer": "js/2284d089bdc8a13a71ccd7d868ed4f83.js",
    }
    blobs = {}
    with open(ASAR, "rb") as f:
        for k, p in mods.items():
            b = read_module(f, data_start, header, p)
            if b is None:
                PROBLEMS.append("asar 内找不到模块 %s" % p)
                print("  [FAIL] 模块缺失:", p)
                continue
            blobs[k] = b
            print("   取出 %-18s %6d B  %s" % (k, len(b), p))

    # 落盘到 %TEMP% 便于人工复核（不写工作区）
    for k, b in blobs.items():
        ext = ".json" if k == "qcOptionJson" else ".js"
        with open(os.path.join(OUT, k + ext), "wb") as f:
            f.write(b)

    print("=" * 78)
    print("1. qualityChecker 三个 handler")
    qc = blobs["qualityChecker"].decode("utf-8", "replace")
    check("qualityChecker 含 checkImageAndAudioSizeLimit", "checkImageAndAudioSizeLimit" in qc)
    check("qualityChecker 含 checkUnusedComponents", "checkUnusedComponents" in qc)
    check("qualityChecker 含 checkUnusedCodes", "checkUnusedCodes" in qc)
    print("   checkImageAndAudioSizeLimit 片段:")
    print("   " + (snippet(qc, "checkImageAndAudioSizeLimit", 20, 380) or "").replace("\n", "\n   "))

    print("=" * 78)
    print("2. QUALITY_CHECK_OPTION：limit=200 / 扩展名表")
    opt = json.loads(blobs["qcOptionJson"].decode("utf-8"))
    img = next((x for x in opt.get("checkList", []) if x.get("name") == "IMAGE_AND_AUDIO_LIMIT"), None)
    regs = (opt.get("regList") or {}).get("IMAGE_AND_AUDIO_LIMIT", [])
    print("   IMAGE_AND_AUDIO_LIMIT =", json.dumps(img, ensure_ascii=False))
    print("   regList =", json.dumps(regs, ensure_ascii=False), " (%d 项)" % len(regs))
    check("limit == 200", bool(img) and img.get("limit") == 200)
    check("扩展名表 18 项且与本项目口径一致", len(regs) == 18)

    print("=" * 78)
    print("3. CodeDenpendencyQualityChecker：未使用组件/无依赖文件判定")
    dep = blobs["depChecker"].decode("utf-8", "replace")
    for needle in ["checkUnusedComponents", "checkUnusedCodeFiles"]:
        check("depChecker 含 %s" % needle, needle in dep)
    print("   checkUnusedComponents 片段:")
    print("   " + (snippet(dep, "checkUnusedComponents", 20, 700) or "").replace("\n", "\n   "))
    check("checkUnusedComponents 类型过滤含 Page/Component/MainPackage/SubPackage",
          '"Page"' in dep and '"Component"' in dep and '"MainPackage"' in dep and '"SubPackage"' in dep)
    # Agent 是否参与 checkUnusedComponents 遍历：检查过滤片段里有无 Agent
    m = re.search(r'checkUnusedComponents[\s\S]{0,1200}', dep)
    if m:
        seg = m.group(0)
        check("checkUnusedComponents 遍历类型不含 Agent", "Agent" not in seg,
              "含 Agent" if "Agent" in seg else "不含（符合推断）")
    print("   setting 放行语义在 qualityChecker 文件里：")
    check("qualityChecker 含 ignoreDevUnusedFiles", "ignoreDevUnusedFiles" in qc)
    check("qualityChecker 含 ignoreUploadUnusedFiles", "ignoreUploadUnusedFiles" in qc)
    print("   " + (snippet(qc, "ignoreDevUnusedFiles", 240, 240) or "").replace("\n", "\n   "))
    check("checkUnusedCodes 放行表达式逐字一致",
          "!(!1===t.project.setting.ignoreDevUnusedFiles||!1===t.project.setting.ignoreUploadUnusedFiles)||c" in qc)

    print("=" * 78)
    print("3b. 分析器 Agent 模块：agent.skills 目录下的 component:true JSON 会变成 Component 依赖")
    an = blobs["analyzer"].decode("utf-8", "replace")
    print("   analyzer 大小:", len(blobs["analyzer"]), "B")
    check("analyzer 含 Agent 模块类", "Agent:classextends" in an.replace(" ", ""))
    i = an.find("isComponentJson")
    print("   Agent.build 片段:")
    print("   " + (an[max(0, i - 700): i + 500] or "").replace("\n", "\n   "))
    check("Agent.build 对 component:true 的 JSON 调用 addDep（生成 Component 依赖）",
          "isComponentJson" in an and bool(re.search(r'isComponentJson\(e\)\)\{r\.add\(e\);[\s\S]{0,120}addDep', an)))

    print("=" * 78)
    print("4. 编译链：filterFactory 同时应用 packOptions.ignore 与无依赖过滤")
    sc = blobs["summerCompiler"].decode("utf-8", "replace")
    for needle in ["filterFactory", "isIgnoredByRules", "isIgnoreByUnusedFiles", "initUnusedFiles", "resultType"]:
        check("summerCompiler 含 %s" % needle, needle in sc)
    m = re.search(r'async filterFactory\(', sc)
    if m:
        print("   filterFactory 原文:")
        print("   " + sc[m.start(): m.start() + 900].replace("\n", "\n   "))
    else:
        PROBLEMS.append("summerCompiler 未找到 async filterFactory 定义")
    check('filterFactory 里 packOptions.ignore 分支 = EFilterCode.PackOptionsIgnore',
          bool(re.search(r'isIgnoredByRules\([^)]*\)\?[^:]{0,60}PackOptionsIgnore', sc)))
    check('filterFactory 里无依赖过滤分支 = EFilterCode.AnalyseNoUse',
          bool(re.search(r'isIgnoreByUnusedFiles\([^)]*\)\?[^:]{0,60}AnalyseNoUse', sc)))

    print("=" * 78)
    print("5. packOptionsHelper：ignoreDev/ignoreUpload 取值")
    ph = blobs["packOptionsHelper"].decode("utf-8", "replace")
    for needle in ["updateState", "ignoreDevUnusedFiles", "ignoreUploadUnusedFiles", "initUnusedFiles", "isIgnoreByUnusedFiles", "isIgnoredByRules"]:
        check("packOptionsHelper 含 %s" % needle, needle in ph)
    print("   updateState/isUnuserFilesEnable 片段:")
    print("   " + (snippet(ph, "ignoreDevUnusedFiles", 400, 500) or "").replace("\n", "\n   "))
    print("   isIgnoredByRules 片段:")
    print("   " + (snippet(ph, "isIgnoredByRules", 40, 700) or "").replace("\n", "\n   "))
    print("   isUnuserFilesEnable（无依赖过滤开关语义）片段:")
    m = re.search(r'isUnuserFilesEnable\([^)]*\)\{[^}]*\}', ph)
    if m:
        print("   " + m.group(0))
    check("isUnuserFilesEnable 语义：dev 分支为「未显式 false 即过滤」",
          bool(m) and "!0===this.ignoreDevUnusedFiles||!1!==this.ignoreDevUnusedFiles" in m.group(0))
    check("isUnuserFilesEnable 语义：prod 分支为「显式 true 才过滤」",
          bool(m) and "!1!==this.ignoreUploadUnusedFiles" in m.group(0))
    check("updateState 从 project.packOptions.ignore 读取 packOptionIgnores",
          bool(re.search(r'this\.packOptionIgnores=\(null===?\(s=e\.packOptions\)', ph)) or
          "packOptionIgnores=(null===(s=e.packOptions)" in ph)

    print("=" * 78)
    print("6. filerules：folder 规则匹配实现（校验 ignore 条目格式）")
    fr = blobs["filerules"].decode("utf-8", "replace")
    print("   filerules 全文（%d B）:" % len(fr))
    print("   " + fr.replace("\n", "\n   ")[:4200])
    check("filerules 支持 folder/prefix/suffix/glob/regexp",
          all(k in fr for k in ['"folder"', '"prefix"', '"suffix"', '"glob"', '"regexp"']))
    folder_ok = bool(re.search(r'"folder"===t\.type\)\{?n=leading\(e,"/"\)\.startsWith\(trailing\(leading\(l,"/"\),"/"\)\)', fr.replace(" ", "")))
    check('folder 规则 = path 以 "/{value}/" 为前缀（ai/agent 的 folder 条目会被识别）', folder_ok)
    if not folder_ok:
        PROBLEMS.append("filerules 的 folder 匹配实现未按预期匹配到")

    print("=" * 78)
    print("7. 质量扫描编译入口 resultType")
    gcr = blobs["getCompiledResult"].decode("utf-8", "replace")
    ct = blobs["compileTask"].decode("utf-8", "replace")
    print("   getCompiledResult:", gcr[:700].replace("\n", " "))
    print("   compileTask 含 resultType:", "resultType" in ct)
    check('getCompiledResult 里 resultType 为 "dev"', re.search(r'resultType\s*[:=]\s*"dev"', gcr) is not None)
    print("   baseCodeQuality getCompileResultAndCheckWithProxyFunc 片段:")
    print("   " + (snippet(blobs["baseCodeQuality"].decode("utf-8", "replace"),
                        "getCompileResultAndCheckWithProxyFunc", 20, 500) or "").replace("\n", "\n   "))

    print("=" * 78)
    if PROBLEMS:
        print("ASAR VERIFY: FAIL (%d 项)" % len(PROBLEMS))
        for p in PROBLEMS:
            print("  - " + p)
        return 1
    print("ASAR VERIFY: PASS —— 笔记关键论断与 asar 原文一致；packOptions.ignore folder 格式有效")
    return 0


if __name__ == "__main__":
    sys.exit(main())
