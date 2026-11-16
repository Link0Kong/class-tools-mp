# optimize_images.py —— 幂等批量优化 mp-class-tools/images/ 下的 PNG（PNG-8 调色板 + 最高压缩）
#
# 背景：微信小程序代码质量硬线是「图片 + 音频总量 ≤ 200KB」，本项目 images/ 原本 35 张 PNG 共 238KB，
# 其中 8 张分享卡片（images/share/*.png，500×400）占 ~185KB。分享卡片是纯色底 + 文字 + 柔和装饰圆，
# 真实颜色数只有 600~1100 种，用 PNG-8 调色板重编码可以无损/近无损地压到 40% 左右。
#
# 用法：
#   python optimize_images.py                 # 优化 mp-class-tools/images/ 全部 PNG（默认策略）
#   python optimize_images.py --dry-run       # 只统计报告，不写盘
#   python optimize_images.py --root <dir>    # 指定别的图片目录
#   python optimize_images.py --colors 128    # 调色板上限（默认 256 = PNG-8 上限）
#   python optimize_images.py --max-kb 12     # 单文件体积上限（默认 images/share/ 12KB，其它 20KB）
#   python optimize_images.py --quiet         # 只输出汇总
#
# 策略（关键：输出是「规范形式」，重复运行得到完全相同的字节 = 幂等）：
#   1) 统计真实颜色数（带透明按 RGBA 计数）。≤ colors 时用精确调色板重建 PNG-8：逐像素颜色完全不变，
#      无损，只是把 24/32 位图换成索引色 + tRNS（alpha 通道用调色板 alpha 表示）。
#   2) 颜色数 > colors 时：RGB 用 MEDIANCUT、带 alpha 用 FASTOCTREE 量化到 colors 色（先试 256，
#      超出 --max-kb 就按 192/160/128/96/64/48/32/16 逐级降色），再按「颜色值升序」重建调色板。
#      调色板顺序固定 → 同一像素内容永远得到同一份字节，所以二次运行不会再有变化。
#   3) 结果不比原文件小时保持原样；不做任何尺寸/文件名/目录改动。
#
# 依赖：Pillow（PIL）+ numpy（都随工作区 Python 环境提供）。
# 生成分享卡片的 make_share_images.py 会 import 本文件的 encode_palette_png()，保证「重新生成」也走同一套编码。
import argparse
import glob
import io
import os
import sys

import numpy as np
from PIL import Image

# 默认图片目录：<workspace>/mp-class-tools/images（本文件在 mp-class-tools-tests/ 下）
DEFAULT_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            'mp-class-tools', 'images')

DEFAULT_COLORS = 256          # PNG-8 上限
SHARE_MAX_BYTES = 12 * 1024   # 单张分享卡片上限（微信转发图，5:4）
OTHER_MAX_BYTES = 20 * 1024   # 其它图片的单文件上限


# ---------------------------------------------------------------- 编码核心

def _pack_pixels(im):
    """把 RGB/RGBA 图压成 uint32 每像素值：RGB=R<<16|G<<8|B，RGBA=R<<24|G<<16|B<<8|A。"""
    a = np.asarray(im)
    if im.mode == 'RGB':
        a = a.astype(np.uint32)
        return (a[..., 0] << 16) | (a[..., 1] << 8) | a[..., 2], 3
    a = a.astype(np.uint32)
    return (a[..., 0] << 24) | (a[..., 1] << 16) | (a[..., 2] << 8) | a[..., 3], 4


def _unpack(key, nch):
    if nch == 3:
        return ((key >> 16) & 0xFF, (key >> 8) & 0xFF, key & 0xFF)
    return ((key >> 24) & 0xFF, (key >> 16) & 0xFF, (key >> 8) & 0xFF, key & 0xFF)


def _to_rgb_or_rgba(im):
    """归一化到 RGB（不透明）或 RGBA（含透明），其它模式（P/LA/L/1）先展开。"""
    im = im.convert('RGBA' if im.mode in ('P', 'PA', 'LA') else im.mode)
    if im.mode == 'RGBA':
        alpha = np.asarray(im)[..., 3]
        if int(alpha.min()) == 255:       # 全不透明：丢掉 alpha 通道，省 1/4 数据
            return im.convert('RGB')
        return im
    if im.mode != 'RGB':
        return im.convert('RGB')
    return im


