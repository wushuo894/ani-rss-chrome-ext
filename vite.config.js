import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const extensionFiles = [
  'src/background/index.js',
  'src/content/index.js',
  'src/content/style.css',
  'src/shared/api.js',
  'src/shared/sites.js',
];

export default defineConfig({
  base: './',
  plugins: [
    vue(),
    {
      name: 'copy-extension-files',
      buildStart() {
        for (const file of extensionFiles) this.addWatchFile(resolve(root, file));
      },
      async writeBundle() {
        const destination = resolve(root, 'dist');
        await mkdir(destination, { recursive: true });
        await Promise.all(extensionFiles.map(async file => {
          const output = resolve(destination, file);
          await mkdir(dirname(output), { recursive: true });
          await cp(resolve(root, file), output);
        }));
      }
    }
  ],
  build: {
    target: 'chrome127',
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: { options: resolve(root, 'options.html'), subscribe: resolve(root, 'subscribe.html') }
    }
  }
});
