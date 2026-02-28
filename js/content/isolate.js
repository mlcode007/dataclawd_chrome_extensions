// 与搜索页一致：当前页刷新时只清空当前页对应的数据，重新开始（先第一页内嵌再滚动加载后续页）
if (window.location.href.indexOf('search_result') !== -1) {
  chrome.storage.local.remove(['searchNotesResult', 'searchNotesPages']);
}
if (window.location.href.indexOf('user/profile') !== -1) {
  chrome.storage.local.remove(['creatorListResult', 'creatorListPages']);
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
      chrome.storage.local.set({ searchNotesPages: pages, searchNotesResult: JSON.stringify(obj, null, 2) });
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
      chrome.storage.local.set({ creatorListPages: pages, creatorListResult: JSON.stringify(obj, null, 2) });
    });
  }
});
