import { renderMarkdown } from '/markdown.mjs';
import { inferMetadata } from '/article-metadata.mjs';
import { articleSlug } from '/article-slug.mjs';

const $ = selector => document.querySelector(selector);
const state = { sites: [], token: '', selectedSites: new Set(), variants: {}, currentSite: '', history: [], drafts: [], uploadName: '', fallbackSlug: '' };
const fields = ['title', 'description', 'summary', 'category', 'markdown'];
const baseInputs = {
  title: $('#base-title'), description: $('#base-description'), summary: $('#base-summary'),
  category: $('#base-category'), markdown: $('#base-markdown'),
};
const variantInputs = {
  title: $('#variant-title'), description: $('#variant-description'), summary: $('#variant-summary'),
  category: $('#variant-category'), markdown: $('#variant-markdown'),
};
let toastTimer;

function create(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function domain(siteId) { return state.sites.find(site => site.id === siteId)?.domain ?? siteId; }
function base() { return Object.fromEntries(fields.map(field => [field, baseInputs[field].value])); }
function variant(site) {
  const overrides = Object.entries(state.variants[site] ?? {}).filter(([, value]) => value?.trim());
  return { ...base(), ...Object.fromEntries(overrides) };
}
function selected() { return state.sites.map(site => site.id).filter(id => state.selectedSites.has(id)); }
function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function currentSlug(title) {
  return articleSlug(title, state.fallbackSlug, $('#article-slug').value);
}
function resolvedVariant(site) {
  const values = variant(site);
  const inferred = inferMetadata(values.markdown, state.uploadName);
  return Object.fromEntries(fields.map(field => [field, values[field]?.trim() || inferred[field] || '']));
}
function updateMetadataPreview() {
  const inferred = inferMetadata(baseInputs.markdown.value, state.uploadName);
  $('#detected-title').textContent = baseInputs.title.value.trim() || inferred.title || '上传后自动识别';
  $('#detected-category').textContent = baseInputs.category.value.trim() || inferred.category;
  $('#detected-summary').textContent = baseInputs.summary.value.trim() || inferred.summary || '上传后自动提取正文开头';
}

function toast(message, error = false) {
  const box = $('#toast');
  box.textContent = message;
  box.classList.toggle('error', error);
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), 4500);
}

async function api(path, options = {}) {
  const headers = options.body ? { 'Content-Type': 'application/json', 'X-Admin-Token': state.token } : {};
  const response = await fetch(path, { ...options, headers });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败');
  return result;
}

function view(name) {
  if (!['overview', 'sites', 'compose', 'history'].includes(name)) return;
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  document.querySelectorAll('.view').forEach(element => element.classList.toggle('active', element.id === `view-${name}`));
  document.querySelectorAll('.nav-item').forEach(element => element.classList.toggle('active', element.dataset.view === name));
  $('#breadcrumb-current').textContent = ({ overview: '工作台', sites: '站点目录', compose: '新建发布', history: '发送记录' })[name];
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (name === 'history') refreshHistory();
  if (name === 'overview' || name === 'sites') refreshOverview();
}

