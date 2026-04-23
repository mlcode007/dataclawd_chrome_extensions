// 关闭按钮：尝试关闭侧边栏（部分 Chrome 版本支持）
const btnClose = document.getElementById('btnClose');
if (btnClose) btnClose.addEventListener('click', () => window.close());

// 固定按钮：侧边栏已由浏览器固定在右侧，此处仅作预留
const btnPin = document.getElementById('btnPin');
if (btnPin) btnPin.addEventListener('click', () => {});

// 根据当前标签页 URL 决定显示「搜索笔记」或「达人列表」表格
function getActiveTabUrl() {
  return chrome.tabs.query({ active: true, currentWindow: true }).then(function(tabs) {
    return (tabs[0] && tabs[0].url) ? tabs[0].url : '';
  });
}

var creatorJumpLink = document.getElementById('creatorJumpLink');

function updateViewByUrl(url) {
  var searchSection = document.getElementById('searchResultSection');
  var creatorSection = document.getElementById('creatorSection');
  var hintEl = document.getElementById('pageTypeHint');
  if (!searchSection || !creatorSection) return;

  var isSearch = url.indexOf('search_result') !== -1;
  var isProfile = url.indexOf('user/profile') !== -1;

  if (isSearch) {
    searchSection.style.display = 'block';
    creatorSection.style.display = 'none';
    if (hintEl) { hintEl.textContent = '当前：搜索页 — 显示笔记表格'; hintEl.style.display = 'block'; }
    if (creatorJumpLink) { creatorJumpLink.style.display = 'none'; creatorJumpLink.removeAttribute('href'); }
  } else if (isProfile) {
    searchSection.style.display = 'none';
    creatorSection.style.display = 'block';
    if (hintEl) { hintEl.textContent = '当前：达人主页 — 显示达人列表'; hintEl.style.display = 'block'; }
    if (creatorJumpLink && url) { creatorJumpLink.href = url; creatorJumpLink.style.display = 'block'; }
  } else {
    searchSection.style.display = 'block';
    creatorSection.style.display = 'block';
    if (hintEl) { hintEl.textContent = '当前：其他页面 — 显示全部'; hintEl.style.display = 'block'; }
    if (creatorJumpLink) { creatorJumpLink.style.display = 'none'; creatorJumpLink.removeAttribute('href'); }
  }
}

// 获取当前页面 URL（并同步切换显示的表格类型）
document.getElementById('btnGetUrl').addEventListener('click', async () => {
  const el = document.getElementById('urlDisplay');
  try {
    const url = await getActiveTabUrl();
    if (url) {
      el.textContent = url;
      el.style.display = 'block';
      updateViewByUrl(url);
    } else {
      el.textContent = '无法获取当前页面 URL';
      el.style.display = 'block';
    }
  } catch (e) {
    el.textContent = '获取失败：' + (e.message || e);
    el.style.display = 'block';
  }
});

// 多关键词配置：增删、持久化、按顺序执行搜索
var pluginSearchKeywords = [];
var KEYWORD_STORAGE_KEY = 'pluginSearchKeywords';
var SEARCH_SITE_BASE_STORAGE_KEY = 'searchSiteBaseUrl';
var SEARCH_SITE_BASE_DEFAULT = 'https://www.xiaohongshu.com/search_result?source=web_search_result_notes';
/** 当前使用的搜索页基础地址（与 chrome.storage 同步） */
var searchSiteBaseUrl = SEARCH_SITE_BASE_DEFAULT;
var AUTO_LOGIN_PAGE_STORAGE_KEY = 'autoLoginPageUrl';
var AUTO_LOGIN_PAGE_DEFAULT = 'https://www.rednote.com';
/** 自动登录时先打开的页面（与 chrome.storage 同步） */
var autoLoginPageUrl = AUTO_LOGIN_PAGE_DEFAULT;
var EXECUTE_WAIT_MS = 5000;

/** 是否为小红书/红书域名（xiaohongshu.com 或 rednote.com） */
function isXhsLikeHost(url) {
  var u = (url || '').toLowerCase();
  return u.indexOf('xiaohongshu.com') !== -1 || u.indexOf('rednote.com') !== -1;
}

/** 自动任务上次成功操作的小红书标签页（侧栏获焦时 active+currentWindow 常不是 xhs） */
var AUTO_TASK_XHS_WORK_TAB_ID_KEY = 'autoTaskXhsWorkTabId';

function getXhsWorkTab() {
  return new Promise(function(resolve) {
    function finishBest(tab) {
      if (tab && tab.id && isXhsLikeHost(tab.url)) {
        var patch = {};
        patch[AUTO_TASK_XHS_WORK_TAB_ID_KEY] = tab.id;
        chrome.storage.local.set(patch);
      }
      resolve(tab || null);
    }
    chrome.storage.local.get([AUTO_TASK_XHS_WORK_TAB_ID_KEY], function(o) {
      var saved = parseInt(o[AUTO_TASK_XHS_WORK_TAB_ID_KEY], 10);
      if (!isNaN(saved) && saved > 0) {
        chrome.tabs.get(saved, function(t) {
          if (!chrome.runtime.lastError && t && t.id && isXhsLikeHost(t.url) && !t.discarded) {
            finishBest(t);
            return;
          }
          queryActiveThenBroad();
        });
        return;
      }
      queryActiveThenBroad();
    });
    function queryActiveThenBroad() {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, function(tabs) {
        var activeT = tabs && tabs[0];
        if (activeT && activeT.id && isXhsLikeHost(activeT.url) && !activeT.discarded) {
          finishBest(activeT);
          return;
        }
        chrome.tabs.query({
          url: [
            '*://*.xiaohongshu.com/*',
            '*://xiaohongshu.com/*',
            '*://*.rednote.com/*',
            '*://rednote.com/*'
          ]
        }, function(xhsTabs) {
          if (xhsTabs && xhsTabs.length) {
            var preferWin = activeT && activeT.windowId;
            var pick = null;
            var i;
            if (preferWin != null) {
              for (i = 0; i < xhsTabs.length; i++) {
                if (xhsTabs[i].windowId === preferWin && xhsTabs[i].active) {
                  pick = xhsTabs[i];
                  break;
                }
              }
            }
            if (!pick) {
              for (i = 0; i < xhsTabs.length; i++) {
                if (xhsTabs[i].active) {
                  pick = xhsTabs[i];
                  break;
                }
              }
            }
            if (!pick) {
              xhsTabs.sort(function(a, b) {
                return (b.lastAccessed || 0) - (a.lastAccessed || 0);
              });
              pick = xhsTabs[0];
            }
            finishBest(pick);
            return;
          }
          finishBest(activeT || null);
        });
      });
    }
  });
}

function normalizeSearchSiteBaseUrl(raw) {
  var d = SEARCH_SITE_BASE_DEFAULT;
  var s = (raw || '').trim();
  if (!s) return d;
  s = s.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) return d;
  if (s.indexOf('search_result') !== -1) return s;
  return s + '/search_result?source=web_search_result_notes';
}

/** 侧栏配置的搜索页基础地址 */
function getSearchBaseUrl() {
  return searchSiteBaseUrl || SEARCH_SITE_BASE_DEFAULT;
}

/** 从配置的搜索页地址解析站点首页（用于非登录场景的站点根等） */
function getSearchSiteOrigin() {
  try {
    return new URL(getSearchBaseUrl()).origin;
  } catch (e) {
    return 'https://www.xiaohongshu.com';
  }
}

function normalizeAutoLoginPageUrl(raw) {
  var d = AUTO_LOGIN_PAGE_DEFAULT;
  var s = (raw || '').trim();
  if (!s) return d;
  s = s.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) return d;
  try {
    var u = new URL(s);
    if (!/^https?:$/i.test(u.protocol)) return d;
    return u.href.replace(/\/$/, '') || d;
  } catch (e) {
    return d;
  }
}

/** 侧栏配置的自动登录落地页 */
function getAutoLoginPageUrl() {
  return normalizeAutoLoginPageUrl(autoLoginPageUrl);
}

/** 搜索业务落地页：URL 不含 keyword，关键词由 humanSearch 提交（侧栏「搜索页地址」） */
function buildSearchLandingUrl() {
  var base = getSearchBaseUrl();
  try {
    var u = new URL(base);
    u.searchParams.delete('keyword');
    return u.href;
  } catch (e) {
    return base;
  }
}

/** 域外进入时的固定 PC 搜索落地页（拦包/回传依赖 search_result 路径） */
var XHS_PC_SEARCH_LANDING = 'https://www.xiaohongshu.com/search_result?source=web_search_result_notes';

/**
 * needTabLoad：是否先整页打开搜索落地页再 humanSearch。
 * 已在 xiaohongshu.com 且 URL 含 search_result：不整页打开，避免重复打开搜索页；站外或非搜索页必须先进入搜索页。
 * 回传依赖 isolate 对 currentKeywordTask 的重试 + 本页 fetch 拦包（不整页时由 humanSearch 触发新请求）。
 */
function getSearchNavigatePlan(tabUrl) {
  var u = (tabUrl || '').toLowerCase();
  if (u.indexOf('xiaohongshu.com') === -1) {
    return { needTabLoad: true, url: XHS_PC_SEARCH_LANDING };
  }
  if (u.indexOf('search_result') === -1) {
    return { needTabLoad: true, url: buildSearchLandingUrl() };
  }
  return { needTabLoad: false, url: '' };
}

function whenReadyForHumanSearch(tab, needTabLoad, delayMs, fn) {
  function safeFn() {
    try {
      fn();
    } catch (e) {
      pushAutoTaskLogLine('自动任务步骤异常：' + (e && e.message ? e.message : String(e)));
    }
  }
  if (needTabLoad) {
    waitForTabComplete(tab.id).then(function() {
      setTimeout(safeFn, delayMs);
    });
  } else {
    setTimeout(safeFn, delayMs);
  }
}

/** 从关键词列与任务对象中解析出非空搜索词 */
function resolveSearchKeyword(primary, taskInfos, index) {
  var k = primary;
  if (k != null && typeof k === 'object' && !Array.isArray(k)) {
    k = k.Keywords != null ? k.Keywords : (k.keyword != null ? k.keyword : k.name);
  }
  if (k != null && String(k).trim() !== '') return String(k).trim();
  if (taskInfos && taskInfos.length) {
    var info = taskInfos[index] != null ? taskInfos[index] : taskInfos[0];
    if (info && typeof info === 'object') {
      var k2 = info.Keywords != null ? info.Keywords : (info.keyword != null ? info.keyword : info.name);
      if (k2 != null && String(k2).trim() !== '') return String(k2).trim();
    }
  }
  return '';
} // 两次请求间隔（毫秒），并在插件中倒计时显示
var executeCountdownTimer = null; // 倒计时定时器，便于清理

// 接口根地址、手机号、接码链接：可配置并持久化到 chrome.storage.local
var API_HOST_STORAGE_KEY = 'apiHost';
var SMS_PHONE_STORAGE_KEY = 'smsPhone';
var SMS_CODE_URL_STORAGE_KEY = 'smsCodeUrl';
var ACCOUNT_LIST_STORAGE_KEY = 'accountList';
var SELECTED_ACCOUNT_INDEX_KEY = 'selectedAccountIndex';
var ACCOUNT_COLLECT_STATS_KEY = 'accountCollectStats';
var apiHost = '';
var smsPhone = '';
var smsCodeUrl = '';
/** 登录账号列表，每项 { phone, codeUrl, maxCollectCount }；自动登录时使用选中的账号 */
var accountList = [];
/** 当前选中用于自动登录的账号索引 */
var selectedAccountIndex = 0;
/** 采集次数统计 { "索引": { "YYYY-MM-DD": count } } */
var accountCollectStats = {};

function getApiHostDefault() {
  var m = chrome.runtime.getManifest();
  return (m && m.api_host_default ? m.api_host_default : '').trim();
}

function getApiHost() {
  var h = (apiHost || '').trim();
  return h || getApiHostDefault();
}

function loadApiHost() {
  chrome.storage.local.get([API_HOST_STORAGE_KEY, SMS_PHONE_STORAGE_KEY, SMS_CODE_URL_STORAGE_KEY, ACCOUNT_LIST_STORAGE_KEY, SELECTED_ACCOUNT_INDEX_KEY, ACCOUNT_COLLECT_STATS_KEY, SEARCH_SITE_BASE_STORAGE_KEY, AUTO_LOGIN_PAGE_STORAGE_KEY], function(o) {
    var v = (o[API_HOST_STORAGE_KEY] || '').trim();
    apiHost = v || getApiHostDefault();
    var input = document.getElementById('apiHostInput');
    if (input) input.value = apiHost;
    searchSiteBaseUrl = normalizeSearchSiteBaseUrl(o[SEARCH_SITE_BASE_STORAGE_KEY]);
    var searchInput = document.getElementById('searchSiteBaseInput');
    if (searchInput) searchInput.value = searchSiteBaseUrl;
    autoLoginPageUrl = normalizeAutoLoginPageUrl(o[AUTO_LOGIN_PAGE_STORAGE_KEY]);
    var autoLoginInput = document.getElementById('autoLoginPageInput');
    if (autoLoginInput) autoLoginInput.value = autoLoginPageUrl;
    smsPhone = (o[SMS_PHONE_STORAGE_KEY] || '').trim();
    smsCodeUrl = (o[SMS_CODE_URL_STORAGE_KEY] || '').trim();
    var list = o[ACCOUNT_LIST_STORAGE_KEY];
    if (Array.isArray(list) && list.length > 0) {
      accountList = list.map(function(item) {
        return {
          phone: (item.phone || '').trim(),
          codeUrl: (item.codeUrl || '').trim(),
          maxCollectCount: item.maxCollectCount != null ? parseInt(item.maxCollectCount, 10) : 200
        };
      });
      selectedAccountIndex = Math.min(Math.max(0, parseInt(o[SELECTED_ACCOUNT_INDEX_KEY], 10) || 0), accountList.length - 1);
    } else {
      accountList = [{ phone: smsPhone, codeUrl: smsCodeUrl, maxCollectCount: 200 }];
      selectedAccountIndex = 0;
      chrome.storage.local.set({ accountList: accountList, selectedAccountIndex: 0 });
    }
    accountCollectStats = o[ACCOUNT_COLLECT_STATS_KEY] || {};
    if (typeof renderAccountList === 'function') renderAccountList();
  });
}

