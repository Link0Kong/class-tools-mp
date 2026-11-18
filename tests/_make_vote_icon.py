# -*- coding: utf-8 -*-
# 生成 images/tool-vote.png（96x96 白色「投票」图标，风格对齐现有 tool-*.png：
# 透明底 + 纯白实心 glyph，绘制区域约 12..84，尺寸/命名与 tool-draw/hw/nt 等一致）。
# 保留为工具脚本（可重复生成）；test 目录不在小程序包内。
import os
from PIL import Image, ImageDraw

SCALE = 8
W = 96 * SCALE
im = Image.new('RGBA', (W, W), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
white = (255, 255, 255, 255)
clear = (0, 0, 0, 0)


def S(v):
    return int(round(v * SCALE))


def rr(x0, y0, x1, y1, r, fill):
    d.rounded_rectangle((S(x0), S(y0), S(x1), S(y1)), radius=S(r), fill=fill)


# 选票（上方纸片）：白色圆角矩形，中央镂空 ✓
rr(28, 9, 68, 41, 3, white)
d.line([(S(37), S(26)), (S(44), S(33)), (S(59), S(18))], fill=clear, width=S(5), joint='curve')

# 投票箱（下方箱体）：白色圆角矩形 + 镂空投票口
rr(12, 43, 84, 84, 7, white)
rr(27, 51, 69, 57, 3, clear)

out = im.resize((96, 96), Image.LANCZOS)
path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    'mp-class-tools', 'images', 'tool-vote.png')
out.save(path, optimize=True)
print('saved', path, os.path.getsize(path), 'bytes', out.size)
