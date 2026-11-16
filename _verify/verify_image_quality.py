#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify_image_quality.py —— 优化前后逐像素差异（量化损失量化评估）

对比基线（_backup_v21_pre_ai_20261105/images，优化前）与当前 images/：
  * 尺寸一致（已在 verify_media.py 校验，这里再次确认）
  * 逐像素 RGBA 差异：完全相同像素占比、平均/最大通道差、PSNR(RGB)、alpha 通道差异
  * 判定：所有图 PSNR >= 30dB 视为「近无损/肉眼无差」；share 图单独列出
说明：PNG-8 256 色调色板量化 + Floyd-Steinberg 抖动，必然有细微差异，本脚本量化其幅度。
"""
import os
import sys

import numpy as np
from PIL import Image

TESTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT = os.path.abspath(os.path.join(TESTS, "..", "mp-class-tools"))
BASE = os.path.join(TESTS, "_backup_v21_pre_ai_20261105", "images")
PROBLEMS = []


def psnr(a, b):
    mse = np.mean((a.astype(np.float64) - b.astype(np.float64)) ** 2)
    if mse == 0:
        return float("inf")
    return 10 * np.log10((255.0 ** 2) / mse)


def main():
    rows = []
    files = []
    for dirpath, _dirnames, filenames in os.walk(BASE):
        for fn in filenames:
            if fn.lower().endswith(".png"):
                bp = os.path.join(dirpath, fn)
                files.append((os.path.relpath(bp, BASE).replace("\\", "/"), bp))
    for name, bp in sorted(files):
        cp = os.path.join(PROJECT, "images", name)
        if not os.path.exists(cp):
            PROBLEMS.append("当前缺少图片: " + name)
            continue
        bi = Image.open(bp).convert("RGBA")
        ci = Image.open(cp).convert("RGBA")
        if bi.size != ci.size:
            PROBLEMS.append("尺寸变化: %s %s -> %s" % (name, bi.size, ci.size))
            continue
        ba, ca = np.asarray(bi), np.asarray(ci)
        diff = np.abs(ba.astype(np.int16) - ca.astype(np.int16))
        same = np.all(diff == 0, axis=2)
        rgb_psnr = psnr(ba[..., :3], ca[..., :3])
        alpha_diff = diff[..., 3]
        rows.append({
            "name": name,
            "same_pct": 100.0 * same.mean(),
            "mean_ch": float(diff[..., :3].mean()),
            "max_ch": int(diff[..., :3].max()),
            "psnr": rgb_psnr,
            "alpha_max": int(alpha_diff.max()),
            "alpha_changed_pct": 100.0 * (alpha_diff > 0).mean(),
        })

    print("=" * 92)
    print("%-26s %10s %12s %8s %9s %10s %12s" %
          ("图片", "完全相同%", "RGB平均差", "最大差", "PSNR(dB)", "alpha最大", "alpha变化%"))
    print("-" * 92)
    for r in rows:
        print("%-26s %9.2f%% %11.3f %8d %9.2f %10d %11.3f%%" %
              (r["name"], r["same_pct"], r["mean_ch"], r["max_ch"],
               r["psnr"] if r["psnr"] != float("inf") else 999.0,
               r["alpha_max"], r["alpha_changed_pct"]))
    print("-" * 92)

    # share 图单独汇总
    share = [r for r in rows if r["name"].startswith("share/")]
    all_psnr = [r["psnr"] for r in rows]
    min_psnr = min(all_psnr)
    min_row = rows[all_psnr.index(min_psnr)]
    print("共 %d 张；PSNR 最小 = %.2f dB（%s）" % (len(rows), min_psnr, min_row["name"]))
    print("share 图 %d 张：PSNR 范围 %.2f–%.2f dB，完全相同像素 %.1f%%–%.1f%%"
          % (len(share), min(r["psnr"] for r in share), max(r["psnr"] for r in share),
             min(r["same_pct"] for r in share), max(r["same_pct"] for r in share)))
    low = [r for r in rows if r["psnr"] < 30]
    if low:
        print("PSNR < 30dB 的图:", [(r["name"], round(r["psnr"], 2)) for r in low])
        PROBLEMS.append("存在 PSNR<30dB 的图片: %s" % [(r["name"], round(r["psnr"], 2)) for r in low])
    else:
        print("全部图片 PSNR >= 30dB（近无损；share 图带抖动量化）")
    # alpha 通道：原本透明的像素不应变成不透明（视觉安全）
    bad_alpha = []
    for name, bp in sorted(files):
        cp = os.path.join(PROJECT, "images", name)
        if not os.path.exists(cp):
            continue
        ba = np.asarray(Image.open(bp).convert("RGBA"))[..., 3]
        ca = np.asarray(Image.open(cp).convert("RGBA"))[..., 3]
        # 基线全透明像素，当前若 alpha>8 则算透明区被填充
        if (ba == 0).any():
            newly = int((ca[ba == 0] > 8).sum())
            if newly:
                bad_alpha.append((name, newly))
    if bad_alpha:
        print("透明区被填充的图:", bad_alpha)
        PROBLEMS.append("透明区域被量化填充: %s" % bad_alpha)
    else:
        print("透明区保持不变（基线全透明像素在当前仍基本透明）")
    print("=" * 92)
    if PROBLEMS:
        print("IMAGE QUALITY: FAIL")
        for p in PROBLEMS:
            print("  - " + p)
        return 1
    print("IMAGE QUALITY: PASS —— 全部图片尺寸不变、PSNR>=30dB、透明区未被破坏")
    return 0


if __name__ == "__main__":
    sys.exit(main())