function saveApiHost() {
  var input = document.getElementById('apiHostInput');
  if (!input) return;
  var v = (input.value || '').trim() || getApiHostDefault();
  apiHost = v;
  chrome.storage.local.set({ apiHost: v });
}

function saveSearchSiteBase() {
  var input = document.getElementById('searchSiteBaseInput');
  if (!input) return;
  var v = normalizeSearchSiteBaseUrl(input.value);
  searchSiteBaseUrl = v;
  input.value = v;
  chrome.storage.local.set({ searchSiteBaseUrl: v });
}

function saveAutoLoginPage() {
  var input = document.getElementById('autoLoginPageInput');
  if (!input) return;
  var v = normalizeAutoLoginPageUrl(input.value);
  autoLoginPageUrl = v;
  input.value = v;
  chrome.storage.local.set({ autoLoginPageUrl: v });
}

function saveAccounts() {
  chrome.storage.local.set({ accountList: accountList, selectedAccountIndex: selectedAccountIndex });
}

function saveCollectStats() {
  chrome.storage.local.set({ accountCollectStats: accountCollectStats });
}

function getTodayDateStr() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function getAccountTodayCollectCount(accIndex) {
  var key = String(accIndex);
  var today = getTodayDateStr();
  if (!accountCollectStats[key]) return 0;
  return accountCollectStats[key][today] || 0;
}

function incrementAccountCollectCount(accIndex) {
  var key = String(accIndex);
  var today = getTodayDateStr();
  if (!accountCollectStats[key]) accountCollectStats[key] = {};
  accountCollectStats[key][today] = (accountCollectStats[key][today] || 0) + 1;
  saveCollectStats();
  return accountCollectStats[key][today];
}

function isAccountExceededToday(accIndex) {
  if (accIndex < 0 || accIndex >= accountList.length) return true;
  var acc = accountList[accIndex];
  var maxCount = acc.maxCollectCount != null ? acc.maxCollectCount : 200;
  return getAccountTodayCollectCount(accIndex) >= maxCount;
}

function areAllAccountsExceededToday() {
  for (var i = 0; i < accountList.length; i++) {
    if (!isAccountExceededToday(i)) return false;
  }
  return true;
}

function findNextAvailableAccount(currentIndex) {
  if (!accountList.length) return -1;
  for (var i = 1; i <= accountList.length; i++) {
    var nextIdx = (currentIndex + i) % accountList.length;
    if (!isAccountExceededToday(nextIdx)) return nextIdx;
  }
  return -1;
}

/** 返回当前选中用于自动登录的账号，无则 null */
function getSelectedAccount() {
  if (!accountList.length) return null;
  var idx = Math.max(0, Math.min(selectedAccountIndex, accountList.length - 1));
  return accountList[idx];
}

/** 从接码接口响应文本中提取4-8位验证码，兼容多种格式（含 rednote 管道分隔、中英文） */
function extractSmsCode(text) {
  if (!text) return '';
  var s = String(text);
  var patterns = [
    /验证码是[：:\s]*(\d{4,8})/,
    /您的验证码是[：:\s]*(\d{4,8})/,
    /验证码为[：:\s]*(\d{4,8})/,
    /您的验证码为[：:\s]*(\d{4,8})/,
    /验证码[：:]\s*(\d{4,8})/,
    /您的验证码[：:]\s*(\d{4,8})/,
    /code\s+is[:\s]*(\d{4,8})/i
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = s.match(patterns[i]);
    if (m) return m[1];
  }
  return '';
}

function renderAccountList() {
  var container = document.getElementById('accountListContainer');
  if (!container) return;
  container.innerHTML = '';
  accountList.forEach(function(acc, i) {
    var row = document.createElement('div');
    row.className = 'account-list-row';
    var radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'accountSelect';
    radio.value = String(i);
    radio.checked = i === selectedAccountIndex;
    radio.id = 'accountRadio' + i;
    radio.addEventListener('change', function() {
      selectedAccountIndex = i;
      saveAccounts();
    });
    var textWrap = document.createElement('label');
    textWrap.htmlFor = 'accountRadio' + i;
    textWrap.className = 'account-row-label';
    textWrap.title = (acc.phone || '') + '\n' + (acc.codeUrl || '');
    var phoneSpan = document.createElement('span');
    phoneSpan.className = 'account-row-phone';
    phoneSpan.textContent = (acc.phone || '').trim() || '（未填手机号）';
    var urlSpan = document.createElement('span');
    urlSpan.className = 'account-row-codeurl';
    urlSpan.textContent = (acc.codeUrl || '').trim() ? '接码：' + (acc.codeUrl || '').trim() : '（未填接码链接）';
    var todayCount = getAccountTodayCollectCount(i);
    var maxCount = acc.maxCollectCount != null ? acc.maxCollectCount : 200;
    var statsSpan = document.createElement('span');
    statsSpan.className = 'account-row-stats' + (todayCount >= maxCount ? ' exceeded' : '');
    statsSpan.textContent = '今日采集：' + todayCount + '/' + maxCount;
    textWrap.appendChild(phoneSpan);
    textWrap.appendChild(urlSpan);
    textWrap.appendChild(statsSpan);
    var maxInput = document.createElement('input');
    maxInput.type = 'number';
    maxInput.className = 'account-max-collect';
    maxInput.min = '0';
    maxInput.max = '9999';
    maxInput.value = String(maxCount);
    maxInput.title = '最大采集次数/天（0 表示本账号今日不采集）';
    maxInput.dataset.index = String(i);
    maxInput.addEventListener('change', function() {
      var idx = parseInt(this.dataset.index, 10);
      var parsed = parseInt(this.value, 10);
      var val = isNaN(parsed)
        ? (accountList[idx].maxCollectCount != null ? accountList[idx].maxCollectCount : 200)
        : Math.max(0, parsed);
      this.value = String(val);
      accountList[idx].maxCollectCount = val;
      saveAccounts();
      renderAccountList();
    });
    var testBtn = document.createElement('button');
    testBtn.type = 'button';
    testBtn.className = 'btn-secondary btn-account-test';
    testBtn.textContent = '测试';
    testBtn.dataset.index = String(i);
    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-remove';
    delBtn.textContent = '删除';
    delBtn.dataset.index = String(i);
    row.appendChild(radio);
    row.appendChild(textWrap);
    row.appendChild(maxInput);
    row.appendChild(testBtn);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
  container.querySelectorAll('.btn-account-test').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = parseInt(btn.dataset.index, 10);
      var acc = accountList[idx];
      if (!acc || !(acc.codeUrl || '').trim()) {
        if (smsCodeResultEl) { smsCodeResultEl.textContent = '请先填写该账号的接码链接'; smsCodeResultEl.style.display = 'block'; }
        return;
      }
      btn.disabled = true;
      btn.textContent = '获取中…';
      if (smsCodeResultEl) { smsCodeResultEl.textContent = ''; smsCodeResultEl.style.display = 'block'; }
      fetch((acc.codeUrl || '').trim())
        .then(function(res) { return res.text(); })
        .then(function(text) {
          btn.disabled = false;
          btn.textContent = '测试';
          var raw = (text || '').trim().slice(0, 300) || '（响应为空）';
          var codeMatch = extractSmsCode(raw);
          var display = raw + '\n' + (codeMatch ? ('验证码：' + codeMatch) : '未抽取到验证码');
          showSmsCodeResult(display, false);
        })
        .catch(function(err) {
          btn.disabled = false;
          btn.textContent = '测试';
          showSmsCodeResult('请求失败：' + (err && err.message || String(err)), true);
        });
    });
  });
  container.querySelectorAll('.btn-remove').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = parseInt(btn.dataset.index, 10);
      if (idx < 0 || idx >= accountList.length) return;
      accountList.splice(idx, 1);
      if (selectedAccountIndex >= accountList.length) selectedAccountIndex = Math.max(0, accountList.length - 1);
      saveAccounts();
      renderAccountList();
    });
  });
}

function addAccountFromForm() {
  var phoneInput = document.getElementById('accountNewPhone');
  var urlInput = document.getElementById('accountNewCodeUrl');
  var phone = (phoneInput && phoneInput.value || '').trim();
  var codeUrl = (urlInput && urlInput.value || '').trim();
  if (!phone && !codeUrl) return;
  accountList.push({ phone: phone, codeUrl: codeUrl, maxCollectCount: 200 });
  selectedAccountIndex = accountList.length - 1;
  saveAccounts();
  if (phoneInput) phoneInput.value = '';
  if (urlInput) urlInput.value = '';
  renderAccountList();
}

function batchAddAccounts() {
  var textarea = document.getElementById('accountBatchInput');
  if (!textarea) return;
  var text = (textarea.value || '').trim();
  if (!text) return;
  var lines = text.split(/\n/);
  var added = 0;
  lines.forEach(function(line) {
    line = line.trim();
    if (!line) return;
    var parts = line.split(/\t+/);
    if (parts.length < 2) parts = line.split(/\s+/);
    var phone = (parts[0] || '').trim();
    var codeUrl = (parts.slice(1).join('') || '').trim();
    if (!phone) return;
    var exists = accountList.some(function(acc) { return acc.phone === phone; });
    if (exists) return;
    accountList.push({ phone: phone, codeUrl: codeUrl, maxCollectCount: 200 });
    added++;
  });
  if (added > 0) {
    selectedAccountIndex = accountList.length - 1;
    saveAccounts();
    renderAccountList();
    textarea.value = '';
    pushAutoTaskLogLine('批量添加了 ' + added + ' 个账号');
  }
}

var btnBatchAddAccount = document.getElementById('btnBatchAddAccount');
if (btnBatchAddAccount) btnBatchAddAccount.addEventListener('click', batchAddAccounts);

// 接口任务自动执行（与 Python 一致：用 maa_router/pop 获取完整任务对象，供回传 kwInfo）
var REDIS_KEY_KEYWORD_TASKS = 'Interest:KeywordTasks:2:551';
var autoTaskRunning = false;
var autoTaskAbort = false;
var autoTaskCountdownTimer = null;
/** 每次启动前台自动任务递增，用于清空上一轮定时逻辑 */
var panelAutoTaskSessionGen = 0;

function clearPanelAutoTaskScheduledTimers() {
  if (autoTaskCountdownTimer) {
    clearInterval(autoTaskCountdownTimer);
    autoTaskCountdownTimer = null;
  }
}

var keywordListEl = document.getElementById('keywordList');
var keywordNewInput = document.getElementById('keywordNewInput');
var btnAddKeyword = document.getElementById('btnAddKeyword');
var btnExecuteSearch = document.getElementById('btnExecuteSearch');
var keywordExecuteStatus = document.getElementById('keywordExecuteStatus');
var publishTimeFilterEl = document.getElementById('publishTimeFilter');

function saveKeywords() {
  chrome.storage.local.set({ pluginSearchKeywords: pluginSearchKeywords });
}

function renderKeywordList() {
  if (!keywordListEl) return;
  keywordListEl.innerHTML = pluginSearchKeywords.map(function(kw, i) {
    var text = (kw || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    return '<li data-index="' + i + '"><span class="keyword-text" title="' + text + '">' + text + '</span><button type="button" class="btn-remove" aria-label="删除">删除</button></li>';
  }).join('');
  keywordListEl.querySelectorAll('.btn-remove').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var li = btn.closest('li');
      var idx = li ? parseInt(li.getAttribute('data-index'), 10) : -1;
      if (idx >= 0 && idx < pluginSearchKeywords.length) {
        pluginSearchKeywords.splice(idx, 1);
        saveKeywords();
        renderKeywordList();
      }
    });
  });
}

function addKeyword(val) {
  var v = (val || '').trim();
  if (!v) return;
  pluginSearchKeywords.push(v);
  saveKeywords();
  renderKeywordList();
  if (keywordNewInput) keywordNewInput.value = '';
}

if (btnAddKeyword && keywordNewInput) {
  btnAddKeyword.addEventListener('click', function() { addKeyword(keywordNewInput.value); });
  keywordNewInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { addKeyword(keywordNewInput.value); e.preventDefault(); }
  });
}

chrome.storage.local.get(KEYWORD_STORAGE_KEY, function(obj) {
  pluginSearchKeywords = Array.isArray(obj[KEYWORD_STORAGE_KEY]) ? obj[KEYWORD_STORAGE_KEY] : [];
  renderKeywordList();
});

chrome.storage.local.get(['publishTimeFilter'], function(o) {
  if (publishTimeFilterEl && o.publishTimeFilter != null) publishTimeFilterEl.value = o.publishTimeFilter;
});
if (publishTimeFilterEl) publishTimeFilterEl.addEventListener('change', function() {
  chrome.storage.local.set({ publishTimeFilter: publishTimeFilterEl.value });
});

// 按顺序执行搜索：在当前标签页依次打开每个关键词的搜索页
function setExecuteStatus(text) {
  if (keywordExecuteStatus) keywordExecuteStatus.textContent = text || '';
}

// 等待指定毫秒数，期间每秒更新状态为倒计时（statusPrefix 为当前执行描述，如「执行中 2/5：关键词」）
function waitWithCountdown(ms, statusPrefix) {
  return new Promise(function(resolve) {
    var remainSec = Math.ceil(ms / 1000);
    function tick() {
      if (remainSec <= 0) {
        if (executeCountdownTimer) clearInterval(executeCountdownTimer);
        executeCountdownTimer = null;
        resolve();
        return;
      }
      setExecuteStatus(statusPrefix + ' · ' + remainSec + ' 秒后下一词');
      remainSec--;
    }
    tick();
    executeCountdownTimer = setInterval(tick, 1000);
  });
}

