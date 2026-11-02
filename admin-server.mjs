import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { renderMarkdown } from './admin/markdown.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const dataDirectory = join(root, 'admin-data');
const draftsDirectory = join(dataDirectory, 'drafts');
const historyPath = join(dataDirectory, 'history.json');
const port = Number(process.env.GOODBOOKS_ADMIN_PORT ?? 4173);
const token = randomBytes(24).toString('hex');
const sites = [
  ['home', 'goodbooks.cc', '总站'], ['geo', 'geo.goodbooks.cc', '研究'],
  ['atlas', 'atlas.goodbooks.cc', '图谱'], ['blocks', 'blocks.goodbooks.cc', '模块'],
  ['fieldnotes', 'fieldnotes.goodbooks.cc', '田野笔记'], ['gallery', 'gallery.goodbooks.cc', '画廊'],
  ['signal', 'signal.goodbooks.cc', '信号'], ['ledger', 'ledger.goodbooks.cc', '记录'],
  ['blog', 'blog.goodbooks.cc', '博客'], ['journal', 'journal.goodbooks.cc', '期刊'],
  ['archive', 'archive.goodbooks.cc', '档案'], ['folio', 'folio.goodbooks.cc', '专辑'],
  ['studio', 'studio.goodbooks.cc', '工作室'], ['type', 'type.goodbooks.cc', '排版'],
  ['terminal', 'terminal.goodbooks.cc', '终端'],
].map(([id, domain, label]) => ({ id, domain, label }));
const siteIds = new Set(sites.map(site => site.id));
const staticFiles = new Map([
  ['/', ['admin/index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['admin/styles.css', 'text/css; charset=utf-8']],
  ['/readable.css', ['admin/readable.css', 'text/css; charset=utf-8']],
  ['/app.js', ['admin/app.js', 'text/javascript; charset=utf-8']],
  ['/markdown.mjs', ['admin/markdown.mjs', 'text/javascript; charset=utf-8']],
  ['/article-metadata.mjs', ['admin/article-metadata.mjs', 'text/javascript; charset=utf-8']],
  ['/article-slug.mjs', ['admin/article-slug.mjs', 'text/javascript; charset=utf-8']],
]);
let publishing = false;

mkdirSync(draftsDirectory, { recursive: true });
if (existsSync(historyPath)) {
  const interrupted = JSON.parse(readFileSync(historyPath, 'utf8'));
  if (interrupted.some(record => record.status === 'sending')) {
    for (const record of interrupted) {
      if (record.status === 'sending') {
        record.status = 'needs_review';
        record.error = '后台上次运行期间中断；请核对 GitHub 与 Cloudflare 的发布结果。';
      }
    }
    writeFileSync(historyPath, JSON.stringify(interrupted, null, 2) + '\n');
  }
}

function respond(response, status, value, contentType = 'application/json; charset=utf-8') {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'",
  });
  response.end(contentType.startsWith('application/json') ? JSON.stringify(value) : value);
}

function readHistory() {
  return existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, 'utf8')) : [];
}

function localDay(value) {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

function saveJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  renameSync(temporary, path);
}

function validateSlug(slug) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug ?? '')) throw new Error('文章链接名只能使用小写英文字母、数字和连字符');
}

function validateDraft(draft, strict = false) {
  if (!draft || typeof draft !== 'object') throw new Error('文章数据无效');
  validateSlug(draft.slug);
  const date = draft.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('发布日期无效');
  if (!Array.isArray(draft.selectedSites) || !draft.selectedSites.length || new Set(draft.selectedSites).size !== draft.selectedSites.length || draft.selectedSites.some(site => !siteIds.has(site))) throw new Error('请至少选择一个有效域名');
  if (!draft.variants || typeof draft.variants !== 'object') throw new Error('请填写站点文章');
  if (strict) {
    for (const site of draft.selectedSites) {
      const variant = draft.variants[site];
      for (const field of ['title', 'description', 'summary', 'category', 'markdown']) {
        if (!variant || typeof variant[field] !== 'string' || !variant[field].trim()) throw new Error(`${site}: 请填写${field}`);
      }
    }
  }
}

async function readJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('请使用 JSON 格式');
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 12_000_000) throw new Error('文章数据超过 12 MB');
  }
  return JSON.parse(body);
}

function runPublisher(manifestPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['publisher.mjs', 'publish', manifestPath], { cwd: root, env: process.env });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      output = (output + chunk.toString()).slice(-20_000);
    });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(output.trim() || `发布命令退出：${code}`)));
  });
}

