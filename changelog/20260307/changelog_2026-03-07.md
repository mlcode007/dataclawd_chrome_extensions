# 修改日报 — 2026-03-07

## 一、初始可用版本发布

**问题**：此前项目仅有基础框架，缺少完整的自动化任务流程和采集日志功能。

**改动文件**：
- `js/background/index.js` — 完善 Service Worker，支持自动化任务调度
- `js/content/isolate.js` — 完善数据拦截与回传逻辑
- `js/content/main.js` — 优化请求拦截兼容性
- `js/panel/index.js` — 大幅增强面板功能（+743行），支持任务采集日志展示
- `manifest.json` — 更新权限声明
- `side_panel.html` — 重构侧边栏页面布局
- `README.md` — 更新项目说明

## 二、Rednote 域名兼容与 API Host 配置化

**问题**：插件仅支持 xiaohongshu.com 域名，无法在 rednote.com 上使用；API 地址硬编码在代码中，部署不灵活。

**改动文件**：
- `js/content/main.js` — 兼容 rednote.com 域名的请求拦截
- `js/content/isolate.js` — 兼容 webapi.rednote.com 搜索接口
- `js/panel/index.js` — API Host 改为可配置项，存储到浏览器缓存
- `manifest.json` — 增加 rednote.com 域名权限

## 三、打包脚本与安全清理

**问题**：缺少自动化打包流程，且代码中包含敏感域名信息。

**改动文件**：
- `scripts/pack.sh` — 新增打包脚本，支持生成 crx 和 zip 文件，排除 script/data/md 等非必要目录
- `js/*` — 清除所有硬编码的敏感域名（cbd-front-itomms.smzdm.com、elice 等）

## 四、回传接口超时时间优化

**问题**：数据回传接口默认超时时间过短，网络波动时容易失败。

**改动文件**：
- `js/content/isolate.js` — 回传接口超时时间增加到合理值

## 涉及文件汇总

| 文件 | 改动点 |
|------|--------|
| `js/background/index.js` | 自动化任务调度 |
| `js/content/isolate.js` | 数据回传、rednote 兼容、超时优化 |
| `js/content/main.js` | 请求拦截、rednote 域名兼容 |
| `js/panel/index.js` | 采集日志、API Host 配置化 |
| `manifest.json` | 权限更新 |
| `side_panel.html` | 页面重构 |
| `scripts/pack.sh` | 打包脚本 |
| `README.md` | 项目说明更新 |

---

## 总结

发布了插件的初始可用版本，具备完整的自动化任务采集和日志展示能力；实现了 rednote.com 域名兼容和 API Host 配置化，提升了部署灵活性；新增自动化打包脚本并清除敏感信息，为安全分发做好准备；优化回传接口超时配置，提升了数据回传稳定性。
