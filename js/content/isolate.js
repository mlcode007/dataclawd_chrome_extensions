// 与搜索页一致：当前页刷新时只清空当前页对应的数据，重新开始（先第一页内嵌再滚动加载后续页）
if (window.location.href.indexOf('search_result') !== -1) {
  chrome.storage.local.remove(['searchNotesResult', 'searchNotesPages']);
}
if (window.location.href.indexOf('user/profile') !== -1) {
  chrome.storage.local.remove(['creatorListResult', 'creatorListPages']);
}

// ---------- 搜索数据回传（与 Python add_xhs_app_search_result 一致） ----------
var ADD_SEARCH_RESULT_PATH = 'xhs_extension/add_xhs_app_search_result';
// 最多在 storage 里保留的页数，超出则只保留最近 N 页，避免 storage 与界面内容无限增长
var MAX_PAGES_IN_STORAGE = 50;

function getTraceId() {
  return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/x/g, function() {
    return (Math.random() * 16 | 0).toString(16);
  });
}

function normalizePublishTime(text) {
  if (!text || typeof text !== 'string') return text || '';
  text = text.trim();
  if (!text) return '';
  var now = new Date();
  var m = text.match(/^(昨天|今天)\s*(\d{1,2}):(\d{2})$/);
  if (m) {
    var d = m[1] === '昨天' ? new Date(now.getTime() - 864e5) : now;
    var y = d.getFullYear(), mon = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return y + '-' + mon + '-' + day + ' ' + m[2] + ':' + m[3] + ':00';
  }
  m = text.match(/^(\d+)\s*分钟前$/);
  if (m) {
    var t = new Date(now.getTime() - m[1] * 60 * 1000);
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0') + ' ' +
      String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0');
  }
  m = text.match(/^(\d+)\s*小时前$/);
  if (m) {
    var t = new Date(now.getTime() - m[1] * 3600 * 1000);
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0') + ' ' +
      String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0');
  }
  m = text.match(/^(\d+)\s*天前$/);
  if (m) {
    var t = new Date(now.getTime() - m[1] * 864e5);
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0') + ' 00:00:00';
  }
  m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3] + ' 00:00:00';
  m = text.match(/^(\d{2})-(\d{2})$/);
  if (m) {
    var y = now.getFullYear();
    var dt = new Date(y, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
    if (dt > now) dt = new Date(y - 1, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0') + ' 00:00:00';
  }
  return text;
}

function parseXhsSearchResultItem(item) {
  if (!item || item.model_type !== 'note') return null;
  var noteCard = item.note_card || {};
  var type = noteCard.type || 'normal';
  var publishTimeRaw = '';
  var tags = noteCard.corner_tag_info || [];
  for (var i = 0; i < tags.length; i++) {
    if (tags[i].type === 'publish_time') {
      publishTimeRaw = (tags[i].text || '').trim();
      break;
    }
  }
  var publishTime = normalizePublishTime(publishTimeRaw);
  var interact = noteCard.interact_info || {};
  var noteId = item.id || '';
  var xsecToken = item.xsec_token || '';
  var url = noteId ? 'https://www.xiaohongshu.com/explore/' + noteId : '';
  return {
    XsecToken: xsecToken,
    IsAds: 0,
    PublishTime: publishTime,
    ArticleType: type,
    ThumbsUpQty: interact.liked_count != null ? String(interact.liked_count) : '0',
    ReviewQty: interact.comment_count != null ? String(interact.comment_count) : '0',
    CollectQty: interact.collected_count != null ? String(interact.collected_count) : '0',
    ShareQty: interact.shared_count != null ? String(interact.shared_count) : '0',
    Url: url
  };
}

function parseXhsSearchResultItems(dataItems) {
  if (!Array.isArray(dataItems)) return [];
  var list = [];
  for (var i = 0; i < dataItems.length; i++) {
    var x = parseXhsSearchResultItem(dataItems[i]);
    if (x) list.push(x);
  }
  return list;
}

var CALLBACK_MAX_RETRIES = 5;

// 单次回传由 background 发起，避免页面环境下 HTTP/混合内容/CORS 导致 Failed to fetch
function doOneCallbackRequest(url, body) {
  return new Promise(function(resolve, reject) {
    chrome.runtime.sendMessage({ type: 'xhsCallbackFetch', url: url, body: body }, function(response) {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || 'Extension context invalid'));
        return;
      }
      if (response && response.ok) {
        resolve(response.data);
      } else {
        reject(new Error(response && response.error || '回传失败'));
      }
    });
  });
}

