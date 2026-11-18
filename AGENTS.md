# AGENTS.md — 小程序端仓库（class-tools-mp）

本仓库是「班级工具站」的微信小程序原生版源码，**测试与验收脚本已并入 `tests/`**（原 `mp-class-tools-tests` 仓库已归档）。
五个端各一个仓库：**site（网页/部署）· android · mp（本仓）· harmony · windows**。
**不要再按功能拆新仓库**；功能改动落在所属端的仓库里。

## 提交规则（硬性，2026-11-18 用户要求）

任何改动完成后，在仓库根目录执行：

```cmd
sync-repos.cmd "feat: 说明本次改了什么"
```

- 它会做安全检查 → `git add -A` → 提交 → **同时推 GitHub `origin` + Gitee `gitee`** → 核对两端 SHA。
- 只推一个远端 / 不写说明 / 写「更新」「修改」「同步」这类笼统说明 = **未完成交付**。
- 两个远端都是**私有仓库**，不要改为公开。
- **没有计划任务、没有后台守护**（用户 2026-11-18 要求）：改完必须**主动执行**上面命令；
  不要等定时任务、不要依赖任何兜底。
- 核对状态：`sync-repos.cmd --check`。

## 目录与包体

- 小程序根目录就是本仓库根；`tests/` 只放测试脚本，已在 `project.config.json` 的 `packOptions.ignore` 中排除，**不会进小程序包**。
- `tests/` 的运行产物（`_shots*`、`_backup_*`、`*-result.json`、`node_modules/`）已在 `.gitignore` 排除。
- `ai/`、`agent/` 同样在打包时排除。

## 禁止

- 提交密钥 / 证书：`*.jks`、`*.p12`、`*.pfx`、`*.pem`、`*.key`、`*.env`。
- 提交构建/依赖产物：`node_modules/`、`miniprogram_npm/`、`cloudfunctions/**/node_modules/`。
- 改动其他端仓库；跨端契约改动先看 `web/AGENTS.md` 与对应 `CONTRACT.md`。

## 验证

```cmd
cd tests
node unit.js
```

自动化测试只用 `miniprogram-automator` + `wx.screenshot`，不要用屏幕操作或真机推送；
测试身份只用 3260799999 测试账号或 9999 段临时身份。
