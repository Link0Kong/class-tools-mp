# make_share_images.py —— 生成微信分享卡片封面（500×400，5:4）到 mp-class-tools/images/share/
#
# 微信 onShareAppMessage / onShareTimeline 的 imageUrl 建议 5:4；这里用莫奈暖白底 + 彩色圆底白字形
# 工具图标做一套页面级封面，避免转发时默认截屏出现空白/滚动状态。
#
# 体积：微信「图片 + 音频」总量硬线 200KB。卡片是纯色底 + 文字 + 柔和装饰圆，真实颜色数只有几百种，
# 所以最终用 PNG-8 调色板（≤256 色）+ optimize/compress_level=9 写出：约 10KB/张（24-bit 直出约 24KB），
# 肉眼无差。编码器复用 optimize_images.py 的 encode_palette_png()，保证「重新生成」不会把体积涨回去。
#
# 用法：python make_share_images.py
import os
from PIL import Image, ImageDraw, ImageFont

try:  # 同目录的批量优化工具；单独拷贝本脚本时退化为等价的内联实现
    from optimize_images import encode_palette_png
except Exception:  # pragma: no cover - 只在缺模块时走线性量化回退
    encode_palette_png = None

TESTS = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(TESTS)
IMG = os.path.join(PROJ, 'images')
OUT = os.path.join(IMG, 'share')
SHOTS = os.path.join(TESTS, '_shots')

BG = (244, 240, 230, 255)
INK = (48, 58, 53, 255)
MUTED = (92, 104, 96, 255)
PRIMARY = (94, 143, 135, 255)
SECONDARY = (125, 158, 187, 255)
TERTIARY = (198, 164, 117, 255)
OUTLINE = (231, 222, 208, 255)

F_EYEBROW = ImageFont.truetype(r'C:\Windows\Fonts\msyh.ttc', 18)
F_TITLE = ImageFont.truetype(r'C:\Windows\Fonts\msyhbd.ttc', 40)
F_TITLE_S = ImageFont.truetype(r'C:\Windows\Fonts\msyhbd.ttc', 32)
F_SUB = ImageFont.truetype(r'C:\Windows\Fonts\msyh.ttc', 20)
F_FOOT = ImageFont.truetype(r'C:\Windows\Fonts\msyh.ttc', 16)

# file, icon, accent color, title, subtitle
CARDS = [
    ('default.png', 'logo',        PRIMARY,   '班级工具',       '课表 · 作业 · 通知 · 抽签'),
    ('index.png',   'tool-tt.png', PRIMARY,   '今天的课与待办', '今日课程 · 作业待交 · 通知待处理'),
    ('tt.png',      'tool-tt.png', PRIMARY,   '班级课表',       '周次切换 · 下一节课 · 教务同步'),
    ('hw.png',      'tool-hw.png', TERTIARY,  '作业板',         '截止提醒 · 完成勾选 · 云端同步'),
    ('nt.png',      'tool-nt.png', PRIMARY,   '班级通知',       '简报 · AI 拆分 · 附件与原始消息'),
    ('draw.png',    'tool-draw.png', SECONDARY, '抽签分组',     '抽号 · 分组 · 结果单 · 导出图片'),
    ('ft.png',      'tool-ft.png', SECONDARY, '大学体测算分',   '国标七项 · 实时出分 · 等级'),
    ('bz.png',      'tool-bz.png', TERTIARY,  '班委名单',       '职务 · 徽章 · 全员可看'),
]


