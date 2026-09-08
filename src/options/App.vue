<script setup>
import { onMounted, reactive, ref } from 'vue';
import { normalizeBaseUrl, hostPattern } from '../shared/api.js';
import { send } from '../shared/rpc.js';

const form = reactive({ baseUrl: '', apiKey: '' });
const formRef = ref();
const busy = ref(true);
const operation = ref('');
const status = reactive({ message: '正在读取设置…', type: 'info' });

function showStatus(message, type = 'info') {
  status.message = message;
  status.type = type;
}

async function applySettings(action) {
  if (busy.value || !formRef.value.$el.reportValidity()) return;
  busy.value = true;
  operation.value = action;
  try {
    const baseUrl = normalizeBaseUrl(form.baseUrl);
    const apiKey = form.apiKey.trim();
    if (!apiKey) throw new Error('请填写 API Key。');
    // Keep permission request in the user gesture, before any RPC or async validation.
    const granted = await chrome.permissions.request({ origins: [hostPattern(baseUrl)] });
    if (!granted) throw new Error('尚未允许访问该服务。请再次点击按钮，并授予访问权限。');
    form.baseUrl = baseUrl;
    showStatus(action === 'save' ? '正在保存连接设置…' : '正在连接 ANI-RSS…');
    const data = await send(`settings:${action}`, { settings: { baseUrl, apiKey } });
    if (action === 'save') {
      form.baseUrl = data?.baseUrl || baseUrl;
      showStatus('设置已保存。返回订阅窗口即可继续；也可以测试连接。', 'success');
    } else {
      showStatus('连接成功，ANI-RSS 可以正常访问。请保存设置后开始订阅。', 'success');
    }
  } catch (error) {
    showStatus(error.message || '操作失败，请检查服务地址和 API Key。', 'error');
  } finally {
    busy.value = false;
    operation.value = '';
  }
}

onMounted(async () => {
  try {
    const settings = await send('settings:get');
    form.baseUrl = settings?.baseUrl || '';
    form.apiKey = settings?.apiKey || '';
    showStatus(form.baseUrl && form.apiKey ? '已读取本机保存的设置。' : '填写服务地址与 API Key，开始连接。');
  } catch (error) {
    showStatus(error.message, 'error');
  } finally {
    busy.value = false;
  }
});
</script>

<template>
  <main class="shell options-shell">
    <header class="page-header">
      <div class="brand-mark" aria-hidden="true">A</div>
      <div><p class="eyebrow">ANI-RSS · CHROME</p><h1>连接你的 ANI-RSS</h1></div>
    </header>
    <p class="page-intro">在喜欢的番剧页面，直接添加订阅。</p>
    <div class="site-tags" aria-label="支持站点"><el-tag effect="plain">AniBT</el-tag><el-tag effect="plain">Mikan</el-tag><el-tag effect="plain">AnimeGarden</el-tag></div>

    <el-card class="card" shadow="never" aria-labelledby="connection-heading">
      <div class="section-heading"><span class="step-number" aria-hidden="true">01</span><h2 id="connection-heading">服务连接</h2></div>
      <el-form id="settings-form" ref="formRef" :model="form" :disabled="busy" label-position="top" @submit.prevent="applySettings('save')">
        <el-form-item label="ANI-RSS 服务地址" for="base-url" required>
          <el-input id="base-url" v-model="form.baseUrl" type="url" placeholder="http://127.0.0.1:7789/" autocomplete="url" :spellcheck="false" required aria-describedby="base-url-hint" />
          <small id="base-url-hint">填写可访问的完整地址，支持代理子路径，例如 https://example.com/ani-rss/。</small>
        </el-form-item>
        <el-form-item label="API Key" for="api-key" required>
          <el-input id="api-key" v-model="form.apiKey" type="password" show-password autocomplete="off" :spellcheck="false" required aria-describedby="api-key-hint" />
          <small id="api-key-hint">在 ANI-RSS 的「设置 → 登录 → API Key」中获取。密钥仅保存在本机浏览器。</small>
        </el-form-item>
        <div class="actions">
          <el-button id="save-button" type="primary" native-type="submit" :disabled="busy" :loading="operation === 'save'">保存设置</el-button>
          <el-button id="test-button" :disabled="busy" :loading="operation === 'test'" @click="applySettings('test')">测试连接</el-button>
        </div>
      </el-form>
      <el-alert id="settings-status" class="status" :title="status.message" :type="status.type" :closable="false" show-icon :role="status.type === 'error' ? 'alert' : 'status'" aria-live="polite" />
    </el-card>

    <aside class="note"><strong>接下来</strong><p>打开番剧详情页，点击「订阅到 ANI-RSS」或浏览器工具栏中的扩展图标，选择 RSS 并确认订阅。</p></aside>
    <footer class="page-footer">服务访问权限会在保存或测试时申请。</footer>
  </main>
</template>
