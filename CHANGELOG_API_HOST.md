# 接口根地址可配置 · 修改说明

本文档记录「将接口根地址（原写死常量）改为侧栏可配置项并持久化到浏览器存储」的改动。

---

## 1. 概述

- **原状**：接口根地址在 panel 与 content 脚本中写死。
- **现状**：在侧栏提供「接口根地址」输入框与「保存」按钮，写入 `chrome.storage.local`（键名 `apiHost`），未配置或为空时使用 manifest 中的默认值。
- **影响范围**：任务接口（get_keyword_task）、maa_router/pop、搜索数据回传（add_xhs_app_search_result）均使用该配置。

---

## 2. side_panel.html

- 在「获取当前页面 URL」上方新增配置区块：
  - **接口根地址**：单行输入框 `id="apiHostInput"`，placeholder 为默认地址。
  - **保存** 按钮 `id="btnSaveApiHost"`，点击后写入 storage 并更新内存中的 host。

---

## 3. js/panel/index.js

| 项 | 改动 |
|----|------|
| **存储与默认** | 常量 `API_HOST_STORAGE_KEY = 'apiHost'`，默认值来自 manifest 的 `api_host_default`；变量 `apiHost` 存当前值。 |
| **getApiHost()** | 返回当前 `apiHost`，空则返回默认值。 |
| **loadApiHost()** | 从 `chrome.storage.local` 读取 `apiHost`，写入变量并填入输入框；侧栏打开时调用。 |
| **saveApiHost()** | 读取输入框、trim，空则用默认值；写入 storage 并更新 `apiHost`；由「保存」按钮触发。 |
| **getTaskApiUrl()** | 改为 `getApiHost().replace(/\/?$/, '/') + 'api/xhs_extension/get_keyword_task' + '?trace_id=...'`。 |
| **fetchFullKeywordTask()** | 改为基于 `getApiHost()` 拼接 `api/maa_router/pop` 的 URL。 |

---

## 4. js/content/isolate.js

| 项 | 改动 |
|----|------|
| **常量** | `ADD_SEARCH_RESULT_PATH = 'api/xhs_extension/add_xhs_app_search_result'`。 |
| **sendXhsSearchResult(body)** | 发请求前 `chrome.storage.local.get(['apiHost'])` 读取配置，再拼接回传 URL；未配置或空则用 manifest 的 `api_host_default`。为保证异步读 storage，返回 `new Promise(...)`，内部 fetch 后 resolve/reject。 |

---

## 5. 行为小结

- 侧栏打开时从 storage 恢复「接口根地址」并显示在输入框。
- 用户修改后点击「保存」即写入 storage，后续任务拉取、pop、搜索回传均使用新地址。
- 地址会自动补末尾 `/`，空输入保存时按默认地址处理。

---

## 6. 排版修复（side_panel.html）

- **.keyword-add-row**：增加 `align-items: center`，使输入框与右侧按钮垂直居中对齐。
- **.keyword-add-row .btn-secondary**：`margin-bottom: 0`、`width: auto`、`flex-shrink: 0`、`min-height: 38px`、`box-sizing: border-box`，使「保存」按钮与输入框同高、不占满行、与输入框对齐。

---

## 7. 手机号与接码链接（2026-03-12）

- **侧栏**：在接口根地址下方增加「手机号」「接码链接」两个输入框（`id="smsPhoneInput"`、`id="smsCodeUrlInput"`），与接口根地址共用「保存」按钮。
- **存储**：键名 `smsPhone`、`smsCodeUrl`，与 `apiHost` 一并由 `loadApiHost()` 读取、`saveApiHost()` 写入 `chrome.storage.local`。
- **失焦保存**：手机号、接码链接输入框绑定 `blur` 事件，光标移出时自动调用 `saveApiHost()`，将当前三项配置同步到本地缓存，无需再点保存。
