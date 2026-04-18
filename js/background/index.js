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
  if (msg.type === 'loginDialogDetected') {
    handleLoginDialogDetected(sender);
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
var SEARCH_SITE_BASE_STORAGE_KEY = 'searchSiteBaseUrl';
var SEARCH_SITE_BASE_DEFAULT = 'https://www.xiaohongshu.com/search_result?source=web_search_result_notes';

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

function normalizeSearchSiteBaseUrl(raw) {
  var d = SEARCH_SITE_BASE_DEFAULT;
  var s = (raw || '').trim();
  if (!s) return d;
  s = s.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) return d;
  if (s.indexOf('search_result') !== -1) return s;
  return s + '/search_result?source=web_search_result_notes';
}

function buildSearchResultUrlAsync(keyword, callback) {
  chrome.storage.local.get([SEARCH_SITE_BASE_STORAGE_KEY], function(o) {
    var base = normalizeSearchSiteBaseUrl(o[SEARCH_SITE_BASE_STORAGE_KEY]);
    var kw = keyword == null ? '' : String(keyword).trim();
    var url = !kw ? base : base + (base.indexOf('?') >= 0 ? '&' : '?') + 'keyword=' + encodeURIComponent(kw);
    callback(url);
  });
}

function getSearchSiteOriginFromStorage(callback) {
  chrome.storage.local.get([SEARCH_SITE_BASE_STORAGE_KEY], function(o) {
    var base = normalizeSearchSiteBaseUrl(o[SEARCH_SITE_BASE_STORAGE_KEY]);
    try {
      callback(new URL(base).origin);
    } catch (e) {
      callback('https://www.xiaohongshu.com');
    }
  });
}

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
}

// 注入到页面执行的函数（与 panel 中定义一致，备用）
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

// 注入到页面：滚动到底部触发下一页懒加载
function scrollToLoadMore() {
  var h = document.documentElement.scrollHeight || document.body.scrollHeight;
  window.scrollTo(0, h);
  return true;
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

// 搜索/筛选完成后，检查第二页数据是否已拦截；未拦截则滚动触发加载，已拦截则跳过
function scrollAndWaitForPage2(tabId, callback) {
  if (backgroundAutoTaskAbort) { callback(); return; }
  // 先等待第一页渲染，同时第二页可能已经自动触发
  setTimeout(function() {
    if (backgroundAutoTaskAbort) { callback(); return; }
    chrome.storage.local.get('searchNotesPages', function(res) {
      var pages = res.searchNotesPages || [];
      if (pages.length >= 2) {
        pushAutoTaskLogLine('第二页已自动加载（共' + pages.length + '页），跳过滚动');
        callback();
        return;
      }
      pushAutoTaskLogLine('滚动加载第二页…');
      setAutoTaskStatusInStorage('滚动加载第二页…');
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        world: 'MAIN',
        func: scrollToLoadMore,
        args: []
      }, function() {
        if (chrome.runtime.lastError) { callback(); return; }
        setTimeout(function() {
          if (backgroundAutoTaskAbort) { callback(); return; }
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            world: 'MAIN',
            func: scrollToLoadMore,
            args: []
          }, function() {
            if (chrome.runtime.lastError) { callback(); return; }
            setTimeout(callback, 3000);
          });
        }, 2000);
      });
    });
  }, 2000);
}

function getTodayDateStr() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function getAccountTodayCollectCountBg(stats, accIndex) {
  var key = String(accIndex);
  var today = getTodayDateStr();
  if (!stats[key]) return 0;
  return stats[key][today] || 0;
}

function extractSmsCode(text) {
  if (!text) return '';
  var m = String(text).match(/code\s+is[:\s]*(\d{4,8})/i);
  return m ? m[1] : '';
}

var _autoLoginInProgress = false;
var _wasAutoTaskRunning = false;

function _checkPageHasLoginDialog() {
  var selectors = [
    'input[placeholder*="手机号"]',
    'input[type="tel"]',
    'input[placeholder*="请输入手机号"]',
    'input[name="phone"]',
    'input[placeholder*="phone"]'
  ];
  for (var i = 0; i < selectors.length; i++) {
    var el = document.querySelector(selectors[i]);
    if (el && el.offsetParent !== null) return true;
  }
  return false;
}

