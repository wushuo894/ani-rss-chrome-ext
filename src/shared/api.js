import './sites.js';

const sites = globalThis.AniRssSites;
const endpoints = new Set(['about', 'mikanGroup', 'aniBTGroup', 'animeGardenGroup', 'rssToAni', 'previewAni', 'addAni']);

export function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('请填写 ANI-RSS 服务地址。');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('服务地址应为完整的 http:// 或 https:// 地址。'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('服务地址仅支持 HTTP 或 HTTPS。');
  if (url.username || url.password || /[?#]/.test(value)) {
    throw new Error('服务地址不能包含账号密码、查询参数或 # 片段，请填写 ANI-RSS 首页地址。');
  }
  url.pathname = url.pathname.replace(/\/+$/, '') + '/';
  return url.href;
}

export function hostPattern(value) {
  const url = new URL(normalizeBaseUrl(value));
  // 浏览器的主机匹配模式不限定端口或代理子路径。
  return `${url.protocol}//${url.hostname}/*`;
}

export function normalizeSettings(settings) {
  const baseUrl = normalizeBaseUrl(settings?.baseUrl);
  const apiKey = typeof settings?.apiKey === 'string' ? settings.apiKey.trim() : '';
  if (!apiKey) throw new Error('请填写 ANI-RSS 设置 → 登录中的 API Key。');
  if (/[\r\n]/.test(apiKey)) throw new Error('API Key 不能包含换行。');
  return { baseUrl, apiKey };
}

export async function callApi(settings, endpoint, body, { query, fetchImpl = globalThis.fetch, timeoutMs = 25000 } = {}) {
  const { baseUrl, apiKey } = normalizeSettings(settings);
  if (!endpoints.has(endpoint)) throw new Error('不支持的接口。');
  const url = new URL(`api/${endpoint}`, baseUrl);
  if (query) url.search = new URLSearchParams(query).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(url.href, {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer'
      });
    } catch {
      const reason = controller.signal.aborted ? '请求超时' : '无法连接 ANI-RSS，请检查服务地址、网络、证书或反向代理重定向';
      throw new Error(`${reason}。${endpoint === 'addAni' ? '保存结果尚不确定，请先在 ANI-RSS 检查订阅；扩展不会自动重试。' : ''}`);
    }
    let result;
    try { result = await response.json(); } catch {
      if (controller.signal.aborted) {
        throw new Error(`请求超时。${endpoint === 'addAni' ? '保存结果尚不确定，请先在 ANI-RSS 检查订阅；扩展不会自动重试。' : ''}`);
      }
      if (response.status === 401 || response.status === 403) throw new Error('认证失败，请检查 API Key 和服务访问权限。');
      const uncertain = endpoint === 'addAni' ? '保存结果尚不确定，请先在 ANI-RSS 检查订阅。' : '';
      throw new Error(`ANI-RSS 返回非 JSON 响应（HTTP ${response.status}），请检查地址及代理子路径。${uncertain}`);
    }
    if (!response.ok || result?.code !== 200) {
      const message = typeof result?.message === 'string' && result.message.trim() ? result.message : '';
      const unauthorized = [401, 403].includes(response.status) || [401, 403].includes(result?.code);
      throw new Error(message || (unauthorized ? '认证失败，请检查 API Key。' : `请求失败（HTTP ${response.status}，业务码 ${result?.code ?? '未知'}）。`));
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export function rssToAniBody(source) {
  const feed = sites.parseFeedUrl(source?.url);
  if (!feed) throw new Error('请输入支持站点中限定单个番剧和一个字幕组的 RSS 地址。');
  const body = { url: feed.url, type: feed.type };
  const subgroup = typeof source?.subgroup === 'string' ? source.subgroup.trim() : feed.subgroup;
  const bgmUrl = source?.bgmUrl || feed.bgmUrl;
  // Mikan 传入任意补充字段都会跳过后端自动补全，必须同时获得这两项。
  if (feed.type === 'mikan') {
    if (subgroup && /^https:\/\/(bgm\.tv|bangumi\.tv|chii\.in)\/subject\/[1-9]\d*\/?$/.test(bgmUrl || '')) {
      body.subgroup = subgroup;
      body.bgmUrl = bgmUrl;
    }
  } else if (subgroup) {
    body.subgroup = subgroup;
  }
  return body;
}

export function groupsRequest(subject) {
  if (!subject || !/^[1-9]\d*$/.test(subject.id)) throw new Error('当前页面没有可用的番剧 ID。');
  if (subject.type === 'mikan') {
    let url;
    try { url = new URL(subject.url); } catch { throw new Error('Mikan 番剧地址无效。'); }
    if (sites.getSite(url.href)?.type !== 'mikan' || !new RegExp(`^/Home/Bangumi/${subject.id}/?$`, 'i').test(url.pathname)) {
      throw new Error('Mikan 番剧地址与作品 ID 不匹配。');
    }
    url.search = '';
    url.hash = '';
    return { endpoint: 'mikanGroup', query: { url: url.href } };
  }
  if (subject.type === 'ani-bt') return { endpoint: 'aniBTGroup', query: { bgmId: subject.id } };
  if (subject.type === 'anime-garden') return { endpoint: 'animeGardenGroup', query: { bgmId: subject.id } };
  throw new Error('不支持的番剧来源。');
}

export function normalizeGroups(groups) {
  if (!Array.isArray(groups)) throw new Error('字幕组接口返回格式不正确。');
  const feeds = new Map();
  for (const group of groups) {
    const feed = sites.parseFeedUrl(group?.rss);
    if (!feed) continue;
    const label = group.label || group.name || feed.label;
    feeds.set(feed.url, { ...feed, label, subgroup: group.label || group.name || feed.subgroup, bgmUrl: group.bgmUrl || feed.bgmUrl });
  }
  return [...feeds.values()];
}

export function validateDraft(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft) || typeof draft.id !== 'string' || !draft.id ||
      typeof draft.title !== 'string' || !draft.title.trim() || !sites.parseFeedUrl(draft.url)) {
    throw new Error('订阅草稿不完整，请重新解析 RSS。');
  }
  return draft;
}

