# 接口任务自动执行 · 修改历史

本文档记录「从接口获取关键词任务并自动执行小红书笔记搜索」相关功能的全部修改。

---

## 1. 新增接口任务自动执行能力

**需求**：从接口拉取关键词任务，自动执行小红书笔记搜索；任务间间隔可配置（如 5～20 秒）；保留原有「按顺序执行搜索」逻辑。

### 1.1 manifest.json

- **host_permissions** 增加对任务接口的访问（使用 `https://*/*` 以支持用户配置的任意接口根地址）。

### 1.2 side_panel.html

- 在「按顺序执行搜索」与「清空表格数据」之间新增区块 **「接口任务自动执行」**：
  - 文案：接口任务自动执行（从接口拉取关键词并自动搜索）
  - **请求间隔（秒）**：两个数字输入框（id: `autoTaskIntervalMin`、`autoTaskIntervalMax`），默认 5～20
  - **启动自动任务** 按钮（id: `btnAutoTaskStart`）
  - **关闭自动任务** 按钮（id: `btnAutoTaskStop`）
  - 状态文案区域（id: `autoTaskStatus`）
- 样式：`.auto-task-block`、`.interval-row`、`.auto-task-buttons` 等，与现有风格一致。

### 1.3 js/panel/index.js

- **常量与状态**：
  - `TASK_API_BASE`：任务接口基础 URL
  - `autoTaskRunning`、`autoTaskAbort`、`autoTaskCountdownTimer`
- **接口与解析**：
  - `getTaskApiUrl()`：返回带 `trace_id` 的完整 URL
  - `parseKeywordTaskResponse(data)`：从多种返回结构中解析出关键词数组（兼容 `data`、`keywords`、`list` 等）
  - `fetchKeywordTask()`：`fetch` 接口并返回关键词数组，失败时 `throw`
- **执行与间隔**：
  - `getRandomIntervalMs()`：根据最小/最大间隔输入，返回随机毫秒数
  - `waitRandomWithCountdown(ms)`：等待并倒计时显示「等待下一词 · N 秒」
  - `runSingleKeywordSearch(tab, keyword, needNavigate)`：在当前标签页执行单次关键词搜索（必要时先打开搜索页）
- **流程**：
  - `runAutoTaskLoop()`：循环：拉取任务 → 解析关键词 → 依次执行搜索（间隔随机）→ 本批结束后再次拉取
  - `updateAutoTaskButtons()`：根据 `autoTaskRunning` 禁用/启用启动、关闭按钮
- **绑定**：使用事件委托在 `document` 上监听点击，识别 `#btnAutoTaskStart` / `#btnAutoTaskStop`，点击启动时先 `setAutoTaskStatus('启动中…')` 再调用 `runAutoTaskLoop()`。

---

## 2. 任务接口 URL 修正

**问题**：用户提供正确链接，`trace_id` 需为 `20260303`。

- **修改**：`getTaskApiUrl()` 改为基于配置的接口根地址拼接 `api/xhs_extension/get_keyword_task?trace_id=...`，trace_id 可固定或按需生成。

---

## 3. 启动自动任务后「按顺序执行搜索」保持可用

**问题**：点击启动自动任务后，「按顺序执行搜索」被禁用，用户希望仍可手动按顺序执行。

- **修改**：在 `updateAutoTaskButtons()` 中移除对 `btnExecuteSearch` 的 `disabled` 设置，自动任务运行期间不再禁用「按顺序执行搜索」。

---

## 4. 启动按钮点击无反应

**问题**：部分环境下点击「启动自动任务」无任何反应。

- **修改**：
  - 改为在 **DOM 就绪后** 再绑定：若 `document.readyState === 'loading'` 则监听 `DOMContentLoaded`，否则 `setTimeout(bindAutoTaskButtons, 0)`。
  - 使用 **直接绑定**：在 `bindAutoTaskButtons()` 内通过 `getElementById('btnAutoTaskStart')` / `getElementById('btnAutoTaskStop')` 取得按钮，设置 `onclick`，并在点击时用 `getElementById('autoTaskStatus')` 更新状态，避免依赖脚本顶部获取的元素引用。
  - 点击启动时先设置状态「启动中…」，再在 `try/catch` 中调用 `runAutoTaskLoop()`，出错时在状态栏显示「启动失败：xxx」。

---

## 5. 获取任务时接口请求未执行 / 不可见

**问题**：用户感觉「获取任务」时没有真正发起请求，或无法确认请求与错误。