function waitForTabComplete(tabId) {
  return new Promise(function(resolve) {
    var resolved = false;
    function done() {
      if (resolved) return;
      resolved = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    }
    var listener = function(id, changeInfo) {
      if (id === tabId && changeInfo.status === 'complete') done();
    };
    chrome.tabs.onUpdated.addListener(listener);
    var timer = setTimeout(done, 15000);
  });
}

// 在页面内通过输入框执行搜索（备用；主流程已改为地址栏带 keyword）
function searchByInputInPage(keyword) {
  var text = keyword == null || keyword === '' ? '' : String(keyword);
  var selectors = [
    'input[placeholder*="搜索"]',
    'input[placeholder*="搜"]',
    'input[type="search"]',
    '.search-input input',
    'input[name="keyword"]',
    'input[name="search"]',
    'header input[type="text"]',
    '.input-bar input'
  ];
  var input = null;
  for (var i = 0; i < selectors.length; i++) {
    try {
      input = document.querySelector(selectors[i]);
      if (input && (input.offsetParent != null || input.getBoundingClientRect().width > 0)) break;
    } catch (e) {}
  }
  if (!input) return false;
  input.focus();
  try {
    var desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
    if (desc && desc.set) {
      desc.set.call(input, text);
    } else {
      input.value = text;
    }
  } catch (e) {
    input.value = text;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  return true;
}

/** 注入到页面 MAIN：调用 manifest 注入的 humanSearch（js/script/xhs-human-search.js） */
function _runHumanSearchOnXhsPage(keyword) {
  if (typeof humanSearch !== 'function') return Promise.resolve(false);
  return humanSearch(keyword);
}

/** 在页面内检测「发布时间」筛选区域是否已出现（用于判断搜索结果是否加载完成）。注入到页面执行。 */
function isPublishTimeFilterVisible() {
  try {
    var nodes = document.evaluate("//*[contains(., '发布时间')]", document, null, 7, null);
    for (var i = 0; i < nodes.snapshotLength; i++) {
      var el = nodes.snapshotItem(i);
      if (!el || el.offsetParent == null) continue;
      var rect = el.getBoundingClientRect();
      if (rect.width >= 8 && rect.height >= 8) return true;
    }
  } catch (e) {}
  return false;
}

/** 在页面内点击「发布时间」筛选项的展开按钮（打开下拉）。注入到页面执行。优先点击文档顺序最后一个可见匹配（多为可点击控件）。 */
function clickPublishTimeFilterOpener() {
  try {
    var nodes = document.evaluate("//*[contains(., '发布时间')]", document, null, 7, null);
    for (var i = nodes.snapshotLength - 1; i >= 0; i--) {
      var el = nodes.snapshotItem(i);
      if (!el || el.offsetParent == null) continue;
      var rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) continue;
      if ((el.textContent || '').indexOf('发布时间') === -1) continue;
      var x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      var opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
      el.focus();
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      return true;
    }
  } catch (e) {}
  return false;
}

/** 在页面内点击发布时间下拉中的某个选项，如「半年内」。注入到页面执行。优先点击文档顺序最后一个可见匹配。 */
function clickPublishTimeOption(optionText) {
  if (!optionText) return false;
  try {
    var escaped = (optionText || '').replace(/'/g, "''");
    var nodes = document.evaluate("//*[contains(., '" + escaped + "')]", document, null, 7, null);
    for (var i = nodes.snapshotLength - 1; i >= 0; i--) {
      var el = nodes.snapshotItem(i);
      if (!el || el.offsetParent == null) continue;
      var rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) continue;
      if ((el.textContent || '').indexOf(optionText) === -1) continue;
      var x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      var opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
      el.focus();
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      return true;
    }
  } catch (e) {}
  return false;
}

function runExecuteSearch() {
  if (!pluginSearchKeywords.length) {
    setExecuteStatus('请先添加至少一个关键词');
    return;
  }
  setExecuteStatus('准备中…');
  chrome.storage.local.remove('currentKeywordTask');
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    var tab = tabs[0];
    if (!tab || !tab.id) {
      setExecuteStatus('无法获取当前标签页');
      return;
    }
    function doNext(index) {
      if (index >= pluginSearchKeywords.length) {
        setExecuteStatus('全部执行完成');
        return;
      }
      var keyword = resolveSearchKeyword(pluginSearchKeywords[index], null, index);
      if (!keyword) {
        setExecuteStatus('第 ' + (index + 1) + ' 个关键词无效，已跳过');
        doNext(index + 1);
        return;
      }
      var statusPrefix = '执行中 ' + (index + 1) + '/' + pluginSearchKeywords.length + '：' + keyword;
      setExecuteStatus(statusPrefix);
      function runInjectAndFollow() {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: _runHumanSearchOnXhsPage,
          args: [keyword]
        }, function(execRes) {
          if (chrome.runtime.lastError) {
            setExecuteStatus(statusPrefix + ' · 拟人搜索异常：' + chrome.runtime.lastError.message);
          } else if (!execRes || !execRes[0] || execRes[0].result !== true) {
            setExecuteStatus(statusPrefix + ' · 拟人搜索失败：请确认已在搜索页且顶部搜索框可见');
          }
          refreshSearchResultTable();
          var filterVal = publishTimeFilterEl ? (publishTimeFilterEl.value || '').trim() : '';
          var thenWait = function() {
            waitWithCountdown(EXECUTE_WAIT_MS, statusPrefix).then(function() { doNext(index + 1); });
          };
          if (filterVal) {
            setExecuteStatus(statusPrefix + ' · 应用筛选「' + filterVal + '」');
            applyPublishTimeFilterAfterSearch(tab.id, filterVal).then(function() {
              setTimeout(refreshSearchResultTable, 3000);
              thenWait();
            });
          } else {
            thenWait();
          }
        });
      }
      chrome.tabs.get(tab.id, function(fresh) {
        if (chrome.runtime.lastError || !fresh) {
          setExecuteStatus('无法读取当前标签页：' + ((chrome.runtime.lastError && chrome.runtime.lastError.message) || '标签已关闭'));
          return;
        }
        var plan = getSearchNavigatePlan(fresh.url || '');
        if (plan.needTabLoad) {
          chrome.tabs.update(tab.id, { url: plan.url }, function() {
            if (chrome.runtime.lastError) {
              setExecuteStatus('无法打开搜索页：' + chrome.runtime.lastError.message);
              return;
            }
            whenReadyForHumanSearch(tab, true, 800, runInjectAndFollow);
          });
        } else {
          whenReadyForHumanSearch(tab, false, 700, runInjectAndFollow);
        }
      });
    }

    doNext(0);
  });
}

if (btnExecuteSearch) btnExecuteSearch.addEventListener('click', runExecuteSearch);

// ---------- 接口任务自动执行 ----------
var autoTaskStatusEl = document.getElementById('autoTaskStatus');
var autoTaskCountdownTextEl = document.getElementById('autoTaskCountdownText');
var autoTaskCallbackLogEl = document.getElementById('autoTaskCallbackLog');
var CALLBACK_LOG_MAX = 50;
var btnAutoTaskStart = document.getElementById('btnAutoTaskStart');
var btnAutoTaskStop = document.getElementById('btnAutoTaskStop');
var autoTaskIntervalMin = document.getElementById('autoTaskIntervalMin');
var autoTaskIntervalMax = document.getElementById('autoTaskIntervalMax');

function saveAutoTaskInterval() {
  var min = autoTaskIntervalMin ? parseInt(autoTaskIntervalMin.value, 10) : NaN;
  var max = autoTaskIntervalMax ? parseInt(autoTaskIntervalMax.value, 10) : NaN;
  if (!isNaN(min) && min >= 0) chrome.storage.local.set({ autoTaskIntervalMin: min });
  if (!isNaN(max) && max >= 0) chrome.storage.local.set({ autoTaskIntervalMax: max });
}

function loadAutoTaskInterval() {
  chrome.storage.local.get(['autoTaskIntervalMin', 'autoTaskIntervalMax'], function(o) {
    if (autoTaskIntervalMin && o.autoTaskIntervalMin != null) autoTaskIntervalMin.value = String(o.autoTaskIntervalMin);
    if (autoTaskIntervalMax && o.autoTaskIntervalMax != null) autoTaskIntervalMax.value = String(o.autoTaskIntervalMax);
  });
}

var AUTO_TASK_RUN_IN_BACKGROUND_KEY = 'autoTaskRunInBackground';
var autoTaskRunInBackgroundEl = document.getElementById('autoTaskRunInBackground');
var AUTO_TASK_AUTO_LOGIN_ENABLED_KEY = 'autoTaskAutoLoginEnabled';
var autoTaskAutoLoginEnabledEl = document.getElementById('autoTaskAutoLoginEnabled');

function loadAutoTaskRunInBackground() {
  chrome.storage.local.get([AUTO_TASK_RUN_IN_BACKGROUND_KEY], function(o) {
    var v = !!(o[AUTO_TASK_RUN_IN_BACKGROUND_KEY]);
    if (autoTaskRunInBackgroundEl) autoTaskRunInBackgroundEl.checked = v;
  });
}

function loadAutoTaskAutoLoginEnabled() {
  chrome.storage.local.get([AUTO_TASK_AUTO_LOGIN_ENABLED_KEY], function(o) {
    var v = o[AUTO_TASK_AUTO_LOGIN_ENABLED_KEY] === true;
    if (autoTaskAutoLoginEnabledEl) autoTaskAutoLoginEnabledEl.checked = v;
  });
}

function saveAutoTaskAutoLoginEnabled() {
  var v = !!(autoTaskAutoLoginEnabledEl && autoTaskAutoLoginEnabledEl.checked);
  chrome.storage.local.set({ autoTaskAutoLoginEnabled: v });
}

function saveAutoTaskRunInBackground() {
  var v = !!(autoTaskRunInBackgroundEl && autoTaskRunInBackgroundEl.checked);
  chrome.storage.local.set({ autoTaskRunInBackground: v });
  // 勾选「后台执行」时自动启动自动任务（若已在运行则不再重复启动）
  if (v) {
    chrome.storage.local.get(['autoTaskRunning'], function(o) {
      if (o.autoTaskRunning) return;
      chrome.storage.local.set({ autoTaskRunning: true }, function() {
        chrome.runtime.sendMessage({ type: 'startAutoTask' }, function() {
          if (chrome.runtime.lastError) {
            var errMsg = '后台启动失败：' + (chrome.runtime.lastError.message || '');
            if (autoTaskStatusEl) autoTaskStatusEl.textContent = errMsg;
            if (autoTaskCountdownTextEl) autoTaskCountdownTextEl.textContent = errMsg;
            chrome.storage.local.set({ autoTaskRunning: false });
            autoTaskRunning = false;
            updateAutoTaskButtons();
            return;
          }
          autoTaskRunning = true;
          updateAutoTaskButtons();
          var startedMsg = '已在后台启动（可关闭侧边栏）';
          if (autoTaskStatusEl) autoTaskStatusEl.textContent = startedMsg;
          if (autoTaskCountdownTextEl) autoTaskCountdownTextEl.textContent = startedMsg;
        });
      });
    });
  }
}

loadAutoTaskInterval();
if (autoTaskIntervalMin) autoTaskIntervalMin.addEventListener('change', saveAutoTaskInterval);
if (autoTaskIntervalMax) autoTaskIntervalMax.addEventListener('change', saveAutoTaskInterval);
loadAutoTaskRunInBackground();
if (autoTaskRunInBackgroundEl) autoTaskRunInBackgroundEl.addEventListener('change', saveAutoTaskRunInBackground);
loadAutoTaskAutoLoginEnabled();
if (autoTaskAutoLoginEnabledEl) autoTaskAutoLoginEnabledEl.addEventListener('change', saveAutoTaskAutoLoginEnabled);

loadApiHost();
var btnSaveApiHost = document.getElementById('btnSaveApiHost');
if (btnSaveApiHost) btnSaveApiHost.addEventListener('click', function() { saveApiHost(); });
var btnSaveSearchSiteBase = document.getElementById('btnSaveSearchSiteBase');
if (btnSaveSearchSiteBase) btnSaveSearchSiteBase.addEventListener('click', function() { saveSearchSiteBase(); });
var btnSaveAutoLoginPage = document.getElementById('btnSaveAutoLoginPage');
if (btnSaveAutoLoginPage) btnSaveAutoLoginPage.addEventListener('click', function() { saveAutoLoginPage(); });

var smsCodeResultEl = document.getElementById('smsCodeResult');

function showSmsCodeResult(text, isErr) {
  if (!smsCodeResultEl) return;
  smsCodeResultEl.textContent = text || '';
  smsCodeResultEl.style.display = text ? 'block' : 'none';
  smsCodeResultEl.style.borderLeftColor = isErr ? '#c62828' : '#e74c3c';
  smsCodeResultEl.style.color = isErr ? '#c62828' : '#333';
}

var btnAddAccount = document.getElementById('btnAddAccount');
if (btnAddAccount) btnAddAccount.addEventListener('click', addAccountFromForm);

// 同步后台任务状态：若在 background 中运行，打开侧边栏时显示正确按钮与状态
function syncAutoTaskStateFromStorage() {
  chrome.storage.local.get(['autoTaskRunning', 'autoTaskStatus'], function(o) {
    if (o.autoTaskRunning === true) {
      autoTaskRunning = true;
      updateAutoTaskButtons();
      var statusText = o.autoTaskStatus || '';
      if (autoTaskStatusEl) autoTaskStatusEl.textContent = statusText;
      mirrorAutoTaskStatusToCountdownLine(statusText);
    }
  });
}
syncAutoTaskStateFromStorage();

/** 「请求关键词倒计时」行不与自动登录类状态同步（仅主状态区显示），避免倒计时行出现「正在自动登录…」 */
function mirrorAutoTaskStatusToCountdownLine(text) {
  var t = text || '';
  if (t.indexOf('自动登录') !== -1) return;
  if (autoTaskCountdownTextEl) autoTaskCountdownTextEl.textContent = t;
}