export function normalizePreview(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.items) || !Array.isArray(value.omitList)) {
    throw new Error('订阅预览返回格式不正确。');
  }
  const items = value.items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('订阅预览包含无效资源。');
    const episode = typeof item.episode === 'number' && Number.isFinite(item.episode) ? item.episode : null;
    return {
      title: typeof item.title === 'string' ? item.title : '',
      reName: typeof item.reName === 'string' ? item.reName : '',
      infoHash: typeof item.infoHash === 'string' ? item.infoHash : '',
      episode,
      formatSize: typeof item.formatSize === 'string' ? item.formatSize : '',
      hasDownloaded: item.hasDownloaded === true,
      master: item.master === true,
      subgroup: typeof item.subgroup === 'string' ? item.subgroup : '',
      pubDate: typeof item.pubDate === 'string' ? item.pubDate : '',
    };
  });
  const omitList = value.omitList.filter((episode) => typeof episode === 'number' && Number.isFinite(episode));
  return {
    downloadPath: typeof value.downloadPath === 'string' ? value.downloadPath : '',
    items,
    omitList,
  };
}

export function mergeDraft(draft, edits = {}) {
  validateDraft(draft);
  const merged = structuredClone(draft);
  for (const key of ['title', 'subgroup']) {
    if (Object.hasOwn(edits, key)) {
      if (typeof edits[key] !== 'string' || !edits[key].trim()) throw new Error(`${key === 'title' ? '标题' : '字幕组'}不能为空。`);
      merged[key] = edits[key].trim();
    }
  }
  for (const key of ['season', 'offset']) {
    if (Object.hasOwn(edits, key)) {
      if (!Number.isInteger(edits[key]) || edits[key] < (key === 'season' ? 0 : -2147483648) || edits[key] > 2147483647) {
        throw new Error(key === 'season' ? '季度必须是大于或等于 0 的整数。' : '剧集偏移必须是有效整数。');
      }
      merged[key] = edits[key];
    }
  }
  for (const key of ['match', 'exclude']) {
    if (Object.hasOwn(edits, key)) {
      if (!Array.isArray(edits[key]) || edits[key].some(item => typeof item !== 'string')) throw new Error('匹配和排除规则必须每行一条。');
      merged[key] = edits[key].map(item => item.trim()).filter(Boolean);
    }
  }
  for (const key of ['enable', 'downloadNew']) {
    if (Object.hasOwn(edits, key)) {
      if (typeof edits[key] !== 'boolean') throw new Error('订阅开关值无效。');
      merged[key] = edits[key];
    }
  }
  if (Object.hasOwn(edits, 'notDownload')) {
    if (!Array.isArray(edits.notDownload) || edits.notDownload.some((episode) => typeof episode !== 'number' || !Number.isFinite(episode))) {
      throw new Error('禁止下载的集数列表无效。');
    }
    merged.notDownload = [...new Set(edits.notDownload)].sort((a, b) => a - b);
  }
  return merged;
}