def circle_layer(size, center, radius, color):
    layer = Image.new('RGBA', size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse([center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius], fill=color)
    return layer


def save_optimized(card, path):
    """把画好的卡片写成语义不变、体积最小化的 PNG（PNG-8 调色板 + optimize/compress_level=9）。

    与 optimize_images.py 的编码参数完全一致：同一画面永远得到同一份字节（幂等），
    以后重跑本脚本也不会把 images/share/ 从 ~10KB 涨回 ~24KB。
    """
    rgb = card.convert('RGB')
    if encode_palette_png is not None:
        with open(path, 'wb') as fh:
            fh.write(encode_palette_png(rgb, max_colors=256))
    else:
        rgb.quantize(colors=256, method=Image.MEDIANCUT).save(
            path, 'PNG', optimize=True, compress_level=9)
    print('saved', path, os.path.getsize(path), 'bytes')


def build(file, icon, accent, title, sub):
    W, H = 500, 400
    card = Image.new('RGBA', (W, H), BG)
    # 右上 / 左下 的柔和装饰圆（低透明度莫奈色）
    deco = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(deco)
    d.ellipse([340, -120, 660, 200], fill=accent[:3] + (26,))
    d.ellipse([-90, 300, 130, 520], fill=TERTIARY[:3] + (22,))
    card = Image.alpha_composite(card, deco)
    d = ImageDraw.Draw(card)

    # 左侧图标：彩色圆 + 白色字形（logo 直接贴品牌图）
    cx, cy, r = 112, 200, 62
    if icon == 'logo':
        logo = Image.open(os.path.join(IMG, 'logo.png')).convert('RGBA').resize((150, 150), Image.LANCZOS)
        card.alpha_composite(logo, (cx - 75, cy - 75))
    else:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=accent)
        glyph = Image.open(os.path.join(IMG, icon)).convert('RGBA')
        gw = int(glyph.width * (62 / glyph.height))
        glyph = glyph.resize((gw, 62), Image.LANCZOS)
        card.alpha_composite(glyph, (cx - gw // 2, cy - 31))
        d = ImageDraw.Draw(card)

    # 右侧文字
    x = 208
    d.text((x, 118), '班级工具 · 示例班级', font=F_EYEBROW, fill=MUTED)
    font = F_TITLE if d.textlength(title, font=F_TITLE) <= 250 else F_TITLE_S
    d.text((x, 146), title, font=font, fill=INK)
    # 副标题：先按最大宽度自动缩字号，再按宽度折行（最多两行）
    def fit_font(text, maxw=252, sizes=(20, 19, 18, 17, 16)):
        f = F_SUB
        for s in sizes:
            f = ImageFont.truetype(r'C:\Windows\Fonts\msyh.ttc', s)
            if d.textlength(text, font=f) <= maxw:
                return f
        return f
    sub_font = fit_font(sub)
    buf, lines = '', []
    for ch in sub:
        if d.textlength(buf + ch, font=sub_font) > 252:
            lines.append(buf)
            buf = ch
        else:
            buf += ch
    if buf:
        lines.append(buf)
    for i, line in enumerate(lines[:2]):
        d.text((x, 210 + i * 28), line, font=sub_font, fill=MUTED)

    # 底部：分隔线 + 站点标识
    d.line([(x, 330), (468, 330)], fill=OUTLINE, width=1)
    d.text((x, 346), 'tool.furina.fun · 班级专用', font=F_FOOT, fill=MUTED)
    d.text((x, 368), '打开小程序查看完整内容', font=F_FOOT, fill=MUTED)

    path = os.path.join(OUT, file)
    save_optimized(card, path)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for c in CARDS:
        build(*c)

    # 交付图：8 张分享卡片排成 2×4 总览（写入 tests/_shots/，该目录不入库）
    os.makedirs(SHOTS, exist_ok=True)
    sheet_w, sheet_h = 360, 288
    gap, pad = 20, 48
    title_font = ImageFont.truetype(r'C:\Windows\Fonts\msyhbd.ttc', 40)
    sub_font = ImageFont.truetype(r'C:\Windows\Fonts\msyh.ttc', 22)
    cap_font = ImageFont.truetype(r'C:\Windows\Fonts\msyh.ttc', 18)
    cols, rows = 4, 2
    W = pad * 2 + cols * sheet_w + (cols - 1) * gap
    H = pad + 84 + rows * (sheet_h + 30) + 40 + pad
    canvas = Image.new('RGB', (W, H), BG[:3])
    d = ImageDraw.Draw(canvas)
    d.text((pad, pad), '小程序分享卡片 · 微信原生转发 / 朋友圈', font=title_font, fill=INK[:3])
    d.text((pad + 2, pad + 56), '17 个页面各带标题 / 路径 / 5:4 封面；课表带当前周次，通知带最新标题（v1.4.0）', font=sub_font, fill=MUTED[:3])
    y = pad + 100
    for i, c in enumerate(CARDS):
        row, col = divmod(i, cols)
        x = pad + col * (sheet_w + gap)
        yy = y + row * (sheet_h + 30 + 28)
        im = Image.open(os.path.join(OUT, c[0])).convert('RGB').resize((sheet_w, sheet_h), Image.LANCZOS)
        canvas.paste(im, (x, yy))
        label = {'default': '通用 / 我的 / 反馈', 'index': '工作台', 'tt': '课表（带周次）', 'hw': '作业板',
                 'nt': '班级通知', 'draw': '抽签分组', 'ft': '体测 / 国标表', 'bz': '班委名单'}.get(c[0][:-4], c[0])
        d.text((x, yy + sheet_h + 6), label, font=cap_font, fill=MUTED[:3])
    out = os.path.join(SHOTS, 'share_overview.png')
    canvas.save(out, 'PNG')
    print('saved', out, canvas.size)
