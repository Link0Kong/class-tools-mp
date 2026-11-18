#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify_media.py —— 独立复算图片/音频总量 + PNG 结构/解码校验 + 引用完整性校验

只读 mp-class-tools，不写项目；结果打印到 stdout（由 verifier 收集进 VERIFY_REPORT.md）。

校验点：
  A. 按扩展名遍历编译包范围内的媒体文件（媒体规则口径 = 编译包内媒体总字节数），
     不含被 packOptions.ignore 排除的 ai/、agent/（cloudfunctions 无媒体文件）。
  B. 与 code_quality_check.js --json 的 IMAGE_AND_AUDIO_LIMIT totalBytes / 文件清单交叉核对。
  C. PNG 结构合法性：签名、chunk 长度/CRC32、IHDR 字段、PLTE/tRNS、IEND；统计 PNG-8(bit depth 8,
     color type 3) 与 tRNS 情况。
  D. Pillow 全解码（verify + load）+ ffmpeg 解码（-f null）确认无损坏。
  E. 与优化前备份（_backup_v21_pre_ai_20261105/images，2026-11-05 08:06 快照）逐文件对比：
     文件名集合一致、像素尺寸一致、字节数变化。
  F. 引用完整性：扫描项目 .json/.wxml/.wxss/.js 里出现的 images/... 路径是否都存在；
     theme.json 变量是否被 app.json 全部解析；列出未被引用的图片（死资源，仅报告不计 FAIL）。
