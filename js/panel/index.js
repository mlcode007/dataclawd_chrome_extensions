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
var SEARCH_BASE_URL = 'https://www.xiaohongshu.com/search_result';
var REDNOTE_SEARCH_BASE_URL = 'https://www.rednote.com/search_result';
var EXECUTE_WAIT_MS = 5000;

/** 是否为小红书/红书域名（xiaohongshu.com 或 rednote.com） */
function isXhsLikeHost(url) {
  var u = (url || '').toLowerCase();
  return u.indexOf('xiaohongshu.com') !== -1 || u.indexOf('rednote.com') !== -1;
}

/** 根据当前标签页 URL 返回对应站点的搜索页地址 */
function getSearchBaseUrl(tabUrl) {
  return isXhsLikeHost(tabUrl) && (tabUrl || '').toLowerCase().indexOf('rednote.com') !== -1
    ? REDNOTE_SEARCH_BASE_URL
    : SEARCH_BASE_URL;
} // 两次请求间隔（毫秒），并在插件中倒计时显示
var executeCountdownTimer = null; // 倒计时定时器，便于清理

// 接口根地址：可配置并持久化到 chrome.storage.local，默认值来自 manifest 的 api_host_default
var API_HOST_STORAGE_KEY = 'apiHost';
var apiHost = '';

function getApiHostDefault() {
  var m = chrome.runtime.getManifest();
  return (m && m.api_host_default ? m.api_host_default : '').trim();
}

function getApiHost() {
  var h = (apiHost || '').trim();
  return h || getApiHostDefault();
}

function loadApiHost() {
  chrome.storage.local.get([API_HOST_STORAGE_KEY], function(o) {
    var v = (o[API_HOST_STORAGE_KEY] || '').trim();
    apiHost = v || getApiHostDefault();
    var input = document.getElementById('apiHostInput');
    if (input) input.value = apiHost;
  });
}

function saveApiHost() {
  var input = document.getElementById('apiHostInput');
  if (!input) return;
  var v = (input.value || '').trim() || getApiHostDefault();
  apiHost = v;
  chrome.storage.local.set({ apiHost: v });
}

// 接口任务自动执行（与 Python 一致：用 maa_router/pop 获取完整任务对象，供回传 kwInfo）
var REDIS_KEY_KEYWORD_TASKS = 'Interest:KeywordTasks:2:551';
var autoTaskRunning = false;
var autoTaskAbort = false;
var autoTaskCountdownTimer = null;

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

// 在页面内通过输入框执行搜索（避免直接改 URL 被风控）
function searchByInputInPage(keyword) {
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
      desc.set.call(input, keyword);
    } else {
      input.value = keyword;
    }
  } catch (e) {
    input.value = keyword;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  return true;
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
    var tabUrl = (tab.url || '').toLowerCase();
    var isSearchPage = isXhsLikeHost(tabUrl) && tabUrl.indexOf('search_result') !== -1;

    function doNext(index) {
      if (index >= pluginSearchKeywords.length) {
        setExecuteStatus('全部执行完成');
        return;
      }
      var keyword = pluginSearchKeywords[index];
      setExecuteStatus('执行中 ' + (index + 1) + '/' + pluginSearchKeywords.length + '：' + keyword);

      function injectAndNext() {
        var statusPrefix = '执行中 ' + (index + 1) + '/' + pluginSearchKeywords.length + '：' + keyword;
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: searchByInputInPage,
          args: [keyword]
        }, function(results) {
          var ok = results && results[0] && results[0].result === true;
          if (!ok && index === 0) {
            setExecuteStatus('未找到搜索框，请先打开小红书搜索页');
            return;
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

      if (index === 0 && !isSearchPage) {
        chrome.tabs.update(tab.id, { url: getSearchBaseUrl(tabUrl) }, function() {
          waitForTabComplete(tab.id).then(function() {
            setTimeout(function() { injectAndNext(); }, 800);
          });
        });
      } else {
        injectAndNext();
      }
    }

    doNext(0);
  });
}

if (btnExecuteSearch) btnExecuteSearch.addEventListener('click', runExecuteSearch);

// ---------- 接口任务自动执行 ----------
var autoTaskStatusEl = document.getElementById('autoTaskStatus');
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

loadAutoTaskInterval();
if (autoTaskIntervalMin) autoTaskIntervalMin.addEventListener('change', saveAutoTaskInterval);
if (autoTaskIntervalMax) autoTaskIntervalMax.addEventListener('change', saveAutoTaskInterval);

loadApiHost();
var btnSaveApiHost = document.getElementById('btnSaveApiHost');
if (btnSaveApiHost) btnSaveApiHost.addEventListener('click', function() { saveApiHost(); });

function setAutoTaskStatus(text) {
  if (autoTaskStatusEl) autoTaskStatusEl.textContent = text || '';
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

function fetchKeywordTask() {
  var url = getTaskApiUrl();
  console.log('[DataCrawler] 获取任务请求:', url);
  return fetch(url, { method: 'GET' })
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
      throw err;
    });
}

function getRandomIntervalMs() {
  var min = 5, max = 20;
  if (autoTaskIntervalMin && autoTaskIntervalMin.value !== '') min = Math.max(1, parseInt(autoTaskIntervalMin.value, 10) || 5);
  if (autoTaskIntervalMax && autoTaskIntervalMax.value !== '') max = Math.max(min, Math.min(120, parseInt(autoTaskIntervalMax.value, 10) || 20));
  return (min + Math.random() * (max - min + 1)) * 1000;
}

