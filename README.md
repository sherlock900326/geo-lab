# Goodbooks 多站文章发布

这套工具管理 `goodbooks.cc` 总站和 14 个子域名。每个站点使用独立的标题、摘要、正文和 canonical URL。文章保存在两个 GitHub 仓库中；推送到 `main` 后，现有 Cloudflare Pages 项目会自动构建。

## 首次接入

将本仓库 `geo-lab` 与 `zengfanblog` 克隆到同一目录。工具优先寻找同级的 `zengfanblog`，也支持当前工作目录名 `goodbooks-secondary-work`；还可设置环境变量 `GOODBOOKS_SECONDARY_DIR` 指定路径。需要 Node.js 和具有两个仓库写权限的 Git。

首次必须把两个仓库新增的 `build-site.mjs`、`.gitignore` 及本仓库的 `publisher.mjs` 提交并推送，然后把 Cloudflare Pages 的构建配置改成下表。根目录保持 `/`，生产分支保持 `main`。切换配置前先在本地执行对应构建命令，确认输出目录存在。

| 域名 | 仓库 | Build command | Build output directory |
| --- | --- | --- | --- |
| goodbooks.cc | geo-lab | `node build-site.mjs home` | `dist-home` |
| geo.goodbooks.cc | geo-lab | `node build-site.mjs geo` | `dist-geo` |
| atlas.goodbooks.cc | geo-lab | `node build-site.mjs atlas` | `dist-atlas` |
| blocks.goodbooks.cc | geo-lab | `node build-site.mjs blocks` | `dist-blocks` |
| fieldnotes.goodbooks.cc | geo-lab | `node build-site.mjs fieldnotes` | `dist-fieldnotes` |
| gallery.goodbooks.cc | geo-lab | `node build-site.mjs gallery` | `dist-gallery` |
| signal.goodbooks.cc | geo-lab | `node build-site.mjs signal` | `dist-signal` |
| ledger.goodbooks.cc | geo-lab | `node build-site.mjs ledger` | `dist-ledger` |
| blog.goodbooks.cc | zengfanblog | `node build-site.mjs blog` | `dist-blog` |
| journal.goodbooks.cc | zengfanblog | `node build-site.mjs journal` | `dist-journal` |
| archive.goodbooks.cc | zengfanblog | `node build-site.mjs archive` | `dist-archive` |
| folio.goodbooks.cc | zengfanblog | `node build-site.mjs folio` | `dist-folio` |
| studio.goodbooks.cc | zengfanblog | `node build-site.mjs studio` | `dist-studio` |
| type.goodbooks.cc | zengfanblog | `node build-site.mjs type` | `dist-type` |
| terminal.goodbooks.cc | zengfanblog | `node build-site.mjs terminal` | `dist-terminal` |

## 本机网页后台

双击桌面上的 `Goodbooks 发布后台.command`，会在终端启动本机后台并自动打开浏览器。后台地址是 `http://127.0.0.1:4173`；关闭终端窗口即可停止服务。也可以在本仓库运行 `node admin-server.mjs --open`。后台只监听本机地址，不部署到公网。

网页后台支持上传 `.doc`、`.docx`、`.md`、`.txt` 原稿或直接粘贴 Markdown。Word 文件会在本机提取为纯文本，再供你逐站调整格式与内容。可选择一个或多个域名，为每站编辑独立版本，保存本地草稿，确认后统一发送。发送记录按域名、发送日期、状态筛选。草稿与历史存放在本机 `admin-data/`，不会进入 Git。`已提交` 表示 GitHub 推送成功，Cloudflare Pages 的上线仍需等待其部署完成；`需核查` 表示发布命令失败，可能已有部分仓库推送成功，应先查看错误和 GitHub 状态再重试。

快速发布只需上传或粘贴文章、选择站点、确认发送。后台从 Markdown 一级标题或正文首行提取标题，从正文段落提取搜索摘要和首页摘要；分类默认是「文章」，也可从文章开头的 YAML `category` 或「分类」字段读取。发布日期默认为今天，文章链接名自动生成。所有信息仍可在可选设置中修改；按站点单独调整也保留为可选功能。

