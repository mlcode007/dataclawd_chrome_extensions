# 红书（rednote）域名兼容 · 修改说明

本文档记录「支持 https://www.rednote.com/ 与小红书双站点、搜索接口双域名拦截」的改动。

---

## 1. 概述

- **页面域名**：扩展同时支持 **www.xiaohongshu.com** 与 **www.rednote.com**（红书站点，与小红书 explore 页等价）。
- **搜索接口**：笔记搜索接口**兼容**两套域名，同时拦截、不替换：
  - `edith.xiaohongshu.com/api/sns/web/v1/search/notes`
  - `webapi.rednote.com/api/sns/web/v1/search/notes`

---

## 2. manifest.json

| 项 | 改动 |
|----|------|
| **host_permissions** | 增加 `https://www.rednote.com/*`、`https://webapi.rednote.com/*` |
| **content_scripts[].matches** | 两处 `matches` 均增加 `https://www.rednote.com/*`，使 main.js、isolate.js 在红书页同样注入并生效 |

---

## 3. js/content/main.js

| 项 | 改动 |
|----|------|
| **搜索笔记接口** | 新增常量 `TARGET_NOTES_REDNOTE = 'webapi.rednote.com/api/sns/web/v1/search/notes'`，注释标明「兼容小红书与红书两套域名，同时拦截」 |
| **isTargetUrl(url)** | 由仅匹配 `TARGET_NOTES` 改为 `url.indexOf(TARGET_NOTES) !== -1 \|\| url.indexOf(TARGET_NOTES_REDNOTE) !== -1`，任一命中即拦截 |

达人列表接口（user_posted）仍仅拦截 `edith.xiaohongshu.com`，未改。

---

## 4. js/panel/index.js

| 项 | 改动 |
|----|------|
| **常量** | `REDNOTE_SEARCH_BASE_URL = 'https://www.rednote.com/search_result'` |
| **isXhsLikeHost(url)** | 判断是否为小红书/红书域名：`xiaohongshu.com` 或 `rednote.com` |
| **getSearchBaseUrl(tabUrl)** | 根据当前标签页域名返回对应搜索页：在 rednote 则返回 `REDNOTE_SEARCH_BASE_URL`，否则 `SEARCH_BASE_URL` |
| **是否搜索页** | 原 `tabUrl.indexOf('xiaohongshu.com') !== -1` 改为 `isXhsLikeHost(tabUrl)`（两处：按顺序执行搜索、自动任务） |
| **跳转搜索页** | 三处 `chrome.tabs.update(..., { url: SEARCH_BASE_URL })` 改为 `getSearchBaseUrl(tabUrl)` / `getSearchBaseUrl(tab.url)`，在红书页会打开 rednote 的搜索页 |

---

## 5. 行为小结

- 在 **www.rednote.com** 或 **www.xiaohongshu.com** 下，扩展均会注入并拦截。
- 无论请求 **edith.xiaohongshu.com** 还是 **webapi.rednote.com** 的笔记搜索接口，都会被拦截并写入 storage，侧边栏表格正常展示。
- 从非搜索页跳转至搜索页时，按当前站点选择对应搜索 URL（红书用 rednote，小红书用 xiaohongshu）。
- 笔记/达人链接在表格中仍使用 `https://www.xiaohongshu.com/explore/...` 等 canonical 地址。