function externalLink(url, label, className = 'row-link') {
  const link = create('a', className, label);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function renderDirectory() {
  const shortcuts = $('#site-shortcuts');
  const directory = $('#site-directory');
  shortcuts.replaceChildren(); directory.replaceChildren();
  $('#directory-count').textContent = state.sites.length;
  for (const site of state.sites) {
    const url = `https://${site.domain}/`;
    const latest = state.history.find(record => record.site === site.id && record.status === 'submitted');
    const card = create('article', 'directory-card');
    const icon = create('span', 'directory-icon', site.id === 'home' ? 'G' : site.domain[0].toUpperCase());
    const heading = create('div', 'directory-card-heading');
    heading.append(create('strong', '', site.id === 'home' ? '总站' : site.label), create('span', '', site.id === 'home' ? 'MAIN SITE' : 'SUBDOMAIN'));
    const title = create('div', 'directory-card-title');
    title.append(icon, heading);
    card.append(title, externalLink(url, site.domain + ' ↗', 'directory-domain'));
    const article = create('div', 'directory-article');
    if (latest) {
      article.append(create('span', '', '最近发送文章'), externalLink(latest.url, latest.title + ' ↗', 'directory-article-link'));
    } else article.append(create('span', '', '暂无本站发送记录'));
    card.append(article, externalLink(url, '访问网站 ↗', 'directory-open'));
    directory.append(card);

    const shortcut = create('div', 'site-shortcut');
    shortcut.append(create('span', 'shortcut-icon', site.id === 'home' ? 'G' : site.domain[0].toUpperCase()));
    const details = create('div', 'shortcut-details');
    details.append(create('strong', '', site.id === 'home' ? '总站' : site.label), externalLink(url, site.domain + ' ↗', 'shortcut-domain'));
    shortcut.append(details); shortcuts.append(shortcut);
  }
}

function renderSites() {
  const grid = $('#site-grid');
  grid.replaceChildren();
  for (const site of state.sites) {
    const option = create('div', `site-option ${state.selectedSites.has(site.id) ? 'selected' : ''}`);
    const label = create('label', 'site-choice');
    const input = create('input');
    input.type = 'checkbox'; input.checked = state.selectedSites.has(site.id); input.value = site.id;
    input.addEventListener('change', () => {
      if (input.checked) state.selectedSites.add(site.id);
      else state.selectedSites.delete(site.id);
      if (!state.selectedSites.has(state.currentSite)) state.currentSite = selected()[0] ?? '';
      renderSites(); renderVariantTabs(); renderVariantEditor(); updateAside();
    });
    const copy = create('span');
    copy.append(create('strong', '', site.id === 'home' ? '总站' : site.label));
    label.append(input, copy);
    option.append(label, externalLink(`https://${site.domain}/`, site.domain + ' ↗', 'site-external'));
    grid.append(option);
  }
  $('#selected-count').textContent = `${state.selectedSites.size} / ${state.sites.length} 已选`;
}

function renderVariantTabs() {
  const tabs = $('#variant-tabs');
  tabs.replaceChildren();
  for (const site of selected()) {
    const button = create('button', `variant-tab ${site === state.currentSite ? 'active' : ''}`, domain(site));
    button.type = 'button';
    button.addEventListener('click', () => { state.currentSite = site; renderVariantTabs(); renderVariantEditor(); });
    tabs.append(button);
  }
}

function renderVariantEditor() {
  const current = state.currentSite;
  $('#variant-editor').hidden = !current;
  if (!current) return;
  $('#variant-domain').textContent = domain(current);
  const values = variant(current);
  for (const field of fields) variantInputs[field].value = values[field] ?? '';
  showEditor();
}

function showEditor(preview = false) {
  $('#variant-markdown').hidden = preview;
  $('#variant-preview').hidden = !preview;
  $('#edit-tab').classList.toggle('active', !preview);
  $('#preview-tab').classList.toggle('active', preview);
  if (preview) $('#variant-preview').innerHTML = renderMarkdown($('#variant-markdown').value) || '<p>暂无正文</p>';
}

function updateAside() {
  $('#aside-sites').textContent = `${state.selectedSites.size} 个站点`;
  const title = baseInputs.title.value.trim() || inferMetadata(baseInputs.markdown.value, state.uploadName).title;
  $('#aside-slug').textContent = title || $('#article-slug').value.trim() ? currentSlug(title) : '自动生成';
  $('#aside-date').textContent = $('#article-date').value || '待设置';
}

function payload() {
  const variants = {};
  for (const site of selected()) variants[site] = resolvedVariant(site);
  return { slug: currentSlug(variants[selected()[0]]?.title || ''), date: $('#article-date').value,
    selectedSites: selected(), variants };
}

function validateForPublish(article) {
  if (!article.selectedSites.length) throw new Error('请至少选择一个发布域名');
  if (!article.date) throw new Error('请选择发布日期');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug)) throw new Error('自动生成链接失败，请刷新页面后重试');
  for (const site of article.selectedSites) {
    for (const field of fields) if (!article.variants[site][field]?.trim()) throw new Error(`${domain(site)} 的${({ title: '标题', description: '搜索摘要', summary: '首页摘要', category: '分类', markdown: '正文' })[field]}还未填写`);
  }
}

function resetForm() {
  for (const input of Object.values(baseInputs)) input.value = '';
  $('#article-slug').value = '';
  $('#article-date').value = localDate();
  state.selectedSites = new Set();
  state.variants = {}; state.currentSite = ''; state.uploadName = '';
  state.fallbackSlug = `article-${localDate().replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8)}`;
  $('#article-details').open = false;
  $('#site-versions').open = false;
  $('#upload-name').textContent = '上传后自动读取文章内容。';
  renderSites(); renderVariantTabs(); renderVariantEditor(); updateMetadataPreview(); updateAside();
}

function loadDraft(draft) {
  resetForm();
  $('#article-slug').value = draft.slug;
  $('#article-date').value = draft.date;
  for (const field of fields) baseInputs[field].value = draft.base?.[field] ?? '';
  state.selectedSites = new Set(draft.selectedSites);
  state.variants = draft.variants ?? {};
  state.currentSite = selected()[0] ?? '';
  state.uploadName = draft.uploadName ?? '';
  renderSites(); renderVariantTabs(); renderVariantEditor(); updateMetadataPreview(); updateAside();
  view('compose'); toast('已载入本地草稿');
}

function statusLabel(status) { return ({ submitted: '已提交', needs_review: '需核查', sending: '发送中' })[status] ?? status; }
function timeLabel(value) { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }

function renderRecent() {
  const list = $('#recent-history'); list.replaceChildren();
  const recent = state.history.slice(0, 5);
  if (!recent.length) { list.append(create('div', 'empty-inline', '还没有发送记录。点击“新建发布”开始第一篇文章。')); return; }
  for (const record of recent) {
    const row = create('div', 'recent-row');
    const copy = create('div', 'row-copy');
    copy.append(create('strong', '', record.title), create('small', '', `${domain(record.site)} · ${statusLabel(record.status)}`));
    const side = create('div', 'row-side');
    side.append(create('span', '', timeLabel(record.sentAt)));
    if (record.status === 'submitted') side.append(externalLink(record.url, '查看文章 ↗', 'recent-article-link'));
    row.append(create('span', 'row-icon', '↗'), copy, side);
    list.append(row);
  }
}

function renderDrafts() {
  const list = $('#draft-list'); list.replaceChildren();
  if (!state.drafts.length) { list.append(create('div', 'empty-inline', '暂无草稿。编辑文章时可随时保存。')); return; }
  for (const draft of state.drafts.slice(0, 5)) {
    const row = create('div', 'draft-row');
    const copy = create('div', 'row-copy');
    copy.append(create('strong', '', draft.title || draft.slug), create('small', '', `${draft.selectedSites.length} 个站点 · 最后编辑 ${timeLabel(draft.updatedAt)}`));
    const button = create('button', 'text-button', '继续编辑 →');
    button.addEventListener('click', async () => {
      try { loadDraft(await api(`/api/drafts/${draft.slug}`)); }
      catch (error) { toast(error.message, true); }
    });
    row.append(create('span', 'row-icon', '✎'), copy, button); list.append(row);
  }
}

async function refreshOverview() {
  try {
    const [history, drafts] = await Promise.all([api('/api/history'), api('/api/drafts')]);
    state.history = history.records; state.drafts = drafts.drafts;
    $('#stat-sites').textContent = state.sites.length;
    $('#stat-sent').textContent = state.history.filter(record => record.status === 'submitted').length;
    $('#stat-drafts').textContent = state.drafts.length;
    renderRecent(); renderDrafts(); renderDirectory();
  } catch (error) { toast(error.message, true); }
}

async function refreshHistory() {
  try {
    const query = new URLSearchParams();
    for (const [key, id] of [['site', '#filter-site'], ['from', '#filter-from'], ['to', '#filter-to'], ['status', '#filter-status']]) {
      if ($(id).value) query.set(key, $(id).value);
    }
    const { records } = await api(`/api/history?${query}`);
    $('#history-count').textContent = `共 ${records.length} 条记录`;
    $('#history-empty').hidden = !!records.length;
    const body = $('#history-body'); body.replaceChildren();
    for (const record of records) {
      const row = create('tr');
      const article = create('td');
      article.append(create('span', 'table-title', record.title), create('span', 'table-sub', `/posts/${record.slug}`));
      const site = create('td'); site.append(externalLink(`https://${domain(record.site)}/`, domain(record.site) + ' ↗', 'domain-chip domain-link'));
      const status = create('td'); status.append(create('span', `status ${record.status}`, statusLabel(record.status)));
      const linkCell = create('td');
      if (record.status === 'submitted') {
        linkCell.append(externalLink(record.url, '查看文章 ↗'));
      } else if (record.error) {
        const details = create('button', 'text-button', '查看错误');
        details.addEventListener('click', () => window.alert(record.error));
        linkCell.append(details);
      }
      row.append(article, site, create('td', '', timeLabel(record.sentAt)), status, linkCell);
      body.append(row);
    }
  } catch (error) { toast(error.message, true); }
}

async function upload(file) {
  if (!file) return;
  if (!/\.(doc|docx|md|txt)$/i.test(file.name)) return toast('支持 Word、Markdown、TXT 文件', true);
  const word = /\.(doc|docx)$/i.test(file.name);
  if (file.size > (word ? 5_000_000 : 2_000_000)) return toast(`文件不能超过 ${word ? 5 : 2} MB`, true);
  let content;
  try {
    if (word) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
      content = (await api('/api/import', { method: 'POST', body: JSON.stringify({ filename: file.name, data: btoa(binary) }) })).text;
    } else content = await file.text();
  } catch (error) { return toast(error.message, true); }
  for (const input of Object.values(baseInputs)) if (input !== baseInputs.markdown) input.value = '';
  $('#article-slug').value = '';
  state.variants = {};
  state.fallbackSlug = `article-${localDate().replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8)}`;
  baseInputs.markdown.value = content;
  state.uploadName = file.name;
  $('#upload-name').textContent = `已导入：${file.name} · ${(file.size / 1024).toFixed(1)} KB`;
  renderVariantTabs(); renderVariantEditor(); updateMetadataPreview(); updateAside();
  toast('文章已导入，选择站点后即可发送');
}