工作台的站点快捷入口和「站点目录」列出总站与全部子域名，点击域名会在新标签页打开网站。站点目录显示每站最近一次已提交的文章链接；「最近发送」和「发送记录」也可以直接打开对应文章核对部署结果。

## 命令行发文

在 `geo-lab` 仓库执行：

```sh
node publisher.mjs init my-article-slug
```

这会生成 `drafts/my-article-slug/article.json`，以及每站一份 JSON 元数据和 HTML 正文。可在 `article.json` 的 `sites` 中删除不需要发布的域名，只保留至少一个站点。编辑选中站点的内容：`title` 标题、`description` 搜索摘要、`summary` 首页摘要、`category` 分类、`bodyFile` 正文文件。正文可写 `<p>`、`<h2>`、`<ul>` 等 HTML；只放自己信任的内容。`article.json` 里的 `date` 为发布日期，可自行修改。

```sh
node publisher.mjs check drafts/my-article-slug/article.json
node publisher.mjs prepare drafts/my-article-slug/article.json
node publisher.mjs publish drafts/my-article-slug/article.json
```

`check` 只校验；`prepare` 写入选中站点所在的仓库并在本地生成对应 `dist-*` 页面，便于预览；`publish` 再次校验、构建，只提交这篇文章在选中站点的内容文件，并推送相关仓库的 `main`。Cloudflare Pages 随后自动部署。`publish` 允许此前 `prepare` 生成的同篇内容及本机后台工具文件的未提交改动，但会拒绝其他未提交改动和暂存区中的改动。若第二个仓库推送失败，修复 Git 连接或权限后重试同一命令即可。

草稿和构建目录不会进入 Git。正式文章内容保存在各站的 `content/<site>/<slug>.json`。新文章会出现在各站首页和 sitemap 中，对外 URL 是 `https://<domain>/posts/<slug>`（旧的 `.html` 地址会跳转到该地址）。

## Google 收录

各站构建时会自动更新自己的 `sitemap.xml`，新文章的页面会包含指向本站最终网址的 canonical 标签；每个站点的 `robots.txt` 也会指向自己的 sitemap。总站另有 `https://goodbooks.cc/sitemap-index.xml`，汇总 15 个站点的 sitemap。发布新文章后，无需逐篇重复提交 sitemap。

首次接入时，在 Google Search Console 添加 `goodbooks.cc` **网域资源**并验证所有权。网域资源覆盖总站及其子域名。后台的「Google 收录」页自动汇总 15 站文章网址，提供 CSV 导出；总站原有文章也进入总站 sitemap。

要让本机后台读取 Google 的实际索引状态，需要一次性连接 Search Console API：

1. 在 Google Cloud Console 创建项目，启用 **Google Search Console API**，配置 OAuth 同意屏幕。若应用处于测试状态，把自己的 Google 账号加入测试用户。
2. 创建 OAuth 客户端，应用类型选 **桌面应用**，下载 JSON。在后台「Google 收录」页点击「导入 OAuth 客户端」，选择该文件；再点击「连接 Google」，使用拥有 `goodbooks.cc` 网域资源的账号授权。
3. 连接后，后台会依次向 Search Console 提交 15 个独立站点地图、读取地图状态、检查清单中的文章索引状态。后续每次发文，后台等页面出现在对应 sitemap 后再次提交该站地图；后台运行时每天检查文章索引状态。也可在页面手动重查或导出清单。

OAuth 客户端、访问令牌和检查结果仅保存在本机 `admin-data/`（Git 忽略此目录）。本机后台需要持续运行，定时检查才会执行。Google API 返回的「已收录」「未收录」「检查失败」分别展示，不会把发布成功或地图提交成功算作已收录。

提交 sitemap 表示让 Google 发现页面，不等于保证收录，也不等于立刻出现在搜索结果。发布记录中的「已提交」只表示 GitHub 推送成功。Google Indexing API 仅支持特定结构化内容，不适用于这些普通文章；Search Console API 可以查询索引状态和提交站点地图，但没有为普通文章提供逐篇请求收录的 API。
