#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""从 web/legal/mp/{privacy,terms}.html 提取小程序端法律页正文 → utils/legal-data.js

一次性/可复跑的离线提取器（不参与小程序运行，不引入构建链）：
  python tests/gen_legal_content.py
  python tests/gen_legal_content.py --src <dir> --out <js>

只提取条款文字（标题/段落/列表/表格行/提示框），去掉目录、跨端导航、页头页脚和 URL；
不新增、不改写条款。生成物是纯 JS 数据模块，小程序运行时零网络/零 HTML 依赖。
"""
import argparse
import json
import os
import re
import sys

from lxml import html

DEFAULT_SRC = r"C:\Users\Ko_Li\.openclaw\workspace\web\legal\mp"
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "utils", "legal-data.js")


def norm(s):
    s = (s or "").replace("\r", "").replace("\u00a0", " ")
    s = re.sub(r"[ \t\f\v]+", " ", s)
    return s.strip()


def inline_text(el):
    """元素内文字；<br> 转成换行，便于联系信息分行。"""
    if el is None:
        return ""
    for br in el.xpath(".//br"):
        br.tail = "\n" + (br.tail or "")
    return norm("".join(el.itertext()))


def lines_of(el):
    """段落/列表/提示框 → 纯文本行数组。"""
    out = []
    for child in el.iterchildren():
        tag = child.tag if isinstance(child.tag, str) else ""
        if tag in ("p", "div") and "callout-title" not in (child.get("class") or ""):
            t = inline_text(child)
            if t:
                out.extend([x.strip() for x in t.split("\n") if x.strip()])
        elif tag in ("ul", "ol"):
            for i, li in enumerate(child.xpath("./li")):
                t = inline_text(li)
                if not t:
                    continue
                prefix = (str(i + 1) + ". ") if tag == "ol" else ""
                out.extend([prefix + x.strip() for x in t.split("\n") if x.strip()])
        elif tag in ("h3", "h4"):
            t = inline_text(child)
            if t:
                out.append(t)
    if not out:
        t = inline_text(el)
        if t:
            out = [x.strip() for x in t.split("\n") if x.strip()]
    return out


def table_block(wrap, idx):
    tb = wrap.find(".//table")
    if tb is None:
        return None
    cap = tb.find(".//caption")
    heads = [norm("".join(th.itertext())) for th in tb.xpath(".//thead//th")]
    rows = []
    for tr in tb.xpath(".//tbody/tr"):
        cells = [norm("".join(td.itertext())) for td in tr.xpath("./td")]
        cells = [c for c in cells if c]
        if not cells:
            continue
        if heads:
            parts = []
            for i, c in enumerate(cells):
                k = heads[i] if i < len(heads) else ""
                parts.append((k + "：" + c) if k else c)
            rows.append(" ｜ ".join(parts))
        else:
            rows.append(" ｜ ".join(cells))
    if not (heads or rows):
        return None
    return {
        "t": "table",
        "id": "b%d" % idx,
        "caption": norm("".join(cap.itertext())) if cap is not None else "",
        "headText": " ｜ ".join(heads) if heads else "",
        "lines": rows,
    }


def unwrap_pre(art):
    """<pre> 里的纯文本（附件 D 申请表）与后续 h2/表格在 HTML 结构上被包在一起；
    展开成 article 的直接子节点，主循环才能按段落/标题/表格处理。"""
    for pre in art.xpath(".//pre"):
        parent = pre.getparent()
        if parent is None:
            continue
        idx = parent.index(pre)
        parent.remove(pre)
        pos = idx
        for line in (pre.text or "").split("\n"):
            t = norm(line)
            if not t:
                continue
            p = html.Element("p")
            p.text = t
            parent.insert(pos, p)
            pos += 1
        for child in list(pre.iterchildren()):
            parent.insert(pos, child)
            pos += 1


def extract(path, kind):
    doc = html.parse(path)
    root = doc.getroot()
    body = root.find("body")
    for el in body.xpath(".//script|.//style|.//nav|.//aside|.//footer"):
        el.drop_tree()
    art = body.find(".//article")
    if art is None:
        art = body
    unwrap_pre(art)

    head = art.xpath(".//header[contains(@class,'doc-head')]")
    head = head[0] if head else None
    kicker = head.xpath(".//*[contains(@class,'kicker')]")[0] if head is not None and head.xpath(".//*[contains(@class,'kicker')]") else None
    h1 = head.find(".//h1") if head is not None else None
    lead = head.xpath(".//*[contains(@class,'lead')]")[0] if head is not None and head.xpath(".//*[contains(@class,'lead')]") else None
    meta = []
    if head is not None:
        for cell in head.xpath(".//*[contains(@class,'meta-grid')]/*"):
            lab = cell.find(".//span")
            val = cell.find(".//b")
            if lab is not None and val is not None:
                k = norm("".join(lab.itertext()))
                v = norm("".join(val.itertext()))
                if k and v:
                    meta.append({"k": k, "v": v})
    doc_notes = []
    if head is not None:
        for p in head.xpath(".//*[contains(@class,'doc-note')]"):
            t = inline_text(p)
            if t and "http" not in t.lower() and "www." not in t.lower():
                doc_notes.append(t)

    blocks = []
    toc = []

    def add(b):
        if not b:
            return
        b["id"] = "b%d" % (len(blocks) + 1)
        blocks.append(b)

    def h2_of(el):
        clone = html.fromstring(html.tostring(el, encoding="unicode"))
        for num in clone.xpath(".//*[contains(@class,'h2num')]"):
            num.drop_tree()
        text = inline_text(clone)
        anchor = el.get("id") or ("s%d" % (len(toc) + 1))
        return text, anchor

    # 只遍历 article 的直接子节点；special 内部再展开
    for child in art.iterchildren():
        tag = child.tag if isinstance(child.tag, str) else ""
        cls = child.get("class") or ""
        if tag == "header":
            continue
        if tag == "div" and "summary-grid" in cls:
            continue
        if tag == "div" and "callout" in cls:
            title_els = child.xpath(".//*[contains(@class,'callout-title')]")
            title = inline_text(title_els[0]) if title_els else ""
            lines = lines_of(child)
            if title and lines and lines[0] == title:
                lines = lines[1:]
            if title or lines:
                add({"t": "note", "title": title, "lines": lines})
            continue
        if tag == "div" and "table-wrap" in cls:
            add(table_block(child, len(blocks) + 1))
            continue
        if tag == "div" and "special" in cls:
            for sub in child.iterchildren():
                st = sub.tag if isinstance(sub.tag, str) else ""
                if st == "h3":
                    add({"t": "h3", "text": inline_text(sub)})
                elif st in ("p", "div"):
                    for line in [x.strip() for x in inline_text(sub).split("\n") if x.strip()]:
                        add({"t": "p", "text": line})
                elif st in ("ul", "ol"):
                    for i, li in enumerate(sub.xpath("./li")):
                        for line in [x.strip() for x in inline_text(li).split("\n") if x.strip()]:
                            add({"t": "li", "text": line})
                elif st == "table":
                    # 理论上 special 不含表格；保留兜底
                    for i, tr in enumerate(sub.xpath(".//tr")):
                        cells = [norm("".join(td.itertext())) for td in tr.xpath("./th|./td")]
                        cells = [c for c in cells if c]
                        if cells:
                            add({"t": "p", "text": " ｜ ".join(cells)})
            continue
        if tag == "h2":
            text, anchor = h2_of(child)
            if text:
                add({"t": "h2", "text": text, "anchor": anchor})
                toc.append({"id": anchor, "text": text})
            continue
        if tag in ("h3", "h4"):
            text = inline_text(child)
            if text:
                add({"t": "h3", "text": text})
            continue
        if tag == "p":
            text = inline_text(child)
            for line in [x.strip() for x in text.split("\n") if x.strip()]:
                add({"t": "p", "text": line})
            continue
        if tag in ("ul", "ol"):
            for i, li in enumerate(child.xpath("./li")):
                text = inline_text(li)
                if not text:
                    continue
                prefix = (str(i + 1) + ". ") if tag == "ol" else ""
                for line in [x.strip() for x in text.split("\n") if x.strip()]:
                    add({"t": "li", "text": prefix + line})
            continue
        if tag == "dl":
            for item in child.xpath("./div"):
                dt = item.find("dt")
                dd = item.find("dd")
                if dt is not None and dd is not None:
                    k = inline_text(dt)
                    v = inline_text(dd)
                    if k and v:
                        add({"t": "p", "text": k + "：" + v})
            continue

    meta_map = {x["k"]: x["v"] for x in meta}
    return {
        "type": kind,
        "title": inline_text(h1) if h1 is not None else ("隐私政策" if kind == "privacy" else "用户协议"),
        "code": inline_text(kicker) if kicker is not None else "",
        "lead": inline_text(lead) if lead is not None else "",
        "version": meta_map.get("文档版本", ""),
        "effective": meta_map.get("生效日期", ""),
        "updated": meta_map.get("更新日期", ""),
        "operator": meta_map.get("运营者", ""),
        "meta": meta,
        "basis": doc_notes,
        "toc": toc,
        "blocks": blocks,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_SRC)
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()
    data = {
        "privacy": extract(os.path.join(args.src, "privacy.html"), "privacy"),
        "terms": extract(os.path.join(args.src, "terms.html"), "terms"),
    }
    for k, d in data.items():
        if not d["blocks"] or not d["toc"]:
            raise SystemExit("extract failed: %s blocks=%d toc=%d" % (k, len(d["blocks"]), len(d["toc"])))
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    header = (
        "'use strict';\n"
        "// utils/legal-data.js —— 微信小程序端《隐私政策》《用户协议》正文（2026-11-19 提取）\n"
        "// 来源：web/legal/mp/privacy.html、web/legal/mp/terms.html（V1.0，生效 2026-11-17）；\n"
        "// 由 tests/gen_legal_content.py 生成，条款文字不改写；小程序运行时只读本模块，不请求外链/HTML。\n"
        "module.exports = " + payload + ";\n"
    )
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        f.write(header)
    size = os.path.getsize(args.out)
    print("wrote", args.out, size, "bytes")
    for k, d in data.items():
        print(k, "blocks", len(d["blocks"]), "toc", len(d["toc"]),
              "version", d["version"], "effective", d["effective"], "operator", d["operator"])


if __name__ == "__main__":
    sys.exit(main())