async function saveDraft() {
  const article = { ...payload(), base: base(), variants: state.variants, uploadName: state.uploadName };
  try {
    if (!article.selectedSites.length) throw new Error('请至少选择一个保存草稿的站点');
    if (!selected().some(site => variant(site).markdown.trim())) throw new Error('请先上传或粘贴文章');
    await api(`/api/drafts/${article.slug}`, { method: 'PUT', body: JSON.stringify(article) });
    toast('草稿已保存到本机'); refreshOverview();
  } catch (error) { toast(error.message, true); }
}

async function confirmPublish() {
  const article = payload();
  try { validateForPublish(article); }
  catch (error) { toast(error.message, true); return; }
  $('#modal-summary').textContent = `将“${article.variants[article.selectedSites[0]].title}”发送到 ${article.selectedSites.length} 个站点。`;
  const list = $('#modal-sites'); list.replaceChildren();
  for (const site of article.selectedSites) list.append(create('span', '', domain(site)));
  $('#confirm-modal').hidden = false;
}

async function performPublish() {
  const button = $('#confirm-publish');
  button.disabled = true; button.textContent = '正在发送…';
  try {
    const article = payload();
    await api('/api/publish', { method: 'POST', body: JSON.stringify(article) });
    $('#confirm-modal').hidden = true;
    toast(`已提交 ${article.selectedSites.length} 个站点，Cloudflare 正在部署`);
    resetForm(); await refreshOverview(); view('history');
  } catch (error) { $('#confirm-modal').hidden = true; toast(error.message, true); refreshOverview(); }
  finally { button.disabled = false; button.textContent = '确认发送'; }
}

function bindEvents() {
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => view(button.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => view(button.dataset.go)));
  for (const field of fields) {
    baseInputs[field].addEventListener('input', () => {
      if (!Object.hasOwn(state.variants[state.currentSite] ?? {}, field)) variantInputs[field].value = baseInputs[field].value;
      updateMetadataPreview(); updateAside();
    });
    variantInputs[field].addEventListener('input', () => {
      if (!state.currentSite) return;
      state.variants[state.currentSite] ??= {};
      state.variants[state.currentSite][field] = variantInputs[field].value;
    });
  }
  $('#article-slug').addEventListener('input', updateAside);
  $('#article-date').addEventListener('change', updateAside);
  $('#select-all').addEventListener('click', () => { state.selectedSites = new Set(state.sites.map(site => site.id)); if (!state.currentSite) state.currentSite = selected()[0]; renderSites(); renderVariantTabs(); renderVariantEditor(); updateAside(); });
  $('#select-none').addEventListener('click', () => { state.selectedSites.clear(); state.currentSite = ''; renderSites(); renderVariantTabs(); renderVariantEditor(); updateAside(); });
  $('#edit-tab').addEventListener('click', () => showEditor(false));
  $('#preview-tab').addEventListener('click', () => showEditor(true));
  const uploadBox = $('#upload-box');
  uploadBox.addEventListener('click', () => $('#file-input').click());
  uploadBox.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('#file-input').click(); } });
  uploadBox.addEventListener('dragover', event => { event.preventDefault(); uploadBox.classList.add('dragging'); });
  uploadBox.addEventListener('dragleave', () => uploadBox.classList.remove('dragging'));
  uploadBox.addEventListener('drop', event => { event.preventDefault(); uploadBox.classList.remove('dragging'); upload(event.dataTransfer.files[0]); });
  $('#file-input').addEventListener('change', event => upload(event.target.files[0]));
  $('#save-draft').addEventListener('click', saveDraft);
  $('#publish-button').addEventListener('click', confirmPublish);
  $('#cancel-publish').addEventListener('click', () => $('#confirm-modal').hidden = true);
  $('#confirm-publish').addEventListener('click', performPublish);
  $('#confirm-modal').addEventListener('click', event => { if (event.target.id === 'confirm-modal') $('#confirm-modal').hidden = true; });
  for (const id of ['#filter-site', '#filter-from', '#filter-to', '#filter-status']) $(id).addEventListener('change', refreshHistory);
  $('#reset-filters').addEventListener('click', () => { for (const id of ['#filter-site', '#filter-from', '#filter-to', '#filter-status']) $(id).value = ''; refreshHistory(); });
}

try {
  const config = await api('/api/config');
  state.sites = config.sites; state.token = config.token;
  const filter = $('#filter-site');
  for (const site of state.sites) {
    const option = create('option', '', site.domain); option.value = site.id; filter.append(option);
  }
  bindEvents(); resetForm(); view(location.hash.slice(1) || 'overview'); refreshOverview();
} catch (error) { toast(`后台连接失败：${error.message}`, true); }
