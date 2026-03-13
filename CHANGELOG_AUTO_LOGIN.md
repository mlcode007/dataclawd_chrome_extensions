# 自动退出 & 自动登录 · 修改历史

本文档记录「账号管理：自动退出登录、自动手机号登录」相关功能的全部修改。

---

## 1. 新增自动退出 & 自动登录功能

### 1.1 manifest.json

- **permissions** 新增 `cookies`，允许插件读写/删除浏览器 Cookie（自动退出清空 Cookie 所需）。

### 1.2 side_panel.html

- **API 配置区**新增字段：
  - **手机号**输入框（id: `smsPhoneInput`）：用于接码的手机号
  - **接码链接**输入框（id: `smsCodeUrlInput`）：接码平台或接口链接
  - **测试**按钮（id: `btnFetchSmsCode`）：点击即时请求接码链接并展示原始响应，辅助调试
  - **验证码结果区**（id: `smsCodeResult`）：展示响应内容 + 抽取结果，支持 `white-space: pre-wrap`
- **账号管理**区块（新增，位于 API 配置下方）：
  - **自动退出**按钮（id: `btnAutoLogout`，次要样式）
  - **自动登录**按钮（id: `btnAutoLogin`，主要红色样式）
  - **状态提示**（id: `accountStatus`）：颜色随状态变化（蓝=进行中、绿=成功、红=失败）

### 1.3 js/panel/index.js

#### 公共工具

- `setAccountStatus(text, type)`：更新账号管理区状态文字，`type` 为 `ing` / `ok` / `err`
- `clearXhsCookies(callback)`：清除 `.xiaohongshu.com` 与 `.rednote.com` 所有 Cookie，完成后回调返回清除数量

#### 测试按钮（接码链接）

- 点击"测试"按钮 → 自动保存配置 → 请求 `smsCodeUrl` → 展示原始响应（最多 300 字）
- 用正则 `/\bcode\b[^0-9]*(\d+)/i` 抽取验证码，展示为 `{原始响应}\n验证码：XXXXXX` 或 `未抽取到验证码`
- 请求中按钮禁用并改为"获取中…"，完成后恢复

#### 验证码抽取正则

支持以下格式（统一使用 `/\bcode\b[^0-9]*(\d+)/i`）：
- `code: 123456`
- `code=123456`
- `code 123456`
- `"code":"123456"`
- `Your verification code is: 188722.`

#### 自动退出流程

1. 判断当前标签页是否为小红书/红书，是则直接操作，否则先跳转到 `https://www.xiaohongshu.com`
2. 注入 `_xhsClickMore()`：XPath 精确匹配"更多"文字，点击左侧底部"≡ 更多"按钮展开菜单
3. 等待 800ms 后注入 `_xhsClickLogout()`：XPath 精确匹配"退出登录"，点击
4. 点击成功后等待 2 秒，调用 `clearXhsCookies()` 清除全部 Cookie
5. 状态显示：`退出成功，已清除 XX 个 Cookie`

#### 自动登录流程

触发时若自动任务正在运行，先强制关闭自动任务再继续。

1. 校验手机号、接码链接已配置
2. 判断当前标签页域名，跳转到对应首页（小红书 / 红书）
3. 等待页面加载完成后注入 `_xhsFillPhone(phone)`：查找手机号输入框并填入
4. 注入 `_xhsClickSendSms()`：XPath 匹配"获取验证码"/"发送验证码"，触发完整鼠标事件（mousedown + mouseup + click + 坐标）
5. 点击成功后同时触发面板"测试"按钮，展示接码链接第一次响应结果
6. 每 3 秒轮询一次 `smsCodeUrl`，最多 40 次（共 120 秒），每次刷新验证码结果区
7. 抽取到验证码后注入 `_xhsFillSmsCode(code)` 填入验证码输入框
8. 注入 `_xhsClickLogin()` 点击"登录"按钮完成登录

#### 页面注入函数说明

| 函数 | 作用 |
|---|---|
| `_xhsFillPhone(phone)` | 查找手机号输入框并填入，触发 input/change 事件 |
| `_xhsClickSendSms()` | XPath 匹配"获取验证码"/"发送验证码"，带坐标鼠标事件点击 |
| `_xhsFillSmsCode(code)` | 查找验证码输入框（按 placeholder / maxLength 判断）并填入 |
| `_xhsClickLogin()` | 查找"登录"/"立即登录"等文字按钮并点击 |
| `_xhsClickMore()` | XPath 匹配"更多"，点击左侧底部更多按钮 |
| `_xhsClickLogout()` | XPath 匹配"退出登录"，点击菜单中的退出选项 |

---

## 2. 细节优化

### 2.1 导航逻辑优化

自动登录/退出时，若当前页已是 `xiaohongshu.com` 或 `rednote.com`，直接刷新到对应域名首页，不强制跳到固定 URL。

### 2.2 _xhsClickSendSms 兼容性增强

XHS 登录弹窗为 `position:fixed` 模态框，原用 `offsetParent == null` 判断可见性导致按钮被误判为隐藏。

改为：
- 使用 XPath `normalize-space(.)='获取验证码'` 精确匹配文字
- 用 `getBoundingClientRect()` 判断实际尺寸
- 事件携带 `clientX/clientY` 坐标，与项目其他点击函数保持一致

### 2.3 验证码轮询次数

轮询次数从 20 次增加到 **40 次**（3 秒/次，总等待时长 **120 秒**）。

---

## 3. 多账号与自动任务联动

### 3.1 多账号列表 + 单选选择

- **存储**：新增 `chrome.storage.local` 键 `accountList`（数组，每项 `{ phone, codeUrl }`）、`selectedAccountIndex`（当前选中索引）。
- **兼容**：若本地无 `accountList` 但有 `smsPhone`/`smsCodeUrl`，自动迁移为单条账号并选中。
- **侧栏 UI**：
  - 原单组「手机号 / 接码链接」改为**登录账号**区块：列表容器 `#accountListContainer`、每行展示单选 + 手机号 + 接码链接（完整显示，可换行）+ 该行「测试」「删除」。
  - 下方「添加账号」：手机号、接码链接输入框 +「添加账号」按钮。
- **自动登录**：`doAutoLogin()` 使用 `getSelectedAccount()` 取当前选中账号的 `phone` / `codeUrl`；未选中或未填时提示「请先添加账号并选中一个账号（单选）」等。

### 3.2 接码链接与显示

- 每行账号同时展示**手机号**与**接码链接**（前缀「接码：」），无截断，长链接可换行（`word-break: break-all`）。
- 验证码结果区 `#smsCodeResult` 仍共用，每行「测试」请求该行接码链接并展示结果。

### 3.3 自动登录成功后启动自动任务

- 新增 `startAutoTaskAfterLogin()`：若当前自动任务未在运行，则模拟点击「启动自动任务」。
- 在自动登录成功时调用：
  - **点击登录按钮成功**：2.5 秒后显示「登录操作完成」，再调用 `startAutoTaskAfterLogin()`。
  - **未找到登录按钮（可能已自动登录）**：显示「未找到登录按钮，可能已自动登录」，0.5 秒后调用 `startAutoTaskAfterLogin()`。
- 若自动任务已在运行则不再重复启动。
