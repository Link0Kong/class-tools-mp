# 测试与静态检查

本目录是小程序仓库的测试集合：所有用例都在 Node / Python 里用 **wx mock** 运行，不访问真实云端、不操作开发者工具、不发订阅消息。

## 环境

- Node.js 16+
- Python 3（仅 `staticcheck.py` 与图片工具需要）
- Python 依赖：Pillow、numpy（仅 `make_share_images.py` / `optimize_images.py` 需要）

所有命令都在**仓库根目录**执行。

## 主要入口

| 命令 | 说明 |
| --- | --- |
| `node tests/unit.js` | 主测试集：纯逻辑、页面契约、云端请求与同步行为（约 25 个测试文件） |
| `node tests/sync_contract_test.js` | 跨端 `userdata` v6 / `marks` 同步契约（夹具在 `_sync_fixtures/`） |
| `python tests/staticcheck.py` | 静态检查：页面四件套、组件引用、事件 handler、分享、包体大小 |
| `node tests/code_quality_check.js` | 离线复刻微信开发者工具「代码质量」规则（图片体积、未使用组件/文件） |
| `node tests/ai_unit_all.js` | `ai/` 原子接口单测（mock `wx.modelContext`，结果写入 `tests/_reports/`） |
| `node tests/ai_eval_check.js` | AI 意图用例评分（用例在 `ai_eval_cases.json`） |
| `node tests/cloudfunctions/notify.test.js` | 订阅消息云函数单测（内存 mock 云开发 SDK） |

以下为独立单元测试，可直接运行：

```bash
node tests/identity_encoding_unit.js
node tests/tool_sort_unit.js
node tests/cloud_patch_fallback_test.js
node tests/notify_flush_ui_test.js
```

## 夹具与共享基座

| 文件 | 用途 |
| --- | --- |
| `_app_pages.js` | 从 `app.json` 解析全部页面路径，供页面级契约测试使用 |
| `_ai_harness.js` | AI 原子接口测试基座：mock `wx`、storage、`modelContext` 与 REST 路由 |
| `_sync_fixtures/` | 跨端同步夹具（userdata v6、marks、merge 参考实现） |
| `ai_eval_cases.json` | AI 意图/实体识别评分用例 |

## 测试数据约定

- 身份只用官方测试身份 `3260799999` 或 9999 段临时身份；姓名一律用「测试账号 / 测试甲 / 张三」等虚构值。
- 不写入真实学号、手机号、班级名单、通知正文；新增夹具前请先脱敏。
- 测试运行产物（`tests/_reports/`、`_shots*`、`*-result.json`）已在 `.gitignore` 中排除，不要提交。

## 新增测试

1. 纯逻辑优先放到 `tests/`，文件名以 `*_unit_tests.js` 或 `*_test.js` 结尾。
2. 页面级测试参考现有写法：`loadPage()` + `wx` mock，断言页面方法/`data`/请求参数。
3. 需要真实网络或开发者工具自动化的脚本不要放进本目录；本仓库只保留可离线复跑的测试。
