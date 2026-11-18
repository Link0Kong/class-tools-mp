# -*- coding: utf-8 -*-
# 生成 images/tool-ppt.png（96x96 白色「演示」图标，风格对齐现有 tool-*.png：
# 透明底 + 纯白实心 glyph，绘制区域约 14..82，尺寸/命名与 tool-draw/hw/nt 等一致）。
# 保留为工具脚本（可重复生成）；test 目录不在小程序包内。
import os
from PIL import Image, ImageDraw

SCALE = 8
W = 96 * SCALE
im = Image.new('RGBA', (W, W), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
white = (255, 255, 255, 255)


def S(v):
    return int(round(v * SCALE))


def rr(x0, y0, x1, y1, r, fill):
    d.rounded_rectangle((S(x0), S(y0), S(x1), S(y1)), radius=S(r), fill=fill)


# 展示屏幕：白色实心圆角矩形
rr(14, 16, 82, 62, 6, white)
# 屏幕内播放三角：挖空（透明）
d.polygon([(S(36), S(26)), (S(36), S(52)), (S(58), S(39))], fill=(0, 0, 0, 0))
# 支架立柱 + 底座（白色实心）
rr(44, 62, 52, 75, 2, white)
rr(30, 74, 66, 80, 3, white)

out = im.resize((96, 96), Image.LANCZOS)
path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    'mp-class-tools', 'images', 'tool-ppt.png')
out.save(path, optimize=True)
print('saved', path, os.path.getsize(path), 'bytes', out.size)
