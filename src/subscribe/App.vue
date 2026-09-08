<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, toRaw } from 'vue';
import { send } from '../shared/rpc.js';

const feeds = ref([]);
const subject = ref(null);
const page = reactive({ title: '', siteLabel: '手动订阅' });
const selectedKey = ref('manual');
const manualUrl = ref('');
const draft = ref(null);
const configured = ref(false);
const busy = ref(true);
const saved = ref(false);
const initialized = ref(false);
const operation = ref('');
const sourceForm = ref();
const subscriptionForm = ref();
const advanced = ref([]);
const editor = reactive({ title: '', subgroup: '', season: undefined, offset: undefined, match: '', exclude: '', enable: false, downloadNew: false, notDownload: [] });
const changedFlags = new Set();
const status = reactive({ message: '正在读取当前页面…', type: 'info' });
const canParse = computed(() => !busy.value && configured.value && (selectedKey.value !== 'manual' || Boolean(manualUrl.value.trim())));
const selectedFeedUrl = computed(() => selectedKey.value === 'manual' ? '' : feeds.value[Number(selectedKey.value)]?.url || '');

// Element Plus InputNumber initializes this ARIA attribute only once. Keep it
// consistent with the native disabled state across parsing and submission.
function syncDisabledAria(element, binding) {
  element.querySelector('input')?.setAttribute('aria-disabled', String(binding.value));
}
const vSyncDisabledAria = { mounted: syncDisabledAria, updated: syncDisabledAria };

function showStatus(message, type = 'info') {
  status.message = message;
  status.type = type;
}

function invalidateDraft() {
  draft.value = null;
  saved.value = false;
  changedFlags.clear();
}

function changeSource() {
  invalidateDraft();
  showStatus('RSS 已变更，请重新解析。');
}

function changeManualUrl() {
  if (draft.value) changeSource();
}

function selectedSource() {
  if (selectedKey.value === 'manual') return { url: manualUrl.value.trim() };
  const source = feeds.value[Number(selectedKey.value)];
  if (!source) throw new Error('请选择 RSS 或手动填写地址。');
  return { ...toRaw(source) };
}

function updateFeeds(nextFeeds, preferredUrl) {
  const currentUrl = preferredUrl || (selectedKey.value !== 'manual' ? feeds.value[Number(selectedKey.value)]?.url : null);
  const byUrl = new Map();
  for (const feed of nextFeeds) {
    if (!feed || typeof feed.url !== 'string') continue;
    const metadata = Object.fromEntries(Object.entries(feed).filter(([, value]) => value !== undefined));
    byUrl.set(feed.url, { ...byUrl.get(feed.url), ...metadata });
  }
  feeds.value = [...byUrl.values()];
  const matchIndex = feeds.value.findIndex((feed) => feed.url === currentUrl);
  selectedKey.value = matchIndex >= 0 ? String(matchIndex) : feeds.value.length ? '0' : 'manual';
  invalidateDraft();
}

async function refreshSettings() {
  const settings = await send('settings:get');
  configured.value = Boolean(settings?.baseUrl && settings?.apiKey);
}

function fillDraft(value) {
  draft.value = value;
  saved.value = false;
  changedFlags.clear();
  for (const name of ['title', 'subgroup']) editor[name] = value[name] ?? '';
  for (const name of ['season', 'offset']) editor[name] = value[name] ?? undefined;
  for (const name of ['match', 'exclude']) editor[name] = Array.isArray(value[name]) ? value[name].join('\n') : '';
  for (const name of ['enable', 'downloadNew']) editor[name] = value[name] === true;
  editor.notDownload = Array.isArray(value.notDownload) ? [...value.notDownload] : [];
}