function setAutoTaskStatus(text) {
  var t = text || '';
  if (autoTaskStatusEl) autoTaskStatusEl.textContent = t;
  mirrorAutoTaskStatusToCountdownLine(t);
}

function sendCountdownToPage(show, text, seconds) {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (!tabs[0] || !tabs[0].id) return;
    try {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'dataCrawlerCountdown', show: show, text: text, seconds: seconds });
    } catch (e) {}
  });
}

function pushAutoTaskLogLine(text) {
  if (!text) return;
  chrome.storage.local.set({ autoTaskLogLine: { time: Date.now(), text: text } });
}

function getTaskApiUrl() {
  var base = getApiHost().replace(/\/?$/, '/') + 'xhs_extension/get_keyword_task';
  return base + '?trace_id=20260303';
}

/** 从 maa_router/pop 获取完整任务对象（与 Python get_keyword_task 一致），供回传时作为完整 kwInfo */
function fetchFullKeywordTask() {
  var base = getApiHost().replace(/\/?$/, '/') + 'api/maa_router/pop';
  var url = base + '?key=' + encodeURIComponent(REDIS_KEY_KEYWORD_TASKS) + '&count=1';
  console.log('[DataCrawler] 获取完整任务 pop:', url);
  return fetch(url, { method: 'GET', headers: { accept: 'application/json' } })
    .then(function(res) {
      if (!res.ok) return res.text().then(function(t) { throw new Error('HTTP ' + res.status + (t ? ' ' + t.slice(0, 80) : '')); });
      return res.json();
    })
    .then(function(data) {
      if (data.code !== '0' || !data.result || !data.result.length) {
        return { keywords: [], taskInfos: [] };
      }
      var fullTask = data.result[0];
      var kw = fullTask.Keywords != null ? fullTask.Keywords : (fullTask.keyword || fullTask.name || '');
      if (kw !== '') kw = String(kw).trim();
      console.log('[DataCrawler] 获取完整任务成功:', fullTask.ID, kw);
      return { keywords: kw ? [kw] : [], taskInfos: [fullTask] };
    })
    .catch(function(err) {
      console.warn('[DataCrawler] fetchFullKeywordTask error', err);
      throw err;
    });
}

/** 从接口返回中解析出关键词数组，兼容 search_keyword 接口及多种数据结构 */
function parseKeywordTaskResponse(data) {
  if (!data || typeof data !== 'object') return [];
  var keywords = [];
  // 接口格式: { code, message, success, result: { Keywords: "xxx", ... } } 或 result 为数组
  var result = data.result;
  if (result != null) {
    if (Array.isArray(result)) {
      result.forEach(function(item) {
        var kw = (item && (item.Keywords != null ? item.Keywords : item.keyword || item.name));
        if (kw != null && kw !== '') keywords.push(String(kw).trim());
      });
    } else if (typeof result === 'object' && (result.Keywords != null || result.keyword != null || result.name != null)) {
      var kw = result.Keywords != null ? result.Keywords : result.keyword || result.name;
      if (kw != null && kw !== '') keywords.push(String(kw).trim());
    }
  }
  if (keywords.length) return keywords;
  // 兼容旧格式
  var list = data.data && Array.isArray(data.data) ? data.data
    : data.data && Array.isArray(data.data.keywords) ? data.data.keywords
    : Array.isArray(data.keywords) ? data.keywords
    : Array.isArray(data.list) ? data.list
    : [];
  return list.map(function(k) {
    return typeof k === 'string' ? k.trim() : (k && k.keyword ? String(k.keyword).trim() : (k && k.name ? String(k.name).trim() : ''));
  }).filter(Boolean);
}

/** 从接口返回中解析出任务对象数组，供回传时作为 kw_info */
function getKeywordTaskInfos(data) {
  if (!data || typeof data !== 'object') return [];
  var result = data.result;
  if (result != null) {
    if (Array.isArray(result) && result.length) return result;
    if (typeof result === 'object' && (result.Keywords != null || result.keyword != null || result.name != null)) return [result];
  }
  return [];
}

var KEYWORD_TASK_FETCH_TIMEOUT_MS = 45000;
var HUMAN_SEARCH_INJECT_TIMEOUT_MS = 120000;
var PAGE_CHECK_WATCHDOG_MS = 25000;

function fetchKeywordTask() {
  var url = getTaskApiUrl();
  console.log('[DataCrawler] 获取任务请求:', url);
  var controller = new AbortController();
  var timer = setTimeout(function() {
    try {
      controller.abort();
    } catch (e) {}
  }, KEYWORD_TASK_FETCH_TIMEOUT_MS);
  return fetch(url, { method: 'GET', signal: controller.signal })
    .finally(function() {
      clearTimeout(timer);
    })
    .then(function(res) {
      if (!res.ok) {
        var msg = 'HTTP ' + res.status;
        console.warn('[DataCrawler] 获取任务失败:', msg);
        return res.text().then(function(text) { throw new Error(msg + (text ? ' ' + text.slice(0, 80) : '')); });
      }
      return res.json();
    })
    .then(function(data) {
      var keywords = parseKeywordTaskResponse(data);
      var taskInfos = getKeywordTaskInfos(data);
      console.log('[DataCrawler] 获取任务成功, 关键词数量:', keywords.length, keywords);
      return { keywords: keywords, taskInfos: taskInfos };
    })
    .catch(function(err) {
      console.warn('[DataCrawler] get_keyword_task error', err);
      if (err && err.name === 'AbortError') {
        throw new Error('获取任务超时（' + Math.round(KEYWORD_TASK_FETCH_TIMEOUT_MS / 1000) + ' 秒）');
      }
      throw err;
    });
}

function executeScriptWithTimeout(tabId, details, timeoutMs) {
  return new Promise(function(resolve) {
    var finished = false;
    var to = setTimeout(function() {
      if (finished) return;
      finished = true;
      resolve({ timedOut: true, chromeError: null, results: null });
    }, timeoutMs);
    try {
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        world: details.world || 'MAIN',
        func: details.func,
        args: details.args || []
      }, function(results) {
        if (finished) return;
        finished = true;
        clearTimeout(to);
        if (chrome.runtime.lastError) {
          resolve({ timedOut: false, chromeError: chrome.runtime.lastError.message || '执行失败', results: null });
          return;
        }
        resolve({ timedOut: false, chromeError: null, results: results });
      });
    } catch (e) {
      if (finished) return;
      finished = true;
      clearTimeout(to);
      resolve({ timedOut: false, chromeError: String(e && e.message ? e.message : e), results: null });
    }
  });
}

function getRandomIntervalMs() {
  var min = 5, max = 20;
  if (autoTaskIntervalMin && autoTaskIntervalMin.value !== '') min = Math.max(1, parseInt(autoTaskIntervalMin.value, 10) || 5);
  if (autoTaskIntervalMax && autoTaskIntervalMax.value !== '') max = Math.max(min, Math.min(120, parseInt(autoTaskIntervalMax.value, 10) || 20));
  return (min + Math.random() * (max - min + 1)) * 1000;
}

function waitRandomWithCountdown(ms, optionalTaskSession) {
  return new Promise(function(resolve) {
    var remainSec = Math.ceil(ms / 1000);
    function tick() {
      if (optionalTaskSession != null && optionalTaskSession !== panelAutoTaskSessionGen) {
        if (autoTaskCountdownTimer) clearInterval(autoTaskCountdownTimer);
        autoTaskCountdownTimer = null;
        resolve();
        return;
      }
      if (remainSec <= 0 || autoTaskAbort) {
        if (autoTaskCountdownTimer) clearInterval(autoTaskCountdownTimer);
        autoTaskCountdownTimer = null;
        resolve();
        return;
      }
      setAutoTaskStatus('等待下一词 · ' + remainSec + ' 秒');
      remainSec--;
    }
    tick();
    autoTaskCountdownTimer = setInterval(tick, 1000);
  });
}

/** 搜索完成后在页面内应用「发布时间」筛选（如半年内）。自动轮询直到筛选区域出现再点击，最多等 15 秒。失败或超时也会 resolve，避免 Promise 与闭包长期挂起导致内存累积。 */
function applyPublishTimeFilterAfterSearch(tabId, optionText) {
  if (!optionText || !tabId) return Promise.resolve();
  var pollInterval = 500;
  var maxWait = 15000;
  var start = Date.now();
  var finished = false;

  var resolve;
  var promise = new Promise(function(r) { resolve = r; });
  var safetyTimeoutId = setTimeout(function() {
    if (!finished) { finished = true; resolve(); }
  }, maxWait + 2000);

  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(safetyTimeoutId);
    resolve();
  }

  function tryClick() {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      func: isPublishTimeFilterVisible,
      args: []
    }, function(res) {
      if (chrome.runtime.lastError) { finish(); return; }
      var visible = res && res[0] && res[0].result === true;
      if (visible) {
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          world: 'MAIN',
          func: clickPublishTimeFilterOpener,
          args: []
        }, function() {
          if (chrome.runtime.lastError) { finish(); return; }
          setTimeout(function() {
            chrome.scripting.executeScript({
              target: { tabId: tabId },
              world: 'MAIN',
              func: clickPublishTimeOption,
              args: [optionText]
            }, function() {
              if (chrome.runtime.lastError) { /* 忽略，仍算完成 */ }
              finish();
            });
          }, 1200);
        });
        return;
      }
      if (Date.now() - start >= maxWait) {
        finish();
        return;
      }
      setTimeout(tryClick, pollInterval);
    });
  }

  tryClick();
  return promise;
}

/** 在当前标签页执行单个关键词搜索，返回 Promise<boolean> */
function runSingleKeywordSearch(tab, keyword, needNavigate) {
  return new Promise(function(resolve) {
    var kw = keyword == null ? '' : String(keyword).trim();
    if (!kw) {
      resolve(false);
      return;
    }
    function inject() {
      setTimeout(function() {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: _runHumanSearchOnXhsPage,
          args: [kw]
        }, function() { resolve(true); });
      }, 800);
    }
    chrome.tabs.get(tab.id, function(fresh) {
      if (chrome.runtime.lastError || !fresh) {
        resolve(false);
        return;
      }
      var plan = getSearchNavigatePlan(fresh.url || '');
      if (plan.needTabLoad) {
        chrome.tabs.update(tab.id, { url: plan.url }, function() {
          if (chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          waitForTabComplete(tab.id).then(inject);
        });
      } else {
        inject();
      }
    });
  });
}

function ensureContentScriptReady(tabId) {
  return new Promise(function(resolve) {
    try {
      chrome.tabs.sendMessage(tabId, { type: 'dataCrawlerPing' }, function(response) {
        if (chrome.runtime.lastError || !response || !response.pong) {
          pushAutoTaskLogLine('content script 未就绪，刷新页面…');
          chrome.tabs.reload(tabId, {}, function() {
            waitForTabComplete(tabId).then(function() {
              setTimeout(resolve, 2000);
            });
          });
        } else {
          resolve();
        }
      });
    } catch (e) {
      chrome.tabs.reload(tabId, {}, function() {
        waitForTabComplete(tabId).then(function() {
          setTimeout(resolve, 2000);
        });
      });
    }
  });
}

function updateAutoTaskButtons() {
  if (btnAutoTaskStart) btnAutoTaskStart.disabled = autoTaskRunning;
  if (btnAutoTaskStop) btnAutoTaskStop.disabled = !autoTaskRunning;
  // 不禁用「按顺序执行搜索」，启动自动任务后仍可手动按顺序执行
}

/**
 * 注入页面 MAIN：与 background 一致；安全验证/验证码 URL、标题含「安全验证」、含「无法访问此网站」「重新加载」或可见「登录」则 block
 */
function _pageShouldBlockKeywordFetch() {
  try {
    var href = '';
    try {
      href = (typeof location !== 'undefined' && location.href) ? String(location.href) : '';
    } catch (e0) {}
    if (/captcha|website-login/i.test(href)) {
      return { block: true, reason: 'security_verify' };
    }
    var pageTitle = (document.title || '').trim();
    if (pageTitle.indexOf('安全验证') !== -1) {
      return { block: true, reason: 'security_verify' };
    }
    var blob = '';
    if (document.body) blob += document.body.innerText || '';
    if (document.documentElement) blob += document.documentElement.innerText || '';
    if (document.title) blob += document.title;
    if (blob.indexOf('无法访问此网站') !== -1) {
      return { block: true, reason: 'unreachable' };
    }
    if (blob.indexOf('重新加载') !== -1) {
      return { block: true, reason: 'reload' };
    }
  } catch (e) {}
  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    var st = window.getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return false;
    return true;
  }
  var byId = document.getElementById('login-btn');
  if (byId && isVisible(byId)) return { block: true, reason: 'login' };
  var list = document.querySelectorAll('.login-btn');
  for (var i = 0; i < list.length; i++) {
    var el = list[i];
    if (!isVisible(el)) continue;
    var t = (el.textContent || '').replace(/\s+/g, '');
    if (t.indexOf('登录') !== -1) return { block: true, reason: 'login' };
  }
  return { block: false };
}