function sendXhsSearchResult(body) {
  return new Promise(function(resolve, reject) {
    chrome.storage.local.get(['apiHost'], function(obj) {
      var host = (obj.apiHost || '').trim();
      if (!host) {
        var m = chrome.runtime.getManifest();
        host = (m && m.api_host_default ? m.api_host_default : '').trim();
      }
      if (!/\/$/.test(host)) host += '/';
      var url = host + ADD_SEARCH_RESULT_PATH + '?trace_id=' + encodeURIComponent(getTraceId());
      var attempt = 1;
      var maxAttempts = 1 + CALLBACK_MAX_RETRIES;
      function tryOnce() {
        doOneCallbackRequest(url, body).then(function(data) {
          resolve({ data: data, attempt: attempt });
        }).catch(function(err) {
          if (attempt >= maxAttempts) {
            reject(new Error('回传失败（已重试' + CALLBACK_MAX_RETRIES + '次）: ' + (err && err.message || String(err))));
          } else {
            attempt++;
            tryOnce();
          }
        });
      }
      tryOnce();
    });
  });
}

// 从达人接口响应里取列表（user_posted 返回 data.notes/data.items，search/users 为 data.users/data.items）
function getCreatorList(obj) {
  if (!obj || !obj.data) return null;
  var d = obj.data;
  if (Array.isArray(d.notes) && d.notes.length) return d.notes;
  if (Array.isArray(d.users) && d.users.length) return d.users;
  if (Array.isArray(d.items) && d.items.length) return d.items;
  return null;
}

function getCreatorId(user) {
  if (!user) return '';
  return user.user_id || user.id || (user.user_info && (user.user_info.user_id || user.user_info.id)) || '';
}