function collectEdits() {
  const title = editor.title.trim();
  const subgroup = editor.subgroup.trim();
  if (!title) throw new Error('请填写番剧标题。');
  if (!subgroup) throw new Error('请填写字幕组。');
  const edits = { title, subgroup };
  for (const name of ['season', 'offset']) {
    const value = editor[name];
    if (!Number.isInteger(value) || value < (name === 'season' ? 0 : -2147483648) || value > 2147483647) {
      throw new Error(name === 'season' ? '季度需要是大于或等于 0 的整数。' : '剧集偏移需要是有效整数。');
    }
    edits[name] = value;
  }
  for (const name of ['match', 'exclude']) {
    if (changedFlags.has(name)) edits[name] = editor[name].split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }
  for (const name of ['enable', 'downloadNew']) {
    if (typeof draft.value[name] === 'boolean' || changedFlags.has(name)) edits[name] = editor[name];
  }
  edits.notDownload = [...new Set(editor.notDownload
    .filter((episode) => typeof episode === 'number' && Number.isFinite(episode)))].sort((a, b) => a - b);
  return edits;
}

async function previewSubscription() {
  if (busy.value || saved.value || !configured.value || !draft.value || !subscriptionForm.value.$el.reportValidity()) return;
  let edits;
  try {
    edits = collectEdits();
  } catch (error) {
    showStatus(error.message, 'error');
    return;
  }
  busy.value = true;
  operation.value = 'preview';
  showStatus('正在打开订阅预览窗口…');
  try {
    await send('preview:open', { draft: toRaw(draft.value), edits });
    showStatus('订阅预览已在独立窗口中打开。', 'success');
  } catch (error) {
    showStatus(error.message || '无法打开订阅预览窗口。', 'error');
  } finally {
    busy.value = false;
    operation.value = '';
  }
}

async function loadGroups() {
  if (busy.value || !configured.value || !subject.value) return;
  busy.value = true;
  operation.value = 'groups';
  showStatus('正在从 ANI-RSS 加载字幕组…');
  try {
    const result = await send('groups:get', { subject: toRaw(subject.value) });
    if (!Array.isArray(result) || !result.length) {
      showStatus('没有找到可用字幕组。可以选择页面上的 RSS，或手动粘贴地址。');
    } else {
      updateFeeds([...feeds.value, ...result]);
      showStatus(`已加载 ${result.length} 个字幕组，请选择 RSS 后解析。`, 'success');
    }
  } catch (error) {
    showStatus(error.message, 'error');
  } finally {
    busy.value = false;
    operation.value = '';
  }
}

