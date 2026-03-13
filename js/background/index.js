// 点击扩展图标时打开右侧侧边栏
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// 首次安装或升级时，若未配置 apiHost 则从 manifest 写入默认值
chrome.runtime.onInstalled.addListener(function() {
  var defaultHost = (chrome.runtime.getManifest().api_host_default || '').trim();
  if (!defaultHost) return;
  chrome.storage.local.get(['apiHost'], function(o) {
    if (!o.apiHost || (o.apiHost || '').trim() === '') {
      chrome.storage.local.set({ apiHost: defaultHost });
    }
  });
});

// 浏览器启动时：若缓存已勾选「后台执行」，则自动启动自动任务
chrome.runtime.onStartup.addListener(function() {
  chrome.storage.local.get(['autoTaskRunInBackground'], function(o) {
    if (o.autoTaskRunInBackground) {
      backgroundAutoTaskAbort = false;
      chrome.storage.local.set({ autoTaskRunning: true }, function() {
        runBackgroundAutoTaskLoop();
      });
    }
  });
});

// 回传请求由 background 发起，避免 content 页面环境下的混合内容/CORS 导致 Failed to fetch
var CALLBACK_TIMEOUT_MS = 60000;
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.type === 'startAutoTask') {
    if (backgroundAutoTaskRunning) {
      sendResponse({ ok: true });
      return true;
    }
    backgroundAutoTaskAbort = false;
    runBackgroundAutoTaskLoop();
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'stopAutoTask') {
    backgroundAutoTaskAbort = true;
    if (backgroundAutoTaskCountdownTimerId) {
      clearInterval(backgroundAutoTaskCountdownTimerId);
      backgroundAutoTaskCountdownTimerId = null;
    }
    if (backgroundAutoTaskWaitTimeoutId) {
      clearTimeout(backgroundAutoTaskWaitTimeoutId);
      backgroundAutoTaskWaitTimeoutId = null;
    }
    if (backgroundAutoTaskDoneCallback) {
      backgroundAutoTaskDoneCallback();
    }
    sendCountdownToPage(false);
    chrome.storage.local.set({ autoTaskRunning: false, autoTaskStatus: '已关闭' });
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type !== 'xhsCallbackFetch' || !msg.url || msg.body === undefined) {
    return false;
  }
  var controller = new AbortController();
  var timeoutId = setTimeout(function() { controller.abort(); }, CALLBACK_TIMEOUT_MS);
  fetch(msg.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'WeRead/8.2.6 WRBrand/other Dalvik/2.1.0 (Linux; U; Android 13; Pixel 6 Build/TP1A.221105.002)'
    },
    body: JSON.stringify(msg.body),
    signal: controller.signal
  }).then(function(res) { return res.json(); }).then(function(data) {
    clearTimeout(timeoutId);
    sendResponse({ ok: true, data: data });
  }).catch(function(err) {
    clearTimeout(timeoutId);
    var message = err.name === 'AbortError' ? '回传超时（' + (CALLBACK_TIMEOUT_MS / 1000) + ' 秒）' : (err && err.message || String(err));
    sendResponse({ ok: false, error: message });
  });
  return true;
});

// ---------- 后台自动任务（与 panel 逻辑一致，关闭侧边栏后继续运行） ----------
var backgroundAutoTaskAbort = false;
var backgroundAutoTaskRunning = false;
var backgroundAutoTaskWaitTimeoutId = null;
var backgroundAutoTaskCountdownTimerId = null;
var backgroundAutoTaskDoneCallback = null;
var SEARCH_BASE_URL = 'https://www.xiaohongshu.com/search_result';
var REDNOTE_SEARCH_BASE_URL = 'https://www.rednote.com/search_result';

function setAutoTaskStatusInStorage(text) {
  chrome.storage.local.set({ autoTaskStatus: text || '' });
}

function pushAutoTaskLogLine(text) {
  if (!text) return;
  chrome.storage.local.set({ autoTaskLogLine: { time: Date.now(), text: text } });
}

function sendCountdownToPage(show, text, seconds) {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (!tabs[0] || !tabs[0].id) return;
    try {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'dataCrawlerCountdown', show: show, text: text, seconds: seconds });
    } catch (e) {}
  });
}

function getApiHostFromStorage() {
  return new Promise(function(resolve) {
    var m = chrome.runtime.getManifest();
    var defaultHost = (m && m.api_host_default ? m.api_host_default : '').trim();
    chrome.storage.local.get(['apiHost'], function(o) {
      var h = (o.apiHost || '').trim() || defaultHost;
      resolve(h);
    });
  });
}

function isXhsLikeHost(url) {
  var u = (url || '').toLowerCase();
  return u.indexOf('xiaohongshu.com') !== -1 || u.indexOf('rednote.com') !== -1;
}

