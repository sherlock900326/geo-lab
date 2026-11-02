import { renderMarkdown } from '/markdown.mjs';

const $ = selector => document.querySelector(selector);
const state = { sites: [], token: '', selectedSites: new Set(), variants: {}, currentSite: 'home', history: [], drafts: [], slugEdited: false };
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
function variant(site) { return { ...base(), ...state.variants[site] }; }
function selected() { return state.sites.map(site => site.id).filter(id => state.selectedSites.has(id)); }
function localDate() { return new Date().toLocaleDateString('en-CA'); }

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
  if (!['overview', 'compose', 'history'].includes(name)) return;
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  document.querySelectorAll('.view').forEach(element => element.classList.toggle('active', element.id === `view-${name}`));
  document.querySelectorAll('.nav-item').forEach(element => element.classList.toggle('active', element.dataset.view === name));
  $('#breadcrumb-current').textContent = ({ overview: '工作台', compose: '新建发布', history: '发送记录' })[name];
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (name === 'history') refreshHistory();
  if (name === 'overview') refreshOverview();
}

function renderSites() {
  const grid = $('#site-grid');
  grid.replaceChildren();
  for (const site of state.sites) {
    const label = create('label', `site-option ${state.selectedSites.has(site.id) ? 'selected' : ''}`);
    const input = create('input');
    input.type = 'checkbox'; input.checked = state.selectedSites.has(site.id); input.value = site.id;
    input.addEventListener('change', () => {
      if (input.checked) state.selectedSites.add(site.id);
      else state.selectedSites.delete(site.id);
      if (!state.selectedSites.has(state.currentSite)) state.currentSite = selected()[0] ?? '';
      renderSites(); renderVariantTabs(); renderVariantEditor(); updateAside();
    });
    const copy = create('span');
    copy.append(create('strong', '', site.domain), create('small', '', site.label));
    label.append(input, copy); grid.append(label);
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
  $('#aside-slug').textContent = $('#article-slug').value || '待填写';
  $('#aside-date').textContent = $('#article-date').value || '待设置';
}

function payload() {
  const variants = {};
  for (const site of selected()) variants[site] = variant(site);
  return { slug: $('#article-slug').value.trim(), date: $('#article-date').value,
    selectedSites: selected(), variants };
}

function validateForPublish(article) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug)) throw new Error('请填写有效的文章链接名');
  if (!article.date) throw new Error('请选择发布日期');
  if (!article.selectedSites.length) throw new Error('请至少选择一个发布域名');
  for (const site of article.selectedSites) {
    for (const field of fields) if (!article.variants[site][field]?.trim()) throw new Error(`${domain(site)} 的${({ title: '标题', description: '搜索摘要', summary: '首页摘要', category: '分类', markdown: '正文' })[field]}还未填写`);
  }
}

function resetForm() {
  for (const input of Object.values(baseInputs)) input.value = '';
  $('#article-slug').value = '';
  $('#article-date').value = localDate();
  state.selectedSites = new Set(state.sites.map(site => site.id));
  state.variants = {}; state.currentSite = 'home'; state.slugEdited = false;
  $('#upload-name').textContent = '上传后自动填入正文；也可以直接在下方编辑。';
  renderSites(); renderVariantTabs(); renderVariantEditor(); updateAside();
}

function loadDraft(draft) {
  resetForm();
  $('#article-slug').value = draft.slug;
  $('#article-date').value = draft.date;
  for (const field of fields) baseInputs[field].value = draft.base?.[field] ?? '';
  state.selectedSites = new Set(draft.selectedSites);
  state.variants = draft.variants;
  state.currentSite = selected()[0] ?? '';
  state.slugEdited = true;
  renderSites(); renderVariantTabs(); renderVariantEditor(); updateAside();
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
    row.append(create('span', 'row-icon', '↗'), copy, create('div', 'row-side', timeLabel(record.sentAt)));
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
    renderRecent(); renderDrafts();
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
      article.append(create('span', 'table-title', record.title), create('span', 'table-sub', `/posts/${record.slug}.html`));
      const site = create('td'); site.append(create('span', 'domain-chip', domain(record.site)));
      const status = create('td'); status.append(create('span', `status ${record.status}`, statusLabel(record.status)));
      const linkCell = create('td');
      if (record.status === 'submitted') {
        const link = create('a', 'row-link', '查看页面 ↗');
        link.href = record.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; linkCell.append(link);
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
  if (!/\.(md|txt)$/i.test(file.name)) return toast('只支持 .md 或 .txt 文件', true);
  if (file.size > 2_000_000) return toast('文件不能超过 2 MB', true);
  const content = await file.text();
  baseInputs.markdown.value = content;
  $('#upload-name').textContent = `已导入：${file.name} · ${(file.size / 1024).toFixed(1)} KB`;
  if (!$('#base-title').value) $('#base-title').value = file.name.replace(/\.(md|txt)$/i, '').replaceAll('-', ' ');
  renderVariantEditor(); toast('原稿已导入，可继续为各站调整内容');
}

async function saveDraft() {
  const article = { ...payload(), base: base(), variants: state.variants };
  try {
    if (!article.slug) throw new Error('请先填写文章链接名');
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
      if (!state.variants[state.currentSite]?.[field]) variantInputs[field].value = baseInputs[field].value;
      if (field === 'title' && !state.slugEdited) {
        const candidate = baseInputs.title.value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 75);
        $('#article-slug').value = candidate || `article-${localDate().replaceAll('-', '')}`;
      }
      updateAside();
    });
    variantInputs[field].addEventListener('input', () => {
      if (!state.currentSite) return;
      state.variants[state.currentSite] ??= {};
      state.variants[state.currentSite][field] = variantInputs[field].value;
    });
  }
  $('#article-slug').addEventListener('input', () => { state.slugEdited = true; updateAside(); });
  $('#article-date').addEventListener('change', updateAside);
  $('#select-all').addEventListener('click', () => { state.selectedSites = new Set(state.sites.map(site => site.id)); if (!state.currentSite) state.currentSite = 'home'; renderSites(); renderVariantTabs(); renderVariantEditor(); updateAside(); });
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
