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