function getSearchBaseUrl(tabUrl) {
  return isXhsLikeHost(tabUrl) && (tabUrl || '').toLowerCase().indexOf('rednote.com') !== -1
    ? REDNOTE_SEARCH_BASE_URL
    : SEARCH_BASE_URL;
}

// 注入到页面执行的函数（与 panel 中定义一致）
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

function parseKeywordTaskResponse(data) {
  if (!data || typeof data !== 'object') return [];
  var keywords = [];
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
  var list = data.data && Array.isArray(data.data) ? data.data
    : data.data && Array.isArray(data.data.keywords) ? data.data.keywords
    : Array.isArray(data.keywords) ? data.keywords
    : Array.isArray(data.list) ? data.list
    : [];
  return list.map(function(k) {
    return typeof k === 'string' ? k.trim() : (k && k.keyword ? String(k.keyword).trim() : (k && k.name ? String(k.name).trim() : ''));
  }).filter(Boolean);
}

function getKeywordTaskInfos(data) {
  if (!data || typeof data !== 'object') return [];
  var result = data.result;
  if (result != null) {
    if (Array.isArray(result) && result.length) return result;
    if (typeof result === 'object' && (result.Keywords != null || result.keyword != null || result.name != null)) return [result];
  }
  return [];
}

var API_HOST_PLACEHOLDER = 'https://your-api.example/';
function fetchKeywordTaskInBackground() {
  return getApiHostFromStorage().then(function(apiHost) {
    var host = (apiHost || '').trim();
    if (!host || host === API_HOST_PLACEHOLDER || host.replace(/\/+$/, '') === API_HOST_PLACEHOLDER.replace(/\/+$/, '')) {
      return Promise.reject(new Error('请先在侧栏配置并保存「接口根地址」'));
    }
    var base = host.replace(/\/?$/, '/') + 'xhs_extension/get_keyword_task';
    var url = base + '?trace_id=20260303';
    return fetch(url, { method: 'GET' })
      .then(function(res) {
        if (!res.ok) return res.text().then(function(t) { throw new Error('HTTP ' + res.status + (t ? ' ' + t.slice(0, 80) : '')); });
        return res.json();
      })
      .then(function(data) {
        var keywords = parseKeywordTaskResponse(data);
        var taskInfos = getKeywordTaskInfos(data);
        return { keywords: keywords, taskInfos: taskInfos };
      });
  });
}

