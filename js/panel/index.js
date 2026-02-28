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

// 搜索接口响应：多页合并展示，先第一页（页面内嵌）再第二页、第三页…表格不清空、向下追加
const searchResultText = document.getElementById('searchResultText');
const searchResultTableWrap = document.getElementById('searchResultTableWrap');
// 达人列表
const creatorListText = document.getElementById('creatorListText');
const creatorTableWrap = document.getElementById('creatorTableWrap');

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
