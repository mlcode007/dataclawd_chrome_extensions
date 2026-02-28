// 运行在页面主环境 (world: MAIN)，劫持 fetch/XHR 拦截小红书搜索接口（笔记 + 达人/用户）；搜索页打开时优先从页面内嵌数据加载第一页
// 不能使用 chrome.*，通过 postMessage 把结果发给 isolate.js
(function() {
  var TARGET_NOTES = 'edith.xiaohongshu.com/api/sns/web/v1/search/notes';
  // 达人列表实际接口：某用户发布的笔记列表（分页用 cursor）
  var TARGET_CREATOR = 'edith.xiaohongshu.com/api/sns/web/v1/user_posted';

  function isTargetUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return url.indexOf(TARGET_NOTES) !== -1;
  }

  function isTargetCreatorUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return url.indexOf(TARGET_CREATOR) !== -1;
  }

  // 从请求 URL 或 body 中解析 page 参数，作为表格页码
  function getRequestPage(url, body) {
    var u = typeof url === 'string' ? url : (url && url.url) || '';
    if (u) {
      var match = u.match(/[?&]page=(\d+)/i) || u.match(/[?&]page%3D(\d+)/i);
      if (match) return parseInt(match[1], 10) || 1;
    }
    if (body) {
      try {
        var b = typeof body === 'string' ? JSON.parse(body) : body;
        if (b.page != null) return parseInt(b.page, 10) || 1;
      } catch (e) {}
    }
    return 1;
  }

  function isRequestPage1(url, body) {
    return getRequestPage(url, body) === 1;
  }

  // user_posted 分页用 cursor：无 cursor 或 cursor 为空视为第一页
  function getCreatorPageInfo(url) {
    var u = typeof url === 'string' ? url : (url && url.url) || '';
    if (!u) return { pageNum: 1, isFirstPage: true };
    var cursorMatch = u.match(/[?&]cursor=([^&]*)/i) || u.match(/[?&]cursor%3D([^&]*)/i);
    var cursor = cursorMatch ? (cursorMatch[1] || '').trim() : '';
    var isFirst = !cursor;
    var pageNum = isFirst ? 1 : 2;
    return { pageNum: pageNum, isFirstPage: isFirst };
  }

  function sendResult(data, isFirstPage, pageNum) {
    try {
      window.postMessage({ type: 'XHS_SEARCH_RESULT', data: data, isFirstPage: !!isFirstPage, pageNum: pageNum != null ? pageNum : 1 }, '*');
    } catch (e) {}
  }

  function sendCreatorResult(data, isFirstPage, pageNum) {
    try {
      window.postMessage({ type: 'XHS_CREATOR_LIST_RESULT', data: data, isFirstPage: !!isFirstPage, pageNum: pageNum != null ? pageNum : 1 }, '*');
    } catch (e) {}
  }

  // 从页面内嵌数据中抽取第一页笔记列表（仅搜索页）
  function findItemsInState(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (Array.isArray(obj) && obj.length && obj[0].note_card) return obj;
    if (obj.data && Array.isArray(obj.data.items) && obj.data.items[0] && obj.data.items[0].note_card) return obj.data.items;
    if (obj.items && Array.isArray(obj.items) && obj.items[0] && obj.items[0].note_card) return obj.items;
    var k;
    for (k in obj) { var r = findItemsInState(obj[k]); if (r) return r; }
    return null;
  }

  // 判断是否为 user_posted 的笔记项（含 note_id/id 或 display_title + user）
  function isCreatorNote(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.note_id) return true;
    if (item.user && (item.display_title !== undefined || item.id)) return true;
    return false;
  }

  // 判断是否为达人页 HTML 内嵌的笔记项（noteCard + displayTitle/user，camelCase）
  function isCreatorNoteFromHtml(item) {
    if (!item || typeof item !== 'object') return false;
    var card = item.noteCard || item.note_card;
    return card && card.user && (card.displayTitle !== undefined || card.display_title !== undefined || card.noteId || card.note_id);
  }

  // 将达人页 HTML 内嵌的一条笔记转为 user_posted 接口格式（snake_case），便于表格统一展示
  function normalizeHtmlNoteToApi(item) {
    var card = item.noteCard || item.note_card || {};
    var u = card.user || {};
    var interact = card.interactInfo || card.interact_info || {};
    return {
      note_id: item.note_id || card.noteId || card.note_id || item.id,
      id: item.id || card.noteId || card.note_id || item.note_id,
      display_title: item.display_title || card.displayTitle || card.display_title,
      user: {
        user_id: u.user_id || u.userId,
        nick_name: u.nick_name || u.nickName || u.nickname,
        nickname: u.nickname || u.nickName || u.nick_name,
        avatar: u.avatar
      },
      interact_info: {
        liked_count: interact.liked_count != null ? interact.liked_count : (interact.likedCount != null ? interact.likedCount : '')
      },
      xsec_token: item.xsec_token || card.xsecToken || card.xsec_token || item.xsecToken,
      cover: card.cover || item.cover
    };
  }

  // 从页面内嵌数据中抽取达人主页第一页笔记列表（支持 API 的 data.notes 与 HTML 的 userPageData.notes 双层数组）
  function findCreatorNotesInState(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.data && Array.isArray(obj.data.notes) && obj.data.notes.length && isCreatorNote(obj.data.notes[0])) {
      return obj.data.notes;
    }
    if (Array.isArray(obj) && obj.length && isCreatorNote(obj[0])) return obj;
    if (obj.notes && Array.isArray(obj.notes) && obj.notes.length) {
      var raw = obj.notes;
      var firstPage = Array.isArray(raw[0]) ? raw[0] : raw;
      if (firstPage.length && isCreatorNoteFromHtml(firstPage[0])) {
        return firstPage.map(function(n) { return normalizeHtmlNoteToApi(n); });
      }
      if (firstPage.length && isCreatorNote(firstPage[0])) return firstPage;
    }
    var k;
    for (k in obj) { var r = findCreatorNotesInState(obj[k]); if (r) return r; }
    return null;
  }

  function getCreatorNotesPayload() {
    var payload = null;
    if (typeof window.__INITIAL_STATE__ !== 'undefined') {
      payload = findCreatorNotesInState(window.__INITIAL_STATE__);
    }
    if (!payload) {
      var scripts = document.querySelectorAll('script:not([src])');
      for (var i = 0; i < scripts.length; i++) {
        var text = scripts[i].textContent || '';
        var match = text.match(/__INITIAL_STATE__\s*=\s*({.+?});?\s*<\/script>/s) || text.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});/s);
        if (match) {
          try {
            var raw = match[1].replace(/\\u002F/g, '/').replace(/\bundefined\b/g, 'null');
            payload = findCreatorNotesInState(JSON.parse(raw));
            break;
          } catch (e) {}
        }
      }
    }
    return payload;
  }

  function tryLoadFromPage() {
    if (window.location.href.indexOf('search_result') === -1) return;
    var payload = null;
    if (typeof window.__INITIAL_STATE__ !== 'undefined') {
      payload = findItemsInState(window.__INITIAL_STATE__);
    }
    if (!payload) {
      var scripts = document.querySelectorAll('script:not([src])');
      for (var i = 0; i < scripts.length; i++) {
        var text = scripts[i].textContent || '';
        var match = text.match(/__INITIAL_STATE__\s*=\s*({.+?});?\s*<\/script>/s) || text.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});/s);
        if (match) {
          try {
            var raw = match[1].replace(/\\u002F/g, '/').replace(/\bundefined\b/g, 'null');
            payload = findItemsInState(JSON.parse(raw));
            break;
          } catch (e) {}
        }
      }
    }
    if (payload && payload.length) {
      sendResult({ code: 0, data: { has_more: true, items: payload } }, true, 1);
    }
  }

  // 达人列表页：从页面内嵌数据抽取第一页笔记（与 user_posted 接口同结构），刷新时表格即展示首屏
  function tryLoadCreatorFromPage() {
    if (window.location.href.indexOf('user/profile') === -1) return;
    var payload = getCreatorNotesPayload();
    if (payload && payload.length) {
      sendCreatorResult({ code: 0, data: { notes: payload, has_more: true, cursor: '' }, _pageNum: 1 }, true, 1);
    }
  }

  function tryLoadBoth() {
    tryLoadFromPage();
    tryLoadCreatorFromPage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(tryLoadBoth, 200);
      // 达人页与搜索页一致：稍后再试一次，确保首屏数据能从未完成的 __INITIAL_STATE__ 中拿到
      setTimeout(tryLoadCreatorFromPage, 600);
    });
  } else {
    setTimeout(tryLoadBoth, 200);
    setTimeout(tryLoadCreatorFromPage, 600);
  }

  var _fetch = window.fetch;
  window.fetch = function(url, opts) {
    var u = typeof url === 'string' ? url : (url && url.url);
    var body = (opts && opts.body) || (url && url.body);
    var pageNum = getRequestPage(u, body);
    var firstPage = isRequestPage1(u, body);
    if (isTargetUrl(u)) {
      return _fetch.apply(this, arguments).then(function(r) {
        var c = r.clone();
        c.json().then(function(data) { sendResult(data, firstPage, pageNum); }).catch(function() {
          r.clone().text().then(function(t) { sendResult({ _raw: t }, firstPage, pageNum); });
        });
        return r;
      });
    }
    if (isTargetCreatorUrl(u)) {
      var creatorInfo = getCreatorPageInfo(u);
      return _fetch.apply(this, arguments).then(function(r) {
        var c = r.clone();
        c.json().then(function(data) { sendCreatorResult(data, creatorInfo.isFirstPage, creatorInfo.pageNum); }).catch(function() {
          r.clone().text().then(function(t) { sendCreatorResult({ _raw: t }, creatorInfo.isFirstPage, creatorInfo.pageNum); });
        });
        return r;
      });
    }
    return _fetch.apply(this, arguments);
  };

  var NativeXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    var xhr = new NativeXHR();
    var _open = xhr.open;
    xhr.open = function(method, url) {
      xhr._url = url;
      return _open.apply(xhr, arguments);
    };
    var _send = xhr.send;
    xhr.send = function(body) {
      xhr._body = body;
      return _send.apply(this, arguments);
    };
    xhr.addEventListener('readystatechange', function() {
      if (xhr.readyState !== 4 || !xhr._url) return;
      var pageNum = getRequestPage(xhr._url, xhr._body);
      var firstPage = isRequestPage1(xhr._url, xhr._body);
      if (isTargetUrl(xhr._url)) {
        try {
          var data = JSON.parse(xhr.responseText);
          sendResult(data, firstPage, pageNum);
        } catch (e) {
          sendResult({ _raw: xhr.responseText }, firstPage, pageNum);
        }
        return;
      }
      if (isTargetCreatorUrl(xhr._url)) {
        var creatorInfo = getCreatorPageInfo(xhr._url);
        try {
          var data = JSON.parse(xhr.responseText);
          sendCreatorResult(data, creatorInfo.isFirstPage, creatorInfo.pageNum);
        } catch (e) {
          sendCreatorResult({ _raw: xhr.responseText }, creatorInfo.isFirstPage, creatorInfo.pageNum);
        }
      }
    });
    return xhr;
  }
  window.XMLHttpRequest = PatchedXHR;
})();
