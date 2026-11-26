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
| `node tests/task_unit_tests.js` | 个人任务专项：归一/分组/步骤备注/作业与通知转入/重复/taskdata 附件剥离/分享卡/页面入口 |
| `node --test tests/task_sync_v1_test.js tests/water_shared_v2_test.js` | V05/V09，Node.js 22+。消费 W03/W07 合成向量，运行实际小程序同步、页面、存储和请求代码。 |
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
node tests/group_split_unit.js
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

V05 的假后端强制校验 `id+ts`、首写方式和回执，覆盖删除与离线修改、发出后再编辑、更票、旧包装及私有附件。本机没有完整旧基线时，在任务页点击“核对旧本机任务”可查看和确认恢复。微信运行时拒绝 PATCH 时客户端保留待发，具体环境的验证见下文。

V09 使用同一后端下的两个独立小程序实例。通过水量页面保存与删除、切房、恢复网络、重新打开和用户再次确认，断言共享表写入次数及页面读数。空集只有在身份得到确认后才生效。水量分享入口发送页面链接；这些测试检查页面展示的读数和人数。真实微信网络、对端旧版本写入频率和线上策略需另外核验。

联合测试可用 `require('./mock_device.js').device(host, storage)` 创建隔离实例。`host.respond(req)` 接收真实代码构造的 `wx.request` 参数并回调 `req.success({ statusCode, data, header })` 或 `req.fail(error)`。常规调用见 [任务请求用例](task_sync_v1_test.js) 和 [水量页面用例](water_shared_v2_test.js)。两套脱敏夹具保存在 `_sync_fixtures/`，工作区存在 Web 仓时会和领域所有者的版本逐项核对。

**DevTools 传输复核，2026-11-27。** 本机微信开发者工具模拟器实际报告的 SDK `3.17.4` 和 `3.18.1` 均通过。每次由 miniprogram-automator 调用实际 `wx.request`，回环 HTTP 服务依次收到 GET、POST、PATCH，均返回 200。POST 与 PATCH 请求体均为 `{"synthetic":true}`。公共项目配置指定 `3.0.0`，本机私有开发者配置指定 `3.17.4`。指定 `3.0.0` 的探针运行时实际回报 `3.18.1`，所以 `3.0.0` 的 PATCH 能力仍待验证。手机微信、其他基础库和生产网关需分别验收。

在装有微信开发者工具和 `miniprogram-automator` 的 Windows 机器上，从仓根执行 `node tests/devtools_patch_probe.cjs 3.17.4`。脚本使用项目公开 AppID 在系统临时目录新建空白小程序，关闭该临时项目的域名校验，将合成请求发往 `127.0.0.1`。结果 JSON 记录双方观测与本次 SDK；仅关闭本次创建的项目。自定义安装路径可通过环境变量 `WX_DEVTOOLS_CLI` 指定。[回环探针](devtools_patch_probe.cjs)

- 身份只用官方测试身份 `3260799999` 或 9999 段临时身份；姓名一律用「测试账号 / 测试甲 / 张三」等虚构值。
- 不写入真实学号、手机号、班级名单、通知正文；新增夹具前请先脱敏。
- 测试运行产物（`tests/_reports/`、`_shots*`、`*-result.json`）已在 `.gitignore` 中排除，不要提交。

## 新增测试

1. 纯逻辑优先放到 `tests/`，文件名以 `*_unit_tests.js` 或 `*_test.js` 结尾。
2. 页面级测试参考现有写法：`loadPage()` + `wx` mock，断言页面方法/`data`/请求参数。
3. 需要真实网络或开发者工具自动化的脚本不要放进本目录；本仓库只保留可离线复跑的测试。