def _palette_png_bytes(im, max_colors=256, compress_level=9):
    """把 RGB/RGBA 图编码成 PNG-8 字节。

    返回 (png_bytes, used_colors, exact)。
    exact=True 表示像素与输入逐字节相同（精确调色板 / 无损）；
    exact=False 表示做过量化（≤ max_colors 色）。
    """
    im = _to_rgb_or_rgba(im)
    packed, nch = _pack_pixels(im)
    keys = np.unique(packed)              # 升序 → 调色板顺序固定，保证幂等
    exact = len(keys) <= max_colors
    if not exact:
        if im.mode == 'RGBA':
            quantized = im.quantize(colors=max_colors, method=Image.FASTOCTREE).convert('RGBA')
        else:
            quantized = im.convert('RGB').quantize(colors=max_colors,
                                                   method=Image.MEDIANCUT).convert('RGB')
        packed, nch = _pack_pixels(quantized)
        keys = np.unique(packed)

    # 颜色值 → 调色板下标
    indices = np.searchsorted(keys, packed).astype(np.uint8)
    pim = Image.frombytes('P', im.size, indices.tobytes())
    palette, alphas = [], []
    for key in keys.tolist():
        rgba = _unpack(key, nch)
        palette.extend(rgba[:3])
        if nch == 4:
            alphas.append(rgba[3])
    pim.putpalette(palette)
    transparency = None
    if nch == 4 and any(a != 255 for a in alphas):
        transparency = bytes(alphas)
        pim.info['transparency'] = transparency

    buf = io.BytesIO()
    kwargs = dict(format='PNG', optimize=True, compress_level=compress_level)
    if transparency is not None:
        kwargs['transparency'] = transparency
    pim.save(buf, **kwargs)
    return buf.getvalue(), len(keys), exact


def encode_palette_png(im, max_colors=DEFAULT_COLORS):
    """供 make_share_images.py 复用的简化入口：返回规范 PNG-8 字节。"""
    return _palette_png_bytes(im, max_colors=max_colors)[0]


# ---------------------------------------------------------------- 质量/体积度量

def _diff_stats(orig, decoded):
    """比较两张同尺寸图（自动按 RGB/RGBA 对齐）的像素差异。

    decoded 是重编码后解出来的 P 图：有 tRNS 就按 RGBA 比（含 alpha），否则按 RGB。
    """
    mode = 'RGBA' if 'transparency' in decoded.info else 'RGB'
    a = np.asarray(orig.convert(mode)).astype(np.int16)
    b = np.asarray(decoded.convert(mode)).astype(np.int16)
    diffs = np.abs(a - b)
    per_pixel = diffs.max(axis=2)
    return {
        'max': int(diffs.max()),
        'mean': float(diffs.mean()),
        'pct_gt8': float((per_pixel > 8).mean() * 100.0),
        'identical': bool(np.array_equal(a, b)),
    }


# ---------------------------------------------------------------- 单文件优化

def optimize_file(path, max_colors=DEFAULT_COLORS, max_bytes=None, dry_run=False):
    """优化一个 PNG 文件。返回结果 dict（不写盘时 changed=False）。"""
    before = os.path.getsize(path)
    with Image.open(path) as src:
        src.load()
        before_mode, size = src.mode, src.size
        original = src.copy()

    color_ladder = []
    for n in (max_colors, 192, 160, 128, 96, 64, 48, 32, 16):
        n = min(n, max_colors)
        if n >= 2 and n not in color_ladder:
            color_ladder.append(n)

    chosen = None
    for n in color_ladder:
        data, used, exact = _palette_png_bytes(original, max_colors=n)
        if max_bytes is None or len(data) <= max_bytes:
            chosen = (n, data, used, exact)
            break
    if chosen is None:                      # 连 16 色都超上限：放弃，保留原图
        return dict(path=path, before=before, after=before, skipped=True,
                    reason='cannot meet max_bytes', changed=False)

    n_colors, data, used, exact = chosen
    if len(data) >= before:                 # 不比原文件小 → 保持原样
        return dict(path=path, before=before, after=before, skipped=False,
                    reason='already optimal', changed=False,
                    colors=None, exact=None, size=size, before_mode=before_mode)

    result = dict(path=path, before=before, after=len(data), skipped=False, reason='',
                  colors=used, exact=exact, size=size, before_mode=before_mode,
                  changed=True, data=data)
    # 质量核对（在写盘前用解出来的图对比原图）
    with Image.open(io.BytesIO(data)) as decoded:
        stats = _diff_stats(original, decoded)
    result.update(stats)
    if dry_run:
        result['changed'] = False
        result['would_change'] = True
        del result['data']
    return result


