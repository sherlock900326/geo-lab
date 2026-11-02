# Goodbooks 多站文章发布

这套工具管理 `goodbooks.cc` 总站和 14 个子域名。每个站点使用独立的标题、摘要、正文和 canonical URL。文章保存在两个 GitHub 仓库中；推送到 `main` 后，现有 Cloudflare Pages 项目会自动构建。

## 首次接入

将本仓库 `geo-lab` 与 `zengfanblog` 克隆到同一目录。默认第二个仓库目录叫 `goodbooks-secondary-work`；也可设置环境变量 `GOODBOOKS_SECONDARY_DIR` 指定路径。需要 Node.js 和具有两个仓库写权限的 Git。

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

## 发一篇文章

在 `geo-lab` 仓库执行：

```sh
node publisher.mjs init my-article-slug
```

这会生成 `drafts/my-article-slug/article.json`，以及每站一份 JSON 元数据和 HTML 正文。编辑 15 份内容：`title` 标题、`description` 搜索摘要、`summary` 首页摘要、`category` 分类、`bodyFile` 正文文件。正文可写 `<p>`、`<h2>`、`<ul>` 等 HTML；只放自己信任的内容。`article.json` 里的 `date` 为发布日期，可自行修改。

```sh
node publisher.mjs check drafts/my-article-slug/article.json
node publisher.mjs prepare drafts/my-article-slug/article.json
node publisher.mjs publish drafts/my-article-slug/article.json
```

`check` 只校验；`prepare` 写入两个仓库并在本地生成 15 站的 `dist-*` 页面，便于预览；`publish` 再次校验、构建，只提交这篇文章在两个仓库中的内容文件，并推送 `main`。Cloudflare Pages 随后自动部署。`publish` 允许此前 `prepare` 生成的同篇内容，但会拒绝其他未提交改动。若第二个仓库推送失败，修复 Git 连接或权限后重试同一命令即可。

草稿和构建目录不会进入 Git。正式文章内容保存在各站的 `content/<site>/<slug>.json`。新文章会出现在各站首页和 sitemap 中，URL 是 `https://<domain>/posts/<slug>.html`。
