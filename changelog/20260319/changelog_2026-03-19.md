# 修改日报 — 2026-03-19

## 一、拦截请求中提取搜索关键词并回传

**问题**：此前数据回传时使用的关键词来自任务配置，而非实际搜索请求，可能导致搜索词与回传词不一致，影响数据准确性。

**改动文件**：
- `js/content/main.js` — 新增 `extractKeywordFromBody()` 函数，从 `search/notes` 接口的 POST body 中提取 `keyword` 字段；`sendResult()` 增加 `interceptedKeyword` 参数，将拦截到的关键词通过 `postMessage` 传递给 isolate 层
- `js/content/isolate.js` — 接收 `interceptedKeyword`，回传时用拦截关键词覆盖 `body.Keywords`；同时与任务关键词做比对，不一致时在日志中标注差异

## 二、回传日志优化：显示页码与关键词标签

**问题**：回传成功/失败的日志信息缺少页码和关键词上下文，运维排查时无法快速定位问题数据。

**改动文件**：
- `js/content/isolate.js` — 回传成功消息中追加关键词标签 `「xxx」` 和页码标签 `（第N页）`；移除无意义的"第1次"提示，改为仅在重试时显示重试次数；失败消息同样追加关键词和页码信息

## 三、自动滚动加载第二页数据

**问题**：浏览器窗口较小时，搜索采集仅拦截到第一页数据，第二页无法自动触发；此前的解决方案是缩小浏览器窗口，运维成本高且不智能。

**改动文件**：
- `js/background/index.js` — 新增 `scrollToLoadMore()` 注入函数，滚动页面到底部触发懒加载；新增 `scrollAndWaitForPage2()` 流程控制函数，先检查 `searchNotesPages` 是否已有两页数据，已有则跳过，否则执行两次滚动并等待加载；在搜索/筛选完成后的任务流程中插入滚动步骤（`afterSearchScroll`），无论是否有筛选条件均会执行

## 涉及文件汇总

| 文件 | 改动点 |
|------|--------|
| `js/content/main.js` | 新增 `extractKeywordFromBody()`；`sendResult()` 增加拦截关键词参数；fetch/XHR 拦截处传递关键词 |
| `js/content/isolate.js` | 接收并回传拦截关键词；关键词比对与标注；日志增加页码和关键词标签；优化重试提示 |
| `js/background/index.js` | 新增 `scrollToLoadMore()` 页面滚动函数；新增 `scrollAndWaitForPage2()` 第二页加载流程；任务循环中集成滚动步骤 |

---

## 总结

今日核心解决了小红书搜索采集插件的三个关键问题：**数据回传关键词准确性**——从实际请求中提取关键词替代任务配置词，杜绝搜索词与回传词不一致的数据质量风险；**自动翻页采集**——通过智能滚动触发第二页加载，替代原有的缩小浏览器窗口方案，降低运维复杂度；**运维可观测性**——回传日志增加关键词和页码标签，问题排查效率显著提升。