async function parseFeed() {
  if (!canParse.value || !sourceForm.value.$el.reportValidity()) return;
  busy.value = true;
  operation.value = 'parse';
  invalidateDraft();
  showStatus('正在解析 RSS 并生成订阅信息，请稍候…');
  try {
    const value = await send('draft:create', { source: selectedSource() });
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('服务没有返回有效的订阅信息。');
    fillDraft(value);
    showStatus('解析完成，请确认订阅信息后添加。', 'success');
    await nextTick();
    document.querySelector('#draft-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    showStatus(error.message, 'error');
  } finally {
    busy.value = false;
    operation.value = '';
  }
}

async function addSubscription() {
  if (busy.value || saved.value || !configured.value || !draft.value || !subscriptionForm.value.$el.reportValidity()) return;
  try {
    const edits = collectEdits();
    busy.value = true;
    operation.value = 'add';
    showStatus('正在保存订阅，请稍候…');
    const result = await send('subscription:add', { draft: toRaw(draft.value), edits });
    saved.value = true;
    showStatus(`${result?.message || '订阅添加成功'}。可在 ANI-RSS 中查看「${edits.title}」。`, 'success');
    document.querySelector('#subscription-status')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    showStatus(error.message, 'error');
  } finally {
    busy.value = false;
    operation.value = '';
  }
}

async function openSettings() {
  try {
    await chrome.runtime.openOptionsPage();
  } catch (error) {
    showStatus(error.message || '无法打开设置页，请从扩展管理页面打开。', 'error');
  }
}

function handleFocus() {
  if (!initialized.value || busy.value) return;
  void refreshSettings().catch((error) => showStatus(error.message, 'error'));
}

async function getSourceTabId(params) {
  const requested = params.has('tabId') ? Number(params.get('tabId')) : -1;
  if (Number.isSafeInteger(requested) && requested >= 0) return requested;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return Number.isSafeInteger(tab?.id) ? tab.id : -1;
}

onMounted(async () => {
  window.addEventListener('focus', handleFocus);
  const params = new URLSearchParams(location.search);
  const tabId = await getSourceTabId(params).catch(() => -1);
  const [settingsResult, contextResult, popupSourceResult] = await Promise.allSettled([
    refreshSettings(),
    Number.isSafeInteger(tabId) && tabId >= 0 ? send('context:get', { tabId }) : Promise.resolve(null),
    Number.isSafeInteger(tabId) && tabId >= 0 ? send('popup:source', { tabId }) : Promise.resolve(null),
  ]);
  const context = contextResult.status === 'fulfilled' ? contextResult.value : null;
  subject.value = context?.subject || null;
  page.siteLabel = context?.site?.label || '手动订阅';
  page.title = context?.title || '打开番剧详情页，或手动粘贴 AniBT、Mikan、AnimeGarden 的番剧 RSS。';
  const contextFeeds = Array.isArray(context?.feeds) ? [...context.feeds] : [];
  const preferredUrl = params.get('feedUrl') || (popupSourceResult.status === 'fulfilled' ? popupSourceResult.value : null);
  if (preferredUrl && !contextFeeds.some((feed) => feed.url === preferredUrl)) contextFeeds.unshift({ url: preferredUrl, label: '页面所选 RSS' });
  updateFeeds(contextFeeds, preferredUrl);
  if (settingsResult.status === 'rejected') {
    showStatus(settingsResult.reason.message, 'error');
  } else if (contextResult.status === 'rejected') {
    showStatus(`未能读取当前页面：${contextResult.reason.message}。你仍可手动填写 RSS。`, 'error');
  } else if (!configured.value) {
    showStatus('请先完成连接设置。当前选择会保留在此窗口。');
  } else if (feeds.value.length) {
    showStatus(`找到 ${feeds.value.length} 个 RSS，选择后即可解析。`);
  } else if (subject.value) {
    showStatus('已识别当前番剧。请加载字幕组，或手动填写 RSS。');
  } else {
    showStatus('尚未发现番剧 RSS。请打开番剧详情页，或手动填写地址。');
  }
  busy.value = false;
  initialized.value = true;
  if (configured.value && subject.value?.type === 'ani-bt') await loadGroups();
});
onUnmounted(() => window.removeEventListener('focus', handleFocus));
</script>

<template>
  <main class="shell subscribe-shell">
    <header class="page-header">
      <div class="brand-mark" aria-hidden="true">A</div>
      <div class="header-copy"><p class="eyebrow">ANI-RSS · CHROME</p><h1>添加订阅</h1></div>
      <el-button id="open-settings" text @click="openSettings">连接设置</el-button>
    </header>

    <section v-if="initialized && !configured" id="setup-notice" class="notice">
      <strong>先连接你的 ANI-RSS</strong><p>填写服务地址和 API Key，保存后重新打开扩展气泡。</p>
      <el-button id="setup-button" type="primary" @click="openSettings">打开连接设置</el-button>
    </section>
    <el-alert id="subscription-status" class="status" :title="status.message" :type="status.type" :closable="false" show-icon :role="status.type === 'error' ? 'alert' : 'status'" aria-live="polite" />

    <el-card class="card" shadow="never" aria-labelledby="source-heading">
      <div class="section-heading"><span class="step-number" aria-hidden="true">01</span><h2 id="source-heading">选择 RSS</h2><el-tag id="site-label" class="site-label" effect="light">{{ page.siteLabel }}</el-tag></div>
      <p id="page-title" class="context-title">{{ page.title }}</p>
      <el-form id="source-form" ref="sourceForm" :disabled="busy" label-position="top" @submit.prevent="parseFeed">
        <el-form-item label="可用 RSS" for="feed-select">
          <el-select id="feed-select" v-model="selectedKey" :disabled="busy" aria-label="可用 RSS" @change="changeSource">
            <el-option v-for="(feed, index) in feeds" :key="feed.url" :value="String(index)" :label="feed.label || feed.subgroup || feed.url" :title="feed.url" />
            <el-option value="manual" label="手动输入 RSS 地址" />
          </el-select>
          <span v-if="selectedFeedUrl" class="feed-address" aria-label="当前 RSS 地址">{{ selectedFeedUrl }}</span>
        </el-form-item>
        <el-form-item v-if="selectedKey === 'manual'" id="manual-feed-field" label="RSS 地址" for="manual-feed" required>
          <el-input id="manual-feed" v-model="manualUrl" type="url" placeholder="粘贴当前番剧的 RSS 地址" :spellcheck="false" autocomplete="off" required @input="changeManualUrl" />
          <small>RSS 必须限定单个番剧和一个字幕组，也可以包含语言等筛选条件。</small>
        </el-form-item>
        <div class="actions">
          <el-button id="parse-button" type="primary" native-type="submit" :disabled="!canParse" :loading="operation === 'parse'">解析 RSS</el-button>
          <el-button v-if="subject" id="groups-button" :disabled="busy || !configured" :loading="operation === 'groups'" @click="loadGroups">加载字幕组</el-button>
        </div>
      </el-form>
    </el-card>

    <el-card v-if="draft" id="draft-card" class="card" shadow="never" aria-labelledby="draft-heading">
      <div class="section-heading"><span class="step-number" aria-hidden="true">02</span><h2 id="draft-heading">确认订阅信息</h2></div>
      <el-form id="subscription-form" ref="subscriptionForm" :model="editor" :disabled="busy || saved" label-position="top" @submit.prevent="addSubscription">
        <el-form-item label="番剧标题" for="draft-title" required><el-input id="draft-title" v-model="editor.title" required /></el-form-item>
        <el-form-item label="字幕组" for="draft-subgroup" required><el-input id="draft-subgroup" v-model="editor.subgroup" placeholder="由 RSS 解析获取" required /></el-form-item>
        <div class="field-grid">
          <el-form-item label="季度" for="draft-season" required><el-input-number id="draft-season" v-sync-disabled-aria="busy || saved" v-model="editor.season" :min="0" :max="2147483647" :step="1" controls-position="right" /></el-form-item>
          <el-form-item label="剧集偏移" for="draft-offset" required><el-input-number id="draft-offset" v-sync-disabled-aria="busy || saved" v-model="editor.offset" :min="-2147483648" :max="2147483647" :step="1" controls-position="right" /></el-form-item>
        </div>
        <div class="check-list">
          <el-checkbox id="draft-enable" v-model="editor.enable" @change="changedFlags.add('enable')">启用订阅</el-checkbox>
          <el-checkbox id="draft-download-new" v-model="editor.downloadNew" @change="changedFlags.add('downloadNew')">只下载最新集</el-checkbox>
        </div>
        <el-collapse v-model="advanced" class="advanced">
          <el-collapse-item name="rules" title="高级设置 · 匹配与排除规则">
            <el-form-item label="匹配规则" for="draft-match"><el-input id="draft-match" v-model="editor.match" type="textarea" :rows="3" placeholder="每行一条" :spellcheck="false" @input="changedFlags.add('match')" /></el-form-item>
            <el-form-item label="排除规则" for="draft-exclude"><el-input id="draft-exclude" v-model="editor.exclude" type="textarea" :rows="3" placeholder="每行一条" :spellcheck="false" @input="changedFlags.add('exclude')" /><small>规则语法与 ANI-RSS 中的设置一致。</small></el-form-item>
          </el-collapse-item>
        </el-collapse>
        <div class="submit-row">
          <p>可先预览匹配结果，也可以直接添加。</p>
          <div class="actions">
            <el-button id="preview-button" :disabled="busy || saved || !configured" :loading="operation === 'preview'" @click="previewSubscription">预览</el-button>
            <el-button id="add-button" type="primary" native-type="submit" :disabled="busy || saved || !configured" :loading="operation === 'add'">{{ saved ? '已添加订阅' : '添加订阅' }}</el-button>
          </div>
        </div>
      </el-form>
    </el-card>

    <footer class="page-footer">选好番剧，让 ANI-RSS 接管更新。</footer>
  </main>
</template>
