# 修改日报 — 2026-03-14

## 一、多账号管理与自动登录选择

**问题**：此前仅支持单账号配置，多账号切换需要手动修改手机号和接码链接，操作繁琐。

**改动文件**：
- `js/panel/index.js` — 重构账号管理模块（+202行），支持多账号配置列表，每个账号包含手机号和接码链接；通过单选按钮选择当前登录账号；自动登录完成后自动启动采集任务
- `side_panel.html` — 账号列表 UI，支持添加/删除账号、单选切换
- `js/background/index.js` — 配合多账号逻辑调整后台任务启动流程

## 二、rednote 域名跳转兼容

**问题**：国内 IP 访问 rednote.com 会被重定向到 xiaohongshu.com，导致 bat 脚本需要两次打开 URL。

**改动文件**：
- `scripts/run_chrome_rednote_1min.bat` — 调整启动脚本，兼容域名跳转场景

## 涉及文件汇总

| 文件 | 改动点 |
|------|--------|
| `js/panel/index.js` | 多账号管理、单选切换、登录后自动启动任务 |
| `side_panel.html` | 账号列表 UI |
| `js/background/index.js` | 配合多账号调整 |
| `scripts/run_chrome_rednote_1min.bat` | 域名跳转兼容 |
| `CHANGELOG_AUTO_LOGIN.md` | 自动登录功能变更记录 |

---

## 总结

实现了多账号管理能力，支持在插件中配置多个小红书账号并通过单选按钮快速切换，自动登录完成后无缝衔接采集任务；同时解决了国内 IP 下 rednote.com 域名跳转的兼容性问题，确保自动化脚本在不同网络环境下正常运行。
