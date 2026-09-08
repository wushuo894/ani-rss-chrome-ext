(() => {
  if (globalThis.__aniRssContentLoaded) return;
  globalThis.__aniRssContentLoaded = true;
  const sites = globalThis.AniRssSites;
  const owned = 'data-ani-rss-extension';
  let floating;
  let timer;
  let previousUrl = location.href;

  function open(button) {
    if (button.disabled) return;
    button.disabled = true;
    chrome.runtime.sendMessage({ type: 'view:open' }).then(result => {
      if (!result?.ok) throw new Error(result?.error || '无法打开订阅窗口。');
    }).catch(error => {
      button.textContent = '打开失败，点击重试';
      button.title = error.message || '请刷新页面重试。';
    }).finally(() => { button.disabled = false; });
  }

  function createButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ani-rss-ext-floating';
    button.setAttribute(owned, '');
    button.textContent = '订阅到 ANI-RSS';
    button.title = '选择字幕组并添加到 ANI-RSS';
    return button;
  }

  function refresh() {
    observer.disconnect();
    try {
      const context = sites.collectPage(document, location.href);
      if (!context.site) return;
      if (context.subject || context.feeds.length) {
        if (!floating || !floating.isConnected) {
          floating = createButton();
          floating.addEventListener('click', () => open(floating));
          (document.body || document.documentElement).append(floating);
        }
      } else {
        floating?.remove();
        floating = undefined;
      }
    } finally {
      observer.observe(document.documentElement, {
        childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['href', 'data-clipboard-text', 'data-rss', 'data-rss-url', 'value']
      });
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 180);
  }

  const observer = new MutationObserver(schedule);
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id === chrome.runtime.id && message?.type === 'page:context') {
      sendResponse(sites.collectPage(document, location.href));
    }
  });
  addEventListener('popstate', schedule);
  addEventListener('hashchange', schedule);
  // 在隔离上下文中无需改写站点的 history API，也能跟踪 pushState 导航。
  setInterval(() => {
    if (location.href !== previousUrl) {
      previousUrl = location.href;
      schedule();
    }
  }, 1000);
  refresh();
})();
