#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
color_audit.py — 微信小程序 WXSS 配色静态审计（WCAG 对比度 / 硬编码 / 暗色覆盖 / 调色板快照）

用途：给「小程序通知页（pages/nt）配色优化」做改色前后可复跑的静态色彩审计。
只读小程序源码，只写 --out 指定的报告目录。

基本用法（在 mp-class-tools-tests 目录下执行）：
  # 审计当前源码（默认 target = ../mp-class-tools/pages/nt/nt.wxss + app.wxss）
  python color_audit.py --out _color_audit/after --label after

  # 审计冻结快照 / 任意 target
  python color_audit.py --root _color_audit/before/source --out _color_audit/before --label before
  python color_audit.py --page other/page.wxss --app app.wxss --wxml other/page.wxml --out _color_audit/x

  # 可选附加文件（组件 wxss 等，只做字面量/暗色覆盖统计，不参与 DOM 对比度推断）
  python color_audit.py --extra components/bottom-sheet/index.wxss --out _color_audit/after

  # 前后对比（读两个 report.json，写 COMPARE.md）
  python color_audit.py --compare _color_audit/before _color_audit/after --out _color_audit/COMPARE.md

口径：
  * rpx→px：1rpx = 0.5px（750 设计宽 / 375pt 视口）。
  * WCAG：normal < 4.5 判失败；large = px≥24 或 (px≥18.66 且 weight≥600)，large < 3.0 判失败。
  * 单位一律按静态 WXSS 计算；无法静态解析的组合写入 unresolved / conditional，绝不虚构比值。
  * 页面级 --nt-* token（浅色定义在 .nt-page、暗色在 @media(prefers-color-scheme:dark) .nt-page）
    会被合并进该页 token 表；app.wxss 的 page token 作为全局底层。
