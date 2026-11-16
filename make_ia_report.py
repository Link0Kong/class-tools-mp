# make_ia_report.py —— 生成「首页信息架构重设计 / 隐私展示清理」交付图（桌面）
#
# 输入：mp-class-tools-tests/_shots/ia-before/*.png + _shots/ia/*.png
#       + _shots/mp_identity_verified.png / mp_committee.png / mp_stats_admin.png（identity_preview.js 产物）
# 输出（桌面）：
#   小程序首页信息架构重设计_前后对比_20261104.png
#   小程序首页信息架构重设计_工具页排序_20261104.png
#   小程序学号头像展示清理_20261104.png
#
# 用法：python make_ia_report.py
import os
from PIL import Image, ImageDraw, ImageFont

TESTS = os.path.dirname(os.path.abspath(__file__))
BEFORE = os.path.join(TESTS, '_shots', 'ia-before')
AFTER = os.path.join(TESTS, '_shots', 'ia')
DESKTOP = r'C:\Users\Ko_Li\OneDrive\桌面'

BG = (244, 240, 230)          # 莫奈暖白（与小程序 --md-surface 一致）
INK = (48, 58, 53)
MUTED = (92, 104, 96)
ACCENT = (94, 143, 135)

F_TITLE = ImageFont.truetype(r'C:\Windows\Fonts\msyhbd.ttc', 46)
F_SUB = ImageFont.truetype(r'C:\Windows\Fonts\msyh.ttc', 24)
F_ROW = ImageFont.truetype(r'C:\Windows\Fonts\msyhbd.ttc', 30)
F_CAP = ImageFont.truetype(r'C:\Windows\Fonts\msyh.ttc', 22)

W = 480          # 单张截图缩放宽度
GAP = 26
PAD = 48


def load(name, folder):
    im = Image.open(os.path.join(folder, name)).convert('RGB')
    ratio = W / im.width
    return im.resize((W, int(im.height * ratio)), Image.LANCZOS)


def text(draw, xy, s, font, fill, spacing=0):
    draw.text(xy, s, font=font, fill=fill, spacing=spacing)


def centered(draw, cx, y, s, font, fill):
    w = draw.textlength(s, font=font)
    draw.text((cx - w / 2, y), s, font=font, fill=fill)


def build_compare(out_path):
    before = [('01-index-before.png', '工作台：问候 + 工具列表\n统计 / 隐私 / 同步 / 清空都在首页'),
              ('02-tools-before.png', '工具页：与首页同一批工具\n长条卡片 + 拖动排序'),
              ('03-me-before.png', '我的：首字头像 + 打码学号\n6 项全站统计 + 重复隐私说明')]
    after = [('01-index.png', '工作台：今日课程 + 待办\n4 个常用工具（无头像）'),
             ('02-tools.png', '工具页：首页快捷 4 个\n全部工具 2 列目录'),
             ('04-me.png', '我的：姓名 + 我的数据四项\n无头像、不显示学号')]
    rows = [
        ('改版前  v1.3.1', before, BEFORE),
        ('改版后  v1.3.3（本次）', after, AFTER),
    ]
    imgs = [(label, [(load(n, d), cap) for n, cap in items]) for label, items, d in rows]
    row_h = imgs[0][1][0][0].height
    h = PAD + 96 + 34 + len(imgs) * (row_h + 34 + 30 + 24) + PAD + 96
    w = PAD * 2 + GAP * 2 + W * 3
    canvas = Image.new('RGB', (w, h), BG)
    d = ImageDraw.Draw(canvas)

    d.text((PAD, PAD), '班级工具小程序 · 首页信息架构重设计', font=F_TITLE, fill=INK)
    d.text((PAD + 2, PAD + 62), '首页只做今天的事；完整功能归「工具」，身份 / 数据 / 设置归「我的」（v1.3.3，Monet 浅色）', font=F_SUB, fill=MUTED)

    y = PAD + 128
    for label, items in imgs:
        d.text((PAD, y), label, font=F_ROW, fill=ACCENT)
        y += 44
        for i, (im, cap) in enumerate(items):
            x = PAD + i * (W + GAP)
            canvas.paste(im, (x, y))
            cy = y + im.height + 10
            for j, line in enumerate(cap.split('\n')):
                d.text((x, cy + j * 28), line, font=F_CAP, fill=MUTED)
        y += row_h + 34 + 30 + 20

    canvas.save(out_path, 'PNG')
    print('saved', out_path, canvas.size)