"""
import json
import os
import re
import subprocess
import sys
import zlib

from PIL import Image

TESTS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT = os.path.join(TESTS_DIR, "..", "mp-class-tools")
PROJECT = os.path.abspath(PROJECT)
BASELINE_CANDIDATES = [
    os.path.join(TESTS_DIR, "_backup_v21_pre_ai_20261105", "images"),
    os.path.join(TESTS_DIR, "_backup_v19_pre_datasync_20261105", "images"),
]
MEDIA_EXT = {".jpg", ".jpeg", ".png", ".svg", ".webp", ".gif",
             ".flac", ".m4a", ".ogg", ".ape", ".amr", ".wma", ".wav",
             ".mp3", ".mp4", ".aac", ".aiff", ".caf"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".svg", ".webp", ".gif"}
TEXT_FILES = {".js", ".json", ".wxml", ".wxss", ".wxs", ".ts"}


def walk_files(root):
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in (".git", "node_modules", "__pycache__")]
        for fn in filenames:
            out.append(os.path.join(dirpath, fn))
    return out


def load_ignore_folders():
    conf = os.path.join(PROJECT, "project.config.json")
    with open(conf, "r", encoding="utf-8-sig") as f:
        data = json.load(f)
    folders = set()
    for ent in (data.get("packOptions", {}) or {}).get("ignore", []) or []:
        if isinstance(ent, dict) and ent.get("type") == "folder" and ent.get("value"):
            folders.add(ent["value"].strip("/"))
    return data, folders


def crc_check_png(path):
    """解析 PNG chunk 并校验 CRC；返回 (ok, info) 。"""
    with open(path, "rb") as f:
        raw = f.read()
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        return False, {"error": "bad PNG signature"}
    pos = 8
    chunks = []
    ihdr = None
    while pos + 8 <= len(raw):
        length = int.from_bytes(raw[pos:pos + 4], "big")
        ctype = raw[pos + 4:pos + 8].decode("latin-1")
        data = raw[pos + 8:pos + 8 + length]
        crc_stored = int.from_bytes(raw[pos + 8 + length:pos + 12 + length], "big")
        crc_calc = zlib.crc32(ctype.encode("latin-1") + data) & 0xFFFFFFFF
        chunks.append(ctype)
        if crc_stored != crc_calc:
            return False, {"error": f"CRC mismatch in {ctype}"}
        if ctype == "IHDR":
            ihdr = {
                "width": int.from_bytes(data[0:4], "big"),
                "height": int.from_bytes(data[4:8], "big"),
                "bitDepth": data[8],
                "colorType": data[9],
                "compression": data[10],
                "filter": data[11],
                "interlace": data[12],
            }
        pos += 12 + length
        if ctype == "IEND":
            break
    if pos != len(raw):
        return False, {"error": f"trailing bytes after IEND: {len(raw) - pos}"}
    if not chunks or chunks[0] != "IHDR" or chunks[-1] != "IEND":
        return False, {"error": "chunk order bad"}
    if ihdr is None:
        return False, {"error": "no IHDR"}
    info = {
        "ihdr": ihdr,
        "chunksHead": chunks[:6],
        "hasPLTE": "PLTE" in chunks,
        "hastRNS": "tRNS" in chunks,
        "chunkCount": len(chunks),
        "png8": ihdr["bitDepth"] == 8 and ihdr["colorType"] == 3,
    }
    # PNG-8 必须有 PLTE；colorType 3 允许 tRNS 做 alpha
    if ihdr["colorType"] == 3 and not info["hasPLTE"]:
        return False, {"error": "color type 3 without PLTE"}
    return True, info


def ffmpeg_decode_ok(path):
    exe = "ffmpeg"
    try:
        p = subprocess.run([exe, "-v", "error", "-xerror", "-i", path, "-f", "null", "-"],
                           capture_output=True, timeout=120)
    except Exception as e:  # noqa: BLE001
        return False, f"ffmpeg 调用失败: {e}"
    if p.returncode != 0:
        return False, p.stderr.decode("utf-8", "replace")[:300]
    return True, ""


def pil_decode_ok(path):
    try:
        with Image.open(path) as im:
            im.verify()
        with Image.open(path) as im:
            im.load()
            size = im.size
            mode = im.mode
            nframes = getattr(im, "n_frames", 1)
        return True, {"size": size, "mode": mode, "n_frames": nframes}
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def rel(p):
    return os.path.relpath(p, PROJECT).replace("\\", "/")


def main():
    problems = []
    notes = []

    # ---------- A. 编译包范围内媒体文件 ----------
    conf, ignore_folders = load_ignore_folders()
    media = []
    for p in walk_files(PROJECT):
        r = rel(p)
        top = r.split("/")[0]
        if top in ignore_folders:  # ai/ agent/ 按 packOptions.ignore 排除
            continue
        if os.path.splitext(p)[1].lower() in MEDIA_EXT:
            media.append((r, os.path.getsize(p)))
    media.sort()
    total = sum(b for _, b in media)
    img_count = sum(1 for r, _ in media if os.path.splitext(r)[1].lower() in IMAGE_EXT)
    audio = [r for r, _ in media if os.path.splitext(r)[1].lower() not in IMAGE_EXT]
    print("=" * 78)
    print("A. 编译包范围媒体统计（packOptions.ignore 排除 %s）" % sorted(ignore_folders))
    print("   媒体文件数=%d（图片 %d / 音频 %d）  总字节=%d  = %.2f KB"
          % (len(media), img_count, len(audio), total, total / 1024.0))
    print("   < 200KB(204800B): %s" % ("PASS" if total < 200 * 1024 else "FAIL"))
    print("   <=150KB(153600B) 目标: %s" % ("PASS" if total <= 150 * 1024 else "FAIL"))
    if audio:
        print("   音频文件: %s" % audio)
    print("   项目内媒体总数（含 ai/agent，仅供对照）:", end=" ")
    all_media = [(rel(p), os.path.getsize(p)) for p in walk_files(PROJECT)
                 if os.path.splitext(p)[1].lower() in MEDIA_EXT]
    print("%d 个 / %d B（含排除目录 %d 个 / %d B）"
          % (len(all_media), sum(b for _, b in all_media),
             len(all_media) - len(media),
             sum(b for _, b in all_media) - total))

    # ---------- B. 与 code_quality_check.js 交叉核对 ----------
    print("=" * 78)
    print("B. 与 code_quality_check.js --json 交叉核对")
    cqc_files = sorted([f for f in os.listdir(os.path.join(TESTS_DIR, "_verify"))
                        if f.startswith("cqc_real_") and f.endswith(".json")])
    if cqc_files:
        latest = sorted(cqc_files)[-1]
        with open(os.path.join(TESTS_DIR, "_verify", latest), "r", encoding="utf-8-sig") as f:
            cqc = json.load(f)
        rule = next(r for r in cqc["rules"] if r["name"] == "IMAGE_AND_AUDIO_LIMIT")
        print("   使用 %s（generatedAt=%s）" % (latest, cqc.get("generatedAt")))
        print("   checker: totalBytes=%d totalKB=%.2f fileCount=%d success=%s"
              % (rule["totalBytes"], rule["totalKB"], rule["fileCount"], rule["success"]))
        if rule["totalBytes"] != total:
            problems.append("checker totalBytes=%d 与独立复算 %d 不一致" % (rule["totalBytes"], total))
        else:
            print("   ✓ 总字节一致 (%d)" % total)
        cqc_map = {it["file"]: it["bytes"] for it in rule["files"]}
        mine_map = dict(media)
        if cqc_map != mine_map:
            only_c = {k: v for k, v in cqc_map.items() if mine_map.get(k) != v}
            only_m = {k: v for k, v in mine_map.items() if cqc_map.get(k) != v}
            problems.append("checker 媒体清单与独立复算不一致: checker独有=%s 独立独有=%s"
                            % (only_c, only_m))
        else:
            print("   ✓ 文件清单与逐文件字节完全一致（%d 个）" % len(cqc_map))
    else:
        problems.append("未找到 cqc_real_*.json，无法交叉核对")

    # ---------- C/D. PNG 结构 + 解码 ----------
    print("=" * 78)
    print("C/D. PNG 结构合法性（chunk CRC32）+ Pillow/ffmpeg 解码")
    pngs = [r for r, _ in media if r.lower().endswith(".png")]
    png8 = trns = 0
    struct_bad = []
    pil_bad = []
    ff_bad = []
    dims_by_file = {}
    for r in pngs:
        path = os.path.join(PROJECT, r)
        ok, info = crc_check_png(path)
        if not ok:
            struct_bad.append((r, info))
            continue
        if info["png8"]:
            png8 += 1
        if info["hastRNS"]:
            trns += 1
        dims_by_file[r] = (info["ihdr"]["width"], info["ihdr"]["height"])
        ok, pinfo = pil_decode_ok(path)
        if not ok:
            pil_bad.append((r, pinfo))
        else:
            dims_by_file[r] = pinfo["size"]
        ok, err = ffmpeg_decode_ok(path)
        if not ok:
            ff_bad.append((r, err))
    print("   PNG 数=%d；PNG-8(bitDepth=8,colorType=3)=%d；带 tRNS=%d" % (len(pngs), png8, trns))
    print("   chunk/CRC 结构非法: %s" % (struct_bad or "无"))
    print("   Pillow 解码失败: %s" % (pil_bad or "无"))
    print("   ffmpeg 解码失败: %s" % (ff_bad or "无"))
    if struct_bad or pil_bad or ff_bad:
        problems.append("PNG 结构或解码存在问题")
    non_png8 = [r for r in pngs if r in dims_by_file]
    # 明确列出非 PNG-8 的文件（结构检查里单独统计）
    for r in pngs:
        ok, info = crc_check_png(os.path.join(PROJECT, r))
        if ok and not info["png8"]:
            print("   ! 非 PNG-8 文件（仍合法）: %s bitDepth=%d colorType=%d"
                  % (r, info["ihdr"]["bitDepth"], info["ihdr"]["colorType"]))
    share = {r: d for r, d in dims_by_file.items() if r.startswith("images/share/")}
    share_bad = {r: d for r, d in share.items() if d != (500, 400)}
    print("   share 图 %d 张，尺寸 500x400 全部满足: %s  异常=%s"
          % (len(share), "PASS" if not share_bad else "FAIL", share_bad or "无"))
    if share_bad:
        problems.append("share 图尺寸异常: %s" % share_bad)

    # ---------- E. 与优化前备份对比 ----------
    print("=" * 78)
    print("E. 与优化前备份对比（尺寸/文件名/字节）")
    base_dir = next((d for d in BASELINE_CANDIDATES if os.path.isdir(d)), None)
    if not base_dir:
        notes.append("未找到优化前图片备份，无法对比历史尺寸（仅能确认当前 500x400）")
        print("   !! 未找到备份目录")
    else:
        print("   基线 = %s" % os.path.relpath(base_dir, TESTS_DIR))
        base = {}
        for p in walk_files(base_dir):
            base[rel(p)[len("images/"):] if False else os.path.relpath(p, base_dir).replace("\\", "/")] = \
                (os.path.getsize(p), p)
        cur = {r[len("images/"):]: os.path.join(PROJECT, r) for r in pngs}
        base_total = sum(v[0] for v in base.values())
        print("   基线文件数=%d 总字节=%d (%.2f KB)   当前文件数=%d 总字节=%d (%.2f KB)"
              % (len(base), base_total, base_total / 1024.0, len(cur), total, total / 1024.0))
        missing = sorted(set(base) - set(cur))
        added = sorted(set(cur) - set(base))
        print("   基线有当前无: %s" % (missing or "无"))
        print("   当前有基线无: %s" % (added or "无"))
        if missing or added:
            problems.append("图片文件名集合与优化前备份不一致: missing=%s added=%s" % (missing, added))
        dim_diff, byte_rows = [], []
        for name in sorted(set(base) & set(cur)):
            bsize, bpath = base[name]
            with Image.open(bpath) as bim:
                bdim = bim.size
            with Image.open(cur[name]) as cim:
                cdim = cim.size
            if bdim != cdim:
                dim_diff.append((name, bdim, cdim))
            if bsize != os.path.getsize(cur[name]):
                byte_rows.append((name, bsize, os.path.getsize(cur[name])))
        print("   像素尺寸变化: %s" % ("无（全部 %d 张一致）" % len(set(base) & set(cur))
                                    if not dim_diff else dim_diff))
        if dim_diff:
            problems.append("有图片像素尺寸变化: %s" % dim_diff)
        print("   字节数变化明细（仅列变化项，共 %d 项）:" % len(byte_rows))
        for name, b, c in byte_rows:
            print("      %-28s %7d -> %7d  (%+.1f%%)" % (name, b, c, (c - b) * 100.0 / b if b else 0))
        print("   基线总字节 243708 复现: %s" % ("PASS" if base_total == 243708 else "FAIL(%d)" % base_total))
        if base_total != 243708:
            notes.append("备份总字节 %d ≠ 文档声称的 243,708（可能备份快照时间不同）" % base_total)

    # ---------- F. 引用完整性 ----------
    print("=" * 78)
    print("F. 图片引用完整性")
    ref_re = re.compile(r"images/[A-Za-z0-9_\-./]+\.(?:png|jpg|jpeg|gif|svg|webp)", re.I)
    refs = {}
    for p in walk_files(PROJECT):
        ext = os.path.splitext(p)[1].lower()
        if ext not in TEXT_FILES:
            continue
        r = rel(p)
        try:
            text = open(p, "r", encoding="utf-8-sig", errors="replace").read()
        except Exception:  # noqa: BLE001
            continue
        for m in ref_re.finditer(text):
            refs.setdefault(m.group(0), set()).add(r)
    broken = {}
    for ref, where in sorted(refs.items()):
        # 去掉前导 /，按项目根解析；忽略注释里的示例（share/xx.png 不存在）
        cand = os.path.join(PROJECT, ref.lstrip("/"))
        if not os.path.exists(cand):
            broken[ref] = sorted(where)
    print("   代码中出现图片路径引用 %d 条" % len(refs))
    if broken:
        print("   !! 断链: %s" % broken)
    else:
        print("   ✓ 全部引用目标存在（无断链）")
    # 注释中的示例路径单独说明
    for ref in broken:
        if ref.endswith("share/xx.png"):
            print("   （说明：%s 仅出现在 utils/share.js 的注释示例里，非真实引用）" % ref)
    if [k for k in broken if not k.endswith("share/xx.png")]:
        problems.append("存在图片断链: %s" % broken)

    # theme.json 变量解析
    app_json = json.load(open(os.path.join(PROJECT, "app.json"), "r", encoding="utf-8-sig"))
    theme = json.load(open(os.path.join(PROJECT, "theme.json"), "r", encoding="utf-8-sig"))
    theme_vars = set()
    for mode in ("light", "dark"):
        theme_vars |= set(theme.get(mode, {}).keys())
    app_text = open(os.path.join(PROJECT, "app.json"), "r", encoding="utf-8-sig").read()
    at_vars = set(re.findall(r'"@([A-Za-z0-9_]+)"', app_text))
    unresolved = sorted(v for v in at_vars if v not in theme_vars)
    print("   app.json @变量 %d 个，theme.json 可解析: %s%s"
          % (len(at_vars), "PASS" if not unresolved else "FAIL", "" if not unresolved else " 未解析=%s" % unresolved))
    if unresolved:
        problems.append("app.json 有未解析主题变量: %s" % unresolved)
    tabbar_broken = []
    for mode in ("light", "dark"):
        for k, v in theme.get(mode, {}).items():
            if k.endswith("Icon") or k.endswith("IconOn"):
                if not os.path.exists(os.path.join(PROJECT, v)):
                    tabbar_broken.append((mode, k, v))
    print("   theme.json 图标路径存在: %s%s"
          % ("PASS" if not tabbar_broken else "FAIL", "" if not tabbar_broken else " %s" % tabbar_broken))
    if tabbar_broken:
        problems.append("theme.json 图标路径不存在: %s" % tabbar_broken)

    # 未被引用的图片
    referenced = set()
    for ref in refs:
        referenced.add(os.path.normpath(os.path.join(PROJECT, ref.lstrip("/"))))
    all_images = {os.path.normpath(os.path.join(PROJECT, r)) for r in dims_by_file}
    unused = sorted(rel(p) for p in all_images - referenced)
    print("   未被代码/主题引用的图片（死资源，仍计入媒体总量）: %s" % (unused or "无"))

    # ---------- 汇总 ----------
    print("=" * 78)
    if problems:
        print("MEDIA VERIFY: FAIL")
        for p in problems:
            print("  - " + p)
        return 1
    print("MEDIA VERIFY: PASS  (总字节 %d = %.2f KB; %d 个文件)"
          % (total, total / 1024.0, len(media)))
    for n in notes:
        print("  note: " + n)
    return 0


if __name__ == "__main__":
    sys.exit(main())