/** 拉取关键词前：连续 N 次页面校验，间隔 ms；任一次 block 则立即回调；全部通过才 cb(null) */
var KEYWORD_FETCH_PAGE_CHECK_ROUNDS = 5;
var KEYWORD_FETCH_PAGE_CHECK_INTERVAL_MS = 500;
function runKeywordFetchPageChecks(tabId, isStale, cb) {
  var passed = 0;
  var finished = false;
  var watchdog = setTimeout(function() {
    if (finished || isStale()) return;
    pushAutoTaskLogLine('页面状态检测超时（' + Math.round(PAGE_CHECK_WATCHDOG_MS / 1000) + ' 秒），继续请求关键词任务');
    finishOnce(false);
  }, PAGE_CHECK_WATCHDOG_MS);
  function finishOnce(v) {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    cb(v);
  }
  function step() {
    if (isStale() || finished) return;
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      func: _pageShouldBlockKeywordFetch,
      args: []
    }, function(results) {
      if (isStale() || finished) return;
      if (chrome.runtime.lastError) {
        pushAutoTaskLogLine('无法检测页面状态（' + (chrome.runtime.lastError.message || '') + '），继续请求关键词任务');
        finishOnce(false);
        return;
      }
      var verdict = results && results[0] && results[0].result;
      if (verdict && verdict.block) {
        finishOnce(verdict);
        return;
      }
      passed++;
      if (passed >= KEYWORD_FETCH_PAGE_CHECK_ROUNDS) {
        finishOnce(null);
        return;
      }
      setTimeout(step, KEYWORD_FETCH_PAGE_CHECK_INTERVAL_MS);
    });
  }
  step();
}

function runAutoTaskLoop() {
  clearPanelAutoTaskScheduledTimers();
  panelAutoTaskSessionGen++;
  var panelTaskSession = panelAutoTaskSessionGen;
  function panelStale() {
    return panelTaskSession !== panelAutoTaskSessionGen;
  }
  function scheduleLoop(ms) {
    return setTimeout(function() {
      if (panelStale()) return;
      if (autoTaskAbort) {
        done();
        return;
      }
      loop();
    }, ms);
  }
  autoTaskRunning = true;
  autoTaskAbort = false;
  updateAutoTaskButtons();

  function done() {
    pushAutoTaskLogLine('已关闭');
    sendCountdownToPage(false);
    autoTaskRunning = false;
    clearPanelAutoTaskScheduledTimers();
    chrome.storage.local.remove('currentKeywordTask');
    updateAutoTaskButtons();
    setAutoTaskStatus('已关闭');
  }

  function getTab() {
    return getXhsWorkTab();
  }

  var apiHostPlaceholder = 'https://your-api.example/';
  function isApiHostConfigured(host) {
    var h = (host || '').trim();
    if (!h) return false;
    var norm = h.replace(/\/+$/, '');
    return norm !== '' && norm !== apiHostPlaceholder.replace(/\/+$/, '');
  }
  function checkAndSwitchAccountIfNeeded(thenContinue) {
    chrome.storage.local.get([ACCOUNT_COLLECT_STATS_KEY, ACCOUNT_LIST_STORAGE_KEY, SELECTED_ACCOUNT_INDEX_KEY], function(o) {
      if (panelStale()) return;
      accountCollectStats = o[ACCOUNT_COLLECT_STATS_KEY] || accountCollectStats;
      if (o[ACCOUNT_LIST_STORAGE_KEY]) {
        accountList = o[ACCOUNT_LIST_STORAGE_KEY].map(function(item) {
          return { phone: (item.phone || '').trim(), codeUrl: (item.codeUrl || '').trim(), maxCollectCount: item.maxCollectCount != null ? parseInt(item.maxCollectCount, 10) : 200 };
        });
      }
      if (o[SELECTED_ACCOUNT_INDEX_KEY] != null) selectedAccountIndex = parseInt(o[SELECTED_ACCOUNT_INDEX_KEY], 10) || 0;

      if (!isAccountExceededToday(selectedAccountIndex)) {
        thenContinue();
        return;
      }

      var todayCount = getAccountTodayCollectCount(selectedAccountIndex);
      var maxCount = accountList[selectedAccountIndex] ? accountList[selectedAccountIndex].maxCollectCount : 200;
      pushAutoTaskLogLine('账号 ' + (selectedAccountIndex + 1) + ' 今日已采集 ' + todayCount + '/' + maxCount + '，已达上限');

      if (areAllAccountsExceededToday()) {
        var now = new Date();
        var nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
        var minToMidnight = Math.ceil((nextMidnight - now) / 60000);
        var waitSec = 15;
        var statusMsg = '所有账号今日采集均已达上限，' + waitSec + '秒后重新检测（距明日重置约' + minToMidnight + '分钟）';
        setAutoTaskStatus(statusMsg);
        pushAutoTaskLogLine(statusMsg);
        sendCountdownToPage(true, '等待重新检测', waitSec);
        setTimeout(function() {
          if (panelStale()) return;
          if (autoTaskAbort) { done(); return; }
          checkAndSwitchAccountIfNeeded(thenContinue);
        }, waitSec * 1000);
        return;
      }

      var nextIdx = findNextAvailableAccount(selectedAccountIndex);
      if (nextIdx < 0) {
        var now2 = new Date();
        var nextMidnight2 = new Date(now2.getFullYear(), now2.getMonth(), now2.getDate() + 1, 0, 0, 0);
        var minToMidnight2 = Math.ceil((nextMidnight2 - now2) / 60000);
        var waitSec2 = 15;
        var statusMsg2 = '无可用账号，' + waitSec2 + '秒后重新检测（距明日重置约' + minToMidnight2 + '分钟）';
        setAutoTaskStatus(statusMsg2);
        pushAutoTaskLogLine(statusMsg2);
        sendCountdownToPage(true, '等待重新检测', waitSec2);
        setTimeout(function() {
          if (panelStale()) return;
          if (autoTaskAbort) { done(); return; }
          checkAndSwitchAccountIfNeeded(thenContinue);
        }, waitSec2 * 1000);
        return;
      }

      sendCountdownToPage(false);
      autoTaskRunning = false;
      if (autoTaskCountdownTimer) { clearInterval(autoTaskCountdownTimer); autoTaskCountdownTimer = null; }
      chrome.storage.local.remove('currentKeywordTask');
      updateAutoTaskButtons();
      pushAutoTaskLogLine('暂停自动任务，准备切换到账号 ' + (nextIdx + 1));
      setAutoTaskStatus('正在切换到账号 ' + (nextIdx + 1) + '…');
      doAutoSwitchAccount(nextIdx, function(success) {
        if (success) {
          pushAutoTaskLogLine('账号 ' + (nextIdx + 1) + ' 登录成功，自动重新启动采集任务');
          runAutoTaskLoop();
        } else {
          pushAutoTaskLogLine('账号 ' + (nextIdx + 1) + ' 切换/登录失败，15秒后重试');
          setTimeout(function() { runAutoTaskLoop(); }, 15000);
        }
      });
    });
  }

  function loop() {
    if (panelStale()) return;
    if (autoTaskAbort) { done(); return; }

    checkAndSwitchAccountIfNeeded(function() {
      loopInner();
    });
  }

  function loopInner() {
    if (panelStale()) return;
    if (autoTaskAbort) { done(); return; }
    chrome.storage.local.remove(['searchNotesPages', 'searchNotesResult']);
    var host = getApiHost();
    if (!isApiHostConfigured(host)) {
      setAutoTaskStatus('请先配置并保存「接口根地址」');
      pushAutoTaskLogLine('请先配置并保存「接口根地址」');
      sendCountdownToPage(true, '请求关键词', 15);
      scheduleLoop(15000);
      return;
    }

    getTab().then(function(tab) {
      if (panelStale()) return;
      if (autoTaskAbort) { done(); return; }

      function proceedFetchKeyword() {
        if (panelStale()) return;
        setAutoTaskStatus('正在获取任务…');
        pushAutoTaskLogLine('正在获取任务…');
        sendCountdownToPage(true, '请求关键词…', 0);
        fetchKeywordTask()
      .then(function(result) {
        if (panelStale()) return;
        if (autoTaskAbort) { done(); return; }
        var keywords = result.keywords || [];
        var taskInfos = result.taskInfos || [];
        if (!keywords.length) {
          setAutoTaskStatus('暂无任务，15 秒后重试');
          pushAutoTaskLogLine('暂无任务，15 秒后重试');
          sendCountdownToPage(true, '请求关键词', 15);
          scheduleLoop(15000);
          return;
        }
        getTab().then(function(tab) {
        if (panelStale()) return;
        if (!tab || !tab.id) {
          setAutoTaskStatus('无法获取当前标签页');
          pushAutoTaskLogLine('无法获取当前标签页');
          sendCountdownToPage(true, '请求关键词', 5);
          scheduleLoop(5000);
          return;
        }
        var total = keywords.length;
        var index = 0;

        function doNext() {
          if (panelStale()) return;
          if (autoTaskAbort) { done(); return; }
          if (index >= total) {
            if (panelStale()) return;
            loop();
            return;
          }
          var keyword = resolveSearchKeyword(keywords[index], taskInfos, index);
          if (!keyword) {
            pushAutoTaskLogLine('第 ' + (index + 1) + ' 个关键词无效，跳过');
            index++;
            doNext();
            return;
          }
          var statusPrefix = '执行中 ' + (index + 1) + '/' + total + '：' + keyword;
          setAutoTaskStatus(statusPrefix);
          pushAutoTaskLogLine(statusPrefix);
          sendCountdownToPage(true, '执行中 ' + (index + 1) + '/' + total, 0);
          var kwInfo = taskInfos[index] || taskInfos[0] || { Keywords: keyword };
          chrome.storage.local.set({ currentKeywordTask: kwInfo }, function() {
            function onOpenSearchError() {
              var errMsg = (chrome.runtime.lastError && chrome.runtime.lastError.message) || '未知错误';
              var acc = accountList[selectedAccountIndex];
              var maxC = acc ? acc.maxCollectCount : 200;
              pushAutoTaskLogLine('打开搜索页失败：' + errMsg);
              var key = String(selectedAccountIndex);
              var today = getTodayDateStr();
              if (!accountCollectStats[key]) accountCollectStats[key] = {};
              accountCollectStats[key][today] = maxC;
              saveCollectStats();
              renderAccountList();
              if (panelStale()) return;
              loop();
            }
            function runInjectAndFollow() {
              if (panelStale()) return;
              if (autoTaskAbort) { done(); return; }
              function afterInject(execPkg) {
                try {
                  execPkg = execPkg || {};
                  if (execPkg.timedOut) {
                    pushAutoTaskLogLine('拟人搜索：注入超时（' + Math.round(HUMAN_SEARCH_INJECT_TIMEOUT_MS / 1000) + ' 秒），仍继续间隔与下一词');
                  } else if (execPkg.chromeError) {
                    pushAutoTaskLogLine('拟人搜索：' + execPkg.chromeError);
                  } else {
                    var execRes = execPkg.results;
                    if (!execRes || !execRes[0] || execRes[0].result !== true) {
                      pushAutoTaskLogLine('拟人搜索未成功：请确认搜索框已出现（当前 URL 未带关键词）');
                    }
                  }
                  refreshSearchResultTable();
                  var filterVal = publishTimeFilterEl ? (publishTimeFilterEl.value || '').trim() : '';
                  var thenWait = function() {
                    index++;
                    var ms = getRandomIntervalMs();
                    var waitText = '等待下一词 · ' + Math.ceil(ms / 1000) + ' 秒';
                    pushAutoTaskLogLine(waitText);
                    sendCountdownToPage(true, '请求关键词', Math.ceil(ms / 1000));
                    waitRandomWithCountdown(ms, panelTaskSession).then(doNext);
                  };
                  if (filterVal) {
                    setAutoTaskStatus(statusPrefix + ' · 应用筛选「' + filterVal + '」');
                    applyPublishTimeFilterAfterSearch(tab.id, filterVal).then(function() {
                      setTimeout(refreshSearchResultTable, 3000);
                      thenWait();
                    }).catch(function() {
                      thenWait();
                    });
                  } else {
                    thenWait();
                  }
                } catch (e) {
                  pushAutoTaskLogLine('拟人搜索后续异常：' + (e && e.message ? e.message : String(e)));
                  index++;
                  scheduleLoop(5000);
                }
              }
              executeScriptWithTimeout(tab.id, { world: 'MAIN', func: _runHumanSearchOnXhsPage, args: [keyword] }, HUMAN_SEARCH_INJECT_TIMEOUT_MS)
                .then(function(execPkg) {
                  try {
                    afterInject(execPkg);
                  } catch (e) {
                    pushAutoTaskLogLine('拟人搜索后续同步异常：' + (e && e.message ? e.message : String(e)));
                    index++;
                    scheduleLoop(5000);
                  }
                });
            }
            chrome.tabs.get(tab.id, function(fresh) {
              if (chrome.runtime.lastError || !fresh) {
                pushAutoTaskLogLine('无法读取当前标签页 URL，跳过本词');
                index++;
                doNext();
                return;
              }
              var plan = getSearchNavigatePlan(fresh.url || '');
              if (plan.needTabLoad) {
                chrome.tabs.update(tab.id, { url: plan.url }, function() {
                  if (chrome.runtime.lastError) {
                    onOpenSearchError();
                    return;
                  }
                  whenReadyForHumanSearch(tab, true, 2000, runInjectAndFollow);
                });
              } else {
                whenReadyForHumanSearch(tab, false, 900, runInjectAndFollow);
              }
            });
          });
        }
        doNext();
      });
    })
    .catch(function(err) {
    if (panelStale()) return;
    if (autoTaskAbort) { done(); return; }
    var msg = (err && err.message) ? err.message : String(err);
    if (msg === 'Failed to fetch') msg = '网络请求失败（请检查接口地址与网络）';
    var errText = '获取任务失败: ' + msg + '，15 秒后重试';
    setAutoTaskStatus(errText);
    pushAutoTaskLogLine(errText);
    sendCountdownToPage(true, '请求关键词', 15);
    console.warn('[DataCrawler] 获取任务异常', err);
    scheduleLoop(15000);
  });
      }

      if (!tab || !tab.id) {
        proceedFetchKeyword();
        return;
      }
      var tabUrlPanel = tab.url || '';
      if (/^chrome-error:\/\//i.test(tabUrlPanel)) {
        setAutoTaskStatus('当前为浏览器网络错误页，暂不获取关键词任务');
        pushAutoTaskLogLine('当前标签页为网络错误页（chrome-error），暂不获取关键词任务，15 秒后重试');
        sendCountdownToPage(true, '等待网络', 15);
        scheduleLoop(15000);
        return;
      }
      if (/captcha|website-login/i.test(tabUrlPanel)) {
        setAutoTaskStatus('当前标签页为安全验证/验证码页（URL），暂不获取关键词任务');
        pushAutoTaskLogLine('当前标签页 URL 含 captcha/website-login，暂不获取关键词任务，15 秒后重试');
        sendCountdownToPage(true, '等待验证', 15);
        scheduleLoop(15000);
        return;
      }
      if (!isXhsLikeHost(tab.url)) {
        proceedFetchKeyword();
        return;
      }
      runKeywordFetchPageChecks(tab.id, function() {
        return panelStale() || autoTaskAbort;
      }, function(verdict) {
        if (panelStale()) return;
        if (autoTaskAbort) { done(); return; }
        if (verdict === false) {
          proceedFetchKeyword();
          return;
        }
        if (verdict && verdict.block) {
          if (verdict.reason === 'login') {
            var autoLoginCb = document.getElementById('autoTaskAutoLoginEnabled');
            if (!autoLoginCb || !autoLoginCb.checked) {
              setAutoTaskStatus('检测到未登录，未勾选「需要时自动登录」，请手动登录后重试');
              pushAutoTaskLogLine('检测到未登录，未勾选「需要时自动登录」，暂不获取关键词任务，15 秒后重试');
              sendCountdownToPage(true, '等待登录', 15);
              scheduleLoop(15000);
              return;
            }
            setAutoTaskStatus('检测到未登录，正在自动登录（与侧栏「自动登录」相同）…');
            pushAutoTaskLogLine('检测到未登录，开始自动登录后再获取关键词任务…');
            chrome.runtime.sendMessage({ type: 'runNavigateThenAutoLogin', tabId: tab.id }, function(response) {
              if (chrome.runtime.lastError) {
                pushAutoTaskLogLine('自动登录失败：' + (chrome.runtime.lastError.message || ''));
                sendCountdownToPage(true, '等待登录', 15);
                scheduleLoop(15000);
                return;
              }
              if (panelStale()) return;
              if (autoTaskAbort) { done(); return; }
              if (response && response.throttled) {
                setAutoTaskStatus('检测到未登录，未满5分钟不重复打开登录页（剩约' + (response.remainSec || 0) + '秒）');
                pushAutoTaskLogLine('距上次登录处理未满5分钟，跳过刷新，继续尝试拉任务');
                proceedFetchKeyword();
                return;
              }
              if (response && response.ok) {
                pushAutoTaskLogLine('自动登录成功，继续获取关键词任务');
                proceedFetchKeyword();
              } else {
                pushAutoTaskLogLine('自动登录未完成，15 秒后重试');
                sendCountdownToPage(true, '等待登录', 15);
                scheduleLoop(15000);
              }
            });
            return;
          }
          if (verdict.reason === 'unreachable') {
            setAutoTaskStatus('检测到页面「无法访问此网站」，暂不获取关键词任务');
            pushAutoTaskLogLine('检测到页面「无法访问此网站」，暂不获取关键词任务，15 秒后重试');
          } else if (verdict.reason === 'reload') {
            setAutoTaskStatus('检测到页面含「重新加载」，暂不获取关键词任务');
            pushAutoTaskLogLine('检测到页面含「重新加载」，暂不获取关键词任务，15 秒后重试');
          } else if (verdict.reason === 'security_verify') {
            setAutoTaskStatus('当前为安全验证/验证码页，暂不获取关键词任务');
            pushAutoTaskLogLine('当前为安全验证或验证码页（标题/URL），暂不获取关键词任务，15 秒后重试');
          }
          sendCountdownToPage(true, verdict.reason === 'security_verify' ? '等待验证' : '等待网络', 15);
          scheduleLoop(15000);
          return;
        }
        proceedFetchKeyword();
      });
    });
  }

  loop();
}

