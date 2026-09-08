# ANI-RSS Chrome 订阅助手

在 AniBT、Mikan 和 AnimeGarden（AG）页面中选择番剧与字幕组，将订阅添加到自己的 ANI-RSS。设置页与工具栏订阅气泡使用 Vue 3 + Element Plus，构建后的扩展使用 Chrome Manifest V3。

## 构建与安装

开发环境需要 Node.js 22.12 或更新版本、pnpm 10；运行扩展需要 Chrome 127 或更新版本。

```bash
cd ani-rss-chrome-ext
pnpm install
pnpm build
```

1. 打开 Chrome 的 `chrome://extensions`，开启右上角“开发者模式”。
2. 点击“加载已解压的扩展程序”，选择本目录中的 **`dist` 文件夹**。
3. 将“ANI-RSS 订阅助手”固定到工具栏，打开扩展的“选项”进行配置。
4. 更新代码后重新运行 `pnpm build`，在扩展管理页面点击重新加载，并刷新已打开的站点页面。

正式使用只需要生成的 `dist` 目录；扩展不从 CDN 加载 Vue 或组件库。

## GitHub Actions 发布

仓库提供 **Package and Release Chrome Extension** 工作流。发布前修改 `public/manifest.json` 中的 `version` 并推送代码，然后在 GitHub 仓库的 **Actions** 页面选择该工作流，点击 **Run workflow** 手动触发。

工作流会安装锁定依赖、构建 `dist`、生成 `ani-rss-chrome-ext-v<版本号>.zip`，并创建 `v<版本号>` GitHub Release。运行时可选择是否标记为预发布版本；同版本 Release 已存在时不会覆盖，需要先提升 Manifest 版本号。

## 连接 ANI-RSS

填写 ANI-RSS 首页地址，例如：

- 本机：`http://127.0.0.1:7789/`
- 局域网：`http://192.168.1.10:7789/`
- HTTPS 与反向代理子路径：`https://example.com/ani-rss/`

API Key 在 ANI-RSS 的“设置 → 登录”中获取。填写后点击“测试连接”或“保存”，按 Chrome 提示允许访问填写的服务主机。Chrome 的主机权限以协议和主机名为范围，不能进一步限定端口或代理子路径。

地址必须包含 `http://` 或 `https://`，不要填写 `/api`，也不能带账号密码、查询参数或 `#`。扩展保留代理子路径，例如上述 HTTPS 地址的解析请求会发送到 `/ani-rss/api/rssToAni`。

地址与 API Key 仅保存于本机扩展存储，不同步到浏览器账号；内容脚本不能读取这份存储。访问 ANI-RSS 的请求由扩展后台发送，以 `api-key` 请求头认证。

## 使用

1. 打开支持站点的番剧详情页，点击页面右下角的“订阅到 ANI-RSS”，或点击浏览器工具栏图标。
2. 在工具栏气泡中选择单个字幕组的 RSS；未发现 RSS 时，点击“加载字幕组”，或手动粘贴限定字幕组的番剧 RSS 地址。
3. 点击“解析 RSS”，等待 ANI-RSS 返回订阅草稿。
4. 检查标题、字幕组、季度、剧集偏移与下载开关；高级设置可编辑匹配/排除规则，每行一条。
5. 可选点击“预览”，在浏览器独立窗口中查看最终下载位置、匹配资源、重命名结果、下载状态和缺失集数，并可允许或禁止选中集下载。
6. 在编辑区或独立预览窗口中点击“添加订阅”。成功后，同一草稿无法再次提交；需要添加其他 RSS 时重新解析。

打开气泡、选择 RSS 和解析草稿都不会保存订阅。气泡在点击浏览器其他区域后会自动关闭；切换 RSS 会使旧草稿失效。下载目录、重命名、通知等未展示字段保留 ANI-RSS 返回的设置。

| 站点 | 自动识别域名 | 番剧详情页 |
| --- | --- | --- |
| AniBT | `anibt.net` | `/anime/<Bangumi ID>` |
| Mikan | `mikanani.me`、`mikanime.tv`、`mikan.sakiko.de` | `/Home/Bangumi/<Mikan ID>` |
| AnimeGarden | `animes.garden`、`api.animes.garden` | `/subject/<Bangumi ID>` 或限定一个作品的筛选页 |

仅接受限定单个作品和一个字幕组的 RSS。“全部字幕组”、多个字幕组、全站 RSS、用户合集和多个作品的搜索 RSS 均不可用于添加订阅。其他镜像域名暂不支持。

## 测试

```bash
pnpm test
pnpm build
```

自动化单元测试覆盖站点解析、API 参数与响应、鉴权、草稿字段保留、错误和重复提交保护。

开发依赖包含 Playwright Core，浏览器测试另需安装支持自动加载扩展的 Chromium：

```bash
npx playwright-core install chromium
pnpm test:browser
```

也可以使用现有 Playwright 与 Chrome for Testing：

```bash
PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs \
CHROME_EXECUTABLE=/absolute/path/to/chrome-for-testing/chrome \
pnpm test:browser
```

`EXTENSION_DIR` 可指定其他构建目录，`HEADED=1` 可显示测试浏览器，`SCREENSHOT_DIR` 可保存界面截图。默认使用独立临时浏览器配置，不访问现有用户配置。

浏览器测试加载真实扩展，用本地模拟 API 和模拟网站验证设置、后台消息、工具栏订阅气泡、三站解析、保存和动态页面入口。为运行无头测试，仅对 `/tmp` 中的扩展副本预授予 `http://127.0.0.1/*` 权限；原始构建不变。Chrome 原生主机授权对话框需在安装时人工确认。测试不使用真实 API Key，也不会向真实 ANI-RSS 添加订阅。

部分系统品牌版 Chrome 禁止通过 `--load-extension` 自动加载扩展；浏览器测试请使用 Playwright Chromium 或 Chrome for Testing。日常使用仍可在 Chrome 的扩展管理页面手动安装。

## 常见问题与限制

- **没有页面按钮**：确认域名和详情页格式属于上表；扩展重新加载后刷新网页，也可以点击工具栏图标进入并手动填写 RSS。
- **页面按钮无法打开气泡**：确认 Chrome 版本不低于 127，并将扩展固定到工具栏后重试；已选择的 RSS 会在下一次打开气泡时读取。
- **没有字幕组或 RSS**：服务端可能未取到数据；检查 ANI-RSS 日志与该站点的可访问性。
- **认证失败**：检查 API Key、服务地址和反向代理是否保留 `api-key` 请求头。
- **返回非 JSON / 无法连接**：检查地址及代理子路径，确认没有跳转到登录页、HTTPS 跳转或失效证书。扩展不会自动跟随接口重定向。
- **未获访问权限**：到扩展设置重新保存并允许该服务主机权限。
- **添加订阅超时**：先到 ANI-RSS 检查是否已添加，再决定是否重试；扩展不会自动重试写入。
- **重复标题**：重复与自动替换规则沿用 ANI-RSS 服务端设置。

第一版支持添加订阅，不包含批量添加、已有订阅管理和 Chrome 商店发布。站点改版、镜像差异及服务端网络状态可能影响识别与解析；实际订阅结果以 ANI-RSS 为准。
