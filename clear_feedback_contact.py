#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一次性地清空 public.feedback.contact 旧值（2026-11-05：反馈建议停收 QQ / 微信）。

背景：小程序 v23 / 1.5.2 起反馈页不再收集 QQ / 微信联系方式，代码只写空串；
按用户要求把历史已提交的 contact 旧值也清空（行本身保留，content/acc/done/ts 不动）。

用法：
  python clear_feedback_contact.py 3260799999 测试账号            # 预演：只统计，不写
  python clear_feedback_contact.py 3260799999 测试账号 --apply    # 真正执行（需要管理员身份）

安全：
  * 只读取 mp-class-tools/utils/cloud-config.js 里的公开 publishableKey（随客户端下发，非机密）；
  * 身份 token 只在本进程内存中使用，不打印、不落盘；
  * 只输出条数，不打印反馈内容 / 联系方式 / token。
"""
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CFG = ROOT / 'mp-class-tools' / 'utils' / 'cloud-config.js'


def load_config():
    src = CFG.read_text(encoding='utf-8')
    rest = re.search(r"restBase:\s*'([^']+)'", src)
    key = re.search(r"publishableKey:\s*'([^']+)'", src)
    if not rest or not key:
        raise SystemExit('无法从 cloud-config.js 读取 restBase / publishableKey')
    return rest.group(1).rstrip('/') + '/', key.group(1)


def http(method, url, headers, body=None):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return r.status, (json.loads(raw.decode('utf-8')) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            payload = json.loads(raw.decode('utf-8'))
        except Exception:
            payload = raw.decode('utf-8', 'replace')[:300]
        return e.code, payload


def main(argv):
    if len(argv) < 3:
        raise SystemExit('用法: python clear_feedback_contact.py <学号> <姓名> [--apply]')
    sid, name = argv[1].strip(), argv[2].strip()
    apply = '--apply' in argv[3:]
    base, key = load_config()
    auth = {'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}

    # 1) 管理员身份（只读 RPC）
    st, resp = http('POST', base + 'rpc/class_verify', auth, {'p_sid': sid, 'p_name': name})
    if isinstance(resp, list):
        resp = resp[0] if resp else None
    if st != 200 or not isinstance(resp, dict) or resp.get('ok') is not True or not resp.get('token'):
        raise SystemExit('身份校验失败（HTTP %s）；未做任何写入' % st)
    if not resp.get('is_admin'):
        raise SystemExit('该身份不是管理员，无法修改 feedback；未做任何写入')
    token = str(resp['token'])
    h = dict(auth)
    h['X-Class-Token'] = token

    # 2) 读取现状（只统计条数）
    st, rows = http('GET', base + 'feedback?select=id,contact&limit=10000', h)
    if st != 200 or not isinstance(rows, list):
        raise SystemExit('读取 feedback 失败（HTTP %s）；未做任何写入' % st)
    nonempty = sum(1 for r in rows if str((r or {}).get('contact') or '') != '')
    print('feedback 总行数: %d；contact 非空: %d' % (len(rows), nonempty))
    if nonempty == 0:
        print('无需清理（contact 已全部为空）')
        return
    if not apply:
        print('预演模式：未写入。确认后加 --apply 执行。')
        return

    # 3) 一次性把 contact 置空（PATCH 只改 contact 列；行与其它字段不动）
    st, resp = http('PATCH', base + 'feedback?id=not.is.null', h, {'contact': ''})
    if st not in (200, 204):
        raise SystemExit('清空失败（HTTP %s），中止；请检查 RLS/权限。' % st)
    print('已发出清空请求（HTTP %s）' % st)

    # 4) 复核
    st, rows2 = http('GET', base + 'feedback?select=id,contact&limit=10000', h)
    if st != 200 or not isinstance(rows2, list):
        raise SystemExit('复核读取失败（HTTP %s）' % st)
    left = sum(1 for r in rows2 if str((r or {}).get('contact') or '') != '')
    print('复核：总行数 %d；contact 非空 %d' % (len(rows2), left))
    if left:
        raise SystemExit('仍有残留，请重试')
    print('OK：feedback.contact 旧值已全部清空')


if __name__ == '__main__':
    main(sys.argv)