// DOM 就绪后直接绑定「启动/关闭」按钮，确保侧栏中点击一定生效
function bindAutoTaskButtons() {
  var btnStart = document.getElementById('btnAutoTaskStart');
  var btnStop = document.getElementById('btnAutoTaskStop');
  var statusEl = document.getElementById('autoTaskStatus');
  var runInBg = document.getElementById('autoTaskRunInBackground');
  if (btnStart) {
    btnStart.onclick = function() {
      if (statusEl) statusEl.textContent = '启动中…';
      if (runInBg && runInBg.checked) {
        chrome.storage.local.set({ autoTaskRunning: true }, function() {
          chrome.runtime.sendMessage({ type: 'startAutoTask' }, function() {
            if (chrome.runtime.lastError) {
              if (statusEl) statusEl.textContent = '后台启动失败：' + (chrome.runtime.lastError.message || '');
              chrome.storage.local.set({ autoTaskRunning: false });
              autoTaskRunning = false;
              updateAutoTaskButtons();
              return;
            }
            autoTaskRunning = true;
            updateAutoTaskButtons();
            if (statusEl) statusEl.textContent = '已在后台启动（可关闭侧边栏）';
          });
        });
      } else {
        try {
          runAutoTaskLoop();
        } catch (err) {
          if (statusEl) statusEl.textContent = '启动失败：' + (err && err.message ? err.message : String(err));
          autoTaskRunning = false;
          updateAutoTaskButtons();
        }
      }
    };
  }
  if (btnStop) {
    btnStop.onclick = function() {
      autoTaskAbort = true;
      panelAutoTaskSessionGen++;
      clearPanelAutoTaskScheduledTimers();
      chrome.runtime.sendMessage({ type: 'stopAutoTask' });
      autoTaskRunning = false;
      chrome.storage.local.set({ autoTaskRunning: false });
      updateAutoTaskButtons();
      setAutoTaskStatus('已关闭');
    };
  }
}
if (typeof document.readyState !== 'undefined' && document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindAutoTaskButtons);
} else {
  setTimeout(bindAutoTaskButtons, 0);
}

// 搜索接口响应：多页合并展示，先第一页（页面内嵌）再第二页、第三页…表格不清空、向下追加
const searchResultText = document.getElementById('searchResultText');
const searchResultTableWrap = document.getElementById('searchResultTableWrap');
// 达人列表
const creatorListText = document.getElementById('creatorListText');
const creatorTableWrap = document.getElementById('creatorTableWrap');

// 侧边栏关闭/隐藏时清空大块 DOM 与文本；若未勾选「后台执行」则立即执行与「关闭自动任务」相同逻辑（用 DOM 状态，不依赖异步 storage 回调）
window.addEventListener('pagehide', function() {
  var runInBgEl = document.getElementById('autoTaskRunInBackground');
  if (!runInBgEl || !runInBgEl.checked) {
    autoTaskAbort = true;
    panelAutoTaskSessionGen++;
    clearPanelAutoTaskScheduledTimers();
    chrome.runtime.sendMessage({ type: 'stopAutoTask' });
    autoTaskRunning = false;
    chrome.storage.local.set({ autoTaskRunning: false, autoTaskStatus: '已关闭' });
  }
  if (searchResultTableWrap) searchResultTableWrap.innerHTML = '';
  if (searchResultText) searchResultText.value = '';
  if (creatorTableWrap) creatorTableWrap.innerHTML = '';
  if (creatorListText) creatorListText.value = '';
});

function getPublishTime(cornerTagInfo) {
  if (!Array.isArray(cornerTagInfo)) return '';
  const tag = cornerTagInfo.find(function(t) { return t.type === 'publish_time'; });
  return tag && tag.text ? tag.text : '';
}

function buildTableFromPages(pages) {
  if (!Array.isArray(pages) || !pages.length) return;
  var rows = [];
  pages.forEach(function(page, pageIdx) {
    var items = page.data && page.data.items;
    if (!Array.isArray(items)) return;
    var pageNum = page._pageNum != null ? page._pageNum : (pageIdx + 1);
    items.forEach(function(it) { rows.push({ item: it, pageNum: pageNum }); });
  });
  if (!rows.length) return;

  var html = [
    '<table class="search-table"><thead><tr>',
    '<th>页码</th>',
    '<th>序号</th>',
    '<th class="col-title">标题</th>',
    '<th class="col-author">作者</th>',
    '<th>点赞</th>',
    '<th>收藏</th>',
    '<th>评论</th>',
    '<th>分享</th>',
    '<th>发布时间</th>',
    '<th>链接</th>',
    '</tr></thead><tbody>'
  ];
  rows.forEach(function(row, i) {
    var it = row.item;
    var card = it.note_card || {};
    var user = card.user || {};
    var interact = card.interact_info || {};
    var title = (card.display_title || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    var author = (user.nick_name || user.nickname || '').replace(/</g, '&lt;');
    var base = it.id ? 'https://www.xiaohongshu.com/explore/' + it.id : '';
    var link = base;
    if (it.xsec_token) {
      link += '?xsec_token=' + encodeURIComponent(it.xsec_token) + '&xsec_source=pc_search&source=unknown';
    }
    html.push(
      '<tr>',
      '<td>' + row.pageNum + '</td>',
      '<td>' + (i + 1) + '</td>',
      '<td class="col-title" title="' + title + '">' + title + '</td>',
      '<td class="col-author" title="' + author + '">' + author + '</td>',
      '<td>' + (interact.liked_count || '0') + '</td>',
      '<td>' + (interact.collected_count || '0') + '</td>',
      '<td>' + (interact.comment_count || '0') + '</td>',
      '<td>' + (interact.shared_count || '0') + '</td>',
      '<td>' + getPublishTime(card.corner_tag_info) + '</td>',
      '<td>' + (link ? '<a href="' + link + '" target="_blank" rel="noopener">打开</a>' : '-') + '</td>',
      '</tr>'
    );
  });
  html.push('</tbody></table>');
  searchResultTableWrap.innerHTML = html.join('');
  searchResultTableWrap.style.display = 'block';
}

function showFromPages(pages) {
  if (!Array.isArray(pages) || !pages.length) {
    searchResultTableWrap.innerHTML = '';
    searchResultTableWrap.style.display = 'none';
    searchResultText.value = '';
    return;
  }
  buildTableFromPages(pages);
  searchResultText.value = JSON.stringify(pages, null, 2);
}

function showFromSingleResult(text) {
  searchResultText.value = text || '';
  if (!text) {
    searchResultTableWrap.innerHTML = '';
    searchResultTableWrap.style.display = 'none';
    return;
  }
  var data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    searchResultTableWrap.innerHTML = '';
    searchResultTableWrap.style.display = 'none';
    return;
  }
  if (data.data && Array.isArray(data.data.items)) showFromPages([data]);
}

/** 从 storage 拉取搜索笔记数据并刷新下方表格（两个按钮执行搜索时主动加载表格） */
function refreshSearchResultTable() {
  chrome.storage.local.get(['searchNotesPages', 'searchNotesResult'], function(obj) {
    if (Array.isArray(obj.searchNotesPages) && obj.searchNotesPages.length) {
      showFromPages(obj.searchNotesPages);
    } else {
      showFromSingleResult(obj.searchNotesResult);
    }
  });
}

// 从单页数据中取出达人列表（data.users / data.items 或 user_posted 的 data.notes）
function getCreatorListFromPage(page) {
  if (!page || !page.data) return [];
  var d = page.data;
  if (Array.isArray(d.users)) return d.users;
  if (Array.isArray(d.items)) return d.items;
  if (Array.isArray(d.notes)) return d.notes;
  return [];
}

function getCreatorNickname(user) {
  if (!user) return '';
  var u = user.user_info || user;
  return u.nick_name || u.nickname || user.nick_name || user.nickname || '';
}

function getCreatorDesc(user) {
  if (!user) return '';
  var u = user.user_info || user;
  return u.desc || user.desc || '';
}

function getCreatorFans(user) {
  if (!user) return '';
  var u = user.user_info || user;
  var n = u.fans_count != null ? u.fans_count : (user.fans_count != null ? user.fans_count : '');
  return n === '' ? '' : String(n);
}

function getCreatorUserId(user) {
  if (!user) return '';
  return user.user_id || user.id || (user.user_info && (user.user_info.user_id || user.user_info.id)) || '';
}

// 判断是否为 user_posted 返回的笔记项（有 note_id / display_title 且含 user）
function isCreatorNote(item) {
  return item && (item.note_id || (item.display_title !== undefined && item.user));
}

// 笔记点赞数
function getNoteLikedCount(note) {
  if (!note || !note.interact_info) return '';
  var c = note.interact_info.liked_count;
  return c === '' || c === undefined ? '' : String(c);
}

// 笔记链接
function getNoteLink(note) {
  var id = note.note_id || note.id;
  if (!id) return '';
  var base = 'https://www.xiaohongshu.com/explore/' + id;
  if (note.xsec_token) base += '?xsec_token=' + encodeURIComponent(note.xsec_token) + '&xsec_source=pc_search&source=unknown';
  return base;
}

// 达人头像 URL
function getCreatorAvatar(item) {
  var u = item && (item.user_info || item.user);
  if (!u) return '';
  return u.image || u.avatar || '';
}