async function publishDraft(draft) {
  validateDraft(draft, true);
  if (publishing) return { status: 409, error: '另一篇文章正在发送，请稍后再试' };
  const history = readHistory();
  const alreadySent = history.some(record => record.slug === draft.slug && draft.selectedSites.includes(record.site) && record.status === 'submitted');
  if (alreadySent) return { status: 409, error: '部分选中域名已有这篇文章的成功发送记录，请更换链接名或先取消这些域名' };
  publishing = true;
  const batchId = randomBytes(8).toString('hex');
  const sentAt = new Date().toISOString();
  const entries = draft.selectedSites.map(site => ({
    id: `${batchId}-${site}`, batchId, site, slug: draft.slug,
    title: draft.variants[site].title, sentAt, status: 'sending',
    url: `https://${sites.find(item => item.id === site).domain}/posts/${draft.slug}.html`,
  }));
  history.unshift(...entries);
  saveJson(historyPath, history);
  try {
    const folder = join(root, 'drafts', `admin-${draft.slug}`);
    mkdirSync(folder, { recursive: true });
    const manifest = { slug: draft.slug, date: draft.date, sites: {} };
    for (const site of draft.selectedSites) {
      const variant = draft.variants[site];
      manifest.sites[site] = `${site}.json`;
      saveJson(join(folder, `${site}.json`), {
        title: variant.title.trim(), description: variant.description.trim(),
        summary: variant.summary.trim(), category: variant.category.trim(), bodyFile: `${site}.html`,
      });
      writeFileSync(join(folder, `${site}.html`), renderMarkdown(variant.markdown));
    }
    saveJson(join(folder, 'article.json'), manifest);
    const output = await runPublisher(join(folder, 'article.json'));
    for (const entry of entries) entry.status = 'submitted';
    saveJson(historyPath, history);
    return { status: 200, data: { batchId, sites: draft.selectedSites, output } };
  } catch (error) {
    for (const entry of entries) { entry.status = 'needs_review'; entry.error = error.message.slice(-1000); }
    saveJson(historyPath, history);
    return { status: 500, error: error.message };
  } finally {
    publishing = false;
  }
}

const server = createServer(async (request, response) => {
  try {
    if (request.headers.host !== `127.0.0.1:${port}`) return respond(response, 403, { error: '仅允许本机访问' });
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (request.method === 'GET' && staticFiles.has(url.pathname)) {
      const [path, type] = staticFiles.get(url.pathname);
      return respond(response, 200, readFileSync(join(root, path), 'utf8'), type);
    }
    if (request.method === 'GET' && url.pathname === '/api/config') return respond(response, 200, { sites, token });
    if (request.method === 'GET' && url.pathname === '/api/history') {
      const records = readHistory().filter(record =>
        (!url.searchParams.get('site') || record.site === url.searchParams.get('site')) &&
        (!url.searchParams.get('from') || localDay(record.sentAt) >= url.searchParams.get('from')) &&
        (!url.searchParams.get('to') || localDay(record.sentAt) <= url.searchParams.get('to')) &&
        (!url.searchParams.get('status') || record.status === url.searchParams.get('status')));
      return respond(response, 200, { records });
    }
    if (request.method === 'GET' && url.pathname === '/api/drafts') {
      const drafts = readdirSync(draftsDirectory).filter(name => name.endsWith('.json')).map(name => JSON.parse(readFileSync(join(draftsDirectory, name), 'utf8')));
      return respond(response, 200, { drafts: drafts.map(({ slug, date, selectedSites, updatedAt, variants, base }) => ({ slug, date, selectedSites, updatedAt, title: variants?.[selectedSites?.[0]]?.title ?? base?.title ?? '' })).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)) });
    }
    const draftMatch = /^\/api\/drafts\/([a-z0-9-]+)$/.exec(url.pathname);
    if (request.method === 'GET' && draftMatch) {
      validateSlug(draftMatch[1]);
      const path = join(draftsDirectory, `${draftMatch[1]}.json`);
      return existsSync(path) ? respond(response, 200, JSON.parse(readFileSync(path, 'utf8'))) : respond(response, 404, { error: '找不到草稿' });
    }
    if (['POST', 'PUT'].includes(request.method)) {
      if (request.headers['x-admin-token'] !== token || request.headers.origin !== `http://127.0.0.1:${port}`) return respond(response, 403, { error: '无效的本机请求' });
      const body = await readJson(request);
      if (request.method === 'POST' && url.pathname === '/api/import') {
        if (!/^.{1,160}\.(doc|docx)$/i.test(body.filename ?? '') || !/^[A-Za-z0-9+/=]+$/.test(body.data ?? '')) return respond(response, 400, { error: '仅支持 .doc 或 .docx Word 文件' });
        const bytes = Buffer.from(body.data, 'base64');
        if (!bytes.length || bytes.length > 5_000_000) return respond(response, 400, { error: 'Word 文件不能超过 5 MB' });
        const folder = mkdtempSync(join(tmpdir(), 'goodbooks-import-'));
        try {
          const source = join(folder, `upload.${body.filename.toLowerCase().endsWith('.docx') ? 'docx' : 'doc'}`);
          writeFileSync(source, bytes);
          const result = spawnSync('/usr/bin/textutil', ['-convert', 'txt', '-stdout', source], { encoding: 'utf8', maxBuffer: 8_000_000 });
          if (result.status !== 0 || !result.stdout?.trim()) throw new Error('Word 文件无法转换为文本，请检查文件内容');
          return respond(response, 200, { text: result.stdout.trim() });
        } finally { rmSync(folder, { recursive: true, force: true }); }
      }
      if (request.method === 'PUT' && draftMatch) {
        if (body.slug !== draftMatch[1]) return respond(response, 400, { error: '文章链接名不匹配' });
        validateDraft(body);
        body.updatedAt = new Date().toISOString();
        saveJson(join(draftsDirectory, `${body.slug}.json`), body);
        return respond(response, 200, { ok: true, updatedAt: body.updatedAt });
      }
      if (request.method === 'POST' && url.pathname === '/api/publish') {
        const result = await publishDraft(body);
        return respond(response, result.status, result.data ?? { error: result.error });
      }
    }
    respond(response, 404, { error: '页面不存在' });
  } catch (error) {
    respond(response, error instanceof SyntaxError ? 400 : 500, { error: error.message });
  }
});

server.listen(port, '127.0.0.1', () => {
  const address = `http://127.0.0.1:${port}`;
  console.log(`Goodbooks 发布后台：${address}`);
  if (process.argv.includes('--open')) spawn('open', [address], { stdio: 'ignore', detached: true }).unref();
});
