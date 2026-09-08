import { normalizeSettings, hostPattern, callApi, rssToAniBody, groupsRequest, normalizeGroups, validateDraft, normalizePreview, mergeDraft } from '../shared/api.js';

const sites = globalThis.AniRssSites;
const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const pendingSubscriptions = new Set();

function isExtensionPage(sender) {
  if (sender.id !== chrome.runtime.id || !sender.url) return false;
  const url = new URL(sender.url);
  return url.protocol === 'chrome-extension:' && url.hostname === chrome.runtime.id &&
    ['/options.html', '/subscribe.html', '/preview.html'].includes(url.pathname);
}

async function readSettings() {
  await storageReady;
  const { settings } = await chrome.storage.local.get('settings');
  return settings || { baseUrl: '', apiKey: '' };
}

async function requireSettings(input) {
  const settings = normalizeSettings(input ?? await readSettings());
  if (!await chrome.permissions.contains({ origins: [hostPattern(settings.baseUrl)] })) {
    throw new Error('尚未获得 ANI-RSS 服务的访问权限，请在扩展设置中重新保存并授权。');
  }
  return settings;
}

function popupSourceKey(tabId) {
  return `popup-source:${tabId}`;
}

async function openSubscription(tab, source) {
  const tabId = tab?.id;
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error('无法读取来源标签页。');
  const key = popupSourceKey(tabId);
  let feed = null;
  if (source) {
    feed = sites.parseFeedUrl(source.url);
    if (!feed) throw new Error('无法识别此 RSS。');
  }
  if (feed) {
    await chrome.storage.session.set({ [key]: { url: feed.url, expiresAt: Date.now() + 30000 } });
  } else {
    await chrome.storage.session.remove(key);
  }
  try {
    await chrome.action.openPopup({ windowId: tab.windowId });
  } catch {
    throw new Error('无法自动打开扩展气泡，请将 ANI-RSS 扩展固定到工具栏后点击图标。');
  }
}

async function takePopupSource(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) return null;
  const key = popupSourceKey(tabId);
  const entry = (await chrome.storage.session.get(key))[key];
  await chrome.storage.session.remove(key);
  return entry?.expiresAt >= Date.now() && sites.parseFeedUrl(entry.url)?.url || null;
}

function previewKey(id) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('预览窗口参数无效。');
  return `subscription-preview:${id}`;
}

async function openPreview(message) {
  const subscription = mergeDraft(message.draft, message.edits);
  const id = crypto.randomUUID();
  const key = previewKey(id);
  await chrome.storage.session.set({ [key]: { subscription, expiresAt: Date.now() + 10 * 60 * 1000 } });
  try {
    const current = await chrome.windows.getLastFocused();
    const width = Math.min(1200, current.width || 1200);
    const height = Math.min(820, current.height || 820);
    const left = Number.isInteger(current.left) ? current.left + Math.max(0, Math.round(((current.width || width) - width) / 2)) : undefined;
    const top = Number.isInteger(current.top) ? current.top + Math.max(0, Math.round(((current.height || height) - height) / 2)) : undefined;
    await chrome.windows.create({
      url: `${chrome.runtime.getURL('preview.html')}?id=${encodeURIComponent(id)}`,
      type: 'popup',
      focused: true,
      width,
      height,
      left,
      top,
    });
  } catch (error) {
    await chrome.storage.session.remove(key);
    throw new Error(error.message || '浏览器无法创建预览窗口。');
  }
}

async function getPreview(id) {
  const key = previewKey(id);
  const entry = (await chrome.storage.session.get(key))[key];
  if (!entry || entry.expiresAt < Date.now()) {
    await chrome.storage.session.remove(key);
    throw new Error('预览数据已失效，请返回订阅窗口重新打开预览。');
  }
  const subscription = validateDraft(entry.subscription);
  const preview = normalizePreview((await callApi(await requireSettings(), 'previewAni', subscription)).data);
  return { subscription, preview };
}

async function getContext(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error('请从番剧页面点击扩展图标打开订阅窗口。');
  try {
    const context = await chrome.tabs.sendMessage(tabId, { type: 'page:context' });
    if (context) return context;
  } catch { /* 已打开的旧页面可能还没有加载内容脚本，使用 activeTab 权限补充读取。 */ }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/shared/sites.js'] });
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => globalThis.AniRssSites.collectPage(document, location.href)
    });
    return results[0]?.result;
  } catch {
    throw new Error('无法读取来源页面，请刷新番剧页面并点击工具栏图标，或手动粘贴 RSS。');
  }
}

async function addSubscription(message) {
  const draft = mergeDraft(message.draft, message.edits);
  const settings = await requireSettings();
  const key = `added:${settings.baseUrl}:${draft.id}`;
  if (pendingSubscriptions.has(key)) throw new Error('此订阅正在提交，请勿重复点击。');
  pendingSubscriptions.add(key);
  try {
    if ((await chrome.storage.session.get(key))[key]) throw new Error('此草稿已添加成功，请勿重复提交。');
    const result = await callApi(settings, 'addAni', draft);
    await chrome.storage.session.set({ [key]: true });
    return { message: result.message || '添加订阅成功' };
  } finally {
    pendingSubscriptions.delete(key);
  }
}

async function handleMessage(message, sender) {
  if (!message || typeof message.type !== 'string' || sender.id !== chrome.runtime.id) throw new Error('无效的扩展消息。');
  if (message.type === 'view:open') {
    if (sender.frameId !== 0 || !sender.tab || !sites.getSite(sender.url)) throw new Error('不支持的来源页面。');
    await openSubscription(sender.tab, message.source);
    return null;
  }
  if (!isExtensionPage(sender)) throw new Error('此操作仅允许在扩展界面中执行。');
  switch (message.type) {
    case 'settings:get': return readSettings();
    case 'settings:save': {
      const settings = await requireSettings(message.settings);
      await storageReady;
      await chrome.storage.local.set({ settings });
      return settings;
    }
    case 'settings:test': return (await callApi(await requireSettings(message.settings), 'about')).data;
    case 'context:get': return getContext(message.tabId);
    case 'popup:source': return takePopupSource(message.tabId);
    case 'preview:open': return openPreview(message);
    case 'preview:get': return getPreview(message.id);
    case 'groups:get': {
      const { endpoint, query } = groupsRequest(message.subject);
      return normalizeGroups((await callApi(await requireSettings(), endpoint, undefined, { query })).data);
    }
    case 'draft:create': {
      const body = rssToAniBody(message.source);
      return validateDraft((await callApi(await requireSettings(), 'rssToAni', body)).data);
    }
    case 'subscription:preview': {
      const ani = mergeDraft(message.draft, message.edits);
      return normalizePreview((await callApi(await requireSettings(), 'previewAni', ani)).data);
    }
    case 'subscription:add': return addSubscription(message);
    default: throw new Error('未知操作。');
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(
    data => sendResponse({ ok: true, data }),
    error => sendResponse({ ok: false, error: error.message || '操作失败，请重试。' })
  );
  return true;
});