function buildCreatorTable(pages) {
  if (!Array.isArray(pages) || !pages.length) return;
  var rows = [];
  pages.forEach(function(page, pageIdx) {
    var list = getCreatorListFromPage(page);
    var pageNum = page._pageNum != null ? page._pageNum : (pageIdx + 1);
    list.forEach(function(item) { rows.push({ item: item, pageNum: pageNum }); });
  });
  if (!rows.length) return;

  var first = rows[0].item;
  var isNoteMode = isCreatorNote(first);
  var tableClass = isNoteMode ? 'search-table creator-table creator-table-notes' : 'search-table creator-table';

  var html = ['<table class="' + tableClass + '"><thead><tr>'];
  html.push('<th>页码</th>', '<th>序号</th>', '<th class="col-avatar">头像</th>', '<th class="col-author">昵称</th>');
  if (isNoteMode) {
    html.push('<th class="col-title">笔记标题</th>', '<th>点赞</th>', '<th>笔记链接</th>');
  } else {
    html.push('<th class="col-desc">简介</th>', '<th>粉丝数</th>', '<th>链接</th>');
  }
  html.push('</tr></thead><tbody>');

  rows.forEach(function(row, i) {
    var it = row.item;
    var u = it.user_info || it.user || it;
    var nick = getCreatorNickname(it).replace(/</g, '&lt;').replace(/"/g, '&quot;');
    var userId = getCreatorUserId(it);
    var profileLink = userId ? 'https://www.xiaohongshu.com/user/profile/' + encodeURIComponent(userId) : '';
    var avatarUrl = getCreatorAvatar(it);

    html.push('<tr>', '<td>' + row.pageNum + '</td>', '<td>' + (i + 1) + '</td>');
    if (avatarUrl) {
      html.push('<td class="col-avatar"><img src="' + avatarUrl.replace(/"/g, '&quot;') + '" alt="" class="creator-avatar"></td>');
    } else {
      html.push('<td class="col-avatar">-</td>');
    }
    html.push('<td class="col-author" title="' + nick + '">' + nick + '</td>');

    if (isNoteMode) {
      var title = (it.display_title || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      var noteLink = getNoteLink(it);
      html.push(
        '<td class="col-title" title="' + title + '">' + title + '</td>',
        '<td>' + getNoteLikedCount(it) + '</td>',
        '<td>' + (noteLink ? '<a href="' + noteLink + '" target="_blank" rel="noopener">笔记</a>' : '-') + '</td>'
      );
    } else {
      var desc = getCreatorDesc(it).replace(/</g, '&lt;').replace(/"/g, '&quot;');
      html.push(
        '<td class="col-desc" title="' + desc + '">' + desc + '</td>',
        '<td>' + getCreatorFans(it) + '</td>',
        '<td>' + (profileLink ? '<a href="' + profileLink + '" target="_blank" rel="noopener">打开</a>' : '-') + '</td>'
      );
    }
    html.push('</tr>');
  });
  html.push('</tbody></table>');
  creatorTableWrap.innerHTML = html.join('');
  creatorTableWrap.style.display = 'block';
}

function showCreatorFromPages(pages) {
  if (!Array.isArray(pages) || !pages.length) {
    creatorTableWrap.innerHTML = '';
    creatorTableWrap.style.display = 'none';
    creatorListText.value = '';
    return;
  }
  buildCreatorTable(pages);
  creatorListText.value = JSON.stringify(pages, null, 2);
}

function showCreatorFromSingleResult(text) {
  creatorListText.value = text || '';
  if (!text) {
    creatorTableWrap.innerHTML = '';
    creatorTableWrap.style.display = 'none';
    return;
  }
  var data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    creatorTableWrap.innerHTML = '';
    creatorTableWrap.style.display = 'none';
    return;
  }
  var list = getCreatorListFromPage(data);
  if (list.length) showCreatorFromPages([data]);
}

document.getElementById('btnClearTable').addEventListener('click', function() {
  chrome.storage.local.remove(['searchNotesPages', 'searchNotesResult'], function() {
    searchResultTableWrap.innerHTML = '';
    searchResultTableWrap.style.display = 'none';
    searchResultText.value = '';
  });
});

document.getElementById('btnClearCreator').addEventListener('click', function() {
  chrome.storage.local.remove(['creatorListPages', 'creatorListResult'], function() {
    creatorTableWrap.innerHTML = '';
    creatorTableWrap.style.display = 'none';
    creatorListText.value = '';
  });
});

// 初始化：按当前标签页 URL 切换显示，再拉取 storage 渲染
getActiveTabUrl().then(function(url) {
  updateViewByUrl(url || '');
});

chrome.storage.local.get(['searchNotesPages', 'searchNotesResult', 'creatorListPages', 'creatorListResult'], function(obj) {
  if (Array.isArray(obj.searchNotesPages) && obj.searchNotesPages.length) {
    showFromPages(obj.searchNotesPages);
  } else {
    showFromSingleResult(obj.searchNotesResult);
  }
  if (Array.isArray(obj.creatorListPages) && obj.creatorListPages.length) {
    showCreatorFromPages(obj.creatorListPages);
  } else {
    showCreatorFromSingleResult(obj.creatorListResult);
  }
});

// 切换标签页或当前页导航时，根据新 URL 更新显示的表格类型
// ========== 账号管理：自动退出 & 自动登录 ==========

var accountStatusEl = document.getElementById('accountStatus');
var btnAutoLogout = document.getElementById('btnAutoLogout');
var btnAutoLogin = document.getElementById('btnAutoLogin');

function setAccountStatus(text, type) {
  if (!accountStatusEl) return;
  accountStatusEl.textContent = text || '';
  accountStatusEl.className = 'account-status' + (type ? ' ' + type : '');
}

// ---- 自动退出：清除小红书全部 Cookie 后刷新 ----
// 注入到页面：点击左侧"≡ 更多"按钮
function _xhsClickMore() {
  try {
    var nodes = document.evaluate(
      "//*[normalize-space(.)='更多' or normalize-space(text())='更多']",
      document, null, 7, null
    );
    for (var i = nodes.snapshotLength - 1; i >= 0; i--) {
      var el = nodes.snapshotItem(i);
      if (!el) continue;
      var rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      var x = rect.left + rect.width / 2;
      var y = rect.top + rect.height / 2;
      var opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      return true;
    }
  } catch (e) {}
  return false;
}

// 注入到页面：点击菜单中的"退出登录"
function _xhsClickLogout() {
  try {
    var nodes = document.evaluate(
      "//*[normalize-space(.)='退出登录' or normalize-space(text())='退出登录']",
      document, null, 7, null
    );
    for (var i = nodes.snapshotLength - 1; i >= 0; i--) {
      var el = nodes.snapshotItem(i);
      if (!el) continue;
      var rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      var x = rect.left + rect.width / 2;
      var y = rect.top + rect.height / 2;
      var opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      return true;
    }
  } catch (e) {}
  return false;
}

function clearXhsCookies(callback) {
  var domains = ['.xiaohongshu.com', 'www.xiaohongshu.com', '.rednote.com', 'www.rednote.com'];
  var total = 0;
  var pending = domains.length;
  domains.forEach(function(domain) {
    chrome.cookies.getAll({ domain: domain }, function(cookies) {
      if (!cookies || !cookies.length) {
        pending--;
        if (pending <= 0 && callback) callback(total);
        return;
      }
      var dp = cookies.length;
      cookies.forEach(function(cookie) {
        var protocol = cookie.secure ? 'https://' : 'http://';
        var removeUrl = protocol + cookie.domain.replace(/^\./, '') + cookie.path;
        chrome.cookies.remove({ url: removeUrl, name: cookie.name }, function() {
          total++;
          dp--;
          if (dp <= 0) {
            pending--;
            if (pending <= 0 && callback) callback(total);
          }
        });
      });
    });
  });
}

function doAutoLogout() {
  setAccountStatus('正在退出…', 'ing');
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    var tab = tabs[0];
    if (!tab || !tab.id) {
      setAccountStatus('无法获取当前标签页', 'err');
      return;
    }
    var tabId = tab.id;
    var tabUrl = (tab.url || '').toLowerCase();
    var isXhsTab = tabUrl.indexOf('xiaohongshu.com') !== -1 || tabUrl.indexOf('rednote.com') !== -1;
    var targetUrl = getAutoLoginPageUrl();

    function tryLogout() {
      // Step 1: 点击"≡ 更多"展开菜单
      setAccountStatus('点击「更多」菜单…', 'ing');
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        world: 'MAIN',
        func: _xhsClickMore,
        args: []
      }, function(results) {
        var found = results && results[0] && results[0].result;
        if (!found) {
          setAccountStatus('未找到「更多」按钮，请确认已登录', 'err');
          return;
        }
        // Step 2: 等菜单展开后点击"退出登录"
        setTimeout(function() {
          setAccountStatus('点击「退出登录」…', 'ing');
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            world: 'MAIN',
            func: _xhsClickLogout,
            args: []
          }, function(results2) {
            var clicked = results2 && results2[0] && results2[0].result;
            if (clicked) {
              setTimeout(function() {
                clearXhsCookies(function(n) {
                  setAccountStatus('退出成功，已清除 ' + n + ' 个 Cookie', 'ok');
                });
              }, 2000);
            } else {
              setAccountStatus('未找到「退出登录」选项', 'err');
            }
          });
        }, 800);
      });
    }

    if (isXhsTab) {
      tryLogout();
    } else {
      chrome.tabs.update(tabId, { url: targetUrl }, function() {
        setAccountStatus('等待页面加载…', 'ing');
        waitForTabComplete(tabId).then(function() {
          setTimeout(tryLogout, 1000);
        });
      });
    }
  });
}

// ---- 注入到页面的函数（自动登录各步骤） ----

function _xhsFillPhone(phone) {
  var selectors = [
    'input[placeholder*="手机号"]',
    'input[type="tel"]',
    'input[placeholder*="请输入手机号"]',
    'input[name="phone"]',
    'input[placeholder*="phone"]'
  ];
  for (var i = 0; i < selectors.length; i++) {
    var el = document.querySelector(selectors[i]);
    if (!el) continue;
    if (el.offsetParent == null && el.getBoundingClientRect().width <= 0) continue;
    el.focus();
    try {
      var desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (desc && desc.set) desc.set.call(el, phone);
      else el.value = phone;
    } catch (e) { el.value = phone; }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  return false;
}

function _xhsClickSendSms() {
  var keywords = ['获取验证码', '发送验证码'];
  for (var k = 0; k < keywords.length; k++) {
    try {
      var escaped = keywords[k].replace(/'/g, "''");
      var nodes = document.evaluate(
        "//*[normalize-space(.)='" + escaped + "' or normalize-space(text())='" + escaped + "']",
        document, null, 7, null
      );
      for (var i = nodes.snapshotLength - 1; i >= 0; i--) {
        var el = nodes.snapshotItem(i);
        if (!el) continue;
        var rect = el.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) continue;
        var x = rect.left + rect.width / 2;
        var y = rect.top + rect.height / 2;
        var opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
        return true;
      }
    } catch(e) {}
  }
  return false;
}

function _xhsFillSmsCode(code) {
  var inputs = Array.from(document.querySelectorAll('input'));
  for (var i = 0; i < inputs.length; i++) {
    var el = inputs[i];
    if (el.offsetParent == null && el.getBoundingClientRect().width <= 0) continue;
    var placeholder = (el.placeholder || '').toLowerCase();
    var maxLen = el.maxLength;
    var isCodeInput = placeholder.indexOf('验证码') !== -1 || placeholder.indexOf('code') !== -1 ||
      (maxLen >= 4 && maxLen <= 8 && el.type !== 'tel' && el.type !== 'email');
    if (!isCodeInput) continue;
    el.focus();
    try {
      var desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (desc && desc.set) desc.set.call(el, code);
      else el.value = code;
    } catch (e) { el.value = code; }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  return false;
}

function _xhsClickLogin() {
  var btns = Array.from(document.querySelectorAll('button, [role="button"]'));
  for (var i = 0; i < btns.length; i++) {
    var btn = btns[i];
    if (btn.offsetParent == null || btn.disabled) continue;
    var text = (btn.textContent || btn.innerText || '').trim();
    if (text === '登录' || text === '立即登录' || text === '登录/注册' || text === '验证登录' || text === '一键登录') {
      btn.click();
      return true;
    }
  }
  return false;
}

/** 自动登录成功后自动启动自动任务 */
function startAutoTaskAfterLogin() {
  if (autoTaskRunning) return;
  pushAutoTaskLogLine('登录成功，自动启动采集任务');
  runAutoTaskLoop();
}

/**
 * 自动切换到下一个可用账号并登录。
 * 流程：退出当前账号 → 等待10秒 → 切换单选 → 自动登录下一个账号
 */
function doAutoSwitchAccount(nextIndex, callback) {
  pushAutoTaskLogLine('账号 ' + (selectedAccountIndex + 1) + ' 今日采集已达上限，切换到账号 ' + (nextIndex + 1));
  setAutoTaskStatus('正在退出当前账号…');

  selectedAccountIndex = nextIndex;
  saveAccounts();
  renderAccountList();

  var acc = accountList[nextIndex];
  var phone = acc ? (acc.phone || '').trim() : '';
  var codeUrl = acc ? (acc.codeUrl || '').trim() : '';

  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    var tab = tabs[0];
    if (!tab || !tab.id) {
      pushAutoTaskLogLine('无法获取标签页，切换失败');
      if (callback) callback(false);
      return;
    }
    var tabId = tab.id;

    chrome.scripting.executeScript({
      target: { tabId: tabId }, world: 'MAIN', func: _xhsClickMore, args: []
    }, function() {
      setTimeout(function() {
        chrome.scripting.executeScript({
          target: { tabId: tabId }, world: 'MAIN', func: _xhsClickLogout, args: []
        }, function() {
          setTimeout(function() {
            clearXhsCookies(function(n) {
              pushAutoTaskLogLine('已退出，清除 ' + n + ' 个 Cookie');
            });

            setAutoTaskStatus('等待10秒后登录账号 ' + (nextIndex + 1) + '…');
            pushAutoTaskLogLine('等待10秒后登录账号 ' + (nextIndex + 1));

            var remain = 10;
            var switchCountdown = setInterval(function() {
              remain--;
              if (remain > 0) {
                setAutoTaskStatus('切换账号中… ' + remain + ' 秒后自动登录');
              } else {
                clearInterval(switchCountdown);
              }
            }, 1000);

            setTimeout(function() {
              clearInterval(switchCountdown);
              if (!phone || !codeUrl) {
                pushAutoTaskLogLine('账号 ' + (nextIndex + 1) + ' 缺少手机号或接码链接，跳过');
                if (callback) callback(false);
                return;
              }

              pushAutoTaskLogLine('开始自动登录账号 ' + (nextIndex + 1) + '：' + phone);
              setAutoTaskStatus('正在登录账号 ' + (nextIndex + 1) + '…');

              chrome.tabs.update(tabId, { url: getAutoLoginPageUrl() }, function() {
                waitForTabComplete(tabId).then(function() {
                  setTimeout(function() {
                    chrome.scripting.executeScript({
                      target: { tabId: tabId }, world: 'MAIN', func: _xhsFillPhone, args: [phone]
                    }, function(results) {
                      if (chrome.runtime.lastError || !results || !results[0] || !results[0].result) {
                        pushAutoTaskLogLine('未找到手机号输入框');
                        if (callback) callback(false);
                        return;
                      }
                      setTimeout(function() {
                        chrome.scripting.executeScript({
                          target: { tabId: tabId }, world: 'MAIN', func: _xhsClickSendSms, args: []
                        }, function(results) {
                          if (chrome.runtime.lastError || !results || !results[0] || !results[0].result) {
                            pushAutoTaskLogLine('未找到发送验证码按钮');
                            if (callback) callback(false);
                            return;
                          }
                          var maxPoll = 40;
                          var pollCount = 0;
                          function pollSmsCode() {
                            if (autoTaskAbort) { if (callback) callback(false); return; }
                            if (pollCount >= maxPoll) {
                              pushAutoTaskLogLine('接码超时');
                              if (callback) callback(false);
                              return;
                            }
                            pollCount++;
                            setAutoTaskStatus('等待接码中… (' + pollCount + '/' + maxPoll + ')');
                            fetch(codeUrl)
                              .then(function(res) { return res.text(); })
                              .then(function(text) {
                                var code = extractSmsCode(text || '');
                                if (!code) {
                                  setTimeout(pollSmsCode, 3000);
                                  return;
                                }
                                pushAutoTaskLogLine('收到验证码：' + code);
                                setAutoTaskStatus('填入验证码…');
                                chrome.scripting.executeScript({
                                  target: { tabId: tabId }, world: 'MAIN', func: _xhsFillSmsCode, args: [code]
                                }, function() {
                                  setTimeout(function() {
                                    setAutoTaskStatus('点击登录…');
                                    chrome.scripting.executeScript({
                                      target: { tabId: tabId }, world: 'MAIN', func: _xhsClickLogin, args: []
                                    }, function() {
                                      setTimeout(function() {
                                        pushAutoTaskLogLine('账号 ' + (nextIndex + 1) + ' 登录完成');
                                        setAutoTaskStatus('账号 ' + (nextIndex + 1) + ' 登录完成');
                                        if (callback) callback(true);
                                      }, 3000);
                                    });
                                  }, 800);
                                });
                              })
                              .catch(function() { setTimeout(pollSmsCode, 3000); });
                          }
                          setTimeout(pollSmsCode, 3000);
                        });
                      }, 600);
                    });
                  }, 5000);
                });
              });
            }, 10000);
          }, 2000);
        });
      }, 800);
    });
  });
}