- **修改**：
  - **fetchKeywordTask()**：
    - 请求前 `console.log('[DataCrawler] 获取任务请求:', url)`。
    - 若 `!res.ok`，用 `res.text()` 取 body 后 `throw new Error(msg)`，便于在调用方展示 HTTP 状态与片段内容。
    - 成功时 `console.log('[DataCrawler] 获取任务成功, 关键词数量:', keywords.length, keywords)`。
    - 在 `.catch` 中不再静默返回 `[]`，改为 `throw err`，由调用方统一处理。
  - **loop() 中**：
    - 拉取前设置状态为「正在获取任务… 」+ 完整 URL，便于确认请求地址。
    - 对 `fetchKeywordTask()` 增加 `.catch()`：显示「获取任务失败: xxx，15 秒后重试」，并 `setTimeout(loop, 15000)` 重试。

---

## 6. 验证请求：点击启动时直接请求并弹窗显示源码

**需求**：点击「启动自动任务」时先直接请求该 URL，将接口**原始返回内容**弹窗显示，用于验证请求是否发出及返回格式。

- **修改**：在 `btnStart.onclick` 中改为：
  - 使用固定 URL 发起 `fetch`，用 `res.text()` 取原始响应体。
  - 弹窗 `alert` 显示：`HTTP 状态码 状态文案` + 空行 + 响应正文；超过约 2000 字则截断并提示「完整内容见控制台」。
  - 同时 `console.log('[DataCrawler] 接口原始返回:', ...)` 输出完整内容。
  - 请求失败时在弹窗和状态栏显示错误信息。

（此步为临时验证；下一步会恢复为完整自动化流程。）

---

## 7. 接口调通后接通完整自动化搜索流程

**需求**：接口已调通，按 `data/xhs/search_keyword.txt` 的返回格式解析，并重新接通「拉取任务 → 解析关键词 → 自动执行搜索」的完整流程。

### 7.1 接口返回格式（search_keyword.txt）

- 单条任务示例：`{ "code":"0", "message":"请求成功", "success":true, "result": { "Keywords": "贝尔金移动电源用户评测", ... } }`
- 关键词在 `result.Keywords`；若 `result` 为数组，则逐项取 `Keywords`（或 `keyword`/`name`）。

### 7.2 parseKeywordTaskResponse()

- **优先处理** `data.result`：
  - 若 `result` 为数组：遍历，取每项 `Keywords` / `keyword` / `name`，得到关键词数组。
  - 若 `result` 为对象且含 `Keywords` / `keyword` / `name`：取单个关键词，返回单元素数组。
- **兼容**：若无 `result`，再按原逻辑解析 `data.data`、`data.keywords`、`data.list` 等。

### 7.3 恢复「启动自动任务」为完整流程

- **修改**：`btnStart.onclick` 恢复为：
  - 设置状态「启动中…」
  - 在 `try/catch` 中调用 `runAutoTaskLoop()`，出错时在状态栏显示「启动失败：xxx」并重置 `autoTaskRunning`、`updateAutoTaskButtons()`。
- 点击「启动自动任务」后：拉取任务 → 解析 `result.Keywords` → 在当前标签页依次执行每个关键词的搜索 → 按配置的随机间隔等待 → 本批结束后再次拉取，循环直到点击「关闭自动任务」。

---

## 8. 请求间隔持久化

**需求**：请求间隔（最小/最大秒数）设置后持久化到浏览器，下次打开侧栏时自动恢复。

### 8.1 js/panel/index.js

- **存储键**：`chrome.storage.local` 使用 `autoTaskIntervalMin`、`autoTaskIntervalMax`（数值）。
- **保存**：
  - `saveAutoTaskInterval()`：读取两个输入框的数值，若合法则分别 `chrome.storage.local.set({ autoTaskIntervalMin })` / `set({ autoTaskIntervalMax })`。
  - 对 `autoTaskIntervalMin`、`autoTaskIntervalMax` 绑定 `change` 事件，失焦或确认修改时调用 `saveAutoTaskInterval()`。
- **加载**：
  - `loadAutoTaskInterval()`：`chrome.storage.local.get(['autoTaskIntervalMin', 'autoTaskIntervalMax'], ...)`，若有值则写回对应输入框的 `value`。
  - 在脚本中在绑定事件前调用一次 `loadAutoTaskInterval()`，侧栏打开时即恢复上次保存的间隔。

---

## 9. 搜索时发布时间筛选（如半年内）

**需求**：搜索完成后自动选择「发布时间」筛选项（如半年内），以便结果限定在指定时间范围内。

