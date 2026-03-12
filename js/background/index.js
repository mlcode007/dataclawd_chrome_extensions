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

// 回传请求由 background 发起，避免 content 页面环境下的混合内容/CORS 导致 Failed to fetch
var CALLBACK_TIMEOUT_MS = 60000;
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
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