def build_privacy(out_path):
    """v1.3.3：去掉头像 + 页面不再显示学号（我的 / 身份页 / 班委 / 统计）。"""
    items = [
        (os.path.join(AFTER, '04-me.png'), '我的：只显示姓名 + 角色徽章\n无头像、无学号'),
        (os.path.join(TESTS, '_shots', 'mp_identity_verified.png'), '身份页：已保存身份卡\n只显示姓名 + 角色'),
        (os.path.join(TESTS, '_shots', 'mp_committee.png'), '班委名单：座位号 + 姓名 + 职务\n不显示学号'),
        (os.path.join(TESTS, '_shots', 'mp_stats_admin.png'), '访问统计：按姓名聚合\n不显示学号'),
    ]
    imgs = []
    for path, cap in items:
        im = Image.open(path).convert('RGB')
        ratio = W / im.width
        imgs.append((im.resize((W, int(im.height * ratio)), Image.LANCZOS), cap))
    row_h = imgs[0][0].height
    w = PAD * 2 + GAP * 3 + W * 4
    h = PAD + 96 + 34 + row_h + 60 + 20 + PAD
    canvas = Image.new('RGB', (w, h), BG)
    d = ImageDraw.Draw(canvas)
    d.text((PAD, PAD), '隐私展示清理 · 去掉头像 / 不再显示学号', font=F_TITLE, fill=INK)
    d.text((PAD + 2, PAD + 62), 'v1.3.3：页面不再打码展示学号，直接不显示；头像功能整体移除（学号仅用于云端身份校验）', font=F_SUB, fill=MUTED)
    y = PAD + 128
    for i, (im, cap) in enumerate(imgs):
        x = PAD + i * (W + GAP)
        canvas.paste(im, (x, y))
        for j, line in enumerate(cap.split('\n')):
            d.text((x, y + im.height + 12 + j * 28), line, font=F_CAP, fill=MUTED)
    canvas.save(out_path, 'PNG')
    print('saved', out_path, canvas.size)


def build_sheet(out_path):
    im = load('03-tools-order.png', AFTER)
    w = PAD * 2 + im.width
    h = PAD + 96 + im.height + 160
    canvas = Image.new('RGB', (w, h), BG)
    d = ImageDraw.Draw(canvas)
    d.text((PAD, PAD), '工具页 · 调整首页快捷', font=F_TITLE, fill=INK)
    d.text((PAD + 2, PAD + 62), '前 4 个工具显示在工作台；↑ / ↓ 调整后立即保存（顺序按账号同步）', font=F_SUB, fill=MUTED)
    canvas.paste(im, (PAD, PAD + 110))
    d.text((PAD, PAD + 110 + im.height + 16), '工作台「常用工具」与「工具 → 首页快捷」使用同一份 homeTools 顺序', font=F_CAP, fill=MUTED)
    canvas.save(out_path, 'PNG')
    print('saved', out_path, canvas.size)


if __name__ == '__main__':
    os.makedirs(DESKTOP, exist_ok=True)
    build_compare(os.path.join(DESKTOP, '小程序首页信息架构重设计_前后对比_20261104.png'))
    build_sheet(os.path.join(DESKTOP, '小程序首页信息架构重设计_工具页排序_20261104.png'))
    build_privacy(os.path.join(DESKTOP, '小程序学号头像展示清理_20261104.png'))