// 接收页面主环境 postMessage 的搜索结果，按页追加到 searchNotesPages
window.addEventListener('message', function(event) {
  if (event.source !== window) return;
  var msgType = event.data && event.data.type;

  if (msgType === 'XHS_SEARCH_RESULT') {
    var raw = event.data.data;
    var obj = typeof raw === 'string' ? (function() { try { return JSON.parse(raw); } catch (e) { return null; } })() : raw;
    if (!obj || !obj.data || !Array.isArray(obj.data.items) || !obj.data.items.length) return;
    var firstId = obj.data.items[0].id;
    var pageNum = event.data.pageNum != null ? event.data.pageNum : 1;
    obj._pageNum = pageNum;

    var isFirstPage = !!event.data.isFirstPage;
    chrome.storage.local.get('searchNotesPages', function(res) {
      var pages = res.searchNotesPages || [];
      if (isFirstPage) {
        pages = [obj];
      } else {
        var sameAsFirst = pages.length && pages[0].data && pages[0].data.items && pages[0].data.items[0] && pages[0].data.items[0].id === firstId;
        if (sameAsFirst) pages = [obj];
        else pages.push(obj);
      }
      if (pages.length > MAX_PAGES_IN_STORAGE) {
        pages = pages.slice(-MAX_PAGES_IN_STORAGE);
      }
      chrome.storage.local.set({ searchNotesPages: pages, searchNotesResult: JSON.stringify(obj, null, 2) });
    });

    // 每次拦截后回传数据：用当前关键词任务 + 本页原始 items（与 data_back.txt 格式一致）调用回传接口
    chrome.storage.local.get('currentKeywordTask', function(res) {
      var kwInfo = res.currentKeywordTask;
      if (!kwInfo || typeof kwInfo !== 'object') return;
      var items = obj.data.items;
      if (!items || !items.length) return;
      var body = {};
      var k;
      for (k in kwInfo) if (kwInfo.hasOwnProperty(k)) body[k] = kwInfo[k];
      body.items = items;
      console.log(body);
      sendXhsSearchResult(body)
        .then(function(result) {
          var data = result && result.data;
          var attempt = result && result.attempt;
          var attemptStr = attempt != null ? '（第' + attempt + '次）' : '';
          var msg = '回传成功' + attemptStr;
          if (data && (data.code != null || (data.message != null && data.message !== ''))) {
            msg += ' code=' + (data.code != null ? String(data.code) : '-');
            msg += ' message=' + (data.message != null && data.message !== '' ? String(data.message) : '-');
          }
          console.log('[DataCrawler] 搜索数据回传:', msg, result);
          chrome.storage.local.set({ autoTaskCallbackStatus: { success: true, message: msg, time: Date.now() } });
        })
        .catch(function(err) {
          var msg = err && err.message || String(err);
          console.error('[DataCrawler] 搜索数据回传失败', err);
          chrome.storage.local.set({ autoTaskCallbackStatus: { success: false, message: msg, time: Date.now() } });
        });
    });
    return;
  }

  if (msgType === 'XHS_CREATOR_LIST_RESULT') {
    var raw = event.data.data;
    var obj = typeof raw === 'string' ? (function() { try { return JSON.parse(raw); } catch (e) { return null; } })() : raw;
    var list = getCreatorList(obj);
    if (!list || !list.length) return;
    var firstId = getCreatorId(list[0]);
    var pageNum = event.data.pageNum != null ? event.data.pageNum : 1;
    obj._pageNum = pageNum;

    var isFirstPage = !!event.data.isFirstPage;
    chrome.storage.local.get('creatorListPages', function(res) {
      var pages = res.creatorListPages || [];
      if (isFirstPage) {
        pages = [obj];
      } else {
        var prevList = pages.length && getCreatorList(pages[0]);
        var sameAsFirst = prevList && prevList.length && getCreatorId(prevList[0]) === firstId;
        if (sameAsFirst) pages = [obj];
        else pages.push(obj);
      }
      if (pages.length > MAX_PAGES_IN_STORAGE) {
        pages = pages.slice(-MAX_PAGES_IN_STORAGE);
      }
      chrome.storage.local.set({ creatorListPages: pages, creatorListResult: JSON.stringify(obj, null, 2) });
    });
  }
});

// ---------- 自动任务时页面左上角「请求关键词」倒计时浮层 ----------
var dataCrawlerCountdownIntervalId = null;
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.type !== 'dataCrawlerCountdown') return;
  var el = document.getElementById('data-crawler-countdown-box');
  if (msg.show) {
    if (!el) {
      el = document.createElement('div');
      el.id = 'data-crawler-countdown-box';
      el.style.cssText = 'position:fixed;top:14px;left:14px;z-index:2147483647;padding:10px 14px;border-radius:10px;background:rgba(0,0,0,0.82);color:#fff;font-size:13px;font-family:system-ui,-apple-system,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,0.25);pointer-events:none;line-height:1.4;';
      document.body.appendChild(el);
    }
    if (dataCrawlerCountdownIntervalId) {
      clearInterval(dataCrawlerCountdownIntervalId);
      dataCrawlerCountdownIntervalId = null;
    }
    var text = (msg.text || '请求关键词').trim();
    var sec = typeof msg.seconds === 'number' ? msg.seconds : 0;
    function update() {
      if (sec > 0) {
        el.textContent = text + ' · ' + sec + ' 秒';
      } else {
        el.textContent = text;
      }
    }
    update();
    if (typeof msg.seconds === 'number' && msg.seconds > 0) {
      dataCrawlerCountdownIntervalId = setInterval(function() {
        sec--;
        if (sec <= 0) {
          clearInterval(dataCrawlerCountdownIntervalId);
          dataCrawlerCountdownIntervalId = null;
          el.textContent = text;
          return;
        }
        el.textContent = text + ' · ' + sec + ' 秒';
      }, 1000);
    }
  } else {
    if (dataCrawlerCountdownIntervalId) {
      clearInterval(dataCrawlerCountdownIntervalId);
      dataCrawlerCountdownIntervalId = null;
    }
    if (el) el.remove();
  }
});