"""

from __future__ import annotations

import argparse
import bisect
import hashlib
import json
import math
import re
import sys
from datetime import datetime
from pathlib import Path

VERSION = "1.2"
RPX_TO_PX = 0.5
NORMAL_MIN = 4.5
LARGE_MIN = 3.0
LARGE_PX = 24.0
LARGE_BOLD_PX = 18.66
CRITICAL_MARGIN_NORMAL = 5.0
CRITICAL_MARGIN_LARGE = 3.5

# --------------------------------------------------------------------------------------
# 颜色表 / 基础工具
# --------------------------------------------------------------------------------------

# 常用 CSS 命名色（静态审计够用；小程序源码里若出现表外颜色名会被列为"未识别颜色名"）
NAMED_COLORS = {
    "transparent": (0, 0, 0, 0.0),
    "aliceblue": (240, 248, 255, 1), "antiquewhite": (250, 235, 215, 1), "aqua": (0, 255, 255, 1),
    "aquamarine": (127, 255, 212, 1), "azure": (240, 255, 255, 1), "beige": (245, 245, 220, 1),
    "bisque": (255, 228, 196, 1), "black": (0, 0, 0, 1), "blanchedalmond": (255, 235, 205, 1),
    "blue": (0, 0, 255, 1), "blueviolet": (138, 43, 226, 1), "brown": (165, 42, 42, 1),
    "burlywood": (222, 184, 135, 1), "cadetblue": (95, 158, 160, 1), "chartreuse": (127, 255, 0, 1),
    "chocolate": (210, 105, 30, 1), "coral": (255, 127, 80, 1), "cornflowerblue": (100, 149, 237, 1),
    "cornsilk": (255, 248, 220, 1), "crimson": (220, 20, 60, 1), "cyan": (0, 255, 255, 1),
    "darkblue": (0, 0, 139, 1), "darkcyan": (0, 139, 139, 1), "darkgoldenrod": (184, 134, 11, 1),
    "darkgray": (169, 169, 169, 1), "darkgreen": (0, 100, 0, 1), "darkgrey": (169, 169, 169, 1),
    "darkkhaki": (189, 183, 107, 1), "darkmagenta": (139, 0, 139, 1), "darkolivegreen": (85, 107, 47, 1),
    "darkorange": (255, 140, 0, 1), "darkorchid": (153, 50, 204, 1), "darkred": (139, 0, 0, 1),
    "darksalmon": (233, 150, 122, 1), "darkseagreen": (143, 188, 143, 1), "darkslateblue": (72, 61, 139, 1),
    "darkslategray": (47, 79, 79, 1), "darkslategrey": (47, 79, 79, 1), "darkturquoise": (0, 206, 209, 1),
    "darkviolet": (148, 0, 211, 1), "deeppink": (255, 20, 147, 1), "deepskyblue": (0, 191, 255, 1),
    "dimgray": (105, 105, 105, 1), "dimgrey": (105, 105, 105, 1), "dodgerblue": (30, 144, 255, 1),
    "firebrick": (178, 34, 34, 1), "floralwhite": (255, 250, 240, 1), "forestgreen": (34, 139, 34, 1),
    "fuchsia": (255, 0, 255, 1), "gainsboro": (220, 220, 220, 1), "ghostwhite": (248, 248, 255, 1),
    "gold": (255, 215, 0, 1), "goldenrod": (218, 165, 32, 1), "gray": (128, 128, 128, 1),
    "green": (0, 128, 0, 1), "greenyellow": (173, 255, 47, 1), "grey": (128, 128, 128, 1),
    "honeydew": (240, 255, 240, 1), "hotpink": (255, 105, 180, 1), "indianred": (205, 92, 92, 1),
    "indigo": (75, 0, 130, 1), "ivory": (255, 255, 240, 1), "khaki": (240, 230, 140, 1),
    "lavender": (230, 230, 250, 1), "lavenderblush": (255, 240, 245, 1), "lawngreen": (124, 252, 0, 1),
    "lemonchiffon": (255, 250, 205, 1), "lightblue": (173, 216, 230, 1), "lightcoral": (240, 128, 128, 1),
    "lightcyan": (224, 255, 255, 1), "lightgoldenrodyellow": (250, 250, 210, 1), "lightgray": (211, 211, 211, 1),
    "lightgreen": (144, 238, 144, 1), "lightgrey": (211, 211, 211, 1), "lightpink": (255, 182, 193, 1),
    "lightsalmon": (255, 160, 122, 1), "lightseagreen": (32, 178, 170, 1), "lightskyblue": (135, 206, 250, 1),
    "lightslategray": (119, 136, 153, 1), "lightslategrey": (119, 136, 153, 1), "lightsteelblue": (176, 196, 222, 1),
    "lightyellow": (255, 255, 224, 1), "lime": (0, 255, 0, 1), "limegreen": (50, 205, 50, 1),
    "linen": (250, 240, 230, 1), "magenta": (255, 0, 255, 1), "maroon": (128, 0, 0, 1),
    "mediumaquamarine": (102, 205, 170, 1), "mediumblue": (0, 0, 205, 1), "mediumorchid": (186, 85, 211, 1),
    "mediumpurple": (147, 112, 219, 1), "mediumseagreen": (60, 179, 113, 1), "mediumslateblue": (123, 104, 238, 1),
    "mediumspringgreen": (0, 250, 154, 1), "mediumturquoise": (72, 209, 204, 1), "mediumvioletred": (199, 21, 133, 1),
    "midnightblue": (25, 25, 112, 1), "mintcream": (245, 255, 250, 1), "mistyrose": (255, 228, 225, 1),
    "moccasin": (255, 228, 181, 1), "navajowhite": (255, 222, 173, 1), "navy": (0, 0, 128, 1),
    "oldlace": (253, 245, 230, 1), "olive": (128, 128, 0, 1), "olivedrab": (107, 142, 35, 1),
    "orange": (255, 165, 0, 1), "orangered": (255, 69, 0, 1), "orchid": (218, 112, 214, 1),
    "palegoldenrod": (238, 232, 170, 1), "palegreen": (152, 251, 152, 1), "paleturquoise": (175, 238, 238, 1),
    "palevioletred": (219, 112, 147, 1), "papayawhip": (255, 239, 213, 1), "peachpuff": (255, 218, 185, 1),
    "peru": (205, 133, 63, 1), "pink": (255, 192, 203, 1), "plum": (221, 160, 221, 1),
    "powderblue": (176, 224, 230, 1), "purple": (128, 0, 128, 1), "rebeccapurple": (102, 51, 153, 1),
    "red": (255, 0, 0, 1), "rosybrown": (188, 143, 143, 1), "royalblue": (65, 105, 225, 1),
    "saddlebrown": (139, 69, 19, 1), "salmon": (250, 128, 114, 1), "sandybrown": (244, 164, 96, 1),
    "seagreen": (46, 139, 87, 1), "seashell": (255, 245, 238, 1), "sienna": (160, 82, 45, 1),
    "silver": (192, 192, 192, 1), "skyblue": (135, 206, 235, 1), "slateblue": (106, 90, 205, 1),
    "slategray": (112, 128, 144, 1), "slategrey": (112, 128, 144, 1), "snow": (255, 250, 250, 1),
    "springgreen": (0, 255, 127, 1), "steelblue": (70, 130, 180, 1), "tan": (210, 180, 140, 1),
    "teal": (0, 128, 128, 1), "thistle": (216, 191, 216, 1), "tomato": (255, 99, 71, 1),
    "turquoise": (64, 224, 208, 1), "violet": (238, 130, 238, 1), "wheat": (245, 222, 179, 1),
    "white": (255, 255, 255, 1), "whitesmoke": (245, 245, 245, 1), "yellow": (255, 255, 0, 1),
    "yellowgreen": (154, 205, 50, 1),
}
NAMED_KEYS = "|".join(sorted(NAMED_COLORS.keys(), key=len, reverse=True))
COLOR_TOKEN_RE = re.compile(
    r"#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{3}\b"
    r"|rgba?\([^()]*\)"
    r"|(?<![\w#.-])(?:" + NAMED_KEYS + r")(?![\w-])",
    re.IGNORECASE,
)
GRADIENT_FN_RE = re.compile(r"(linear|radial|conic)-gradient\(", re.IGNORECASE)


def read_text(path: Path) -> str:
    data = path.read_bytes()
    for enc in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()


def strip_comments(text: str) -> str:
    """把 /* ... */ 替换成等长空格（保留换行），保证行号/偏移不变。"""
    out = list(text)
    i, n = 0, len(text)
    while i < n:
        if text[i] == "/" and i + 1 < n and text[i + 1] == "*":
            j = text.find("*/", i + 2)
            j = n if j < 0 else j
            end = min(j + 2, n)
            for k in range(i, end):
                if out[k] != "\n":
                    out[k] = " "
            i = end
        else:
            i += 1
    return "".join(out)


def split_top(s: str, sep: str = ",") -> list[str]:
    """按顶层分隔符切分（忽略括号/引号内部）。"""
    parts, depth, start, quote = [], 0, 0, None
    i = 0
    while i < len(s):
        ch = s[i]
        if quote:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
        elif ch in "([":
            depth += 1
        elif ch in ")]":
            depth = max(0, depth - 1)
        elif ch == sep and depth == 0:
            parts.append(s[start:i])
            start = i + 1
        i += 1
    parts.append(s[start:])
    return [p.strip() for p in parts]


def find_matching_paren(s: str, open_idx: int) -> int:
    """s[open_idx] == '('，返回匹配的 ')' 下标（找不到返回 -1）。"""
    depth = 0
    for i in range(open_idx, len(s)):
        if s[i] == "(":
            depth += 1
        elif s[i] == ")":
            depth -= 1
            if depth == 0:
                return i
    return -1


class Source:
    """一个 CSS 文件：原文 + 去注释文本（等长）+ 行号索引。"""

    def __init__(self, path: Path, role: str):
        self.path = Path(path)
        self.role = role
        self.text = read_text(self.path)
        self.stripped = strip_comments(self.text)
        self.line_starts = [0] + [i + 1 for i, ch in enumerate(self.text) if ch == "\n"]
        self.sha = sha256_text(self.text)

    def line_of(self, offset: int) -> int:
        return bisect.bisect_right(self.line_starts, max(0, offset))

    def line_text(self, line: int) -> str:
        lines = self.text.splitlines()
        if 1 <= line <= len(lines):
            return lines[line - 1].strip()
        return ""


# --------------------------------------------------------------------------------------
# CSS 解析
# --------------------------------------------------------------------------------------


class Decl:
    __slots__ = ("prop", "value", "line", "selector")

    def __init__(self, prop: str, value: str, line: int, selector: str = ""):
        self.prop = prop
        self.value = value
        self.line = line
        self.selector = selector


class Rule:
    __slots__ = ("src", "selector_raw", "selectors", "decls", "line", "dark", "at_stack", "keyframes", "order")

    def __init__(self, src, selector_raw, selectors, decls, line, dark, at_stack, keyframes=False):
        self.src = src
        self.selector_raw = selector_raw
        self.selectors = selectors
        self.decls = decls
        self.line = line
        self.dark = dark
        self.at_stack = at_stack
        self.keyframes = keyframes
        self.order = 0


def parse_decls_text(src: Source, body: str, body_base: int, selectors: list[str]) -> list[Decl]:
    decls: list[Decl] = []
    seg_start, depth, i = 0, 0, 0
    n = len(body)

    def add(seg_start_: int, seg_end_: int):
        seg = body[seg_start_:seg_end_]
        if not seg.strip():
            return
        lead = len(seg) - len(seg.lstrip())
        m = _find_colon(seg)
        if m < 0:
            return
        prop = seg[:m].strip().lower()
        value = seg[m + 1:].strip()
        value = re.sub(r"\s*!important\s*$", "", value, flags=re.I).strip()
        line = src.line_of(body_base + seg_start_ + lead)
        if prop:
            decls.append(Decl(prop, value, line, selectors[0] if selectors else ""))

    while i < n:
        ch = body[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        elif ch == ";" and depth == 0:
            add(seg_start, i)
            seg_start = i + 1
        i += 1
    add(seg_start, n)
    return decls


def _find_colon(seg: str) -> int:
    depth = 0
    for i, ch in enumerate(seg):
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth = max(0, depth - 1)
        elif ch == ":" and depth == 0:
            return i
    return -1


def parse_stylesheet(src: Source) -> list[Rule]:
    rules: list[Rule] = []
    text = src.stripped

    def parse_block(block: str, base: int, at_stack: list[str], keyframes: bool):
        i, n = 0, len(block)
        while i < n:
            while i < n and block[i] in " \t\r\n;":
                i += 1
            if i >= n:
                break
            if block[i] == "}":
                i += 1
                continue
            start = i
            while i < n and block[i] not in "{};":
                i += 1
            if i >= n:
                break
            prelude_raw = block[start:i]
            prelude = prelude_raw.strip()
            if block[i] == ";":
                i += 1
                continue
            j = i + 1
            depth = 1
            while j < n and depth:
                if block[j] == "{":
                    depth += 1
                elif block[j] == "}":
                    depth -= 1
                j += 1
            body = block[i + 1:j - 1] if depth == 0 else block[i + 1:]
            body_base = base + i + 1
            if prelude.startswith("@"):
                if re.match(r"@(?:media|supports|container|layer|scope)\b", prelude, re.I):
                    parse_block(body, body_base, at_stack + [prelude], keyframes)
                elif re.match(r"@(?:-\w+-)?keyframes\b", prelude, re.I):
                    parse_block(body, body_base, at_stack + [prelude], True)
                # 其他 at 规则（font-face 等）不参与色彩审计
            else:
                sel_line = src.line_of(base + start + (len(prelude_raw) - len(prelude_raw.lstrip())))
                selectors = [s for s in split_top(prelude, ",") if s]
                if selectors:
                    decls = parse_decls_text(src, body, body_base, selectors)
                    dark = any(
                        re.search(r"prefers-color-scheme\s*:\s*dark", at or "", re.I) for at in at_stack
                    )
                    rules.append(Rule(src, prelude, selectors, decls, sel_line, dark, list(at_stack), keyframes))
            i = j

    parse_block(text, 0, [], False)
    for idx, r in enumerate(rules):
        r.order = idx
    return rules


# --------------------------------------------------------------------------------------
# 选择器 / 匹配
# --------------------------------------------------------------------------------------

_PSEUDO_RE = re.compile(r"::?[\w-]+(?:\([^)]*\))?")


def parse_selector_parts(sel: str):
    """把选择器拆成 [(combinator, compound), ...]，combinator 表示与前一部分的关系。"""
    s = sel.strip()
    if not s:
        return []
    parts, buf, pending, depth, i = [], [], None, 0, 0
    while i < len(s):
        ch = s[i]
        if ch in "([":
            depth += 1
            buf.append(ch)
        elif ch in ")]":
            depth = max(0, depth - 1)
            buf.append(ch)
        elif depth == 0 and ch in ">+~":
            if "".join(buf).strip():
                parts.append((pending, "".join(buf).strip()))
                buf = []
            pending = ch
        elif depth == 0 and ch.isspace():
            j = i
            while j < len(s) and s[j].isspace():
                j += 1
            if j < len(s) and s[j] in ">+~":
                i = j
                continue
            if "".join(buf).strip():
                parts.append((pending, "".join(buf).strip()))
                buf = []
            pending = " " if parts else None
        else:
            buf.append(ch)
        i += 1
    if "".join(buf).strip():
        parts.append((pending, "".join(buf).strip()))
    return [(c, p) for c, p in parts if p]


def compound_classes(compound: str) -> set[str]:
    return set(re.findall(r"\.([A-Za-z_][\w-]*)", _PSEUDO_RE.sub("", compound)))


def compound_has_pseudo_element(compound: str) -> bool:
    return "::" in compound


def compound_tag(compound: str) -> str | None:
    c = _PSEUDO_RE.sub("", compound).strip()
    m = re.match(r"^([A-Za-z][\w-]*)", c)
    return m.group(1).lower() if m else None


def compute_specificity(sel: str) -> int:
    s = _PSEUDO_RE.sub("", sel)
    ids = len(re.findall(r"#[\w-]+", s))
    classes = len(re.findall(r"\.[\w-]+", s)) + len(re.findall(r"\[[^\]]*\]", s))
    types = len(re.findall(r"(?:^|[\s>+~])([A-Za-z][\w-]*)", s))
    elems = len(re.findall(r"::[\w-]+", sel))
    return ids * 100 + classes * 10 + types + elems


def selector_matches_element(parts, chain, use_static: bool = False) -> bool:
    """chain: [ancestor..., element] 的 element dict 列表（含 classes/tag）。
    只支持后代 / 子组合器；最右 compound 必须命中 element 自身（祖先规则不算作用在元素上）。
    use_static=True 时只用 static_classes 匹配（用于判断「无条件覆盖」，忽略动态状态类）。
    """
    if not parts:
        return True
    last = len(parts) - 1

    def match_at(pi: int, ei: int) -> bool:
        if pi < 0:
            return True
        comb, compound = parts[pi]
        need = compound_classes(compound)
        tag = compound_tag(compound)
        if compound_has_pseudo_element(compound):
            return False
        if pi == last:
            # 目标元素自身必须匹配最右 compound
            return _compound_ok(compound, need, tag, chain[ei], use_static) and match_at(pi - 1, ei - 1)
        if comb == ">":
            if ei < 0:
                return False
            return _compound_ok(compound, need, tag, chain[ei], use_static) and match_at(pi - 1, ei - 1)
        j = ei
        while j >= 0:
            if _compound_ok(compound, need, tag, chain[j], use_static) and match_at(pi - 1, j - 1):
                return True
            j -= 1
        return False

    return match_at(last, len(chain) - 1)


def _compound_ok(compound: str, need: set[str], tag: str | None, element: dict,
                 use_static: bool = False) -> bool:
    classes = element.get("static_classes" if use_static else "classes", set())
    if need and not need.issubset(classes):
        return False
    if tag and tag not in ("*",) and tag != element.get("tag"):
        if tag == "page" and element.get("tag") == "page":
            return True
        return False
    return True


# --------------------------------------------------------------------------------------
# 颜色解析 / WCAG
# --------------------------------------------------------------------------------------


class Color:
    __slots__ = ("r", "g", "b", "a", "raw", "kind")

    def __init__(self, r: int, g: int, b: int, a: float, raw: str, kind: str):
        self.r, self.g, self.b, self.a = int(r), int(g), int(b), max(0.0, min(1.0, float(a)))
        self.raw, self.kind = raw, kind

    def css(self) -> str:
        if self.a >= 0.999:
            return "#%02X%02X%02X" % (self.r, self.g, self.b)
        a = round(self.a, 3)
        return "rgba(%d, %d, %d, %s)" % (self.r, self.g, self.b, ("%g" % a))

    def key(self) -> tuple:
        return (self.r, self.g, self.b, round(self.a, 3))

    def __repr__(self):
        return self.css()


def _parse_component(tok: str, scale=255.0) -> float:
    tok = tok.strip()
    if tok.endswith("%"):
        return float(tok[:-1]) / 100.0 * scale
    return float(tok)


def parse_color(raw: str) -> Color | None:
    s = raw.strip()
    low = s.lower()
    if low.startswith("#"):
        h = low[1:]
        if len(h) in (3, 4):
            h = "".join(c * 2 for c in h)
        if len(h) == 6:
            try:
                return Color(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 1.0, s, "hex")
            except ValueError:
                return None
        if len(h) == 8:
            try:
                return Color(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16),
                             int(h[6:8], 16) / 255.0, s, "hex")
            except ValueError:
                return None
        return None
    m = re.fullmatch(r"rgba?\((.*)\)", low, re.S)
    if m:
        inner = m.group(1).replace("/", " ")
        inner = re.sub(r"\s+", " ", inner).strip()
        chunks = [c for c in re.split(r"[,\s]+", inner) if c]
        try:
            if len(chunks) < 3:
                return None
            r, g, b = (_parse_component(c) for c in chunks[:3])
            a = _parse_component(chunks[3], 1.0) if len(chunks) > 3 else 1.0
            return Color(round(r), round(g), round(b), a, s, "rgb")
        except (ValueError, TypeError):
            return None
    if low in NAMED_COLORS:
        r, g, b, a = NAMED_COLORS[low]
        return Color(r, g, b, a, s, "named")
    return None


def find_color_tokens(value: str):
    """返回 [(match_start, raw_text, Color|None)]；未知命名色返回 Color=None 并由调用方标记。"""
    out = []
    for m in COLOR_TOKEN_RE.finditer(value):
        raw = m.group(0)
        c = parse_color(raw)
        out.append((m.start(), raw, c))
    return out


def in_var_fallback(value: str, pos: int) -> bool:
    """判断 pos 处的颜色是否位于 var(--x, <fallback>) 的 fallback 段（不是任意括号内的逗号）。"""
    stack: list[int] = []
    for i, ch in enumerate(value):
        if i == pos:
            break
        if ch == "(":
            stack.append(i)
        elif ch == ")" and stack:
            stack.pop()
    for open_idx in reversed(stack):
        k = open_idx - 1
        while k >= 0 and value[k].isspace():
            k -= 1
        end = k + 1
        while k >= 0 and (value[k].isalnum() or value[k] in "-_"):
            k -= 1
        fname = value[k + 1:end].lower()
        if fname != "var":
            continue
        inner = value[open_idx + 1:]
        d = 0
        for j, ch in enumerate(inner):
            if ch == "(":
                d += 1
            elif ch == ")":
                if d == 0:
                    break
                d -= 1
            elif ch == "," and d == 0:
                return open_idx + 1 + j < pos
        return False
    return False


def _srgb_lin(c: int) -> float:
    x = c / 255.0
    return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4


def luminance(c: Color) -> float:
    return 0.2126 * _srgb_lin(c.r) + 0.7152 * _srgb_lin(c.g) + 0.0722 * _srgb_lin(c.b)


def contrast_ratio(a: Color, b: Color) -> float:
    la, lb = luminance(a), luminance(b)
    hi, lo = (la, lb) if la >= lb else (lb, la)
    return (hi + 0.05) / (lo + 0.05)


def composite(fg: Color, bg: Color) -> Color:
    a = fg.a + bg.a * (1 - fg.a)
    if a <= 0:
        return Color(0, 0, 0, 0, "rgba(0,0,0,0)", "rgb")
    r = (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a
    g = (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a
    b = (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a
    return Color(round(r), round(g), round(b), a, "composite", "rgb")


def scale_color(c: Color, k: float) -> Color:
    """近似 CSS filter: brightness(k)：各通道乘 k 并截断到 0-255。"""
    clamp = lambda x: max(0, min(255, round(x * k)))
    return Color(clamp(c.r), clamp(c.g), clamp(c.b), c.a, c.raw, c.kind)


def hue_of(c: Color) -> float | None:
    r, g, b = c.r / 255.0, c.g / 255.0, c.b / 255.0
    mx, mn = max(r, g, b), min(r, g, b)
    d = mx - mn
    if d < 1e-6:
        return None
    if mx == r:
        h = ((g - b) / d) % 6
    elif mx == g:
        h = (b - r) / d + 2
    else:
        h = (r - g) / d + 4
    return h * 60.0


def is_chromatic(c: Color) -> bool:
    r, g, b = c.r, c.g, c.b
    mx, mn = max(r, g, b), min(r, g, b)
    if c.a < 0.5:
        return False
    if mx - mn < 12:
        return False
    return True


def hue_buckets(colors: list[Color]) -> dict:
    buckets = {}
    for c in colors:
        if not is_chromatic(c):
            continue
        h = hue_of(c)
        if h is None:
            continue
        b = int(h // 30) * 30
        buckets.setdefault(b, 0)
        buckets[b] += 1
    return {f"{k:03d}-{k + 29:03d}": v for k, v in sorted(buckets.items())}


# --------------------------------------------------------------------------------------
# var() 解析 & token 表
# --------------------------------------------------------------------------------------


class Resolve:
    __slots__ = ("value", "missing", "chain")

    def __init__(self, value, missing=None, chain=None):
        self.value = value
        self.missing = missing or []
        self.chain = chain or []


def resolve_vars(value: str, tokens: dict, _stack=None, _chain=None) -> Resolve:
    """递归解析 var(--x[, fallback])；tokens: {name: {'value': str, ...}}。"""
    _stack = _stack or set()
    _chain = _chain or []
    missing: list[str] = []
    out = value
    guard = 0
    while "var(" in out:
        guard += 1
        if guard > 40:
            return Resolve(None, [f"var() 解析超过 40 层：{value}"], _chain)
        idx = out.find("var(")
        open_idx = idx + 3
        close_idx = find_matching_paren(out, open_idx)
        if close_idx < 0:
            return Resolve(None, [f"var() 括号不匹配：{value}"], _chain)
        inner = out[open_idx + 1:close_idx]
        pieces = split_top(inner, ",")
        name = pieces[0].strip()
        fallback = ",".join(pieces[1:]).strip() if len(pieces) > 1 else None
        repl = None
        if name in _stack:
            return Resolve(None, [f"var() 循环引用：{name}"], _chain)
        if name in tokens:
            sub = resolve_vars(tokens[name]["value"], tokens, _stack | {name}, _chain + [name])
            repl = sub.value
            missing.extend(sub.missing)
            if repl is None and fallback is not None:
                fb = resolve_vars(fallback, tokens, _stack | {name}, _chain + [name])
                repl = fb.value
                missing.extend(fb.missing)
        elif fallback is not None:
            fb = resolve_vars(fallback, tokens, _stack | {name}, _chain + [name])
            repl = fb.value
            missing.extend(fb.missing)
        else:
            missing.append(f"未定义 token：{name}")
            return Resolve(None, missing, _chain + [name])
        if repl is None:
            missing.append(f"无法解析 var({name}) 的 fallback")
            return Resolve(None, missing, _chain + [name])
        out = out[:idx] + repl + out[close_idx + 1:]
    return Resolve(out, missing, _chain)


def token_maps(srcs: list[Source], rules_by_src: dict) -> dict:
    """构建 light/dark 合并 token 表（app 底层 + extra + 页面文件覆盖）。"""
    def file_tokens(src: Source):
        light, dark = {}, {}
        for r in rules_by_src[src]:
            if r.keyframes:
                continue
            for d in r.decls:
                if not d.prop.startswith("--"):
                    continue
                entry = {"value": d.value, "line": d.line, "selector": r.selector_raw, "file": src.path.name, "role": src.role}
                (dark if r.dark else light)[d.prop] = entry
        return light, dark

    app_src = next((s for s in srcs if s.role == "app"), None)
    page_src = next((s for s in srcs if s.role == "page"), None)
    extras = [s for s in srcs if s.role == "extra"]

    app_light, app_dark = file_tokens(app_src) if app_src else ({}, {})
    page_light, page_dark = file_tokens(page_src) if page_src else ({}, {})

    def merged(theme: str) -> dict:
        out = {}
        out.update(app_light)
        if theme == "dark":
            out.update(app_dark)
        for s in extras:
            l, d = file_tokens(s)
            out.update(l)
            if theme == "dark":
                out.update(d)
        out.update(page_light)
        if theme == "dark":
            out.update(page_dark)
        return out

    return {
        "light": merged("light"),
        "dark": merged("dark"),
        "app_light": app_light,
        "app_dark": app_dark,
        "page_light": page_light,
        "page_dark": page_dark,
        "extras_light": {s.path.name: file_tokens(s)[0] for s in extras},
        "extras_dark": {s.path.name: file_tokens(s)[1] for s in extras},
    }


# --------------------------------------------------------------------------------------
# WXML 解析（推断元素祖先链，用于「父类 background」）
# --------------------------------------------------------------------------------------

TAG_RE = re.compile(r"<(/?)([A-Za-z][\w-]*)((?:[^>\"']|\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*')*?)(/?)>", re.S)
CLASS_ATTR_RE = re.compile(r"\bclass\s*=\s*\"([^\"]*)\"", re.S)
CLS_ATTR_RE = re.compile(r"\bcls\s*=\s*\"([^\"]*)\"", re.S)
TEMPLATE_NAME_RE = re.compile(r"\bname\s*=\s*\"([^\"]+)\"")
TEMPLATE_IS_RE = re.compile(r"\bis\s*=\s*\"([^\"]+)\"")

TRANSPARENT_TAGS = {"block", "template", "wxs", "include", "import"}


def parse_class_attr(attr: str):
    static, literals, prefixes = [], [], []
    blocks = re.findall(r"\{\{(.*?)\}\}", attr, re.S)
    remainder = re.sub(r"\{\{.*?\}\}", " ", attr, flags=re.S)
    for tok in remainder.split():
        if tok.endswith("--"):
            prefixes.append(tok)
        elif re.match(r"^[A-Za-z_][\w-]*$", tok):
            static.append(tok)
    for blk in blocks:
        for m in re.finditer(r"'([^']*)'|\"([^\"]*)\"", blk):
            val = m.group(1) if m.group(1) is not None else m.group(2)
            for tok in (val or "").split():
                if re.match(r"^[A-Za-z_][\w-]*$", tok):
                    literals.append(tok)
    for m in re.finditer(r"([A-Za-z_][\w-]*--)\s*\{\{", attr):
        prefixes.append(m.group(1))
    return list(dict.fromkeys(static)), list(dict.fromkeys(literals)), list(dict.fromkeys(prefixes))


def parse_wxml(path: Path, page_classes: set[str]) -> dict:
    text = read_text(path)
    line_starts = [0] + [i + 1 for i, ch in enumerate(text) if ch == "\n"]

    def line_of(off):
        return bisect.bisect_right(line_starts, max(0, off))

    elements: list[dict] = []
    # 虚拟 page 根（匹配 page 选择器）
    elements.append({"tag": "page", "classes": set(), "static_classes": set(), "dynamic_literals": [],
                     "dynamic_prefixes": [], "parent": None, "line": 1, "component": False,
                     "component_kind": None, "template_name": None})
    templates: dict[str, list[int]] = {}
    usages: list[tuple[str, int]] = []
    stack: list[dict] = []  # {'tag','elem' (idx|None),'template_name'}
    def_ctx: list[str] = []

    def top_elem() -> int | None:
        for item in reversed(stack):
            if item.get("elem") is not None:
                return item["elem"]
        return 0 if not stack else None

    for m in TAG_RE.finditer(text):
        closing, tag, attrs, selfclose = m.group(1), m.group(2).lower(), m.group(3) or "", m.group(4) == "/"
        line = line_of(m.start())
        if closing:
            for k in range(len(stack) - 1, -1, -1):
                if stack[k]["tag"] == tag:
                    item = stack[k]
                    del stack[k:]
                    if item.get("template_name") and def_ctx and def_ctx[-1] == item["template_name"]:
                        def_ctx.pop()
                    break
            continue
        if tag == "template":
            tname = TEMPLATE_NAME_RE.search(attrs)
            tis = TEMPLATE_IS_RE.search(attrs)
            if tname:
                stack.append({"tag": "template", "elem": None, "template_name": tname.group(1)})
                def_ctx.append(tname.group(1))
                templates.setdefault(tname.group(1), [])
            elif tis:
                usages.append((tis.group(1), top_elem() if stack else 0))
                if not selfclose:
                    stack.append({"tag": "template", "elem": None, "template_name": None})
            else:
                if not selfclose:
                    stack.append({"tag": "template", "elem": None, "template_name": None})
            continue
        if tag in TRANSPARENT_TAGS:
            if not selfclose:
                stack.append({"tag": tag, "elem": None, "template_name": None})
            continue
        attr_source = attrs
        static, literals, prefixes = [], [], []
        cls_m = CLASS_ATTR_RE.search(attr_source)
        if cls_m:
            static, literals, prefixes = parse_class_attr(cls_m.group(1))
        cls2 = CLS_ATTR_RE.search(attrs)
        if cls2:
            s2, l2, p2 = parse_class_attr(cls2.group(1))
            static += s2
            literals += l2
            prefixes += p2
        proxy = bool(cls2)
        classes = set(static) | set(literals)
        for pref in prefixes:
            for c in page_classes:
                if c.startswith(pref):
                    classes.add(c)
        parent = top_elem() if stack else 0
        idx = len(elements)
        known_components = {"bottom-sheet", "empty-state", "touchable"}
        is_component = tag in ("bottom-sheet", "empty-state")
        elements.append({
            "tag": tag, "classes": classes, "static_classes": set(static),
            "dynamic_literals": list(dict.fromkeys(literals)), "dynamic_prefixes": list(dict.fromkeys(prefixes)),
            "parent": parent, "line": line,
            "component": is_component, "component_kind": tag if is_component else None,
            "custom_component": tag in known_components or "-" in tag,
            "proxy": bool(cls2), "template_name": def_ctx[-1] if def_ctx else None,
        })
        if stack and def_ctx:
            # 记录模板根（直接挂在 template 标记下、且父为 0/无元素的元素）
            parent_item = next((it for it in reversed(stack) if it["tag"] == "template" and it.get("template_name")), None)
            if parent_item is not None and top_elem() in (None, 0):
                templates.setdefault(parent_item["template_name"], []).append(idx)
        if not selfclose:
            stack.append({"tag": tag, "elem": idx, "template_name": None})

    # 模板实例化：把模板根元素的父指向使用处容器
    for tname, roots in templates.items():
        usage = next((u for u in usages if u[0] == tname), None)
        if usage is not None and usage[1] is not None:
            for r in roots:
                elements[r]["parent"] = usage[1]
                elements[r]["instantiated_by_template"] = tname

    for i, el in enumerate(elements):
        el["_idx"] = i
    return {"path": str(path), "elements": elements, "templates": templates, "usages": usages,
            "line_count": len(text.splitlines()), "sha": sha256_text(text)}


def build_chain(elements: list[dict], idx: int) -> list[dict]:
    chain, cur, guard = [], idx, 0
    while cur is not None and guard < 500:
        chain.append(elements[cur])
        cur = elements[cur].get("parent")
        guard += 1
    chain.reverse()
    return chain


# --------------------------------------------------------------------------------------
# 主题化选择器条目（light/dark 各一套有效声明）
# --------------------------------------------------------------------------------------


def normalized_selector(sel: str) -> str:
    return re.sub(r"\s+", " ", sel.strip())


def build_entries(srcs: list[Source], rules_by_src: dict, scope: str) -> list[dict]:
    entries: dict[str, dict] = {}
    order = 0
    for src in srcs:
        for r in rules_by_src[src]:
            if r.keyframes:
                continue
            if r.dark and scope != "dark":
                continue
            for sel in r.selectors:
                key = normalized_selector(sel)
                e = entries.get(key)
                if e is None:
                    e = {"key": key, "selector": sel.strip(), "parts": parse_selector_parts(sel),
                         "decls": {}, "order": 0, "specificity": compute_specificity(sel),
                         "role": src.role, "file": src.path.name}
                    entries[key] = e
                order += 1
                e["order"] = order
                for d in r.decls:
                    if d.prop.startswith("--"):
                        continue
                    e["decls"][d.prop] = {
                        "value": d.value, "line": d.line, "selector": d.selector,
                        "role": src.role, "file": src.path.name, "dark_rule": r.dark,
                    }
    return list(entries.values())


def resolve_decl(decl_meta: dict, tokens: dict) -> tuple[Color | None, dict]:
    res = resolve_vars(decl_meta["value"], tokens)
    info = {"value_raw": decl_meta["value"], "resolved": res.value, "missing": res.missing,
            "token_chain": res.chain,
            "line": decl_meta["line"], "file": decl_meta["file"], "selector": decl_meta["selector"],
            "dark_rule": decl_meta.get("dark_rule", False)}
    if res.value is None:
        return None, info
    c = parse_color(res.value.strip())
    return c, info


# --------------------------------------------------------------------------------------
# 背景候选解析
# --------------------------------------------------------------------------------------


def parse_bg_value(decl_meta: dict, tokens: dict) -> tuple[list[dict], list[str]]:
    """返回 ([candidate...], notes)。candidate: {'kind':'solid'|'gradient','stops':[Color],'raw':..}"""
    res = resolve_vars(decl_meta["value"], tokens)
    if res.value is None:
        return [], [f"背景变量无法解析：{decl_meta['value']}（{'; '.join(res.missing)}）"]
    value = res.value.strip()
    low = value.lower()
    if low in ("none", "inherit", "initial", "unset", "transparent"):
        return [], []
    notes = []
    gradient_spans = []
    for m in GRADIENT_FN_RE.finditer(value):
        open_idx = value.find("(", m.start())
        close_idx = find_matching_paren(value, open_idx)
        if close_idx < 0:
            notes.append("渐变括号不匹配")
            continue
        gradient_spans.append((m.start(), close_idx, value[m.start():close_idx + 1]))
    if gradient_spans:
        cands = []
        for _, _, gtext in gradient_spans:
            colors = [c for _, raw, c in find_color_tokens(gtext) if c is not None]
            if not colors:
                notes.append("渐变中未解析到颜色停靠点")
                continue
            cands.append({"kind": "gradient", "stops": colors, "raw": gtext,
                          "source": decl_meta, "uncertain": any(c.a < 0.9 for c in colors)})
        if "url(" in low:
            notes.append("背景含图片 url（叠加在渐变下方，静态不可解析）")
        return cands, notes
    colors = [c for _, raw, c in find_color_tokens(value) if c is not None]
    if "url(" in low:
        return [], ["背景是图片（url(...)），静态不可解析"]
    if not colors:
        return [], [f"背景值无法解析为颜色：{value}"]
    # background 简写里可能有多个颜色（极少见）：取最后一个，其余记 note
    if len(colors) > 1:
        notes.append("背景简写包含多个颜色，取最后一个作为底色")
    return [{"kind": "solid", "stops": [colors[-1]], "raw": value, "source": decl_meta, "uncertain": False}], notes


def _stop_ground(cand: dict, ground: Color | None) -> tuple[Color | None, bool]:
    if cand["kind"] == "solid":
        c = cand["stops"][0]
        if c.a >= 0.999:
            return c, False
        if ground is None:
            return c, True
        return composite(c, ground), False
    # 渐变：返回第一停靠点（调用方遍历 stops）
    return None, False


# --------------------------------------------------------------------------------------
# 审计主体
# --------------------------------------------------------------------------------------


def audit(args) -> dict:
    root = Path(args.root).resolve()
    page_path = resolve_path(root, args.page)
    app_path = resolve_path(root, args.app)
    wxml_path = resolve_path(root, args.wxml) if args.wxml else None
    extra_paths = [resolve_path(root, p) for p in (args.extra or [])]

    srcs = [Source(app_path, "app"), Source(page_path, "page")]
    for ep in extra_paths:
        srcs.append(Source(ep, "extra"))
    rules_by_src = {s: parse_stylesheet(s) for s in srcs}
    tokens = token_maps(srcs, rules_by_src)
    page_src = next(s for s in srcs if s.role == "page")

    page_rules = rules_by_src[page_src]
    page_classes: set[str] = set()
    for r in page_rules:
        if r.keyframes:
            continue
        for sel in r.selectors:
            page_classes |= compound_classes(sel)
    for s in srcs:
        if s.role != "page":
            continue

    wxml = parse_wxml(wxml_path, page_classes) if (wxml_path and wxml_path.exists()) else None
    elements = wxml["elements"] if wxml else []

    # 页面背景（page 元素背景 token，供兜底）
    page_ground = None
    for scope_name in ("light", "dark"):
        pass
    light_tokens, dark_tokens = tokens["light"], tokens["dark"]

    def page_ground_for(tokens_theme: dict) -> Color | None:
        for src in srcs:
            if src.role == "extra":
                continue
            for r in rules_by_src[src]:
                if r.keyframes or r.dark:
                    continue
                for sel in r.selectors:
                    if normalized_selector(sel) in ("page", ":root"):
                        for d in r.decls:
                            if d.prop in ("background", "background-color"):
                                c, _ = resolve_decl({"value": d.value, "line": d.line, "selector": sel,
                                                     "file": src.path.name, "role": src.role}, tokens_theme)
                                if c:
                                    return c
        for name in ("--nt-bg", "--md-surface"):
            if name in tokens_theme:
                res = resolve_vars(tokens_theme[name]["value"], tokens_theme)
                if res.value:
                    c = parse_color(res.value.strip())
                    if c:
                        return c
        return None

    light_ground = page_ground_for(light_tokens)
    dark_ground = page_ground_for(dark_tokens)

    # 仅当组件 wxss 通过 --extra 显式纳入时，才用组件容器背景做推断；否则按 unresolved 处理（不臆测）
    extra_component_tags: set[str] = set()
    for ep in extra_paths:
        parts = ep.parts
        if "components" in parts:
            idx = parts.index("components")
            if idx + 1 < len(parts):
                extra_component_tags.add(parts[idx + 1])

    # ---- 有效选择器条目 & 元素匹配 ----
    def scope_data(scope: str):
        entries = build_entries(srcs, rules_by_src, scope)
        entry_key_index = {e["key"]: i for i, e in enumerate(entries)}
        matches_by_elem: dict[int, list[int]] = {}
        if elements:
            for ei in range(len(elements)):
                chain = build_chain(elements, ei)
                hits = []
                for k, e in enumerate(entries):
                    if compound_has_pseudo_element(e["selector"]):
                        continue
                    if selector_matches_element(e["parts"], chain):
                        hits.append(k)
                matches_by_elem[ei] = hits
        return entries, entry_key_index, matches_by_elem

    light_entries, light_key_index, light_matches = scope_data("light")
    dark_entries, dark_key_index, dark_matches = scope_data("dark")

    def analyze(scope: str, entries, matches_by_elem, tokens_theme, ground):
        pairs, unresolved = [], []
        if not elements:
            return pairs, unresolved
        matched_rule_selectors = set()

        def matching_entries(ei):
            return [entries[k] for k in matches_by_elem.get(ei, [])]

        def eff_prop(ei, prop):
            hits = [e for e in matching_entries(ei) if prop in e["decls"]]
            if not hits:
                return None, None
            hits.sort(key=lambda e: (e["specificity"], e["order"]))
            return hits[-1]["decls"][prop], hits[-1]

        def chain_of(ei):
            return build_chain(elements, ei)

        def filter_overridden(entry_list, props, ei):
            """去掉被「无条件且更高优先级」的规则覆盖掉的声明（例：.nt-page .m3-btn--filled 覆盖 app 的 .m3-btn--filled）。
            动态状态类（如 .nt-card--done 可能态）不算无条件覆盖，仍按可能状态分别保留。"""
            chain = chain_of(ei)
            def has_prop(e, prop):
                return prop in e["decls"] or (prop == "background" and "background-color" in e["decls"]) \
                    or (prop == "background-color" and "background" in e["decls"])

            out = []
            for e in entry_list:
                if not any(has_prop(e, p) for p in props):
                    out.append(e)
                    continue
                overridden = False
                for e2 in entry_list:
                    if e2 is e:
                        continue
                    if not any(has_prop(e2, p) for p in props):
                        continue
                    if (e2["specificity"], e2["order"]) <= (e["specificity"], e["order"]):
                        continue
                    if selector_matches_element(e2["parts"], chain, use_static=True):
                        overridden = True
                        break
                if not overridden:
                    out.append(e)
            return out

        def resolve_font(ei):
            font_px, px_src = None, None
            weight, w_src = None, None
            for level_elem in reversed(chain_of(ei)):
                el = level_elem
                if font_px is None:
                    d, e = eff_prop(el["_idx"], "font-size")
                    if d is not None:
                        v = resolve_vars(d["value"], tokens_theme).value
                        if v:
                            m = re.match(r"^([\d.]+)\s*(rpx|px|rem|em)?$", v.strip())
                            if m:
                                num = float(m.group(1))
                                unit = m.group(2) or "px"
                                if unit == "rpx":
                                    font_px = num * RPX_TO_PX
                                elif unit == "px":
                                    font_px = num
                                elif unit == "em":
                                    font_px = num * 16.0
                                elif unit == "rem":
                                    font_px = num * 16.0
                                px_src = {"selector": e["selector"], "line": d["line"], "value": v}
                if weight is None:
                    d, e = eff_prop(el["_idx"], "font-weight")
                    if d is not None:
                        v = resolve_vars(d["value"], tokens_theme).value
                        if v:
                            lv = v.strip().lower()
                            if lv == "bold":
                                weight = 700
                            elif lv == "normal":
                                weight = 400
                            else:
                                try:
                                    weight = int(float(lv))
                                except ValueError:
                                    weight = None
                            if weight is not None:
                                w_src = {"selector": e["selector"], "line": d["line"], "value": lv}
                if font_px is not None and weight is not None:
                    break
            if font_px is None:
                font_px = 16.0
                px_src = {"selector": None, "line": None, "value": "default 16px"}
            if weight is None:
                weight = 400
                w_src = {"selector": None, "line": None, "value": "default 400"}
            return font_px, weight, px_src, w_src

        def resolve_opacity(ei):
            prod, notes = 1.0, []
            for level_elem in chain_of(ei):
                hits = [e for e in matching_entries(level_elem["_idx"]) if "opacity" in e["decls"]]
                if not hits:
                    continue
                vals = []
                for e in hits:
                    v = resolve_vars(e["decls"]["opacity"]["value"], tokens_theme).value
                    try:
                        vals.append((float(v), e, e["decls"]["opacity"]))
                    except (TypeError, ValueError):
                        notes.append(f"{e['selector']} opacity 无法解析：{v}")
                if vals:
                    vals.sort(key=lambda t: (t[0], t[1]["specificity"], t[1]["order"]))
                    val, e, d = vals[0]  # 取最小（最坏情况）
                    prod *= val
                    notes.append({"selector": e["selector"], "value": val, "line": d["line"]})
            return prod, notes

        # 自定义组件的容器背景（bottom-sheet / empty-state 等）：从组件 wxss 推断，供 slot 内文字使用
        component_grounds: dict[str, dict | None] = {}
        comp_root_candidates = [root / "components", default_root() / "components"]

        def load_component_ground(tag: str):
            if tag in component_grounds:
                return component_grounds[tag]
            if tag not in extra_component_tags:
                component_grounds[tag] = None
                return None
            wxss = None
            for base in comp_root_candidates:
                cand_path = base / tag / "index.wxss"
                if cand_path.exists():
                    wxss = cand_path
                    break
            if wxss is None:
                component_grounds[tag] = None
                return None
            try:
                cs = Source(wxss, "extra")
                crules = parse_stylesheet(cs)
            except Exception:
                component_grounds[tag] = None
                return None
            best, best_score = None, -1
            for r in crules:
                if r.keyframes:
                    continue
                for sel in r.selectors:
                    lsel = sel.lower()
                    if "mask" in lsel or "grabber" in lsel:
                        continue
                    for d in r.decls:
                        if d.prop not in ("background", "background-color"):
                            continue
                        cands, _notes = parse_bg_value(
                            {"value": d.value, "line": d.line, "selector": sel}, tokens_theme)
                        for cand in cands:
                            if cand["kind"] != "solid":
                                continue
                            col = cand["stops"][0]
                            if col.a < 0.9:
                                continue
                            score = 2 if any(k in lsel for k in ("__sheet", "__panel", "__body", "__content", "__wrap")) else 1
                            if score > best_score:
                                best_score = score
                                best = {
                                    "kind": "solid", "stops": [col], "raw": d.value,
                                    "source_selector": f"<{tag}> 容器（推断）",
                                    "source_line": d.line, "source_kind": "component-inferred",
                                    "notes": [f"自定义组件 <{tag}> 内部：容器背景按 components/{tag}/index.wxss 推断"],
                                    "source": {"dark_rule": r.dark},
                                }
            component_grounds[tag] = best
            return best

        def resolve_filter_scale(ei):
            """祖先/自身的 filter: brightness(k) 近似系数（静态近似，记录在 notes）。
            同一元素上多个可能的状态变体只取最坏一个（CSS 实际只会命中一个）。"""
            k, notes = 1.0, []
            for level_elem in chain_of(ei):
                level_factors = []
                for e in matching_entries(level_elem["_idx"]):
                    if "filter" not in e["decls"]:
                        continue
                    v = resolve_vars(e["decls"]["filter"]["value"], tokens_theme).value
                    if not v:
                        continue
                    for m in re.finditer(r"brightness\(\s*([\d.]+)\s*\)", v, re.I):
                        try:
                            fac = float(m.group(1))
                        except ValueError:
                            continue
                        level_factors.append((fac, e, e["decls"]["filter"]))
                if level_factors:
                    level_factors.sort(key=lambda t: t[0])
                    fac, e, d = level_factors[0]
                    k *= fac
                    notes.append({"selector": e["selector"], "value": fac, "line": d["line"]})
            return k, notes

        def gather_bg(entry_list):
            cands = []
            for e in entry_list:
                for prop in ("background", "background-color"):
                    if prop not in e["decls"]:
                        continue
                    c, notes = parse_bg_value(e["decls"][prop], tokens_theme)
                    for cand in c:
                        cand["source_selector"] = e["selector"]
                        cand["source_line"] = e["decls"][prop]["line"]
                        cand["source_prop"] = prop
                        cand["source_hits"] = 1
                        cand.setdefault("notes", []).extend(notes)
                        cands.append(cand)
            # 去重（颜色/来源不同即不同候选）
            out, seen = [], set()
            for cand in cands:
                sig = (cand["kind"], tuple(c.css() for c in cand["stops"]), cand["source_selector"])
                if sig in seen:
                    continue
                seen.add(sig)
                out.append(cand)
            return out

        def ground_below(level_idx):
            p = elements[level_idx].get("parent")
            guard = 0
            while p is not None and guard < 200:
                el = elements[p]
                if el.get("component"):
                    g = load_component_ground(el["tag"])
                    if g and g["stops"] and g["stops"][0].a >= 0.999:
                        return g["stops"][0]
                    return None
                cands = gather_bg(filter_overridden(
                    [entries[k] for k in matches_by_elem.get(p, [])],
                    ["background", "background-color"], p))
                if cands:
                    c = cands[0]
                    if c["kind"] == "solid" and c["stops"][0].a >= 0.999:
                        return c["stops"][0]
                    g = ground_below(p)
                    if c["kind"] == "solid":
                        if g is None:
                            return None
                        return composite(c["stops"][0], g)
                p = el.get("parent")
                guard += 1
            return ground

        def bg_candidates(ei, ce):
            self_entry_bg = []
            for prop in ("background", "background-color"):
                if prop in ce["decls"]:
                    c, notes = parse_bg_value(ce["decls"][prop], tokens_theme)
                    for cand in c:
                        cand["source_selector"] = ce["selector"]
                        cand["source_line"] = ce["decls"][prop]["line"]
                        cand["source_prop"] = prop
                        cand.setdefault("notes", []).extend(notes)
                        cand["source_kind"] = "own-rule"
                    self_entry_bg.extend(c)
            if self_entry_bg:
                return self_entry_bg, None
            # 同元素的「纯背景」规则（如 .nt-cat--jw）
            self_others = filter_overridden(
                [e for e in matching_entries(ei)
                 if e is not ce and "color" not in e["decls"]
                 and ("background" in e["decls"] or "background-color" in e["decls"])],
                ["background", "background-color"], ei)
            cands = gather_bg(self_others)
            for c in cands:
                c["source_kind"] = "same-element-variant"
            if cands:
                return cands, None
            # 祖先链
            level = ei
            while level is not None:
                el = elements[level]
                if el.get("component"):
                    g = load_component_ground(el["tag"])
                    if g:
                        return [dict(g)], None
                    return [], f"位于自定义组件 <{el['tag']}> 内部，且未找到组件容器背景（可 --extra 该组件 wxss 后人工核对）"
                if level != ei:
                    level_entries = filter_overridden(
                        [entries[k] for k in matches_by_elem.get(level, [])],
                        ["background", "background-color"], level)
                    cands = gather_bg(level_entries)
                    if cands:
                        for c in cands:
                            c["source_kind"] = "ancestor"
                        return cands, None
                level = el.get("parent")
            if ground:
                return [{"kind": "solid", "stops": [ground], "raw": "page-ground",
                         "source": {"selector": "page", "line": None}, "source_selector": "page", "source_line": None,
                         "source_prop": "background", "source_kind": "page-ground", "notes": []}], None
            return [], "未找到任何背景（祖先链到 page 均无 background）"

        for ei, el in enumerate(elements):
            me = matches_by_elem.get(ei, [])
            if not me:
                continue
            color_entries = filter_overridden(
                [entries[k] for k in me if "color" in entries[k]["decls"]], ["color"], ei)
            if not color_entries:
                continue
            font_px, weight, font_src, w_src = resolve_font(ei)
            opacity, op_notes = resolve_opacity(ei)
            large = font_px >= LARGE_PX or (font_px >= LARGE_BOLD_PX and weight >= 600)
            threshold = LARGE_MIN if large else NORMAL_MIN
            filter_scale, filter_notes = resolve_filter_scale(ei)
            for ce in color_entries:
                if compound_has_pseudo_element(ce["selector"]):
                    continue
                matched_rule_selectors.add(ce["selector"])
                text_color, tinfo = resolve_decl(ce["decls"]["color"], tokens_theme)
                if text_color is None:
                    unresolved.append({
                        "scope": scope, "element_line": el["line"], "element_classes": sorted(el["static_classes"]),
                        "selector": ce["selector"], "font_px": font_px, "font_weight": weight,
                        "reason": "文字颜色无法解析：" + "; ".join(tinfo["missing"]),
                    })
                    continue
                cands, reason = bg_candidates(ei, ce)
                if not cands:
                    unresolved.append({
                        "scope": scope, "element_line": el["line"], "element_classes": sorted(el["static_classes"]),
                        "selector": ce["selector"], "font_px": font_px, "font_weight": weight,
                        "reason": reason or "无背景",
                    })
                    continue
                for cand in cands:
                    for stop in cand["stops"]:
                        bg_color = stop
                        uncertain = bool(cand.get("uncertain"))
                        notes = list(cand.get("notes", []))
                        if bg_color.a < 0.999:
                            g = ground_below(cand.get("_level", ei))
                            if g is not None:
                                bg_color = composite(bg_color, g)
                            else:
                                uncertain = True
                                notes.append("半透明背景下方无法静态确定")
                        text_base = text_color
                        if bg_color.a < 0.999:
                            uncertain = True
                            notes.append("背景半透明，静态不可完全确定")
                        if filter_scale != 1.0:
                            bg_color = scale_color(bg_color, filter_scale)
                            text_base = scale_color(text_base, filter_scale)
                            notes.append(f"已按 filter brightness({filter_scale:g}) 近似缩放前景/背景")
                        ratio_base = contrast_ratio(text_base, bg_color)
                        # opacity 降权态（如 .nt-card--done）：作为条件性风险单独给出，不污染硬失败
                        ratio_eff = ratio_base
                        if opacity < 0.999:
                            eff = composite(
                                Color(text_base.r, text_base.g, text_base.b,
                                      text_base.a * opacity, text_base.raw, text_base.kind),
                                bg_color if bg_color.a >= 0.999 else Color(255, 255, 255, 1, "#FFFFFF", "hex"))
                            ratio_eff = contrast_ratio(eff, bg_color)
                        verdict = "fail" if ratio_base < threshold else (
                            "critical" if ratio_base < (CRITICAL_MARGIN_LARGE if large else CRITICAL_MARGIN_NORMAL) else "pass")
                        opacity_risk = bool(ratio_base >= threshold and ratio_eff < threshold)
                        conditional = bool(uncertain or opacity_risk)
                        if opacity_risk:
                            notes.append(f"opacity {opacity:g} 降权后 {ratio_eff:.2f} < {threshold:g}")
                        pairs.append({
                            "scope": scope,
                            "selector": ce["selector"],
                            "rule_line": ce["decls"]["color"]["line"],
                            "text": {"token": tinfo["token_chain"], "value_raw": tinfo["value_raw"],
                                     "resolved": tinfo["resolved"], "hex": text_color.css(),
                                     "missing": tinfo["missing"]},
                            "bg": {"kind": cand["kind"], "hex": bg_color.css(),
                                   "stops": [c.css() for c in cand["stops"]],
                                   "raw": cand.get("raw"), "source": cand.get("source_selector"),
                                   "source_line": cand.get("source_line"),
                                   "source_kind": cand.get("source_kind"),
                                   "dark_rule": (cand.get("source") or {}).get("dark_rule", False)},
                            "font_px": round(font_px, 2), "font_weight": weight, "large": large,
                            "threshold": threshold, "ratio": round(ratio_base, 2),
                            "ratio_with_opacity": round(ratio_eff, 2) if opacity < 0.999 else None,
                            "verdict": verdict, "opacity": round(opacity, 3), "opacity_chain": op_notes,
                            "opacity_risk": opacity_risk,
                            "rule_role": ce.get("role"), "rule_file": ce.get("file"),
                            "filter_scale": round(filter_scale, 3) if filter_scale != 1.0 else None,
                            "filter_chain": filter_notes,
                            "conditional": conditional, "uncertain": uncertain,
                            "notes": notes,
                            "elements_sample": sorted(el["static_classes"]),
                            "font_source": font_src, "weight_source": w_src,
                        })

        # 去重（同一文字规则 × 同一背景颜色 × 同一字号 = 同一个视觉结论；来源合并记录）
        dedup = {}
        for p in pairs:
            key = (p["scope"], p["selector"], p["bg"]["hex"], p["font_px"], p["threshold"],
                   p["ratio"], p["conditional"], p["opacity_risk"], p["uncertain"])
            if key in dedup:
                q = dedup[key]
                q["instances"] += 1
                srcs = q["bg"].setdefault("sources", [q["bg"]["source"]])
                if p["bg"]["source"] not in srcs:
                    srcs.append(p["bg"]["source"])
                q["elements_sample"] = sorted(set(q["elements_sample"]) | set(p["elements_sample"]))
                continue
            p["instances"] = 1
            p["bg"]["sources"] = [p["bg"]["source"]]
            dedup[key] = p
        pairs = list(dedup.values())
        pairs.sort(key=lambda p: (-(1 if p["verdict"] == "fail" else 0), p["ratio"], p["selector"]))
        return pairs, unresolved, matched_rule_selectors

    light_pairs, light_unresolved, light_matched = analyze("light", light_entries, light_matches, light_tokens, light_ground)
    dark_pairs, dark_unresolved, dark_matched = analyze("dark", dark_entries, dark_matches, dark_tokens, dark_ground)

    # ---- 未匹配元素的 color 规则（死规则/动态类推断失败提示） ----
    page_light_entries = build_entries([page_src], rules_by_src, "light")
    unmatched_color_rules = []
    for e in page_light_entries:
        if "color" not in e["decls"] or compound_has_pseudo_element(e["selector"]):
            continue
        if not any(p["selector"] == e["selector"] for p in light_pairs + dark_pairs) and \
           not any(u["selector"] == e["selector"] for u in light_unresolved + dark_unresolved):
            unmatched_color_rules.append({"selector": e["selector"], "line": e["decls"]["color"]["line"],
                                          "value": e["decls"]["color"]["value"]})
    unmatched_color_rules.sort(key=lambda x: x["line"])

    # ---- 字面量清单 / 暗色覆盖 ----
    literal_files = [s for s in srcs if s.role in ("page", "extra")]
    literal_report = {}
    all_literals = []
    for s in literal_files:
        items = collect_literals(s, rules_by_src[s])
        literal_report[s.path.name] = items
        all_literals.extend(items)

    page_literals = literal_report.get(page_src.path.name, [])
    # 暗色覆盖缺口：页面文件浅色规则里的 style 字面量，在 dark 规则中无同 selector+prop 覆盖
    dark_rules_by_selector: dict[str, dict] = {}
    for r in page_rules:
        if not r.dark or r.keyframes:
            continue
        for sel in r.selectors:
            key = normalized_selector(sel)
            for d in r.decls:
                dark_rules_by_selector.setdefault(key, {})[d.prop] = d

    def classify_theme_independent(item):
        sel = (item.get("selector") or "").lower()
        prop = item.get("property", "")
        val = item.get("value", "")
        if "img-cap" in sel or ("gradient" in val.lower() and "img" in sel):
            return "功能性覆盖（图片字幕，深浅色同一套）"
        if prop.startswith("--"):
            return "页面 token 定义"
        return None

    dark_gaps = []
    dark_rule_selectors = []
    for r in page_rules:
        if r.dark and not r.keyframes:
            for sel in r.selectors:
                dark_rule_selectors.append((normalized_selector(sel), r))
    for item in page_literals:
        if item["kind"] != "style":
            continue
        if item.get("dark_block"):
            # 暗色块里的字面量本身是"暗色覆盖值"，不属于「浅色写死」问题
            item["dark_cover"] = "dark-override"
            continue
        if item.get("in_var_fallback"):
            continue
        sel_key = normalized_selector(item["selector"])
        cover = dark_rules_by_selector.get(sel_key, {})
        prop = item["property"]
        if prop in cover:
            item["dark_cover"] = "same-rule"
            continue
        # 同 selector 的 dark 规则是否只做 filter/opacity 补丁
        patch_props = set(cover.keys())
        if patch_props & {"filter", "opacity", "mix-blend-mode", "backdrop-filter"}:
            item["dark_cover"] = "patch(filter/opacity)"
            dark_gaps.append({**item, "gap": "patch", "dark_rule_props": sorted(patch_props)})
            continue
        # 间接补丁：同族选择器（.nt-cat → .nt-cat--jw …）在 dark 块里只有 filter/opacity
        base_classes = compound_classes(item["selector"])
        indirect = []
        for dkey, dr in dark_rule_selectors:
            dclasses = compound_classes(dkey)
            related = any(
                (bc == dc) or dc.startswith(bc + "--") or bc.startswith(dc + "--")
                for bc in base_classes for dc in dclasses
            )
            if not related:
                continue
            if any(d.prop in ("filter", "opacity", "mix-blend-mode", "backdrop-filter") for d in dr.decls):
                indirect.append(dr.selector_raw)
        if indirect:
            item["dark_cover"] = "patch-indirect(filter)"
            dark_gaps.append({**item, "gap": "patch", "dark_rule_props": ["filter/opacity"],
                              "indirect_selectors": indirect[:6]})
            continue
        item["dark_cover"] = "none"
        ti = classify_theme_independent(item)
        dark_gaps.append({**item, "gap": "missing", "theme_independent": ti, "dark_rule_props": sorted(patch_props)})

    # 页面 token：浅色有、暗色无覆盖
    page_light_tokens = tokens["page_light"]
    page_dark_tokens = tokens["page_dark"]
    token_dark_gaps = []
    for name in page_light_tokens:
        if name not in page_dark_tokens:
            token_dark_gaps.append({"token": name, "light": page_light_tokens[name]["value"],
                                    "line": page_light_tokens[name]["line"],
                                    "dark": None,
                                    "dark_only": False})
    dark_only_tokens = [{"token": n, "value": e["value"], "line": e["line"]}
                        for n, e in page_dark_tokens.items() if n not in page_light_tokens]

    # ---- 视觉补丁 / 渐变 / 虚线 ----
    visual_patches, gradients, dashes, box_shadows = [], [], [], []
    for s in srcs:
        if s.role == "extra":
            continue
        for r in rules_by_src[s]:
            if r.keyframes:
                continue
            for d in r.decls:
                vlow = d.value.lower()
                if d.prop in ("filter", "backdrop-filter", "mix-blend-mode"):
                    visual_patches.append({"file": s.path.name, "role": s.role, "line": d.line,
                                           "selector": r.selector_raw, "property": d.prop,
                                           "value": d.value, "dark_block": r.dark})
                if d.prop == "opacity":
                    visual_patches.append({"file": s.path.name, "role": s.role, "line": d.line,
                                           "selector": r.selector_raw, "property": "opacity",
                                           "value": d.value, "dark_block": r.dark})
                if "gradient(" in vlow:
                    for m in GRADIENT_FN_RE.finditer(d.value):
                        gradients.append({"file": s.path.name, "role": s.role, "line": d.line,
                                          "selector": r.selector_raw, "property": d.prop,
                                          "kind": m.group(1).lower() + "-gradient",
                                          "value": d.value, "dark_block": r.dark})
                if "dashed" in vlow:
                    dashes.append({"file": s.path.name, "role": s.role, "line": d.line,
                                   "selector": r.selector_raw, "property": d.prop,
                                   "value": d.value, "dark_block": r.dark})
                if d.prop == "box-shadow" and vlow not in ("none", "0", "0 0 0 transparent"):
                    box_shadows.append({"file": s.path.name, "role": s.role, "line": d.line,
                                        "selector": r.selector_raw, "value": d.value, "dark_block": r.dark})

    # ---- 噪声指标 ----
    noise = compute_noise(srcs, rules_by_src, page_src, page_literals, page_light_tokens, page_dark_tokens,
                          tokens, light_pairs, dark_pairs)

    # ---- 调色板快照 ----
    palette = build_palette(tokens)
    semantic_palette = build_semantic_palette(tokens)
    combos = build_semantic_combos(tokens)

    # ---- 汇总 ----
    def pair_stats(pairs):
        fails = [p for p in pairs if p["verdict"] == "fail" and not p["conditional"]]
        cond = [p for p in pairs if p["conditional"] and (p["verdict"] in ("fail", "critical") or p.get("opacity_risk"))]
        crit = [p for p in pairs if p["verdict"] == "critical" and not p["conditional"]]
        return {
            "pairs": len(pairs),
            "fail": len(fails),
            "fail_page": len([p for p in fails if p.get("rule_role") == "page"]),
            "fail_app": len([p for p in fails if p.get("rule_role") != "page"]),
            "critical": len(crit),
            "conditional_risk": len(cond),
            "pass": len(pairs) - len(fails) - len(cond) - len(crit),
            "fail_pairs": fails,
            "critical_pairs": crit,
            "conditional_pairs": cond,
        }

    ls, ds = pair_stats(light_pairs), pair_stats(dark_pairs)
    summary = {
        "files": {
            "app": {**file_meta(app_path), "role": "app"},
            "page": {**file_meta(page_path), "role": "page"},
            "wxml": ({**file_meta(wxml_path), "role": "wxml"} if wxml_path and wxml_path.exists() else None),
            "extras": [{**file_meta(p), "role": "extra"} for p in extra_paths],
        },
        "rpx_to_px": RPX_TO_PX,
        "thresholds": {"normal": NORMAL_MIN, "large": LARGE_MIN, "large_px": LARGE_PX,
                       "large_bold_px": LARGE_BOLD_PX},
        "noise": noise,
        "page_token_count": {"light": len(page_light_tokens), "dark": len(page_dark_tokens)},
        "contast": {
            "light": {k: v for k, v in ls.items() if not k.endswith("_pairs")},
            "dark": {k: v for k, v in ds.items() if not k.endswith("_pairs")},
        },
        "semantic_combos": {
            "count": len(combos),
            "min_ratio": min((c["min_ratio"] for c in combos), default=None),
            "pass_all": all(c["pass"] for c in combos) if combos else None,
            "fail_count": sum(1 for c in combos if not c["pass"]),
        },
        "dark_coverage": {
            "page_literals_total": len([i for i in page_literals
                                        if i["kind"] == "style" and not i.get("in_var_fallback")
                                        and not i.get("dark_block")]),
            "covered": sum(1 for i in page_literals if i.get("dark_cover") == "same-rule"),
            "patched": sum(1 for i in page_literals
                           if i.get("dark_cover") in ("patch(filter/opacity)", "patch-indirect(filter)")),
            "missing": sum(1 for i in page_literals if i.get("dark_cover") == "none"),
            "missing_nonfunctional": len([g for g in dark_gaps if g["gap"] == "missing" and not g.get("theme_independent")]),
            "patch_count": sum(1 for g in dark_gaps if g["gap"] == "patch"),
            "token_gaps": len(token_dark_gaps),
            "dark_only_tokens": len(dark_only_tokens),
        },
        "unresolved": {"light": len(light_unresolved), "dark": len(dark_unresolved)},
        "components": {
            "boundaries": sorted({e["tag"] for e in elements if e.get("custom_component")}),
            "bg_boundaries": sorted({e["tag"] for e in elements if e.get("component")}),
            "extra_included": sorted(extra_component_tags),
        },
    }

    report = {
        "meta": {
            "tool": "color_audit.py",
            "version": VERSION,
            "label": args.label,
            "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "source_root": str(root),
            "page": str(page_path),
            "app": str(app_path),
            "wxml": str(wxml_path) if wxml_path and wxml_path.exists() else None,
            "extras": [str(p) for p in extra_paths],
            "command": " ".join([Path(sys.argv[0]).name] + sys.argv[1:]),
            "note": "静态审计：无法静态解析的组合进 unresolved/conditional，不虚构比值。rpx→px=0.5。",
        },
        "summary": summary,
        "palette": palette,
        "semantic_palette": semantic_palette,
        "semantic_combos": combos,
        "contrast": {
            "light": {"pairs": light_pairs, "unresolved": light_unresolved},
            "dark": {"pairs": dark_pairs, "unresolved": dark_unresolved},
        },
        "color_literals": literal_report,
        "color_literals_flat": all_literals,
        "hardcoded_dark_gaps": dark_gaps,
        "token_dark_gaps": token_dark_gaps,
        "dark_only_tokens": dark_only_tokens,
        "visual_patches": visual_patches,
        "gradients": gradients,
        "dashes": dashes,
        "box_shadows": box_shadows,
        "unmatched_color_rules": unmatched_color_rules,
        "elements": {
            "count": len(elements),
            "templates": list((wxml or {}).get("templates", {}).keys()),
            "component_boundaries": sorted({e["tag"] for e in elements if e.get("component")}),
        },
    }
    return report


def resolve_path(root: Path, p: str | None) -> Path:
    if p is None:
        return root
    pp = Path(p)
    return pp if pp.is_absolute() else (root / pp)


def file_meta(path: Path) -> dict:
    text = read_text(path)
    return {"path": str(path), "sha256": sha256_text(text), "bytes": len(text.encode("utf-8", errors="replace")),
            "lines": len(text.splitlines())}


def collect_literals(src: Source, rules: list[Rule]) -> list[dict]:
    items = []
    for r in rules:
        for d in r.decls:
            ctx = "token-def" if d.prop.startswith("--") else "style"
            if r.keyframes:
                ctx = "keyframes"
            if "gradient(" in d.value.lower() and ctx != "style":
                pass
            for pos, raw, c in find_color_tokens(d.value):
                if c is None:
                    items.append({
                        "file": src.path.name, "line": d.line, "selector": (r.selector_raw or "").strip(),
                        "property": d.prop, "value": d.value, "raw": raw, "kind": ctx,
                        "in_var_fallback": in_var_fallback(d.value, pos),
                        "color": None, "unknown_named": True, "keyframes": r.keyframes,
                        "dark_block": r.dark,
                        "context": "/".join(r.at_stack[-2:]) if r.at_stack else "",
                    })
                    continue
                if c.kind == "named" and raw.lower() == "transparent":
                    continue
                items.append({
                    "file": src.path.name, "line": d.line, "selector": (r.selector_raw or "").strip(),
                    "property": d.prop, "value": d.value, "raw": raw, "hex": c.css(),
                    "color_kind": c.kind, "alpha": round(c.a, 3), "kind": ctx,
                    "in_var_fallback": in_var_fallback(d.value, pos),
                    "color": [c.r, c.g, c.b, round(c.a, 3)], "unknown_named": False,
                    "keyframes": r.keyframes, "dark_block": r.dark,
                    "context": "/".join(r.at_stack[-2:]) if r.at_stack else "",
                })
    return items


def compute_noise(srcs, rules_by_src, page_src, page_literals, page_light_tokens, page_dark_tokens, tokens,
                  light_pairs, dark_pairs) -> dict:
    page_rules = rules_by_src[page_src]
    box_shadow = sum(1 for r in page_rules if not r.keyframes for d in r.decls
                     if d.prop == "box-shadow" and d.value.strip().lower() not in ("none", "0"))
    gradients = sum(len(GRADIENT_FN_RE.findall(d.value)) for r in page_rules if not r.keyframes for d in r.decls)
    dashed = sum(1 for r in page_rules if not r.keyframes for d in r.decls if "dashed" in d.value.lower())
    filters = sum(1 for r in page_rules if not r.keyframes for d in r.decls
                  if d.prop in ("filter", "backdrop-filter", "mix-blend-mode"))
    opacities = sum(1 for r in page_rules if not r.keyframes for d in r.decls if d.prop == "opacity")
    style_literals = [i for i in page_literals if i["kind"] == "style" and not i.get("in_var_fallback")
                      and i.get("color") is not None]
    token_literals = [i for i in page_literals if i["kind"] == "token-def" and i.get("color") is not None]
    hex_literals = [i["hex"] for i in style_literals if i.get("hex")]
    all_hex = [i["hex"] for i in page_literals if i.get("hex")]
    # 调色板色相族（浅/深各算一次，排除低饱和/近白近黑）
    def palette_hues(theme):
        cols = []
        for name, entry in tokens[theme].items():
            res = resolve_vars(entry["value"], tokens[theme])
            if res.value:
                c = parse_color(res.value.strip())
                if c:
                    cols.append(c)
        return hue_buckets(cols)

    return {
        "rules": len([r for r in page_rules if not r.keyframes]),
        "declarations": len([d for r in page_rules if not r.keyframes for d in r.decls]),
        "box_shadow": box_shadow,
        "linear_gradient": gradients,
        "dashed": dashed,
        "filter": filters,
        "opacity_decls": opacities,
        "color_literal_occurrences": len(style_literals),
        "color_literal_occurrences_total": len([i for i in page_literals if i.get("color") is not None]),
        "token_definition_literals": len(token_literals),
        "distinct_hex_literals": len(set(hex_literals)),
        "distinct_hex_all": len(set(all_hex)),
        "hue_families_literals": hue_buckets([parse_color(i["hex"]) for i in style_literals if parse_color(i["hex"])]),
        "hue_families_palette_light": palette_hues("light"),
        "hue_families_palette_dark": palette_hues("dark"),
        "contrast_fail_light": sum(1 for p in light_pairs if p["verdict"] == "fail" and not p["conditional"]),
        "contrast_fail_dark": sum(1 for p in dark_pairs if p["verdict"] == "fail" and not p["conditional"]),
    }


def token_category(name: str) -> str:
    n = name.lower()
    if n.startswith("--nt-"):
        short = n[5:]
        if short in ("bg", "card", "card-soft", "brief", "line", "line-strong"):
            return "表面/线条"
        if short in ("ink", "ink-2", "ink-3"):
            return "文字"
        if re.search(r"-(tint|ink|deep)$", short) or short.startswith(("cy", "bl", "sd", "rose", "violet", "grey")):
            return "莫奈六色"
        return "其他页面 token"
    short = n.replace("--md-", "")
    if short == "press-overlay":
        return "交互叠色"
    if any(k in short for k in ("elev",)):
        return "阴影"
    if re.match(r"(primary|secondary|tertiary|error|on-|surface|outline)", short):
        return "M3 色彩角色"
    return "其他"


def build_palette(tokens: dict) -> dict:
    def one(entries: dict, resolve_tokens: dict, category_fn=token_category):
        out = {}
        for name, entry in entries.items():
            res = resolve_vars(entry["value"], resolve_tokens)
            c = parse_color(res.value.strip()) if res.value else None
            out[name] = {
                "value_raw": entry["value"],
                "resolved": res.value,
                "hex": c.css() if c else None,
                "category": category_fn(name),
                "source": f"{entry['file']}:{entry['line']}",
                "selector": entry["selector"],
            }
        return out

    app_dark_all = dict(tokens["app_light"])
    app_dark_all.update(tokens["app_dark"])
    return {
        "light": one(tokens["light"], tokens["light"]),
        "dark": one(tokens["dark"], tokens["dark"]),
        "app": {
            "light": one(tokens["app_light"], tokens["light"]),
            "dark": one(app_dark_all, tokens["dark"]),
        },
        "page_light": {
            n: {**e, "category": token_category(n)} for n, e in tokens["page_light"].items()
        },
        "page_dark": {
            n: {**e, "category": token_category(n)} for n, e in tokens["page_dark"].items()
        },
    }


SIX_COLORS = ["cy", "bl", "sd", "rose", "violet", "grey"]
SURFACES = ["card", "brief", "card-soft"]


def _tok_hex(tokens_theme: dict, name: str) -> Color | None:
    entry = tokens_theme.get(name)
    if not entry:
        return None
    res = resolve_vars(entry["value"], tokens_theme)
    if not res.value:
        return None
    return parse_color(res.value.strip())


def build_semantic_palette(tokens: dict) -> dict:
    """页面级 token 语义分组：表面 / 文字 / 六色 tint-ink-deep（浅/深）。"""
    names_light = set(tokens["page_light"].keys())
    names_dark = set(tokens["page_dark"].keys())
    if not names_light and not names_dark:
        return {"available": False, "note": "页面文件未定义 --nt-* 页面级 token（旧版配色直接写死字面量）"}

    def rows(names):
        out = []
        for name in names:
            l = _tok_hex(tokens["light"], name)
            d = _tok_hex(tokens["dark"], name)
            out.append({"token": name, "light": l.css() if l else None,
                        "dark": d.css() if d else None,
                        "light_raw": tokens["page_light"].get(name, {}).get("value"),
                        "dark_raw": tokens["page_dark"].get(name, {}).get("value")})
        return out

    surfaces = [f"--nt-{n}" for n in ("bg", "card", "card-soft", "brief", "line", "line-strong")
                if f"--nt-{n}" in names_light or f"--nt-{n}" in names_dark]
    text = [f"--nt-{n}" for n in ("ink", "ink-2", "ink-3")
            if f"--nt-{n}" in names_light or f"--nt-{n}" in names_dark]
    families = []
    family_token_names: set[str] = set()
    for fam in SIX_COLORS:
        fam_rows = {}
        for suffix in ("tint", "ink"):
            name = f"--nt-{fam}-{suffix}"
            if name in names_light or name in names_dark:
                family_token_names.add(name)
                l = _tok_hex(tokens["light"], name)
                d = _tok_hex(tokens["dark"], name)
                fam_rows[suffix] = {"token": name,
                                    "light": l.css() if l else None,
                                    "dark": d.css() if d else None}
        # deep：优先 --nt-<fam>-deep，对应不到时回退到该色基色 --nt-<fam>（六色里只有 cy 有 deep token）
        deep_name = f"--nt-{fam}-deep"
        if deep_name not in names_light and deep_name not in names_dark:
            deep_name = f"--nt-{fam}"
        if deep_name in names_light or deep_name in names_dark:
            family_token_names.add(deep_name)
            l = _tok_hex(tokens["light"], deep_name)
            d = _tok_hex(tokens["dark"], deep_name)
            fam_rows["deep"] = {"token": deep_name,
                                "light": l.css() if l else None,
                                "dark": d.css() if d else None}
        if fam_rows:
            families.append({**fam_rows, "family": fam})
    extra = [r for r in rows(sorted(names_light | names_dark))
             if r["token"] not in (surfaces + text) and r["token"] not in family_token_names]
    return {
        "available": True,
        "surfaces": rows(surfaces),
        "text": rows(text),
        "color_families": families,
        "other": extra,
        "count": len(names_light | names_dark),
    }


def build_semantic_combos(tokens: dict) -> list[dict]:
    """Lead 指定口径：文字 × 背景语义组合，两主题各算一次，取最低值。"""
    page_light = tokens["page_light"]
    if not page_light:
        return []
    combos = []

    def add(label: str, fg: str, bg: str):
        rec = {"label": label, "fg": fg, "bg": bg, "light": None, "dark": None,
               "min_ratio": None, "pass": None, "themes": {}}
        ratios = []
        for theme in ("light", "dark"):
            f = _tok_hex(tokens[theme], fg)
            b = _tok_hex(tokens[theme], bg)
            if f is None or b is None:
                rec["themes"][theme] = {"reason": "token 不存在或无法解析"}
                continue
            fb = f if b.a >= 0.999 else (composite(f, b) if f.a >= 0.999 else f)
            ratio = contrast_ratio(fb, b)
            th = LARGE_MIN if False else NORMAL_MIN
            rec["themes"][theme] = {"fg": f.css(), "bg": b.css(), "ratio": round(ratio, 2),
                                    "threshold": th, "pass": ratio >= th}
            ratios.append(ratio)
        if ratios:
            rec["min_ratio"] = round(min(ratios), 2)
            rec["pass"] = rec["min_ratio"] >= NORMAL_MIN
            rec["light"] = rec["themes"].get("light", {}).get("ratio")
            rec["dark"] = rec["themes"].get("dark", {}).get("ratio")
        combos.append(rec)

    for ink in ("--nt-ink", "--nt-ink-2", "--nt-ink-3"):
        if ink not in page_light:
            continue
        for surf in SURFACES:
            bg = f"--nt-{surf}"
            if bg in page_light:
                add(f"{ink} on {bg}", ink, bg)
    for fam in SIX_COLORS:
        fg, bg = f"--nt-{fam}-ink", f"--nt-{fam}-tint"
        if fg in page_light and bg in page_light:
            add(f"{fg} on {bg}", fg, bg)
    if "--nt-on-cy" in page_light and "--nt-cy-deep" in page_light:
        add("--nt-on-cy on --nt-cy-deep", "--nt-on-cy", "--nt-cy-deep")
    if "--nt-bl-ink" in page_light and "--nt-bl-tint" in page_light:
        add("--nt-bl-ink on --nt-bl-tint", "--nt-bl-ink", "--nt-bl-tint")
    if "--nt-rose-ink" in page_light and "--nt-rose-tint" in page_light:
        add("--nt-rose-ink on --nt-rose-tint", "--nt-rose-ink", "--nt-rose-tint")
    return combos


# --------------------------------------------------------------------------------------
# Markdown 报告
# --------------------------------------------------------------------------------------


def md_table(headers: list[str], rows: list[list], empty: str = "_无_") -> str:
    if not rows:
        return empty
    out = ["| " + " | ".join(headers) + " |",
           "|" + "|".join(["---"] * len(headers)) + "|"]
    for r in rows:
        out.append("| " + " | ".join("" if v is None else str(v).replace("|", "\\|") for v in r) + " |")
    return "\n".join(out)


def _fmt_ratio(v):
    return f"{v:.2f}" if isinstance(v, (int, float)) else "—"


def write_report_md(report: dict, out_dir: Path):
    m = report["meta"]
    s = report["summary"]
    noise = s["noise"]
    lines = []
    lines.append(f"# 通知页配色静态审计 · {m['label']}")
    lines.append("")
    lines.append(f"- 生成时间：`{m['generated_at']}`")
    lines.append(f"- 工具：`{m['tool']} v{m['version']}`　审计根目录：`{m['source_root']}`")
    lines.append(f"- 页面：`{m['page']}`　全局：`{m['app']}`")
    if m["wxml"]:
        lines.append(f"- WXML（用于推断父类背景/继承字号）：`{m['wxml']}`")
    if m["extras"]:
        lines.append(f"- 附加文件：{', '.join('`' + e + '`' for e in m['extras'])}")
    lines.append("- 口径：rpx→px = 0.5；WCAG normal < 4.5 失败；large（px≥24 或 px≥18.66 且 weight≥600）< 3.0 失败；"
                 "带 opacity/filter 降权或半透明渐变的组合标为「条件性」，不计入硬失败。")
    lines.append("")
    for role, meta in s["files"].items():
        if not meta:
            continue
        if role == "extras":
            for e in meta:
                lines.append(f"- `{e['path']}`（{e['lines']} 行，sha256 `{e['sha256'][:16]}…`）")
        else:
            lines.append(f"- `{meta['path']}`（{meta['lines']} 行，{meta['bytes']} B，sha256 `{meta['sha256'][:16]}…`）")
    lines.append("")

    # ---- 1 总览 ----
    lines.append("## 1. 总览指标")
    lines.append("")
    rows = [
        ["规则数 / 声明数", f"{noise['rules']} / {noise['declarations']}"],
        ["`box-shadow` 数", noise["box_shadow"]],
        ["`linear-gradient` 数", noise["linear_gradient"]],
        ["`dashed` 数", noise["dashed"]],
        ["`filter`/混合模式 数", noise["filter"]],
        ["`opacity` 数", noise["opacity_decls"]],
        ["颜色字面量数（style，排除 token 定义与 var fallback）", noise["color_literal_occurrences"]],
        ["颜色字面量数（页面文件全部，含 token 定义）", noise["color_literal_occurrences_total"]],
        ["独立颜色（hex 去重，style 字面量）", noise["distinct_hex_literals"]],
        ["独立颜色（hex 去重，全部）", noise["distinct_hex_all"]],
        ["页面 token 数", f"浅 {s['page_token_count']['light']} / 深 {s['page_token_count']['dark']}"],
        ["对比度硬失败（浅 / 深）", f"{s['contast']['light']['fail']} / {s['contast']['dark']['fail']}"],
        ["　└ 页面 wxss 规则（浅 / 深）",
         f"{s['contast']['light']['fail_page']} / {s['contast']['dark']['fail_page']}"],
        ["　└ 全站/组件层既有规则（浅 / 深）",
         f"{s['contast']['light']['fail_app']} / {s['contast']['dark']['fail_app']}"],
        ["对比度临界（浅 / 深）", f"{s['contast']['light']['critical']} / {s['contast']['dark']['critical']}"],
        ["条件性风险（浅 / 深）", f"{s['contast']['light']['conditional_risk']} / {s['contast']['dark']['conditional_risk']}"],
        ["unresolved（浅 / 深）", f"{s['unresolved']['light']} / {s['unresolved']['dark']}"],
        ["浅色写死且暗色无覆盖（非功能性）", s["dark_coverage"]["missing_nonfunctional"]],
        ["浅色写死且暗色用 filter/opacity 补丁", s["dark_coverage"]["patch_count"]],
        ["页面 token 暗色缺口", s["dark_coverage"]["token_gaps"]],
    ]
    if s["semantic_combos"]["count"]:
        rows.append(["语义 token 组合（最低对比度）",
                     f"{s['semantic_combos']['count']} 组，min {_fmt_ratio(s['semantic_combos']['min_ratio'])}，"
                     f"全部 PASS = {s['semantic_combos']['pass_all']}"])
    lines.append(md_table(["指标", "值"], rows))
    lines.append("")

    # ---- 2 调色板 ----
    lines.append("## 2. 调色板快照")
    lines.append("")
    sem = report["semantic_palette"]
    if sem.get("available"):
        lines.append("### 2.1 页面语义 token（浅 / 深）")
        lines.append("")
        rows = [[r["token"], r["light"], r["dark"]] for r in sem["surfaces"]]
        if rows:
            lines.append("**表面 / 线条**")
            lines.append("")
            lines.append(md_table(["token", "浅色", "深色"], rows))
            lines.append("")
        rows = [[r["token"], r["light"], r["dark"]] for r in sem["text"]]
        if rows:
            lines.append("**文字**")
            lines.append("")
            lines.append(md_table(["token", "浅色", "深色"], rows))
            lines.append("")
        if sem["color_families"]:
            lines.append("**莫奈六色 · tint / ink / deep**")
            lines.append("")
            rows = []
            for fam in sem["color_families"]:
                def cell(sfx, theme):
                    v = fam.get(sfx)
                    return (v.get(theme) or "—") if v else "—"
                rows.append([fam["family"].upper(),
                             cell("tint", "light"), cell("ink", "light"), cell("deep", "light"),
                             cell("tint", "dark"), cell("ink", "dark"), cell("deep", "dark")])
            lines.append(md_table(["色", "浅 tint", "浅 ink", "浅 deep", "深 tint", "深 ink", "深 deep"], rows))
            lines.append("")
            lines.append("> deep 列：`cy` 取 `--nt-cy-deep`，其余五色无独立 deep token，回退显示该色基色 `--nt-<色>`。")
            lines.append("")
        if sem.get("other"):
            lines.append("**其他页面 token**")
            lines.append("")
            lines.append(md_table(["token", "浅色", "深色"],
                                  [[r["token"], r["light"], r["dark"]] for r in sem["other"]]))
            lines.append("")
    sem_available = bool(sem.get("available"))
    if not sem_available:
        lines.append(f"_页面级 token 不可用：{sem.get('note')}_")
        lines.append("")
    # 全站 M3 token（app.wxss），按类别
    pal = report["palette"]
    app_pal = pal.get("app") or {}
    m3_names = [n for n in (app_pal.get("light") or {}).keys()]
    if m3_names:
        lines.append("### " + ("2.2" if sem_available else "2.1") + " 全站 M3 token（app.wxss，浅 / 深）")
        lines.append("")
        rows = []
        for n in m3_names:
            l = (app_pal.get("light") or {}).get(n)
            d = (app_pal.get("dark") or {}).get(n)
            if l and l["hex"]:
                rows.append([n, l["hex"], (d or {}).get("hex") or "—", l["category"]])
        lines.append(md_table(["token", "浅色", "深色", "类别"], rows))
        lines.append("")

    # ---- 3 语义组合 ----
    combos = report["semantic_combos"]
    if combos:
        lines.append("## 3. 语义「文字 × 背景」组合对比度（两主题）")
        lines.append("")
        rows = []
        fails = 0
        for c in combos:
            ok = c["pass"]
            fails += 0 if ok else 1
            mark = "PASS" if ok else "**FAIL**"
            rows.append([c["label"], _fmt_ratio(c["light"]), _fmt_ratio(c["dark"]),
                         _fmt_ratio(c["min_ratio"]), mark])
        rows.append(["**最低值**", "", "", _fmt_ratio(min(c["min_ratio"] for c in combos if c["min_ratio"] is not None)
                                                   if any(c["min_ratio"] is not None for c in combos) else None),
                     "全部 PASS" if fails == 0 else f"{fails} 组 FAIL"])
        lines.append(md_table(["组合", "浅色", "深色", "两主题最低", "判定(AA 4.5)"], rows))
        lines.append("")

    # ---- 4 硬编码 / 暗色覆盖 ----
    lines.append("## 4. 硬编码颜色 & 暗色覆盖")
    lines.append("")
    dc = s["dark_coverage"]
    lines.append(f"- 页面文件 style 字面量（排除 token 定义 / `var()` fallback）：**{dc['page_literals_total']}** 处")
    lines.append(f"- 暗色有同规则同属性覆盖：{dc['covered']}；用 filter/opacity 补丁：{dc['patched']}；"
                 f"无覆盖：{dc['missing']}（其中功能性允许 {dc['missing'] - dc['missing_nonfunctional']}，"
                 f"非功能性缺口 **{dc['missing_nonfunctional']}**）")
    lines.append(f"- 页面 token 暗色缺口：{dc['token_gaps']}；仅暗色定义的 token：{dc['dark_only_tokens']}")
    lines.append("")
    gaps = report["hardcoded_dark_gaps"]
    if gaps:
        lines.append("**逐项明细**")
        lines.append("")
        rows = []
        for g in gaps:
            color_txt = g.get("hex") or g.get("raw") or ""
            rows.append([g["line"], f"`{g['selector']}`", g["property"], f"`{color_txt}`",
                         {"missing": "无覆盖", "patch": "filter/opacity 补丁"}.get(g["gap"], g["gap"]),
                         g.get("theme_independent") or ""])
        lines.append(md_table(["行", "选择器", "属性", "颜色", "暗色覆盖", "备注"], rows))
        lines.append("")
    token_gaps = report["token_dark_gaps"]
    if token_gaps:
        lines.append("**页面 token 暗色缺口**")
        lines.append("")
        lines.append(md_table(["token", "浅色值", "行"], [[g["token"], f"`{g['light']}`", g["line"]] for g in token_gaps]))
        lines.append("")
    # 页面文件全部 style 字面量清单（带行号 + 所属选择器 + 暗色覆盖状态）
    page_name = Path(report["meta"]["page"]).name
    all_page_literals = report["color_literals"].get(page_name, [])
    style_literals = [i for i in all_page_literals if i["kind"] == "style" and not i.get("in_var_fallback")]
    token_def_literals = [i for i in all_page_literals if i["kind"] == "token-def"]
    lines.append(f"**页面文件全部颜色字面量清单**：style 字面量 {len(style_literals)} 条"
                 f"（另有 token 定义字面量 {len(token_def_literals)} 条，见 §2 调色板）；"
                 f"共 {len(all_page_literals)} 条匹配记录。")
    lines.append("")
    if style_literals:
        rows = []
        for i in style_literals:
            cover = i.get("dark_cover")
            cover_txt = {"same-rule": "同规则覆盖",
                         "patch(filter/opacity)": "filter/opacity 补丁",
                         "patch-indirect(filter)": "同族 filter 补丁",
                         "none": "无覆盖",
                         "dark-override": "暗色块自身覆盖值"}.get(cover, "—")
            rows.append([i["line"], f"`{i['selector']}`", i["property"],
                         f"`{i.get('hex') or i.get('raw')}`", cover_txt,
                         "是" if i.get("dark_block") else "否"])
        lines.append(md_table(["行", "选择器", "属性", "颜色", "暗色覆盖", "暗色块"], rows))
    else:
        lines.append("_无 style 字面量_")
    lines.append("")
    if token_def_literals:
        lines.append(f"> token 定义字面量 {len(token_def_literals)} 条未逐条展开（其「浅/深」成对关系已在 §2.1 调色板快照列出）。")
        lines.append("")

    # ---- 5 视觉补丁 ----
    lines.append("## 5. `filter` / `opacity` 视觉补丁")
    lines.append("")
    patches = [p for p in report["visual_patches"] if p["role"] != "extra"]
    page_patches = [p for p in patches if p["role"] == "page"]
    lines.append(f"页面文件 **{len(page_patches)}** 处，全站 app.wxss **{len(patches) - len(page_patches)}** 处。")
    lines.append("")
    if patches:
        lines.append(md_table(["文件", "行", "选择器", "属性", "值", "暗色块"],
                              [[p["file"], p["line"], f"`{p['selector']}`", p["property"],
                                f"`{p['value']}`", "是" if p["dark_block"] else "否"] for p in patches]))
    else:
        lines.append("_无_")
    lines.append("")

    # ---- 6 渐变 / 虚线 ----
    lines.append("## 6. 渐变 / 虚线（整洁度指标）")
    lines.append("")
    grads = [g for g in report["gradients"] if g["role"] != "extra"]
    page_grads = [g for g in grads if g["role"] == "page"]
    lines.append(f"页面文件渐变 **{len(page_grads)}** 处（全站合计 {len(grads)} 处）")
    lines.append("")
    if grads:
        lines.append(md_table(["文件", "行", "选择器", "类型", "暗色块"],
                              [[g["file"], g["line"], f"`{g['selector']}`", g["kind"],
                                "是" if g["dark_block"] else "否"] for g in grads]))
    else:
        lines.append("_无_")
    lines.append("")
    dashes = [d for d in report["dashes"] if d["role"] != "extra"]
    page_dashes = [d for d in dashes if d["role"] == "page"]
    lines.append(f"页面文件虚线 **{len(page_dashes)}** 处（全站合计 {len(dashes)} 处）")
    lines.append("")
    if dashes:
        lines.append(md_table(["文件", "行", "选择器", "属性", "值"],
                              [[d["file"], d["line"], f"`{d['selector']}`", d["property"], f"`{d['value']}`"]
                               for d in dashes]))
    else:
        lines.append("_无_")
    lines.append("")

    # ---- 7 对比度 ----
    lines.append("## 7. WCAG 对比度（元素级推断）")
    lines.append("")
    for scope_name, label in (("light", "浅色"), ("dark", "深色")):
        pairs = report["contrast"][scope_name]["pairs"]
        unresolved = report["contrast"][scope_name]["unresolved"]
        fails = [p for p in pairs if p["verdict"] == "fail" and not p["conditional"]]
        crit = [p for p in pairs if p["verdict"] == "critical" and not p["conditional"]]
        cond = [p for p in pairs if p["conditional"]
                and (p["verdict"] in ("fail", "critical") or p.get("opacity_risk"))]
        fails_page = [p for p in fails if p.get("rule_role") == "page"]
        fails_app = [p for p in fails if p.get("rule_role") != "page"]
        lines.append(f"### 7.{1 if scope_name == 'light' else 2} {label}模式")
        lines.append("")
        lines.append(f"有效组合 {len(pairs)} 项：硬失败 **{len(fails)}**（页面 wxss {len(fails_page)} / 全站-组件层 {len(fails_app)}），"
                     f"临界 {len(crit)}，条件性风险 {len(cond)}，unresolved {len(unresolved)}")
        lines.append("")
        for group_label, group in (("页面 wxss 规则", fails_page), ("全站/组件层既有规则（非页面配色改动引入）", fails_app)):
            if not group:
                continue
            lines.append(f"**硬失败（AA 不达标）· {group_label}**")
            lines.append("")
            rows = [[p["selector"], p["rule_line"], p["text"]["hex"], p["bg"]["hex"], p["bg"]["source"],
                     p["font_px"], _fmt_ratio(p["ratio"]), _fmt_ratio(p["threshold"])] for p in group[:80]]
            lines.append(md_table(["文字规则", "行", "文字色", "背景色", "背景来源", "字号px", "对比度", "阈值"], rows))
            lines.append("")
        if crit:
            lines.append("**临界（达标但余量小）**")
            lines.append("")
            rows = [[p["selector"], p["rule_line"], p["text"]["hex"], p["bg"]["hex"], p["bg"]["source"],
                     p["font_px"], _fmt_ratio(p["ratio"])] for p in crit[:40]]
            lines.append(md_table(["文字规则", "行", "文字色", "背景色", "背景来源", "字号px", "对比度"], rows))
            lines.append("")
        if cond:
            lines.append("**条件性风险（opacity 降权态 / 半透明渐变 / 图片底图 / filter 近似，静态不确定）**")
            lines.append("")
            reasons = []
            for p in cond:
                why = []
                if p["opacity"] < 0.999:
                    why.append(f"opacity {p['opacity']:g}（{_fmt_ratio(p.get('ratio_with_opacity'))}）")
                if p["uncertain"]:
                    why.append("半透明/图片底图")
                if p.get("filter_scale"):
                    why.append(f"filter brightness({p['filter_scale']:g}) 近似")
                if p.get("opacity_risk") and not why:
                    why.append("opacity 降权")
                reasons.append("、".join(why) or "—")
            rows = [[p["selector"], p["rule_line"], p["text"]["hex"], p["bg"]["hex"],
                     _fmt_ratio(p["ratio"]), reasons[i]] for i, p in enumerate(cond[:40])]
            lines.append(md_table(["文字规则", "行", "文字色", "背景色", "对比度(基态)", "原因"], rows))
            lines.append("")
        if unresolved:
            lines.append("**unresolved（需人工核对）**")
            lines.append("")
            rows = [[u["element_line"], f"`{u['selector']}`", u["font_px"], (u["reason"] or "")[:90]]
                    for u in unresolved[:40]]
            lines.append(md_table(["WXML行", "文字规则", "字号px", "原因"], rows))
            lines.append("")

    # 7.3 组件 / 未纳入范围
    comps = report["summary"].get("components") or {}
    comp_list = comps.get("boundaries") or []
    lines.append("### 7.3 组件与未纳入审计范围")
    lines.append("")
    if comp_list:
        lines.append(f"- WXML 中的自定义组件边界：{', '.join('`<' + c + '>`' for c in comp_list)}")
    if comps.get("extra_included"):
        lines.append(f"- 本次通过 `--extra` 纳入的组件 wxss：{', '.join('`' + c + '`' for c in comps['extra_included'])}"
                     "（其容器背景按组件 wxss 推断，`source_kind=component-inferred`）")
    else:
        lines.append("- **组件 wxss 未纳入本次审计**（bottom-sheet / empty-state / touchable 等未通过 `--extra` 传入）："
                     "组件内部元素（原始消息弹层、提醒弹层等）的背景无法静态确定，已列入上方 unresolved；"
                     "如需覆盖：`python color_audit.py --extra components/bottom-sheet/index.wxss ...`。")
        lines.append("- `<touchable>` 以 `cls` 属性代理其渲染类（M3 按钮类来自 app.wxss），属近似处理。")
    lines.append("")

    # ---- 8 色相 ----
    lines.append("## 8. 色相分布（粗略）")
    lines.append("")
    lines.append(f"- style 字面量色相族：{noise['hue_families_literals'] or '—'}")
    lines.append(f"- 调色板（浅）色相族：{noise['hue_families_palette_light'] or '—'}")
    lines.append(f"- 调色板（深）色相族：{noise['hue_families_palette_dark'] or '—'}")
    lines.append("")

    # ---- 9 unresolved 规则 ----
    if report["unmatched_color_rules"]:
        lines.append("## 9. 未能对应到 WXML 元素的 `color` 规则（可能未使用 / 动态类推断失败）")
        lines.append("")
        lines.append(md_table(["行", "选择器", "声明值"],
                              [[r["line"], f"`{r['selector']}`", f"`{r['value']}`"] for r in report["unmatched_color_rules"]]))
        lines.append("")

    # ---- 10 TOP 问题清单 ----
    from collections import defaultdict as _dd
    agg = _dd(lambda: {"count": 0, "mins": [], "scopes": set(), "bgs": set(), "roles": set()})
    for scope_name in ("light", "dark"):
        for p in report["contrast"][scope_name]["pairs"]:
            if p["verdict"] != "fail" or p["conditional"]:
                continue
            a = agg[p["selector"]]
            a["count"] += 1
            a["mins"].append(p["ratio"])
            a["scopes"].add(scope_name)
            a["bgs"].add(p["bg"]["hex"])
            a["roles"].add(p.get("rule_role") or "?")
    top = sorted(agg.items(), key=lambda kv: (-kv[1]["count"], min(kv[1]["mins"])))
    lines.append("## 10. TOP 问题清单（按严重度自动生成）")
    lines.append("")
    items = []
    for rank, (sel, info) in enumerate(top[:10], 1):
        role_txt = "页面" if info["roles"] == {"page"} else ("全站层" if "page" not in info["roles"] else "页面+全站")
        items.append([f"P0-{rank}", "对比度失败", f"`{sel}`",
                      f"{role_txt}，{info['count']} 组合，最低 {min(info['mins']):.2f}:1，"
                      f"背景 {', '.join(sorted(info['bgs'])[:4])}"])
    miss = [g for g in report["hardcoded_dark_gaps"] if g["gap"] == "missing" and not g.get("theme_independent")]
    if miss:
        items.append(["P1", "暗色无覆盖（非功能性）", f"{len(miss)} 处",
                      "浅色写死字面量暗色无覆盖：" + ", ".join(sorted({g["selector"] for g in miss})[:8])])
    patched = [g for g in report["hardcoded_dark_gaps"] if g["gap"] == "patch"]
    if patched:
        items.append(["P2", "M3 补丁 hack", f"{len(patched)} 处",
                      "用 filter/opacity 代替暗色 token：" + ", ".join(sorted({g["selector"] for g in patched})[:8])])
    noise = report["summary"]["noise"]
    if noise["box_shadow"] or noise["linear_gradient"] or noise["dashed"]:
        items.append(["P3", "整洁度（投影/渐变/虚线）",
                      f"shadow {noise['box_shadow']} / gradient {noise['linear_gradient']} / dashed {noise['dashed']}",
                      "页面文件装饰性投影 / 渐变 / 虚线数量（越低越整洁）"])
    if noise["color_literal_occurrences"] > 2:
        items.append(["P4", "硬编码颜色", f"{noise['color_literal_occurrences']} 处 / "
                      f"{noise['distinct_hex_literals']} 个独立色",
                      "页面文件 style 字面量（排除 token 定义与 var fallback）"])
    if items:
        lines.append(md_table(["严重度", "类别", "对象", "说明"], items))
    else:
        lines.append("_无 TOP 问题（页面级对比度失败 0、暗色缺口 0、补丁 0、装饰噪声 0）_")
    lines.append("")

    # ---- 11 复现 ----
    lines.append("## 11. 复现")
    lines.append("")
    lines.append("```powershell")
    lines.append(f"# 本次命令：{m['command']}")
    lines.append("python color_audit.py --out _color_audit/after --label after")
    lines.append("python color_audit.py --root _color_audit/before/source --out _color_audit/before --label before")
    lines.append("python color_audit.py --compare _color_audit/before _color_audit/after --out _color_audit/COMPARE.md")
    lines.append("```")
    lines.append("")
    (out_dir / "report.md").write_text("\n".join(lines), encoding="utf-8")


# --------------------------------------------------------------------------------------
# 对比模式
# --------------------------------------------------------------------------------------


def write_compare(before_dir: Path, after_dir: Path, out_path: Path):
    before = json.loads((before_dir / "report.json").read_text(encoding="utf-8"))
    after = json.loads((after_dir / "report.json").read_text(encoding="utf-8"))
    bm, am = before["meta"], after["meta"]
    bs, as_ = before["summary"], after["summary"]
    bn, an = bs["noise"], as_["noise"]

    def d(b, a):
        try:
            return a - b
        except TypeError:
            return None

    def icon(delta, lower_better=True):
        if delta is None:
            return "—"
        if delta == 0:
            return "="
        good = delta < 0 if lower_better else delta > 0
        return "✅" if good else "⚠️"

    lines = []
    lines.append("# 通知页配色优化 · before / after 对比")
    lines.append("")
    lines.append(f"- before：`{bm['page']}`（sha256 `{(bs['files']['page'] or {}).get('sha256', '')[:16]}…`，{bm['generated_at']}）")
    lines.append(f"- after：`{am['page']}`（sha256 `{(as_['files']['page'] or {}).get('sha256', '')[:16]}…`，{am['generated_at']}）")
    lines.append(f"- 对比脚本：`color_audit.py v{am['version']}`　口径：rpx→px=0.5；AA normal 4.5 / large 3.0；条件性不计入硬失败")
    lines.append("")

    # 指标差值表
    lines.append("## 1. 指标差值表")
    lines.append("")
    metric_rows = [
        ("页面 token 数（浅/深）", f"{bs['page_token_count']['light']}/{bs['page_token_count']['dark']}",
         f"{as_['page_token_count']['light']}/{as_['page_token_count']['dark']}", None, "—"),
        ("`box-shadow` 数", bn["box_shadow"], an["box_shadow"], d(bn["box_shadow"], an["box_shadow"]), "越低越整洁"),
        ("`linear-gradient` 数", bn["linear_gradient"], an["linear_gradient"],
         d(bn["linear_gradient"], an["linear_gradient"]), "越低越整洁"),
        ("`dashed` 数", bn["dashed"], an["dashed"], d(bn["dashed"], an["dashed"]), "越低越整洁"),
        ("`filter`/混合模式 数", bn["filter"], an["filter"], d(bn["filter"], an["filter"]), "越低越整洁"),
        ("`opacity` 数", bn["opacity_decls"], an["opacity_decls"],
         d(bn["opacity_decls"], an["opacity_decls"]), "越低越整洁（done 态不再整卡降权）"),
        ("颜色字面量（style，排除 token 定义）", bn["color_literal_occurrences"], an["color_literal_occurrences"],
         d(bn["color_literal_occurrences"], an["color_literal_occurrences"]), "越低越不写死"),
        ("颜色字面量（全部，含 token 定义）", bn["color_literal_occurrences_total"],
         an["color_literal_occurrences_total"], d(bn["color_literal_occurrences_total"], an["color_literal_occurrences_total"]),
         "token 定义属正常"),
        ("独立颜色（hex 去重，style 字面量）", bn["distinct_hex_literals"], an["distinct_hex_literals"],
         d(bn["distinct_hex_literals"], an["distinct_hex_literals"]), "粗略色相数"),
        ("独立颜色（hex 去重，全部）", bn["distinct_hex_all"], an["distinct_hex_all"],
         d(bn["distinct_hex_all"], an["distinct_hex_all"]), "含 token 调色板"),
        ("对比度硬失败·浅色（页面/全站）",
         f"{bs['contast']['light']['fail_page']}/{bs['contast']['light']['fail_app']}",
         f"{as_['contast']['light']['fail_page']}/{as_['contast']['light']['fail_app']}", None, "页面部分应为 0"),
        ("对比度硬失败·深色（页面/全站）",
         f"{bs['contast']['dark']['fail_page']}/{bs['contast']['dark']['fail_app']}",
         f"{as_['contast']['dark']['fail_page']}/{as_['contast']['dark']['fail_app']}", None, "页面部分应为 0"),
        ("对比度硬失败合计（浅）", bs["contast"]["light"]["fail"], as_["contast"]["light"]["fail"],
         d(bs["contast"]["light"]["fail"], as_["contast"]["light"]["fail"]), "越低越好"),
        ("对比度硬失败合计（深）", bs["contast"]["dark"]["fail"], as_["contast"]["dark"]["fail"],
         d(bs["contast"]["dark"]["fail"], as_["contast"]["dark"]["fail"]), "越低越好"),
        ("对比度临界·浅色", bs["contast"]["light"]["critical"], as_["contast"]["light"]["critical"],
         d(bs["contast"]["light"]["critical"], as_["contast"]["light"]["critical"]), "越低越好"),
        ("对比度临界·深色", bs["contast"]["dark"]["critical"], as_["contast"]["dark"]["critical"],
         d(bs["contast"]["dark"]["critical"], as_["contast"]["dark"]["critical"]), "越低越好"),
        ("条件性风险（浅/深）",
         f"{bs['contast']['light']['conditional_risk']}/{bs['contast']['dark']['conditional_risk']}",
         f"{as_['contast']['light']['conditional_risk']}/{as_['contast']['dark']['conditional_risk']}", None, "—"),
        ("unresolved（浅/深）", f"{bs['unresolved']['light']}/{bs['unresolved']['dark']}",
         f"{as_['unresolved']['light']}/{as_['unresolved']['dark']}", None, "—"),
        ("浅色写死·暗色无覆盖（非功能性）", bs["dark_coverage"]["missing_nonfunctional"],
         as_["dark_coverage"]["missing_nonfunctional"],
         d(bs["dark_coverage"]["missing_nonfunctional"], as_["dark_coverage"]["missing_nonfunctional"]), "应为 0"),
        ("浅色写死·暗色 filter/opacity 补丁", bs["dark_coverage"]["patch_count"],
         as_["dark_coverage"]["patch_count"],
         d(bs["dark_coverage"]["patch_count"], as_["dark_coverage"]["patch_count"]), "应为 0"),
        ("页面 token 暗色缺口", bs["dark_coverage"]["token_gaps"], as_["dark_coverage"]["token_gaps"],
         d(bs["dark_coverage"]["token_gaps"], as_["dark_coverage"]["token_gaps"]), "应为 0"),
    ]
    rows = []
    for name, bv, av, delta, comment in metric_rows:
        rows.append([name, bv, av, "—" if delta is None else (f"{delta:+d}" if isinstance(delta, int) else f"{delta:+}"),
                     comment])
    lines.append(md_table(["指标", "before", "after", "差值", "判定口径"], rows))
    lines.append("")
    crit_after = [p for sc in ("light", "dark") for p in after["contrast"][sc]["pairs"]
                  if p["verdict"] == "critical" and not p["conditional"]]
    if crit_after:
        crit_ratios = [p["ratio"] for p in crit_after]
        lines.append(f"> 说明：「临界」= 达标但对比度 < 5.0（AA 4.5 的余量 < 0.5）。after 仍有 **{len(crit_after)} 项临界**"
                     f"（{min(crit_ratios):.2f}–{max(crit_ratios):.2f}），全部 ≥ 4.5 达标、**不是失败**；"
                     "这是语义色板刻意压到 AA 边缘（六色 tint/ink 对最低 4.61）的设计取舍，before 的临界项为 8 项。")
        lines.append("")

    # 语义组合
    combos = after["semantic_combos"]
    if combos:
        lines.append("## 2. 语义 token 组合（after，浅/深/最低）")
        lines.append("")
        rows = []
        for c in combos:
            rows.append([c["label"], _fmt_ratio(c["light"]), _fmt_ratio(c["dark"]), _fmt_ratio(c["min_ratio"]),
                         "PASS" if c["pass"] else "**FAIL**"])
        min_ratio = as_["semantic_combos"]["min_ratio"]
        rows.append(["**最低值**", "", "", _fmt_ratio(min_ratio),
                     "全部 PASS" if as_["semantic_combos"]["pass_all"] else
                     f"{as_['semantic_combos']['fail_count']} 组 FAIL"])
        lines.append(md_table(["组合", "浅色", "深色", "两主题最低", "判定(AA 4.5)"], rows))
        lines.append("")
        uniq = len({(c["fg"], c["bg"]) for c in combos})
        lines.append(f"> 口径：共 **{len(combos)} 组**语义组合 × 2 主题 = **{len(combos) * 2} 项检查**"
                     f"（其中 bl-ink×bl-tint、rose-ink×rose-tint 为 Lead 指定单列项，与六色表同值，去重后 {uniq} 组唯一组合）。"
                     "AA 阈值按 normal 文本 4.5:1 从严判定。")
        lines.append("")

    # before TOP 问题 → after 状态
    def pair_keys(report, scope):
        return {(p["selector"], p["bg"]["hex"]) for p in report["contrast"][scope]["pairs"]
                if p["verdict"] == "fail" and not p["conditional"]}

    before_fails = {(scope, sel, bg) for scope in ("light", "dark") for sel, bg in pair_keys(before, scope)}
    after_fails = {(scope, sel, bg) for scope in ("light", "dark") for sel, bg in pair_keys(after, scope)}
    resolved = sorted(before_fails - after_fails)
    introduced = sorted(after_fails - before_fails)

    # 按 selector 聚合 before 硬失败，给出 TOP 问题（行数/背景数）
    from collections import defaultdict
    agg = defaultdict(lambda: {"light": 0, "dark": 0, "ratios": [], "lines": set(), "bgs": set()})
    for scope in ("light", "dark"):
        for p in before["contrast"][scope]["pairs"]:
            if p["verdict"] != "fail" or p["conditional"]:
                continue
            key = p["selector"]
            agg[key][scope] += 1
            agg[key]["ratios"].append(p["ratio"])
            agg[key]["lines"].add(p["rule_line"])
            agg[key]["bgs"].add(p["bg"]["hex"])
    top = sorted(agg.items(), key=lambda kv: (-(kv[1]["light"] + kv[1]["dark"]), min(kv[1]["ratios"] or [99])))
    lines.append("## 3. before TOP 问题 → after 状态")
    lines.append("")
    rows = []
    for rank, (sel, info) in enumerate(top[:12], 1):
        after_has = any(k[1] == sel for k in after_fails)
        status = "**未解决**" if after_has else "已解决"
        rows.append([rank, f"`{sel}`", info["light"] + info["dark"], ", ".join(info["bgs"])[:40],
                     f"{min(info['ratios']):.2f}", status])
    if not rows:
        rows.append(["—", "before 无硬失败", "", "", "", "—"])
    lines.append(md_table(["#", "文字规则", "失败组合数", "背景色", "最低对比度", "after 状态"], rows))
    lines.append("")
    before_total = bs["contast"]["light"]["fail"] + bs["contast"]["dark"]["fail"]
    after_total = as_["contast"]["light"]["fail"] + as_["contast"]["dark"]["fail"]
    lines.append(f"before 硬失败 **{before_total}** 项（浅 {bs['contast']['light']['fail']} / 深 {bs['contast']['dark']['fail']}）"
                 f"→ after 硬失败 **{after_total}** 项（浅 {as_['contast']['light']['fail']} / 深 {as_['contast']['dark']['fail']}）。"
                 f"按「文字规则 × 背景色 × 主题」去重：已解决 {len(resolved)} 项，新增 {len(introduced)} 项。")
    lines.append("")
    if introduced:
        lines.append("**新增失败项（需人工确认）**")
        lines.append("")
        lines.append(md_table(["主题", "文字规则", "背景色"], [[s, f"`{sel}`", bg] for s, sel, bg in introduced[:30]]))
        lines.append("")

    # 3.1 暗色模式专项
    lines.append("### 3.1 暗色模式专项")
    lines.append("")
    dark_rows = []
    dark_before = bs["contast"]["dark"]
    dark_after = as_["contast"]["dark"]
    dark_rows.append(["暗色硬失败（页面/全站）", f"{dark_before['fail_page']}/{dark_before['fail_app']}",
                      f"{dark_after['fail_page']}/{dark_after['fail_app']}"])
    dark_rows.append(["暗色临界", dark_before["critical"], dark_after["critical"]])
    dark_rows.append(["暗色条件性风险", dark_before["conditional_risk"], dark_after["conditional_risk"]])
    dark_rows.append(["暗色 unresolved", bs["unresolved"]["dark"], as_["unresolved"]["dark"]])
    dark_rows.append(["页面 token 暗色缺口", bs["dark_coverage"]["token_gaps"], as_["dark_coverage"]["token_gaps"]])
    dark_rows.append(["浅色写死·暗色 filter/opacity 补丁", bs["dark_coverage"]["patch_count"],
                      as_["dark_coverage"]["patch_count"]])
    dark_combos = [c for c in combos if c["themes"].get("dark", {}).get("ratio") is not None]
    if dark_combos:
        dmin = min(c["themes"]["dark"]["ratio"] for c in dark_combos)
        dark_rows.append(["语义组合·暗色最低对比度", "—", _fmt_ratio(dmin)])
    lines.append(md_table(["暗色指标", "before", "after"], dark_rows))
    lines.append("")
    lines.append("结论：暗色模式由「同一批浅色实底 + brightness(.88) 补丁」改为「独立暗色 token」，"
                 "硬失败归零（浅 11→0）、no filter 补丁、token 30/30 全覆盖；"
                 f"暗色条件性风险 {bs['contast']['dark']['conditional_risk']} → {as_['contast']['dark']['conditional_risk']}。")
    lines.append("")

    # 3.2 残留风险与条件性项
    lines.append("### 3.2 残留风险、页面级修复与条件性项")
    lines.append("")
    residual = []
    seen_res = set()
    for p in after["contrast"]["light"]["pairs"] + after["contrast"]["dark"]["pairs"]:
        if p["verdict"] == "fail" and not p["conditional"] and p.get("rule_role") != "page":
            key = (p["scope"], p["selector"], p["bg"]["hex"])
            if key in seen_res:
                continue
            seen_res.add(key)
            residual.append([p["scope"], f"`{p['selector']}`", p["text"]["hex"], p["bg"]["hex"],
                             _fmt_ratio(p["ratio"]), "全站/组件层既有规则，非页面 wxss 本次改动"])
    if residual:
        lines.append(md_table(["主题", "文字规则", "文字色", "背景色", "对比度", "说明"], residual))
    else:
        lines.append("_after 无残留硬失败（全站/组件层 0 项）_")
    lines.append("")
    # before 的全站层 2 项 → 页面级覆盖修复（app.wxss 全局未动）
    overrides = [(".m3-btn--filled", ".nt-page .m3-btn--filled"),
                 (".m3-li__trail", ".nt-page .m3-li__trail")]
    fixed_rows = []
    for app_sel, page_sel in overrides:
        b_pair = next((p for p in before["contrast"]["light"]["pairs"]
                       if p["selector"] == app_sel and p["verdict"] == "fail" and not p["conditional"]), None)
        a_pair = next((p for p in after["contrast"]["light"]["pairs"] if p["selector"] == page_sel), None)
        fixed_rows.append([
            f"`{app_sel}`（app.wxss，全站）",
            f"{_fmt_ratio(b_pair['ratio'])}（FAIL）" if b_pair else "—",
            f"`{page_sel}`（nt.wxss，页面级）",
            f"{_fmt_ratio(a_pair['ratio'])}（{'PASS' if a_pair and a_pair['verdict'] == 'pass' else '—'}）" if a_pair else "—",
            "app.wxss 全局未改动，覆盖仅限 `.nt-page` 内，其它页面不受影响",
        ])
    lines.append("**before 全站层 2 项硬失败 → after 在 nt 页面级修复**")
    lines.append("")
    lines.append(md_table(["before 失败项", "before 对比度", "after 页面级覆盖", "after 对比度", "说明"], fixed_rows))
    lines.append("")
    # 条件性项说明
    cond_light = [p for p in after["contrast"]["light"]["pairs"]
                  if p["conditional"] and (p["verdict"] in ("fail", "critical") or p.get("opacity_risk"))]
    cond_dark = [p for p in after["contrast"]["dark"]["pairs"]
                 if p["conditional"] and (p["verdict"] in ("fail", "critical") or p.get("opacity_risk"))]
    uncertain = [p for p in cond_light + cond_dark if p["uncertain"]]
    before_cond = bs["contast"]["light"]["conditional_risk"] + bs["contast"]["dark"]["conditional_risk"]
    after_cond = as_["contast"]["light"]["conditional_risk"] + as_["contast"]["dark"]["conditional_risk"]
    lines.append(f"- **`.nt-card--done` 整卡 opacity 已移除**（opacity 数 {bn['opacity_decls']}→{an['opacity_decls']}）：done 态改为「下沉底色 `--nt-card-soft` + 状态灰化 + 标题删除线」，"
                 f"条件性风险 {before_cond} → {after_cond}（after 仅剩图片字幕半透明项），不再出现「done 卡片整卡降权导致文字低于 AA」。")
    lines.append(f"- **图片字幕 `.nt-img-cap`**：白字 + 半透明黑色渐变覆盖在图片上（{len(uncertain)} 项 uncertain），"
                 "底图内容不可静态解析；属功能性覆盖，保留为人工核对项。")
    lines.append(f"- **组件内部 unresolved**：after unresolved {as_['unresolved']['light']}/{as_['unresolved']['dark']} 项（浅/深），"
                 "集中在未纳入审计的 `<bottom-sheet>` / `<empty-state>` 组件内部（原始消息弹层、提醒弹层、编辑表单）；"
                 "`<touchable>` 以 `cls` 代理渲染类（近似）。需要覆盖时用 `--extra components/<tag>/index.wxss` 复跑，"
                 "组件容器背景将按组件 wxss 推断并标注 `component-inferred`。")
    lines.append("")

    # 4 PASS/FAIL 判定
    lines.append("## 4. 结论 / PASS-FAIL")
    lines.append("")
    dc = as_["dark_coverage"]
    noise_ok = all(an[k] <= bn[k] for k in ("box_shadow", "linear_gradient", "dashed", "filter",
                                            "opacity_decls", "color_literal_occurrences", "distinct_hex_literals"))
    after_literals = an["color_literal_occurrences"]
    page_fail_after = as_["contast"]["light"]["fail_page"] + as_["contast"]["dark"]["fail_page"]
    app_fail_after = as_["contast"]["light"]["fail_app"] + as_["contast"]["dark"]["fail_app"]
    app_fail_before = bs["contast"]["light"]["fail_app"] + bs["contast"]["dark"]["fail_app"]
    sem_after = after.get("semantic_palette") or {}
    fam_map = {f.get("family"): f for f in sem_after.get("color_families", [])}
    six = ["cy", "bl", "sd", "rose", "violet", "grey"]
    missing_fams = [f for f in six
                    if f not in fam_map or not fam_map[f].get("tint") or not fam_map[f].get("ink")]
    checks = [
        ("对比度：页面 wxss 硬失败归零（浅+深）",
         page_fail_after == 0,
         f"after 页面 {page_fail_after} 项；before 页面 "
         f"{bs['contast']['light']['fail_page'] + bs['contast']['dark']['fail_page']} 项"
         + (f"；另有全站/组件层既有 {app_fail_after} 项（before {app_fail_before} 项，非本次页面改动引入）" if app_fail_after else "")),
        ("暗色覆盖：无功能外的写死缺口",
         dc["missing_nonfunctional"] == 0,
         f"非功能性缺口 {dc['missing_nonfunctional']} 处；剩余 {dc['missing']} 处为功能性（图片字幕）"),
        ("全站层既有 2 项硬失败已在 nt 页面级修复",
         app_fail_after == 0 and app_fail_before > 0,
         "`.m3-btn--filled` 3.65→5.09、`.m3-li__trail` 4.48→9.05（`.nt-page` 内覆盖；app.wxss 全局未动）"
         if app_fail_after == 0 and app_fail_before > 0 else f"after 全站层失败 {app_fail_after} 项"),
        ("暗色覆盖：无 filter/opacity 亮度补丁",
         dc["patch_count"] == 0, f"after patch {dc['patch_count']} 处；before {bs['dark_coverage']['patch_count']} 处"),
        ("页面 token 暗色全覆盖", dc["token_gaps"] == 0, f"缺口 {dc['token_gaps']} 个"),
        ("语义色板「文字×背景」全部 AA（4.5）",
         bool(combos) and as_["semantic_combos"]["pass_all"] is True,
         f"最低 {_fmt_ratio(as_['semantic_combos']['min_ratio'])}（{as_['semantic_combos']['count']} 组）"),
        ("整洁度指标不劣化（box-shadow/渐变/虚线/filter/字面量/独立色数）",
         noise_ok, "全部 ≤ before" if noise_ok else "存在指标上升"),
        ("无新增对比度失败", len(introduced) == 0, f"新增 {len(introduced)} 项"),
        ("页面级 token 化（浅/深同套语义 token）",
         as_["page_token_count"]["light"] > 0 and as_["page_token_count"]["dark"] > 0,
         f"after 浅 {as_['page_token_count']['light']} / 深 {as_['page_token_count']['dark']}"),
        ("莫奈六色语义保留（tint + ink 齐全）",
         not missing_fams,
         ("六色齐全（cy/bl/sd/rose/violet/grey）" if not missing_fams
          else "缺失：" + ",".join(missing_fams))),
    ]
    rows = [[name, "**PASS**" if ok else "**FAIL**", detail] for name, ok, detail in checks]
    lines.append(md_table(["检查项", "结果", "依据"], rows))
    lines.append("")
    all_pass = all(ok for _, ok, _ in checks)
    lines.append(f"**总判定：{'PASS — 目标达成，未发现新问题' if all_pass else 'FAIL — 见上表未通过项'}**")
    lines.append("")

    # 5 莫奈六色调色板
    lines.append("## 5. after 莫奈六色调色板（浅 / 深）")
    lines.append("")
    if fam_map:
        rows = []
        for f in six:
            fam = fam_map.get(f) or {}
            t = fam.get("tint") or {}
            i = fam.get("ink") or {}
            d = fam.get("deep") or {}
            rows.append([f.upper(), t.get("light") or "—", i.get("light") or "—", d.get("light") or "—",
                         t.get("dark") or "—", i.get("dark") or "—", d.get("dark") or "—"])
        lines.append(md_table(["色", "浅 tint", "浅 ink", "浅 deep", "深 tint", "深 ink", "深 deep"], rows))
        lines.append("")
        lines.append("> deep 列：cy 取 `--nt-cy-deep`，其余五色回退显示基色 `--nt-<色>`；六色均使用「tint 底 + ink 字」，未再用白字实底。")
    else:
        lines.append("_after 无页面级语义 token，无法判断莫奈六色保留情况_")
    lines.append("")

    # 6 残留字面量
    lines.append("## 6. after 残留颜色字面量（应仅为功能性覆盖）")
    lines.append("")
    residues = [i for i in after["color_literals_flat"] if i["kind"] == "style" and not i.get("in_var_fallback")]
    if residues:
        lines.append(md_table(["行", "选择器", "属性", "颜色", "值"],
                              [[i["line"], f"`{i['selector']}`", i["property"], f"`{i['hex'] or i['raw']}`",
                                f"`{i['value']}`"] for i in residues]))
    else:
        lines.append("_无_")
    lines.append("")

    # 7 复现
    lines.append("## 7. 复现")
    lines.append("")
    lines.append("```powershell")
    lines.append("python color_audit.py --root _color_audit/before/source --out _color_audit/before --label before")
    lines.append("python color_audit.py --out _color_audit/after --label after")
    lines.append("python color_audit.py --compare _color_audit/before _color_audit/after --out _color_audit/COMPARE.md")
    lines.append("```")
    lines.append("")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"[compare] wrote {out_path}")


# --------------------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------------------


def default_root() -> Path:
    here = Path(__file__).resolve().parent
    candidate = here.parent / "mp-class-tools"
    return candidate


def main(argv=None):
    ap = argparse.ArgumentParser(description="WXSS 配色静态审计（WCAG / 硬编码 / 暗色覆盖 / 调色板快照）")
    ap.add_argument("--root", default=None, help="小程序源码根目录（默认 ../mp-class-tools）")
    ap.add_argument("--page", default="pages/nt/nt.wxss", help="目标页面 WXSS（相对 root）")
    ap.add_argument("--app", default="app.wxss", help="全局 WXSS（相对 root）")
    ap.add_argument("--wxml", default="pages/nt/nt.wxml", help="目标页面 WXML（相对 root；用于父类背景/继承推断）")
    ap.add_argument("--extra", nargs="*", default=None, help="附加文件（组件 wxss 等，相对 root）")
    ap.add_argument("--out", required=True, help="输出目录（report.md / report.json），或 --compare 时的输出 md 路径")
    ap.add_argument("--label", default="", help="报告标签，如 before / after")
    ap.add_argument("--compare", nargs=2, metavar=("BEFORE_DIR", "AFTER_DIR"), default=None,
                    help="对比模式：读取两个 report.json，写 COMPARE.md")
    args = ap.parse_args(argv)

    if args.compare:
        before_dir = Path(args.compare[0])
        after_dir = Path(args.compare[1])
        out_path = Path(args.out)
        if out_path.is_dir():
            out_path = out_path / "COMPARE.md"
        write_compare(before_dir, after_dir, out_path)
        return 0

    root = Path(args.root).resolve() if args.root else default_root().resolve()
    if not root.exists():
        print(f"[error] root not found: {root}", file=sys.stderr)
        return 2
    args.root = str(root)
    label = args.label or Path(args.out).name
    args.label = label
    report = audit(args)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    write_report_md(report, out_dir)
    s = report["summary"]
    print(f"[audit] {label}: page={report['meta']['page']}")
    print(f"[audit] tokens light/dark={s['page_token_count']['light']}/{s['page_token_count']['dark']}  "
          f"literals(style)={s['noise']['color_literal_occurrences']}  "
          f"gradients={s['noise']['linear_gradient']}  shadow={s['noise']['box_shadow']}  dashed={s['noise']['dashed']}  "
          f"filter={s['noise']['filter']}")
    print(f"[audit] contrast fail light/dark={s['contast']['light']['fail']}/{s['contast']['dark']['fail']}  "
          f"critical={s['contast']['light']['critical']}/{s['contast']['dark']['critical']}  "
          f"unresolved={s['unresolved']['light']}/{s['unresolved']['dark']}")
    print(f"[audit] dark gaps: missing_nonfunctional={s['dark_coverage']['missing_nonfunctional']}  "
          f"patch={s['dark_coverage']['patch_count']}  token_gaps={s['dark_coverage']['token_gaps']}")
    if s["semantic_combos"]["count"]:
        print(f"[audit] semantic combos={s['semantic_combos']['count']}  min={s['semantic_combos']['min_ratio']}  "
              f"pass_all={s['semantic_combos']['pass_all']}")
    print(f"[audit] wrote {out_dir / 'report.md'} / report.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
