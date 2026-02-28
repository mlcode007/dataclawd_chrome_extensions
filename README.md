# 最简单的浏览器插件

> **约定：每次修改扩展都要在本页「修改记录」中追加一条说明。**

## 安装方法

1. 打开 Chrome，在地址栏输入 `chrome://extensions/`
2. 打开右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本文件夹 `chrome_extensions2`
5. 安装完成后，点击浏览器工具栏的拼图图标，将本扩展固定到工具栏
6. 点击扩展图标，侧边栏会在**浏览器右侧**打开并固定显示。

## 文件说明

- `manifest.json`：扩展配置（Manifest V3），使用 side_panel + background
- `side_panel.html`：右侧侧边栏页面（标题栏 + 内容区，参考固定右栏样式）
- `js/`：脚本按业务分子文件夹
  - `js/background/index.js`：点击扩展图标时打开右侧侧边栏
  - `js/panel/index.js`：侧边栏内关闭、获取 URL、解析搜索接口响应并渲染为表格（序号/标题/作者/点赞/收藏/评论/发布时间/链接）
  - `js/content/main.js`：页面主环境 (world: MAIN) 劫持 fetch/XHR，拦截小红书搜索接口（笔记 search/notes、达人 user_posted），postMessage 发送结果
  - `js/content/isolate.js`：监听 postMessage，将笔记/达人结果分别写入 chrome.storage.local（searchNotesPages、creatorListPages）
- `popup.html`：已不再使用（改为侧边栏）
- `data/search_data.txt`：小红书搜索接口完整响应（原始）
- `data/search_first_page.json`：从 search_data.txt 抽取的第一页数据（code + data.has_more + data.items），与接口结构一致

## 修改记录

| 日期 | 说明 |
|------|------|
| 2025-02-12 | 初始版本：新增 manifest.json、popup.html，实现点击图标弹出「你好，世界！」 |
| 2025-02-12 | README 增加「修改记录」小节及「每次修改都要记录」的约定说明 |
| 2025-02-12 | 改为右侧固定侧边栏：manifest 增加 side_panel、permissions、background；新增 background.js、side_panel.html、side_panel.js；侧边栏含标题栏（左：红点+名称，右：固定图标+关闭），内容区预留无内部业务 |
| 2025-02-12 | 侧边栏增加「获取当前页面 URL」按钮：manifest 增加 tabs 权限；内容区添加按钮与 URL 展示区，点击后通过 chrome.tabs.query 获取当前标签页 URL 并显示 |
| 2025-02-12 | 拦截小红书搜索接口：manifest 增加 storage、host_permissions、content_scripts（xiaohongshu.com）；content.js 注入页面劫持 fetch/XHR，拦截 edith.xiaohongshu.com/api/sns/web/v1/search/notes 响应并写入 storage；侧边栏增加「搜索接口响应」文本框，展示并实时更新拦截到的 JSON |
| 2025-02-12 | 修复拦截不生效：新增 content-main.js 并在 manifest 中设为 world: MAIN，在页面主环境直接劫持 fetch/XHR（不依赖 script 注入时机）；content.js 仅负责接收 postMessage 并写 storage；响应非 JSON 时用 _raw 回退 |
| 2025-02-12 | JS 脚本迁移至 js 文件夹：js/background/index.js、js/content/main.js、js/content/isolate.js、js/panel/index.js；更新 manifest 与 side_panel.html 引用路径；删除根目录旧 JS 文件 |
| 2025-02-12 | 搜索结果表格化：根据 data.items 解析笔记列表，在侧边栏输出表格，列包括序号、标题、作者、点赞、收藏、评论、发布时间、链接；表格区域可滚动，保留原始 JSON 文本框 |
| 2025-02-12 | 每次刷新页面时清空插件数据：在 js/content/isolate.js 中页面加载时执行 chrome.storage.local.remove('searchNotesResult')，刷新小红书页面后侧边栏不再保留上次搜索结果 |
| 2025-02-12 | 点笔记链接不清空表格：仅当当前页为搜索页（URL 含 search_result）时清空 storage，进入 explore 笔记页时不再清空，表格数据保留 |
| 2025-02-12 | 抽取第一页数据：从 data/search_data.txt 解析并写出 data/search_first_page.json（code + data.has_more + data.items，22 条笔记），与接口结构一致便于复用 |
| 2025-02-12 | 搜索页优先加载页面内嵌数据：仅在 search_result 页、DOMContentLoaded 后尝试从 __INITIAL_STATE__ 或 script 内嵌 JSON 抽取笔记列表，找到则通过 postMessage 写入 storage，侧边栏先展示首屏再可被接口响应覆盖 |
| 2025-02-12 | 撤销选项卡：恢复为单页表格，仅使用 searchNotesResult 存储与展示，移除 searchNotesPages 及选项卡 UI |
| 2025-02-12 | 表格增加分享列：从 note_card.interact_info.shared_count 读取，表头为「分享」 |
| 2025-02-12 | 表格增加页码列；页面加载时不再清空 storage，搜索结果持久保留 |
| 2025-02-12 | 多页追加：首屏从页面内嵌数据加载第一页，滚动触发的第二页/第三页通过接口拦截追加到 searchNotesPages；表格合并展示所有页、页码列与连续序号 |
| 2025-02-12 | 搜索页刷新时清空数据：仅在 search_result 页加载时清除 searchNotesPages/searchNotesResult，刷新后重新开始（先第一页再滚动加载后续页） |
| 2025-02-12 | 增加「清空表格数据」按钮：侧边栏可手动清除 searchNotesPages/searchNotesResult 并清空表格与 JSON 区域 |
| 2025-02-12 | 第一页出现时清空再加载：收到与当前第一页同一条的搜索结果时视为第一页搜索，先清空表格再仅用该页重新加载；后续页仍追加 |
| 2025-02-12 | 表格高度自适应：移除 .search-table-wrap 的 max-height，表格随行数增高，由侧边栏内容区整体滚动 |
| 2025-02-12 | 撤回「表格下方显示搜索请求链接」：恢复 main/isolate/panel 与 side_panel 至仅展示表格与 JSON，不再保存或展示请求链接 |
| 2025-02-12 | 表格「打开」链接追加 xsec_token：笔记链接改为 explore/{id}?xsec_token=...&xsec_source=pc_search&source=unknown，与小红书 PC 搜索来源一致 |
| 2025-02-12 | 页码取请求中的 page 参数：getRequestPage 从 URL/body 解析 page，postMessage 带 pageNum；存储时写入 _pageNum，表格列「页码」按 _pageNum 显示 |
| 2025-02-26 | 达人列表页采集：main.js 增加劫持 search/users 接口并发送 XHS_CREATOR_LIST_RESULT；isolate.js 接收后写入 creatorListPages/creatorListResult；侧边栏增加「达人列表」区块与表格（页码/序号/昵称/简介/粉丝数/链接）、清空达人数据按钮 |
| 2025-02-26 | 按当前页面 URL 切换表格：search_result 仅显示笔记表格，user/profile 仅显示达人列表，其他页面显示全部；增加当前页类型提示，监听标签页切换与导航以自动刷新显示 |
| 2025-02-26 | 达人列表接口改为 user_posted：拦截 edith.xiaohongshu.com/api/sns/web/v1/user_posted（cursor 分页），首页判断为无 cursor；isolate 支持 data.notes，追加页时页码按页序递增 |
