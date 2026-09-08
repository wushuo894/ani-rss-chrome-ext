import { createApp } from 'vue';
import { ElAlert, ElButton, ElCard, ElForm, ElFormItem, ElInput, ElTag } from 'element-plus';
import 'element-plus/dist/index.css';
import '../styles/ui.css';
import App from './App.vue';

const app = createApp(App);
for (const component of [ElAlert, ElButton, ElCard, ElForm, ElFormItem, ElInput, ElTag]) {
  app.component(component.name, component);
}
app.mount('#app');