function getRandomIntervalMsFromStorage() {
  return new Promise(function(resolve) {
    chrome.storage.local.get(['autoTaskIntervalMin', 'autoTaskIntervalMax'], function(o) {
      var min = 5, max = 20;
      if (o.autoTaskIntervalMin != null) min = Math.max(1, parseInt(o.autoTaskIntervalMin, 10) || 5);
      if (o.autoTaskIntervalMax != null) max = Math.max(min, Math.min(120, parseInt(o.autoTaskIntervalMax, 10) || 20));
      resolve((min + Math.random() * (max - min + 1)) * 1000);
    });
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
              if (chrome.runtime.lastError) {}
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

function runBackgroundAutoTaskLoop() {
  backgroundAutoTaskRunning = true;
  function done() {
    backgroundAutoTaskDoneCallback = null;
    backgroundAutoTaskCountdownTimerId = null;
    backgroundAutoTaskWaitTimeoutId = null;
    backgroundAutoTaskRunning = false;
    pushAutoTaskLogLine('已关闭');
    sendCountdownToPage(false);
    chrome.storage.local.set({ autoTaskRunning: false, autoTaskStatus: '已关闭' });
    chrome.storage.local.remove('currentKeywordTask');
  }
  backgroundAutoTaskDoneCallback = done;

  function getTab() {
    return new Promise(function(resolve) {
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        resolve(tabs[0] || null);
      });
    });
  }

  function loop() {
    if (backgroundAutoTaskAbort) {
      done();
      return;
    }
    setAutoTaskStatusInStorage('正在获取任务…');
    pushAutoTaskLogLine('正在获取任务…');
    sendCountdownToPage(true, '请求关键词…', 0);
    fetchKeywordTaskInBackground()
      .then(function(result) {
        if (backgroundAutoTaskAbort) { done(); return; }
        var keywords = result.keywords || [];
        var taskInfos = result.taskInfos || [];
        if (!keywords.length) {
          setAutoTaskStatusInStorage('暂无任务，15 秒后重试');
          pushAutoTaskLogLine('暂无任务，15 秒后重试');
          sendCountdownToPage(true, '请求关键词', 15);
          setTimeout(loop, 15000);
          return;
        }
        getTab().then(function(tab) {
          if (!tab || !tab.id) {
            setAutoTaskStatusInStorage('无法获取当前标签页');
            pushAutoTaskLogLine('无法获取当前标签页');
            sendCountdownToPage(true, '请求关键词', 5);
            setTimeout(loop, 5000);
            return;
          }
          var tabUrl = (tab.url || '').toLowerCase();
          var isSearchPage = isXhsLikeHost(tabUrl) && tabUrl.indexOf('search_result') !== -1;
          var total = keywords.length;
          var index = 0;

          function injectAndNext() {
            if (backgroundAutoTaskAbort) { done(); return; }
            var keyword = keywords[index];
            var statusPrefix = '执行中 ' + (index + 1) + '/' + total + '：' + keyword;
            setAutoTaskStatusInStorage(statusPrefix);
            pushAutoTaskLogLine(statusPrefix);
            sendCountdownToPage(true, '执行中 ' + (index + 1) + '/' + total, 0);
            var kwInfo = taskInfos[index] || taskInfos[0] || { Keywords: keyword };
            chrome.storage.local.set({ currentKeywordTask: kwInfo }, function() {
              chrome.scripting.executeScript({
                target: { tabId: tab.id },
                world: 'MAIN',
                func: searchByInputInPage,
                args: [keyword]
              }, function(results) {
                if (backgroundAutoTaskAbort) { done(); return; }
                var ok = results && results[0] && results[0].result === true;
                if (!ok && index === 0) {
                  setAutoTaskStatusInStorage('未找到搜索框，请先打开小红书搜索页');
                  pushAutoTaskLogLine('未找到搜索框，请先打开小红书搜索页');
                  sendCountdownToPage(false);
                  done();
                  return;
                }
                chrome.storage.local.get(['publishTimeFilter'], function(o) {
                  var filterVal = (o.publishTimeFilter || '').trim();
                  var thenWait = function() {
                    index++;
                    getRandomIntervalMsFromStorage().then(function(ms) {
                      if (backgroundAutoTaskAbort) { done(); return; }
                      var sec = Math.ceil(ms / 1000);
                      var waitText = '等待下一词 · ' + sec + ' 秒';
                      setAutoTaskStatusInStorage(waitText);
                      pushAutoTaskLogLine(waitText);
                      sendCountdownToPage(true, '请求关键词', sec);
                      var remainSec = sec;
                      backgroundAutoTaskCountdownTimerId = setInterval(function() {
                        if (backgroundAutoTaskAbort) {
                          if (backgroundAutoTaskCountdownTimerId) clearInterval(backgroundAutoTaskCountdownTimerId);
                          backgroundAutoTaskCountdownTimerId = null;
                          return;
                        }
                        remainSec--;
                        if (remainSec <= 0) {
                          if (backgroundAutoTaskCountdownTimerId) clearInterval(backgroundAutoTaskCountdownTimerId);
                          backgroundAutoTaskCountdownTimerId = null;
                          return;
                        }
                        setAutoTaskStatusInStorage('等待下一词 · ' + remainSec + ' 秒');
                        sendCountdownToPage(true, '请求关键词', remainSec);
                      }, 1000);
                      backgroundAutoTaskWaitTimeoutId = setTimeout(function() {
                        backgroundAutoTaskWaitTimeoutId = null;
                        if (backgroundAutoTaskCountdownTimerId) {
                          clearInterval(backgroundAutoTaskCountdownTimerId);
                          backgroundAutoTaskCountdownTimerId = null;
                        }
                        doNext();
                      }, ms);
                    });
                  };
                  if (filterVal) {
                    setAutoTaskStatusInStorage(statusPrefix + ' · 应用筛选「' + filterVal + '」');
                    applyPublishTimeFilterAfterSearch(tab.id, filterVal).then(function() {
                      thenWait();
                    }).catch(function() {
                      thenWait();
                    });
                  } else {
                    thenWait();
                  }
                });
              });
            });
          }

          function doNext() {
            if (backgroundAutoTaskAbort) { done(); return; }
            if (index >= total) {
              loop();
              return;
            }
            var keyword = keywords[index];
            var doNextPrefix = '执行中 ' + (index + 1) + '/' + total + '：' + keyword;
            setAutoTaskStatusInStorage(doNextPrefix);
            pushAutoTaskLogLine(doNextPrefix);
            sendCountdownToPage(true, '执行中 ' + (index + 1) + '/' + total, 0);
            if (index === 0 && !isSearchPage) {
              chrome.tabs.update(tab.id, { url: getSearchBaseUrl(tabUrl) }, function() {
                waitForTabComplete(tab.id).then(function() {
                  if (backgroundAutoTaskAbort) { done(); return; }
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
        if (backgroundAutoTaskAbort) { done(); return; }
        var msg = (err && err.message) ? err.message : String(err);
        if (msg === 'Failed to fetch') msg = '网络请求失败（请检查接口地址与网络）';
        var errText = '获取任务失败: ' + msg + '，15 秒后重试';
        setAutoTaskStatusInStorage(errText);
        pushAutoTaskLogLine(errText);
        sendCountdownToPage(true, '请求关键词', 15);
        setTimeout(loop, 15000);
      });
  }

  loop();
}
