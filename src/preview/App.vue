<script setup>
import { computed, onMounted, reactive, ref, toRaw } from 'vue';
import { send } from '../shared/rpc.js';

const loading = ref(true);
const busy = ref(false);
const saved = ref(false);
const filter = ref('all');
const selection = ref([]);
const table = ref();
const subscription = ref(null);
const preview = reactive({ downloadPath: '', items: [], omitList: [] });
const status = reactive({ message: '', type: 'info' });

const shownItems = computed(() => preview.items.filter((item) => {
  if (filter.value === 'downloaded') return item.hasDownloaded;
  if (filter.value === 'pending') return !item.hasDownloaded;
  return true;
}));
const selectedEpisodes = computed(() => [...new Set(selection.value
  .map((item) => item.episode)
  .filter((episode) => typeof episode === 'number' && Number.isFinite(episode)))]);
const notDownload = computed(() => Array.isArray(subscription.value?.notDownload) ? subscription.value.notDownload : []);

function clearSelection() {
  selection.value = [];
  table.value?.clearSelection();
}

function closeWindow() {
  window.close();
}

function willDownload(item) {
  return item.episode === null || !notDownload.value.includes(item.episode);
}

function setDownloadAllowed(allowed) {
  if (!selectedEpisodes.value.length || !subscription.value) return;
  const excluded = new Set(notDownload.value);
  for (const episode of selectedEpisodes.value) {
    if (allowed) excluded.delete(episode);
    else excluded.add(episode);
  }
  subscription.value.notDownload = [...excluded].sort((a, b) => a - b);
  clearSelection();
}

async function addSubscription() {
  if (loading.value || busy.value || saved.value || !subscription.value) return;
  busy.value = true;
  status.message = '正在保存订阅，请稍候…';
  status.type = 'info';
  try {
    const result = await send('subscription:add', { draft: toRaw(subscription.value) });
    saved.value = true;
    status.message = `${result?.message || '订阅添加成功'}。可在 ANI-RSS 中查看「${subscription.value.title}」。`;
    status.type = 'success';
  } catch (error) {
    status.message = error.message || '添加订阅失败。';
    status.type = 'error';
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  try {
    const id = new URLSearchParams(location.search).get('id');
    const result = await send('preview:get', { id });
    subscription.value = result.subscription;
    Object.assign(preview, result.preview);
  } catch (error) {
    status.message = error.message || '无法生成订阅预览。';
    status.type = 'error';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <main class="shell preview-shell">
    <header class="page-header">
      <div class="brand-mark" aria-hidden="true">A</div>
      <div class="header-copy"><p class="eyebrow">ANI-RSS · CHROME</p><h1>订阅预览</h1></div>
      <el-button text @click="closeWindow">关闭窗口</el-button>
    </header>

    <section class="preview-content">
      <div v-if="loading" class="preview-loading" role="status">正在读取 RSS 并计算重命名结果…</div>
      <el-alert v-else-if="status.type === 'error' && !subscription" :title="status.message" type="error" :closable="false" show-icon role="alert" />
      <template v-else>
        <el-alert v-if="status.message" class="status" :title="status.message" :type="status.type" :closable="false" show-icon :role="status.type === 'error' ? 'alert' : 'status'" />
        <div class="preview-summary">
          <span>最终下载位置</span>
          <code>{{ preview.downloadPath || '未设置' }}</code>
        </div>
        <div class="preview-toolbar">
          <el-select v-model="filter" class="preview-filter" aria-label="预览资源筛选" @change="clearSelection">
            <el-option value="all" label="全部资源" />
            <el-option value="downloaded" label="已下载" />
            <el-option value="pending" label="未下载" />
          </el-select>
          <div class="actions">
            <el-button :disabled="!selectedEpisodes.length || saved" @click="setDownloadAllowed(true)">允许下载</el-button>
            <el-button :disabled="!selectedEpisodes.length || saved" @click="setDownloadAllowed(false)">禁止下载</el-button>
          </div>
        </div>
        <el-table ref="table" class="preview-table" :data="shownItems" height="calc(100vh - 300px)" size="small" stripe scrollbar-always-on empty-text="没有匹配到资源" @selection-change="selection = $event">
          <el-table-column type="selection" width="44" :selectable="() => !saved" />
          <el-table-column label="下载" width="70">
            <template #default="{ row }"><el-tag :type="willDownload(row) ? 'success' : 'info'" effect="light">{{ willDownload(row) ? '是' : '否' }}</el-tag></template>
          </el-table-column>
          <el-table-column label="已下载" width="78">
            <template #default="{ row }"><el-tag :type="row.hasDownloaded ? 'success' : 'info'" effect="light">{{ row.hasDownloaded ? '是' : '否' }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="episode" label="集数" width="66" />
          <el-table-column prop="subgroup" label="字幕组" width="140" show-overflow-tooltip />
          <el-table-column label="标题" min-width="320">
            <template #default="{ row }"><span class="preview-cell">{{ row.title || '—' }}</span></template>
          </el-table-column>
          <el-table-column label="重命名" min-width="260">
            <template #default="{ row }"><span class="preview-cell">{{ row.reName || '—' }}</span></template>
          </el-table-column>
          <el-table-column prop="pubDate" label="发布时间" width="112" />
          <el-table-column prop="formatSize" label="大小" width="96" />
          <el-table-column prop="infoHash" label="InfoHash" width="190" show-overflow-tooltip />
        </el-table>
        <el-alert v-if="preview.omitList.length" class="preview-missing" :title="`缺少集数：${preview.omitList.slice(0, 10).join('、')}`" type="warning" :closable="false" show-icon />
        <div class="preview-footer">
          <span>共 {{ shownItems.length }} 项<span v-if="notDownload.length">，已禁止 {{ notDownload.length }} 集</span></span>
          <div class="actions">
            <el-button @click="closeWindow">关闭</el-button>
            <el-button type="primary" :disabled="busy || saved" :loading="busy" @click="addSubscription">{{ saved ? '已添加订阅' : '添加订阅' }}</el-button>
          </div>
        </div>
      </template>
    </section>
  </main>
</template>