function waitRandomWithCountdown(ms) {
  return new Promise(function(resolve) {
    var remainSec = Math.ceil(ms / 1000);
    function tick() {
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
    function doInject() {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: searchByInputInPage,
        args: [keyword]
      }, function(results) {
        resolve(results && results[0] && results[0].result === true);
      });
    }
    if (needNavigate) {
      chrome.tabs.update(tab.id, { url: getSearchBaseUrl(tab.url || '') }, function() {
        waitForTabComplete(tab.id).then(function() { setTimeout(doInject, 800); });
      });
    } else {
      doInject();
    }
  });
}

function updateAutoTaskButtons() {
  if (btnAutoTaskStart) btnAutoTaskStart.disabled = autoTaskRunning;
  if (btnAutoTaskStop) btnAutoTaskStop.disabled = !autoTaskRunning;
  // 不禁用「按顺序执行搜索」，启动自动任务后仍可手动按顺序执行
}

function runAutoTaskLoop() {
  if (autoTaskRunning) return;
  autoTaskRunning = true;
  autoTaskAbort = false;
  updateAutoTaskButtons();

  function done() {
    autoTaskRunning = false;
    if (autoTaskCountdownTimer) {
      clearInterval(autoTaskCountdownTimer);
      autoTaskCountdownTimer = null;
    }
    chrome.storage.local.remove('currentKeywordTask');
    updateAutoTaskButtons();
    setAutoTaskStatus('已关闭');
  }

  function getTab() {
    return new Promise(function(resolve) {
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        resolve(tabs[0] || null);
      });
    });
  }

  function loop() {
    if (autoTaskAbort) { done(); return; }
    setAutoTaskStatus('正在获取任务…');
    fetchKeywordTask()
      .then(function(result) {
        if (autoTaskAbort) { done(); return; }
        var keywords = result.keywords || [];
        var taskInfos = result.taskInfos || [];
        if (!keywords.length) {
          setAutoTaskStatus('暂无任务，15 秒后重试');
          setTimeout(loop, 15000);
          return;
        }
        getTab().then(function(tab) {
        if (!tab || !tab.id) {
          setAutoTaskStatus('无法获取当前标签页');
          setTimeout(loop, 5000);
          return;
        }
        var tabUrl = (tab.url || '').toLowerCase();
        var isSearchPage = isXhsLikeHost(tabUrl) && tabUrl.indexOf('search_result') !== -1;
        var total = keywords.length;
        var index = 0;

        function injectAndNext() {
          var keyword = keywords[index];
          var statusPrefix = '执行中 ' + (index + 1) + '/' + total + '：' + keyword;
          setAutoTaskStatus(statusPrefix);
          var kwInfo = taskInfos[index] || taskInfos[0] || { Keywords: keyword };
          chrome.storage.local.set({ currentKeywordTask: kwInfo }, function() {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: searchByInputInPage,
            args: [keyword]
          }, function(results) {
            if (autoTaskAbort) { done(); return; }
            var ok = results && results[0] && results[0].result === true;
            if (!ok && index === 0) {
              setAutoTaskStatus('未找到搜索框，请先打开小红书搜索页');
              done();
              return;
            }
            refreshSearchResultTable();
            var filterVal = publishTimeFilterEl ? (publishTimeFilterEl.value || '').trim() : '';
            var thenWait = function() {
              index++;
              waitRandomWithCountdown(getRandomIntervalMs()).then(doNext);
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
          });
          });
        }

        function doNext() {
          if (autoTaskAbort) { done(); return; }
          if (index >= total) {
            loop();
            return;
          }
          var keyword = keywords[index];
          setAutoTaskStatus('执行中 ' + (index + 1) + '/' + total + '：' + keyword);
          if (index === 0 && !isSearchPage) {
            chrome.tabs.update(tab.id, { url: getSearchBaseUrl(tabUrl) }, function() {
              waitForTabComplete(tab.id).then(function() {
                if (autoTaskAbort) { done(); return; }
                setTimeout(injectAndNext, 800);
              });
            });
          } else {
            injectAndNext();
          }
        }
        doNext();
      });
    })
  .catch(function(err) {
    if (autoTaskAbort) { done(); return; }
    var msg = (err && err.message) ? err.message : String(err);
    setAutoTaskStatus('获取任务失败: ' + msg + '，15 秒后重试');
    console.warn('[DataCrawler] 获取任务异常', err);
    setTimeout(loop, 15000);
  });
  }

  loop();
}

// DOM 就绪后直接绑定「启动/关闭」按钮，确保侧栏中点击一定生效
function bindAutoTaskButtons() {
  var btnStart = document.getElementById('btnAutoTaskStart');
  var btnStop = document.getElementById('btnAutoTaskStop');
  var statusEl = document.getElementById('autoTaskStatus');
  if (btnStart) {
    btnStart.onclick = function() {
      if (statusEl) statusEl.textContent = '启动中…';
      try {
        runAutoTaskLoop();
      } catch (err) {
        if (statusEl) statusEl.textContent = '启动失败：' + (err && err.message ? err.message : String(err));
        autoTaskRunning = false;
        updateAutoTaskButtons();
      }
    };
  }
  if (btnStop) {
    btnStop.onclick = function() {
      autoTaskAbort = true;
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

// 侧边栏关闭/隐藏时清空大块 DOM 与文本，释放引用便于 GC 回收内存
window.addEventListener('pagehide', function() {
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
  if (changes[KEYWORD_STORAGE_KEY] && Array.isArray(changes[KEYWORD_STORAGE_KEY].newValue)) {
    pluginSearchKeywords = changes[KEYWORD_STORAGE_KEY].newValue;
    renderKeywordList();
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