### 9.1 实现方式

- 小红书搜索页的「发布时间」为页面内筛选项（不限 / 一天内 / 一周内 / 半年内 / 一年内），无公开 URL 参数。
- 采用**页面内模拟点击**：搜索触发并等待结果区出现后，注入脚本依次点击「发布时间」展开按钮、再点击所选选项（如「半年内」）。

### 9.2 side_panel.html

- 在「插件搜索关键词」列表下方、添加关键词行上方增加 **「发布时间筛选」** 下拉（id: `publishTimeFilter`）：
  - 选项：不筛选、一天内、一周内、**半年内**（默认）、一年内。
- 样式：`.interval-row select`（min-width、padding、border 等与现有表单项一致）。

### 9.3 js/panel/index.js

- **注入页面的函数**（与 `searchByInputInPage` 同处，供 `executeScript` 调用）：
  - `clickPublishTimeFilterOpener()`：用 XPath 查找包含「发布时间」的可见可点元素并点击，打开筛选项。
  - `clickPublishTimeOption(optionText)`：查找文案为 `optionText`（如「半年内」）的可点元素并点击；XPath 中单引号已转义。
- **应用筛选**：
  - `applyPublishTimeFilterAfterSearch(tabId, optionText)`：若 `optionText` 为空则直接 resolve；否则延迟 2s 后执行「打开发布时间筛」→ 再延迟 600ms 执行「点击选项」，返回 Promise。
- **与流程串联**：
  - **按顺序执行搜索**：每次 `searchByInputInPage` 成功后，若下拉非「不筛选」，先 `applyPublishTimeFilterAfterSearch(tab.id, value)`，再进入 `waitWithCountdown` 与下一词。
  - **自动任务**：每次 `runSingleKeywordSearch` 成功后，若下拉非「不筛选」，先 `applyPublishTimeFilterAfterSearch(tab.id, value)`，再进入 `waitRandomWithCountdown` 与下一词。
- **持久化**：`publishTimeFilterEl` 的 `value` 写入 `chrome.storage.local` 键 `publishTimeFilter`；侧栏加载时读取并回填下拉。

### 9.4 涉及文件

- `side_panel.html`：发布时间筛选下拉及 `.interval-row select` 样式。
- `js/panel/index.js`：`clickPublishTimeFilterOpener`、`clickPublishTimeOption`、`applyPublishTimeFilterAfterSearch`，`publishTimeFilterEl` 的读写与持久化，以及两处流程中「搜索后应用筛选」的调用。

---

## 10. 发布时间筛选：统一策略与自动判断加载完成

**需求**：每次搜索都走同一套发布时间筛选逻辑；不依赖固定等待时间，改为自动判断「筛选区域已出现」再点击。

### 10.1 移除固定延迟常量

- 删除 `PUBLISH_TIME_FILTER_DELAY_MS`，不再使用固定 4 秒等待。
- `applyPublishTimeFilterAfterSearch(tabId, optionText)` 仅保留两个参数，调用处不再传延迟。

### 10.2 先改为「搜索完成即点筛选」

- 逻辑改为：搜索完成 → 直接执行「点发布时间」→ 1.2 秒后点选项。实际使用中不等待会导致筛选不生效（结果区未渲染完）。

### 10.3 改为自动判断加载完成

- **注入函数 `isPublishTimeFilterVisible()`**：在页面内用 XPath 查找包含「发布时间」的节点，若存在可见且宽高 ≥ 8px 的元素则返回 `true`，否则 `false`，用于判断筛选区域是否已出现。
- **`applyPublishTimeFilterAfterSearch` 轮询逻辑**：
  - 每 **500ms** 在对应 tab 执行一次 `isPublishTimeFilterVisible()`。
  - **一旦为 `true`**：立即执行「点发布时间」→ 等待 **1.2 秒** → 「点选项（如半年内）」→ resolve。
  - **若超过 15 秒仍为 `false`**：停止轮询并 resolve，避免流程卡死。
- 效果：结果加载快则尽早点击筛选，加载慢则多轮询几次，不再依赖固定秒数。

### 10.4 涉及文件

- `js/panel/index.js`：新增 `isPublishTimeFilterVisible`；`applyPublishTimeFilterAfterSearch` 改为轮询检测再点击，移除固定 delay 参数。

---

## 11. 启动自动任务适配按顺序执行搜索逻辑

**需求**：启动自动任务与「按顺序执行搜索」使用同一套执行逻辑，保证行为一致、易维护。

### 11.1 原差异