// ---- 自动登录主流程（使用单选选中的账号） ----
function doAutoLogin() {
  if (autoTaskRunning) {
    autoTaskAbort = true;
    chrome.runtime.sendMessage({ type: 'stopAutoTask' });
    autoTaskRunning = false;
    chrome.storage.local.set({ autoTaskRunning: false });
    updateAutoTaskButtons();
    setAutoTaskStatus('已关闭（自动登录触发）');
  }
  var acc = getSelectedAccount();
  var phone = acc ? acc.phone : '';
  var codeUrl = acc ? acc.codeUrl : '';
  if (!acc || !phone) {
    setAccountStatus('请先添加账号并选中一个账号（单选）', 'err');
    return;
  }
  if (!codeUrl) {
    setAccountStatus('请先填写选中账号的接码链接', 'err');
    return;
  }
  var maxCollect = acc.maxCollectCount != null ? acc.maxCollectCount : 200;
  if (maxCollect === 0) {
    setAccountStatus('当前账号采集上限为 0，无需自动登录', 'ok');
    return;
  }

  var LAST_LOGIN_DISRUPTIVE_AT_KEY_PANEL = 'lastLoginDisruptiveAt';
  var LOGIN_DISRUPTIVE_COOLDOWN_MS_PANEL = 5 * 60 * 1000;
  chrome.storage.local.get([LAST_LOGIN_DISRUPTIVE_AT_KEY_PANEL], function(stCooldown) {
    var lastT = parseInt(stCooldown[LAST_LOGIN_DISRUPTIVE_AT_KEY_PANEL], 10) || 0;
    var nowT = Date.now();
    if (lastT > 0 && nowT - lastT < LOGIN_DISRUPTIVE_COOLDOWN_MS_PANEL) {
      var remainSecPanel = Math.ceil((LOGIN_DISRUPTIVE_COOLDOWN_MS_PANEL - (nowT - lastT)) / 1000);
      setAccountStatus('距上次打开登录页未满5分钟（约 ' + remainSecPanel + ' 秒后再试）', 'err');
      return;
    }
    var markP = {};
    markP[LAST_LOGIN_DISRUPTIVE_AT_KEY_PANEL] = nowT;
    chrome.storage.local.set(markP);
    setAccountStatus('正在导航到登录页…', 'ing');
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    var tab = tabs[0];
    if (!tab || !tab.id) {
      setAccountStatus('无法获取当前标签页', 'err');
      return;
    }
    var tabId = tab.id;
    var loginTargetUrl = getAutoLoginPageUrl();

    chrome.tabs.update(tabId, { url: loginTargetUrl }, function() {
      setAccountStatus('等待页面加载…', 'ing');
      waitForTabComplete(tabId).then(function() {
        setTimeout(function() {
          setAccountStatus('填入手机号…', 'ing');
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            world: 'MAIN',
            func: _xhsFillPhone,
            args: [phone]
          }, function(results) {
            if (chrome.runtime.lastError || !results || !results[0] || !results[0].result) {
              setAccountStatus('未找到手机号输入框，请确认页面为登录状态', 'err');
              return;
            }
            setTimeout(function() {
              setAccountStatus('点击发送验证码…', 'ing');
              chrome.scripting.executeScript({
                target: { tabId: tabId },
                world: 'MAIN',
                func: _xhsClickSendSms,
                args: []
              }, function(results) {
                if (chrome.runtime.lastError || !results || !results[0] || !results[0].result) {
                  setAccountStatus('未找到发送验证码按钮', 'err');
                  return;
                }
                var maxPoll = 40;
                var pollCount = 0;
                function pollSmsCode() {
                  if (pollCount >= maxPoll) {
                    setAccountStatus('接码超时（120 秒），请检查接码链接', 'err');
                    return;
                  }
                  pollCount++;
                  setAccountStatus('等待接码中… (' + pollCount + '/' + maxPoll + ')', 'ing');
                  fetch(codeUrl)
                    .then(function(res) { return res.text(); })
                    .then(function(text) {
                      var code = extractSmsCode(text || '');
                      var raw = (text || '').trim().slice(0, 300) || '（响应为空）';
                      showSmsCodeResult(raw + '\n' + (code ? ('验证码：' + code) : '未抽取到验证码'), false);
                      if (!code) {
                        setTimeout(pollSmsCode, 3000);
                        return;
                      }
                      setAccountStatus('收到验证码：' + code + '，正在填入…', 'ing');
                      chrome.scripting.executeScript({
                        target: { tabId: tabId },
                        world: 'MAIN',
                        func: _xhsFillSmsCode,
                        args: [code]
                      }, function(results) {
                        if (chrome.runtime.lastError || !results || !results[0] || !results[0].result) {
                          setAccountStatus('验证码填入失败，请手动填写', 'err');
                          return;
                        }
                        setTimeout(function() {
                          setAccountStatus('点击登录按钮…', 'ing');
                          chrome.scripting.executeScript({
                            target: { tabId: tabId },
                            world: 'MAIN',
                            func: _xhsClickLogin,
                            args: []
                          }, function(results) {
                            if (chrome.runtime.lastError) {
                              setAccountStatus('登录按钮点击失败', 'err');
                              return;
                            }
                            var clicked = results && results[0] && results[0].result;
                            if (clicked) {
                              setTimeout(function() {
                                setAccountStatus('登录操作完成', 'ok');
                                startAutoTaskAfterLogin();
                              }, 2500);
                            } else {
                              setAccountStatus('未找到登录按钮，可能已自动登录', 'ok');
                              setTimeout(startAutoTaskAfterLogin, 500);
                            }
                          });
                        }, 800);
                      });
                    })
                    .catch(function() { setTimeout(pollSmsCode, 3000); });
                }
                setTimeout(pollSmsCode, 3000);
              });
            }, 600);
          });
        }, 5000);
      });
    });
  });
  });
}

if (btnAutoLogout) btnAutoLogout.addEventListener('click', doAutoLogout);
if (btnAutoLogin) btnAutoLogin.addEventListener('click', doAutoLogin);

// ========== 以下为原有标签页监听 ==========

chrome.tabs.onActivated.addListener(function() {
  getActiveTabUrl().then(updateViewByUrl);
});
chrome.tabs.onUpdated.addListener(function(updatedTabId, changeInfo) {
  if (!changeInfo.url) return;
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (tabs[0] && tabs[0].id === updatedTabId) getActiveTabUrl().then(updateViewByUrl);
  });
});

chrome.storage.onChanged.addListener(function(changes, areaName) {
  if (areaName !== 'local') return;
  if (changes.autoTaskRunning !== undefined) {
    autoTaskRunning = changes.autoTaskRunning.newValue === true;
    updateAutoTaskButtons();
    if (autoTaskStatusEl && changes.autoTaskStatus && changes.autoTaskStatus.newValue != null) {
      autoTaskStatusEl.textContent = changes.autoTaskStatus.newValue;
    }
  }
  if (changes.autoTaskStatus && changes.autoTaskStatus.newValue != null) {
    var v = changes.autoTaskStatus.newValue;
    if (autoTaskStatusEl) autoTaskStatusEl.textContent = v;
    mirrorAutoTaskStatusToCountdownLine(v);
  }
  if (changes[KEYWORD_STORAGE_KEY] && Array.isArray(changes[KEYWORD_STORAGE_KEY].newValue)) {
    pluginSearchKeywords = changes[KEYWORD_STORAGE_KEY].newValue;
    renderKeywordList();
  }
  if (changes[SEARCH_SITE_BASE_STORAGE_KEY]) {
    searchSiteBaseUrl = normalizeSearchSiteBaseUrl(changes[SEARCH_SITE_BASE_STORAGE_KEY].newValue);
    var sbi = document.getElementById('searchSiteBaseInput');
    if (sbi) sbi.value = searchSiteBaseUrl;
  }
  if (changes[AUTO_LOGIN_PAGE_STORAGE_KEY]) {
    autoLoginPageUrl = normalizeAutoLoginPageUrl(changes[AUTO_LOGIN_PAGE_STORAGE_KEY].newValue);
    var ali = document.getElementById('autoLoginPageInput');
    if (ali) ali.value = autoLoginPageUrl;
  }
  if (changes[AUTO_TASK_AUTO_LOGIN_ENABLED_KEY]) {
    var nv = changes[AUTO_TASK_AUTO_LOGIN_ENABLED_KEY].newValue === true;
    if (autoTaskAutoLoginEnabledEl) autoTaskAutoLoginEnabledEl.checked = nv;
  }
  if (changes.autoTaskLogLine && changes.autoTaskLogLine.newValue) {
    var entry = changes.autoTaskLogLine.newValue;
    if (autoTaskCallbackLogEl && entry.text) {
      var time = new Date(entry.time).toLocaleTimeString('zh-CN', { hour12: false });
      var line = document.createElement('div');
      line.className = 'log-info';
      line.textContent = time + ' ' + entry.text;
      autoTaskCallbackLogEl.appendChild(line);
      while (autoTaskCallbackLogEl.children.length > CALLBACK_LOG_MAX) {
        autoTaskCallbackLogEl.removeChild(autoTaskCallbackLogEl.firstChild);
      }
      autoTaskCallbackLogEl.scrollTop = autoTaskCallbackLogEl.scrollHeight;
    }
  }
  if (changes.accountCollectStats && changes.accountCollectStats.newValue) {
    accountCollectStats = changes.accountCollectStats.newValue;
    renderAccountList();
  }
  if (changes.selectedAccountIndex && changes.selectedAccountIndex.newValue != null) {
    selectedAccountIndex = parseInt(changes.selectedAccountIndex.newValue, 10) || 0;
    renderAccountList();
  }
  if (changes.autoTaskCallbackStatus && changes.autoTaskCallbackStatus.newValue) {
    var v = changes.autoTaskCallbackStatus.newValue;
    var msg = v.message || (v.success ? '回传成功' : '回传失败');
    if (autoTaskStatusEl) {
      autoTaskStatusEl.textContent = v.success ? '✓ ' + msg : '✗ ' + msg;
    }
    if (autoTaskCallbackLogEl) {
      var time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      var line = document.createElement('div');
      line.className = v.success ? 'log-ok' : 'log-err';
      line.textContent = time + ' ' + (v.success ? '✓ ' : '✗ ') + msg;
      autoTaskCallbackLogEl.appendChild(line);
      while (autoTaskCallbackLogEl.children.length > CALLBACK_LOG_MAX) {
        autoTaskCallbackLogEl.removeChild(autoTaskCallbackLogEl.firstChild);
      }
      autoTaskCallbackLogEl.scrollTop = autoTaskCallbackLogEl.scrollHeight;
    }
  }
  if (changes.searchNotesPages && Array.isArray(changes.searchNotesPages.newValue)) {
    showFromPages(changes.searchNotesPages.newValue);
  } else if (changes.searchNotesResult) {
    showFromSingleResult(changes.searchNotesResult.newValue);
  }
  if (changes.creatorListPages && Array.isArray(changes.creatorListPages.newValue)) {
    showCreatorFromPages(changes.creatorListPages.newValue);
  } else if (changes.creatorListResult) {
    showCreatorFromSingleResult(changes.creatorListResult.newValue);
  }
});
