import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const styles = {
  geo: null,
  home: 'themes/home.css',
  atlas: 'atlas.css',
  blocks: 'themes/blocks.css',
  fieldnotes: 'themes/fieldnotes.css',
  gallery: 'themes/gallery.css',
  signal: 'themes/signal.css',
  ledger: 'themes/ledger.css',
};

const site = process.argv[2];
if (!Object.hasOwn(styles, site)) throw new Error(`Unknown site: ${site}`);
const domain = site === 'home' ? 'goodbooks.cc' : `${site}.goodbooks.cc`;
const output = resolve(`dist-${site}`);
const oldDomain = 'geo.goodbooks.cc';
const contentDirectory = join('content', site);
rmSync(output, { recursive: true, force: true });

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function write(path, value) {
  writeFileSync(join(output, path), value);
}

if (site === 'home') {
  const result = spawnSync(process.execPath, ['build-home.mjs'], {
    env: { ...process.env, GOODBOOKS_OUTPUT_DIR: output }, stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error('Home build failed');
} else {
  mkdirSync(join(output, 'posts'), { recursive: true });
  for (const name of ['index.html', 'sitemap.xml', 'googled0ff232d179376b7.html']) {
    if (existsSync(name)) cpSync(name, join(output, name));
  }
  for (const name of readdirSync('posts').filter(name => name.endsWith('.html'))) {
    cpSync(join('posts', name), join(output, 'posts', name));
  }
  const baseStyle = readFileSync('style.css', 'utf8');
  write('style.css', baseStyle + (styles[site] ? `\n${readFileSync(styles[site], 'utf8')}` : ''));
}

let index = readFileSync(join(output, 'index.html'), 'utf8');
let sitemap = readFileSync(join(output, 'sitemap.xml'), 'utf8');
const indexOldDomain = site === 'home' ? 'goodbooks.cc' : oldDomain;
index = index.replaceAll(`https://${indexOldDomain}/`, `https://${domain}/`);
sitemap = sitemap.replaceAll(`https://${oldDomain}/`, `https://${domain}/`);

for (const name of readdirSync(join(output, 'posts')).filter(name => name.endsWith('.html'))) {
  const path = join(output, 'posts', name);
  const article = readFileSync(path, 'utf8').replaceAll(`https://${oldDomain}/`, `https://${domain}/`);
  writeFileSync(path, article);
}

const template = readFileSync(join(output, 'posts', 'how-ai-engines-choose.html'), 'utf8');
const month = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' });
const shortMonth = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

if (existsSync(contentDirectory)) {
  for (const name of readdirSync(contentDirectory).filter(name => name.endsWith('.json')).sort()) {
    const article = JSON.parse(readFileSync(join(contentDirectory, name), 'utf8'));
    const slug = name.slice(0, -5);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`Invalid slug: ${slug}`);
    if (!article.title || !article.description || !article.summary || !article.category || !article.bodyHtml || !/^\d{4}-\d{2}-\d{2}$/.test(article.date)) {
      throw new Error(`Incomplete article: ${join(contentDirectory, name)}`);
    }
    const published = new Date(`${article.date}T00:00:00Z`);
    if (Number.isNaN(published.getTime()) || published.toISOString().slice(0, 10) !== article.date) throw new Error(`Invalid date: ${article.date}`);
    const displayDate = `${month.format(published)} ${published.getUTCFullYear()}`;
    const url = `https://${domain}/posts/${slug}.html`;
    const title = escapeHtml(article.title);
    const category = escapeHtml(article.category);
    const summary = escapeHtml(article.summary);
    const articleWrap = `<div class="article-wrap">\n  <a class="back" href="../index.html">All Articles</a>\n  <div class="article-header">\n    <span class="tag">${category}</span>\n    <h1>${title}</h1>\n    <div class="meta">${displayDate}</div>\n  </div>\n  <div class="article-body">\n${article.bodyHtml}\n  </div>\n</div>\n\n`;
    const page = template
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${title} | Goodbooks</title>`)
      .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeHtml(article.description)}">`)
      .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`)
      .replace(/<div class="article-wrap">[\s\S]*?(?=<footer>)/, articleWrap);
    if (!page.includes(`<link rel="canonical" href="${url}">`)) throw new Error(`Template failed: ${site}`);
    write(`posts/${slug}.html`, page);

    const card = `<a class="article-card" href="posts/${slug}.html">\n      <div class="article-date"><span class="month">${shortMonth.format(published)}</span><span class="year">${published.getUTCFullYear()}</span></div>\n      <div class="article-content"><span class="tag">${category}</span><h2>${title}</h2><p>${summary}</p><span class="read-more">Read more</span></div>\n    </a>\n\n    `;
    if (!index.includes(`href="posts/${slug}.html"`)) index = index.replace(/(<div class="article-list">\s*)/, `$1${card}`);
    if (!sitemap.includes(url)) sitemap = sitemap.replace('</urlset>', `  <url><loc>${url}</loc><lastmod>${article.date}</lastmod></url>\n</urlset>`);
  }
}

write('index.html', index);
write('sitemap.xml', sitemap);
console.log(`Built ${domain} in ${output}`);