def _fmt_bytes(n):
    return '%d B' % n


def _row(path, rel, res, dry_run):
    if not res.get('skipped') and not res.get('changed') and not res.get('would_change'):
        return '  %-26s %8d  (kept: %s)' % (rel, res['before'], res['reason'])
    if res.get('skipped'):
        return '  %-26s %8d  (skip: %s)' % (rel, res['before'], res['reason'])
    tag = 'would' if dry_run else 'optim'
    exact = 'lossless' if res.get('exact') else ('q%d' % res.get('colors', 0))
    return '  %-26s %8d -> %-8d %5.1f%%  %-12s maxerr=%2d mean=%.3f  %s' % (
        rel, res['before'], res['after'], res['after'] * 100.0 / res['before'],
        exact, res.get('max', -1), res.get('mean', -1.0), tag)


def collect(root):
    return sorted(glob.glob(os.path.join(root, '**', '*.png'), recursive=True))


def main(argv=None):
    ap = argparse.ArgumentParser(
        description='Idempotent PNG-8 optimizer for mini-program images (report, then shrink).')
    ap.add_argument('--root', default=DEFAULT_ROOT, help='image root dir (default: %(default)s)')
    ap.add_argument('--colors', type=int, default=DEFAULT_COLORS,
                    help='palette upper bound, 2..256 (default: %(default)s)')
    ap.add_argument('--max-kb', type=float, default=None,
                    help='per-file size cap in KB (default: share/ 12KB, others 20KB)')
    ap.add_argument('--dry-run', action='store_true', help='only report, do not write')
    ap.add_argument('--quiet', action='store_true', help='summary only')
    args = ap.parse_args(argv)

    root = os.path.abspath(args.root)
    if not os.path.isdir(root):
        print('ERROR: image root not found: %s' % root)
        return 2
    files = collect(root)
    if not files:
        print('No PNG found under %s' % root)
        return 1

    before_total = sum(os.path.getsize(p) for p in files)
    after_total = 0
    changed = kept = skipped = 0
    rows = []
    for path in files:
        rel = os.path.relpath(path, root).replace('\\', '/')
        if args.max_kb is not None:
            cap = int(args.max_kb * 1024)
        else:
            cap = SHARE_MAX_BYTES if rel.startswith('share/') else OTHER_MAX_BYTES
        res = optimize_file(path, max_colors=args.colors, max_bytes=cap, dry_run=args.dry_run)
        if res.get('changed'):
            with open(path, 'wb') as fh:
                fh.write(res.pop('data'))
            changed += 1
            after_total += res['after']
        elif res.get('would_change'):
            res.pop('data', None)
            changed += 1
            after_total += res['after']
        else:
            kept += 1
            if res.get('skipped'):
                skipped += 1
            after_total += res['before']
        rows.append((rel, res))

    if not args.quiet:
        print('PNG-8 optimize: root=%s colors<=%d%s' % (root, args.colors,
                                                        ' [DRY-RUN]' if args.dry_run else ''))
        print('  %-26s %9s %10s %7s  %s' % ('file', 'before', 'after', 'ratio', 'quality'))
        for rel, res in rows:
            print(_row(path=None, rel=rel, res=res, dry_run=args.dry_run))

    print('-' * 78)
    print('files: %d   changed: %d   kept: %d (skipped: %d)' % (len(files), changed, kept, skipped))
    print('TOTAL: %d bytes (%.2f KB) -> %d bytes (%.2f KB)   saved %.2f KB (%.1f%%)' % (
        before_total, before_total / 1024.0, after_total, after_total / 1024.0,
        (before_total - after_total) / 1024.0,
        (before_total - after_total) * 100.0 / before_total if before_total else 0.0))
    print('(limit: images+audio <= 200KB hard line, <= 150KB target)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