- **按顺序执行搜索**：拿到 tab 后，用 `doNext(index)` + `injectAndNext()`：首词且不在搜索页则先 `chrome.tabs.update(SEARCH_BASE_URL)`、`waitForTabComplete`、800ms 后再 `chrome.scripting.executeScript(searchByInputInPage, [keyword])`；否则直接注入。回调里根据是否选发布时间筛选执行 `applyPublishTimeFilterAfterSearch`，再 `waitWithCountdown(EXECUTE_WAIT_MS)` 后 `doNext(index+1)`。
- **启动自动任务**：原先用 `runSingleKeywordSearch(tab, keyword, needNavigate)`（Promise 包装的“先跳转再注入”），再在 then 里做筛选与 `waitRandomWithCountdown`，两套实现。

### 11.2 统一后的自动任务逻辑

- 自动任务在「拿到接口关键词 + 当前 tab」后，改为与按顺序执行搜索相同的结构：
  - **doNext(index)**：若 `index === 0 && !isSearchPage` 则 `chrome.tabs.update(SEARCH_BASE_URL)` → `waitForTabComplete` → 800ms → 调用 **injectAndNext**；否则直接 **injectAndNext**。
  - **injectAndNext**：`chrome.scripting.executeScript(searchByInputInPage, [keywords[index]])`，回调中：首词且注入失败则报错并 done；否则若选了发布时间筛选则 `applyPublishTimeFilterAfterSearch(tab.id, filterVal)`，再 `waitRandomWithCountdown(getRandomIntervalMs())`，然后 `index++`、`doNext()`；未选筛选则直接等待后 `doNext()`。
- 仅保留两点差异：关键词来源为接口返回的 `keywords`；间隔为 `getRandomIntervalMs()`（如 15～20 秒），而非按顺序的 `EXECUTE_WAIT_MS`（5 秒）。

### 11.3 涉及文件

- `js/panel/index.js`：`runAutoTaskLoop` 内用与按顺序执行搜索一致的 `injectAndNext` + `doNext` 实现，不再调用 `runSingleKeywordSearch`（该函数仍保留未使用）。

---

## 涉及文件一览

| 文件 | 修改内容概要 |
|------|----------------|
| `manifest.json` | 增加 `host_permissions` 以支持任务接口（如 `https://*/*` 供用户配置的接口根地址） |
| `side_panel.html` | 新增「接口任务自动执行」区块（间隔输入、启动/关闭按钮、状态区）；新增「发布时间筛选」下拉及样式 |
| `js/panel/index.js` | 任务接口 URL、解析、拉取、单次搜索、循环流程、按钮绑定、错误与状态展示、请求间隔持久化；发布时间筛：isPublishTimeFilterVisible、点击函数、轮询判断加载完成后应用筛选、筛选选项持久化 |

---

## 使用说明摘要

1. **手动关键词**：在「插件搜索关键词」中添加关键词，点击「按顺序执行搜索」按列表顺序执行（与是否启动自动任务无关）。
2. **自动任务**：设置「请求间隔（秒）」后点击「启动自动任务」；插件会请求 `get_keyword_task?trace_id=20260303`，解析 `result.Keywords`，执行逻辑与「按顺序执行搜索」一致（首词先跳转再注入、直接注入搜索、发布时间筛选、间隔后下一词），仅关键词来自接口、间隔为随机（如 15～20 秒）；点击「关闭自动任务」停止。详见第 11 节。
3. **请求间隔**：修改最小/最大秒数后失焦即保存，下次打开侧栏会自动恢复。
4. **发布时间筛选**：在「发布时间筛选」下拉选择「半年内」等选项后，每次搜索（含按顺序执行与自动任务）完成后会自动在页面内点击该筛选项；选项会持久化。筛选时机为「自动判断加载完成」：每 500ms 检测筛选区域是否出现，出现后立即点击，最多等 15 秒。详见第 10 节。
5. **后台执行**（2026-03-12）：侧栏增加「后台执行（关闭侧边栏后继续运行）」复选框，持久化到 `chrome.storage.local`（键 `autoTaskRunInBackground`）。勾选后点击「启动自动任务」时，由 background 接管循环（拉任务、执行搜索、间隔等待），关闭侧边栏后任务继续；再次打开侧栏可查看状态与回传日志，点击「关闭自动任务」停止。不勾选时保持原逻辑，仅在侧边栏打开时于 panel 内执行，关闭侧栏即停止。

以上为本次「接口任务自动执行」及相关功能（含发布时间筛选、自动判断加载、后台执行）的完整修改历史。