function _stopAutoTaskForLogin() {
  _wasAutoTaskRunning = true;
  backgroundAutoTaskAbort = true;
  if (backgroundAutoTaskCountdownTimerId) {
    clearInterval(backgroundAutoTaskCountdownTimerId);
    backgroundAutoTaskCountdownTimerId = null;
  }
  if (backgroundAutoTaskWaitTimeoutId) {
    clearTimeout(backgroundAutoTaskWaitTimeoutId);
    backgroundAutoTaskWaitTimeoutId = null;
  }
  sendCountdownToPage(false);
  chrome.storage.local.set({ autoTaskRunning: false, autoTaskStatus: '检测到登录弹窗，暂停采集任务' });
}

function _restartAutoTask() {
  pushAutoTaskLogLine('自动恢复采集任务');
  _wasAutoTaskRunning = false;
  backgroundAutoTaskAbort = false;
  runBackgroundAutoTaskLoop();
}

function _doAutoLoginOnTab(tabId, acc, accIdx, onDone) {
  pushAutoTaskLogLine('开始自动登录账号 ' + (accIdx + 1) + '：' + acc.phone);
  setAutoTaskStatusInStorage('正在自动登录…');

  chrome.scripting.executeScript({
    target: { tabId: tabId }, world: 'MAIN', func: _xhsFillPhone, args: [acc.phone]
  }, function(results) {
    if (chrome.runtime.lastError || !results || !results[0] || !results[0].result) {
      pushAutoTaskLogLine('自动登录：未找到手机号输入框（可能已登录）');
      onDone(false);
      return;
    }
    setTimeout(function() {
      chrome.scripting.executeScript({
        target: { tabId: tabId }, world: 'MAIN', func: _xhsClickSendSms, args: []
      }, function(results) {
        if (chrome.runtime.lastError || !results || !results[0] || !results[0].result) {
          pushAutoTaskLogLine('自动登录：未找到发送验证码按钮');
          onDone(false);
          return;
        }
        var maxPoll = 40;
        var pollCount = 0;
        function pollSmsCode() {
          if (pollCount >= maxPoll) {
            pushAutoTaskLogLine('自动登录：接码超时');
            onDone(false);
            return;
          }
          pollCount++;
          setAutoTaskStatusInStorage('自动登录：等待接码… (' + pollCount + '/' + maxPoll + ')');
          fetch(acc.codeUrl)
            .then(function(res) { return res.text(); })
            .then(function(text) {
              var code = extractSmsCode(text || '');
              if (!code) {
                setTimeout(pollSmsCode, 3000);
                return;
              }
              pushAutoTaskLogLine('自动登录：收到验证码 ' + code);
              chrome.scripting.executeScript({
                target: { tabId: tabId }, world: 'MAIN', func: _xhsFillSmsCode, args: [code]
              }, function() {
                setTimeout(function() {
                  chrome.scripting.executeScript({
                    target: { tabId: tabId }, world: 'MAIN', func: _xhsClickLogin, args: []
                  }, function() {
                    setTimeout(function() {
                      pushAutoTaskLogLine('自动登录：账号 ' + (accIdx + 1) + ' 登录完成');
                      setAutoTaskStatusInStorage('自动登录完成');
                      onDone(true);
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
}

function handleLoginDialogDetected(sender) {
  if (_autoLoginInProgress) return;
  var tabId = sender && sender.tab && sender.tab.id;
  if (!tabId) return;

  chrome.storage.local.get(['accountList', 'selectedAccountIndex', 'autoLoginOnDialog', 'autoTaskRunning'], function(o) {
    if (o.autoLoginOnDialog === false) return;
    var accs = (o.accountList || []).map(function(item) {
      return { phone: (item.phone || '').trim(), codeUrl: (item.codeUrl || '').trim(), maxCollectCount: item.maxCollectCount != null ? parseInt(item.maxCollectCount, 10) : 200 };
    });
    var accIdx = parseInt(o.selectedAccountIndex, 10) || 0;
    if (accIdx < 0 || accIdx >= accs.length) return;
    var acc = accs[accIdx];
    if (!acc.phone || !acc.codeUrl) {
      pushAutoTaskLogLine('检测到登录弹窗，但账号 ' + (accIdx + 1) + ' 缺少手机号或接码链接');
      return;
    }

    _autoLoginInProgress = true;
    var taskWasRunning = o.autoTaskRunning || backgroundAutoTaskRunning;
    pushAutoTaskLogLine('检测到登录弹窗，刷新页面确认登录状态…');

    if (taskWasRunning) {
      _stopAutoTaskForLogin();
    }

    chrome.tabs.reload(tabId, {}, function() {
      waitForTabComplete(tabId).then(function() {
        setTimeout(function() {
          chrome.scripting.executeScript({
            target: { tabId: tabId }, world: 'MAIN', func: _checkPageHasLoginDialog, args: []
          }, function(results) {
            var stillNeedLogin = results && results[0] && results[0].result;

            if (!stillNeedLogin) {
              pushAutoTaskLogLine('刷新后登录框消失，判断为已登录，无需重新登录');
              _autoLoginInProgress = false;
              if (taskWasRunning) _restartAutoTask();
              return;
            }

            pushAutoTaskLogLine('刷新后仍需登录，执行自动登录账号 ' + (accIdx + 1));
            _doAutoLoginOnTab(tabId, acc, accIdx, function(success) {
              _autoLoginInProgress = false;
              if (success) {
                pushAutoTaskLogLine('登录成功，自动启动采集任务');
                if (!backgroundAutoTaskRunning) {
                  backgroundAutoTaskAbort = false;
                  runBackgroundAutoTaskLoop();
                }
              } else {
                pushAutoTaskLogLine('自动登录未完成，刷新页面检查登录状态…');
                chrome.tabs.reload(tabId, {}, function() {
                  waitForTabComplete(tabId).then(function() {
                    setTimeout(function() {
                      chrome.scripting.executeScript({
                        target: { tabId: tabId }, world: 'MAIN', func: _checkPageHasLoginDialog, args: []
                      }, function(r2) {
                        var needLogin2 = r2 && r2[0] && r2[0].result;
                        if (!needLogin2) {
                          pushAutoTaskLogLine('刷新后确认已登录，自动启动采集任务');
                          if (!backgroundAutoTaskRunning) {
                            backgroundAutoTaskAbort = false;
                            runBackgroundAutoTaskLoop();
                          }
                        } else {
                          pushAutoTaskLogLine('仍未登录，等待下次登录弹窗检测');
                          if (taskWasRunning) {
                            pushAutoTaskLogLine('15秒后重试自动登录');
                            setTimeout(function() { _restartAutoTask(); }, 15000);
                          }
                        }
                      });
                    }, 3000);
                  });
                });
              }
            });
          });
        }, 3000);
      });
    });
  });
}

function isAccountExceededTodayBg(accountList, stats, accIndex) {
  if (accIndex < 0 || accIndex >= accountList.length) return true;
  var acc = accountList[accIndex];
  var maxCount = acc.maxCollectCount != null ? acc.maxCollectCount : 200;
  return getAccountTodayCollectCountBg(stats, accIndex) >= maxCount;
}

function areAllAccountsExceededTodayBg(accountList, stats) {
  for (var i = 0; i < accountList.length; i++) {
    if (!isAccountExceededTodayBg(accountList, stats, i)) return false;
  }
  return true;
}

function findNextAvailableAccountBg(accountList, stats, currentIndex) {
  if (!accountList.length) return -1;
  for (var i = 1; i <= accountList.length; i++) {
    var nextIdx = (currentIndex + i) % accountList.length;
    if (!isAccountExceededTodayBg(accountList, stats, nextIdx)) return nextIdx;
  }
  return -1;
}

// 注入到页面的自动登录函数（与 panel 中一致）
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

function clearXhsCookiesBg(callback) {
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

/**
 * 后台自动退出 → 切换账号 → 自动登录，完成后回调 callback
 */
function doBackgroundAutoSwitchAccount(tabId, nextIndex, accountList, callback) {
  var acc = accountList[nextIndex];
  if (!acc) { callback(false); return; }
  var phone = (acc.phone || '').trim();
  var codeUrl = (acc.codeUrl || '').trim();

  pushAutoTaskLogLine('正在退出当前账号…');
  setAutoTaskStatusInStorage('正在退出当前账号…');

  chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: 'MAIN',
    func: _xhsClickMore,
    args: []
  }, function() {
    setTimeout(function() {
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        world: 'MAIN',
        func: _xhsClickLogout,
        args: []
      }, function() {
        setTimeout(function() {
          clearXhsCookiesBg(function(n) {
            pushAutoTaskLogLine('已退出，清除 ' + n + ' 个 Cookie');
          });

          chrome.storage.local.set({ selectedAccountIndex: nextIndex });
          pushAutoTaskLogLine('切换到账号 ' + (nextIndex + 1) + '：' + phone);
          setAutoTaskStatusInStorage('等待10秒后登录账号 ' + (nextIndex + 1));

          var remain = 10;
          var switchTimer = setInterval(function() {
            remain--;
            if (remain > 0) {
              setAutoTaskStatusInStorage('切换账号中… ' + remain + ' 秒后自动登录');
            } else {
              clearInterval(switchTimer);
            }
          }, 1000);

          setTimeout(function() {
            clearInterval(switchTimer);
            if (!phone || !codeUrl) {
              pushAutoTaskLogLine('账号 ' + (nextIndex + 1) + ' 缺少手机号或接码链接，跳过');
              callback(false);
              return;
            }

            pushAutoTaskLogLine('开始自动登录账号 ' + (nextIndex + 1) + '：' + phone);
            setAutoTaskStatusInStorage('正在登录账号 ' + (nextIndex + 1) + '…');

            getSearchSiteOriginFromStorage(function(loginOrigin) {
            chrome.tabs.update(tabId, { url: loginOrigin }, function() {
              waitForTabComplete(tabId).then(function() {
                setTimeout(function() {
                  chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    world: 'MAIN',
                    func: _xhsFillPhone,
                    args: [phone]
                  }, function(results) {
                    if (chrome.runtime.lastError || !results || !results[0] || !results[0].result) {
                      pushAutoTaskLogLine('未找到手机号输入框');
                      callback(false);
                      return;
                    }
                    setTimeout(function() {
                      chrome.scripting.executeScript({
                        target: { tabId: tabId },
                        world: 'MAIN',
                        func: _xhsClickSendSms,
                        args: []
                      }, function(results) {
                        if (chrome.runtime.lastError || !results || !results[0] || !results[0].result) {
                          pushAutoTaskLogLine('未找到发送验证码按钮');
                          callback(false);
                          return;
                        }
                        var maxPoll = 40;
                        var pollCount = 0;
                        function pollSmsCode() {
                          if (backgroundAutoTaskAbort) { callback(false); return; }
                          if (pollCount >= maxPoll) {
                            pushAutoTaskLogLine('接码超时');
                            callback(false);
                            return;
                          }
                          pollCount++;
                          setAutoTaskStatusInStorage('等待接码中… (' + pollCount + '/' + maxPoll + ')');
                          fetch(codeUrl)
                            .then(function(res) { return res.text(); })
                            .then(function(text) {
                              var code = extractSmsCode(text || '');
                              if (!code) {
                                setTimeout(pollSmsCode, 3000);
                                return;
                              }
                              pushAutoTaskLogLine('收到验证码：' + code);
                              chrome.scripting.executeScript({
                                target: { tabId: tabId },
                                world: 'MAIN',
                                func: _xhsFillSmsCode,
                                args: [code]
                              }, function() {
                                setTimeout(function() {
                                  chrome.scripting.executeScript({
                                    target: { tabId: tabId },
                                    world: 'MAIN',
                                    func: _xhsClickLogin,
                                    args: []
                                  }, function() {
                                    setTimeout(function() {
                                      pushAutoTaskLogLine('账号 ' + (nextIndex + 1) + ' 登录完成');
                                      setAutoTaskStatusInStorage('账号 ' + (nextIndex + 1) + ' 登录完成');
                                      callback(true);
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
            });
          }, 10000);
        }, 2000);
      });
    }, 800);
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

  function checkAndSwitchIfNeeded(thenContinue) {
    chrome.storage.local.get(['accountList', 'selectedAccountIndex', 'accountCollectStats'], function(o) {
      var accs = (o.accountList || []).map(function(item) {
        return { phone: (item.phone || '').trim(), codeUrl: (item.codeUrl || '').trim(), maxCollectCount: item.maxCollectCount != null ? parseInt(item.maxCollectCount, 10) : 200 };
      });
      var accIdx = parseInt(o.selectedAccountIndex, 10) || 0;
      var stats = o.accountCollectStats || {};

      if (!accs.length || !isAccountExceededTodayBg(accs, stats, accIdx)) {
        thenContinue();
        return;
      }

      var todayCount = getAccountTodayCollectCountBg(stats, accIdx);
      var maxCount = accs[accIdx] ? accs[accIdx].maxCollectCount : 200;
      pushAutoTaskLogLine('账号 ' + (accIdx + 1) + ' 今日已采集 ' + todayCount + '/' + maxCount + '，已达上限');

      if (areAllAccountsExceededTodayBg(accs, stats)) {
        var now = new Date();
        var nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
        var minToMidnight = Math.ceil((nextMidnight - now) / 60000);
        var waitSec = 15;
        var statusMsg = '所有账号今日采集均已达上限，' + waitSec + '秒后重新检测（距明日重置约' + minToMidnight + '分钟）';
        setAutoTaskStatusInStorage(statusMsg);
        pushAutoTaskLogLine(statusMsg);
        sendCountdownToPage(true, '等待重新检测', waitSec);
        setTimeout(function() { checkAndSwitchIfNeeded(thenContinue); }, waitSec * 1000);
        return;
      }

      var nextIdx = findNextAvailableAccountBg(accs, stats, accIdx);
      if (nextIdx < 0) {
        var now2 = new Date();
        var nextMidnight2 = new Date(now2.getFullYear(), now2.getMonth(), now2.getDate() + 1, 0, 0, 0);
        var minToMidnight2 = Math.ceil((nextMidnight2 - now2) / 60000);
        var waitSec2 = 15;
        var statusMsg2 = '无可用账号，' + waitSec2 + '秒后重新检测（距明日重置约' + minToMidnight2 + '分钟）';
        setAutoTaskStatusInStorage(statusMsg2);
        pushAutoTaskLogLine(statusMsg2);
        sendCountdownToPage(true, '等待重新检测', waitSec2);
        setTimeout(function() { checkAndSwitchIfNeeded(thenContinue); }, waitSec2 * 1000);
        return;
      }

      pushAutoTaskLogLine('准备切换到账号 ' + (nextIdx + 1));
      getTab().then(function(tab) {
        if (!tab || !tab.id) {
          pushAutoTaskLogLine('无法获取标签页，无法切换账号');
          done();
          return;
        }
        doBackgroundAutoSwitchAccount(tab.id, nextIdx, accs, function(success) {
          if (success) {
            thenContinue();
          } else {
            pushAutoTaskLogLine('账号切换/登录失败，15秒后重试');
            setTimeout(function() { checkAndSwitchIfNeeded(thenContinue); }, 15000);
          }
        });
      });
    });
  }

  function loop() {
    if (backgroundAutoTaskAbort) {
      done();
      return;
    }
    checkAndSwitchIfNeeded(loopInner);
  }

  function loopInner() {
    if (backgroundAutoTaskAbort) { done(); return; }
    chrome.storage.local.remove(['searchNotesPages', 'searchNotesResult']);
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
          var total = keywords.length;
          var index = 0;

          function doNext() {
            if (backgroundAutoTaskAbort) { done(); return; }
            if (index >= total) {
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
            setAutoTaskStatusInStorage(statusPrefix);
            pushAutoTaskLogLine(statusPrefix);
            sendCountdownToPage(true, '执行中 ' + (index + 1) + '/' + total, 0);
            var kwInfo = taskInfos[index] || taskInfos[0] || { Keywords: keyword };
            chrome.storage.local.set({ currentKeywordTask: kwInfo }, function() {
              buildSearchResultUrlAsync(keyword, function(url) {
              chrome.tabs.update(tab.id, { url: url }, function() {
                if (chrome.runtime.lastError) {
                  chrome.storage.local.get(['selectedAccountIndex', 'accountCollectStats', 'accountList'], function(so) {
                    var accIdx = parseInt(so.selectedAccountIndex, 10) || 0;
                    var stats = so.accountCollectStats || {};
                    var accs = so.accountList || [];
                    var maxC = accs[accIdx] && accs[accIdx].maxCollectCount != null ? accs[accIdx].maxCollectCount : 200;
                    var accKey = String(accIdx);
                    var today = getTodayDateStr();
                    if (!stats[accKey]) stats[accKey] = {};
                    stats[accKey][today] = maxC;
                    chrome.storage.local.set({ accountCollectStats: stats });
                    pushAutoTaskLogLine('打开搜索页失败：' + chrome.runtime.lastError.message + '，已标记今日暂停采集');
                    loop();
                  });
                  return;
                }
                waitForTabComplete(tab.id).then(function() {
                  if (backgroundAutoTaskAbort) { done(); return; }
                  setTimeout(function() {
                    if (backgroundAutoTaskAbort) { done(); return; }
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
                      var afterSearchScroll = function() {
                        scrollAndWaitForPage2(tab.id, thenWait);
                      };
                      if (filterVal) {
                        setAutoTaskStatusInStorage(statusPrefix + ' · 应用筛选「' + filterVal + '」');
                        applyPublishTimeFilterAfterSearch(tab.id, filterVal).then(function() {
                          afterSearchScroll();
                        }).catch(function() {
                          afterSearchScroll();
                        });
                      } else {
                        afterSearchScroll();
                      }
                    });
                  }, 2000);
                });
              });
              });
            });
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
