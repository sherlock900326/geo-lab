import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const property = 'sc-domain:goodbooks.cc';
const scope = 'https://www.googleapis.com/auth/webmasters';
const articlePath = /^https:\/\/[^/]+\/posts\/([a-z0-9-]+)(?:\.html)?$/;

function saveJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, path);
}

function parseLocations(xml) {
  return [...xml.matchAll(/<loc>\s*(https:\/\/[^<]+)\s*<\/loc>/g)].map(match => match[1]);
}

export function articleInventory(root, secondary, sites) {
  const articles = [];
  for (const site of sites) {
    const repo = ['blog', 'journal', 'archive', 'folio', 'studio', 'type', 'terminal'].includes(site.id) ? secondary : root;
    const urls = new Set();
    const sitemap = join(repo, 'sitemap.xml');
    if (existsSync(sitemap)) {
      for (const url of parseLocations(readFileSync(sitemap, 'utf8'))) {
        if (articlePath.test(url)) {
          const pathname = new URL(url).pathname.replace(/\.html$/, '');
          urls.add(`https://${site.domain}${pathname}`);
        }
      }
    }
    const folder = join(repo, 'content', site.id);
    if (existsSync(folder)) {
      for (const name of readdirSync(folder).filter(name => name.endsWith('.json'))) {
        urls.add(`https://${site.domain}/posts/${name.slice(0, -5)}`);
      }
    }
    if (site.id === 'home') {
      const posts = join(repo, 'posts');
      for (const name of readdirSync(posts).filter(name => name.endsWith('.html'))) {
        urls.add(`https://${site.domain}/posts/${name.slice(0, -5)}`);
      }
    }
    for (const url of urls) articles.push({ site: site.id, domain: site.domain, url });
  }
  return articles;
}

export function createGoogleSearch({ root, secondary, dataDirectory, sites, port }) {
  const clientPath = join(dataDirectory, 'google-oauth-client.json');
  const tokenPath = join(dataDirectory, 'google-token.json');
  const statusPath = join(dataDirectory, 'google-status.json');
  const submissionPath = join(dataDirectory, 'google-submissions.json');
  const queuePath = join(dataDirectory, 'google-publish-queue.json');
  let pendingAuth;
  let job = null;
  let lastJob = null;
  const queuedPublishes = existsSync(queuePath) ? JSON.parse(readFileSync(queuePath, 'utf8')) : [];
  let token = existsSync(tokenPath) ? JSON.parse(readFileSync(tokenPath, 'utf8')) : null;
  let statuses = existsSync(statusPath) ? JSON.parse(readFileSync(statusPath, 'utf8')) : {};
  let submissions = existsSync(submissionPath) ? JSON.parse(readFileSync(submissionPath, 'utf8')) : {};
  const redirectUri = `http://127.0.0.1:${port}/api/google/callback`;
  const inventory = () => articleInventory(root, secondary, sites);
  const client = () => {
    if (!existsSync(clientPath)) return null;
    const config = JSON.parse(readFileSync(clientPath, 'utf8'));
    const value = config.installed ?? config.web;
    if (!value?.client_id || !value?.client_secret) throw new Error('Google OAuth 客户端 JSON 无效');
    return value;
  };
  function configure(value) {
    const config = value?.installed;
    if (!config?.client_id || !config?.client_secret || !Array.isArray(config.redirect_uris) || !config.redirect_uris.some(uri => uri.startsWith('http://localhost'))) {
      throw new Error('请上传 Google Cloud 创建的“桌面应用”OAuth 客户端 JSON');
    }
    saveJson(clientPath, { installed: config });
    token = null;
    saveJson(tokenPath, null);
  }
  const connection = () => ({ configured: !!client(), connected: !!token?.refresh_token, busy: !!job, job: job ?? lastJob, submissions });

  async function responseJson(response) {
    if (response.ok) return response.status === 204 ? {} : response.json();
    const body = await response.text();
    throw new Error(`Google API ${response.status}: ${body.slice(0, 500)}`);
  }

  async function accessToken() {
    if (!token?.refresh_token) throw new Error('请先连接 Google Search Console');
    if (token.access_token && token.expires_at > Date.now() + 60_000) return token.access_token;
    const config = client();
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.client_id, client_secret: config.client_secret,
        refresh_token: token.refresh_token, grant_type: 'refresh_token',
      }),
    });
    const refreshed = await responseJson(response);
    token = { ...token, access_token: refreshed.access_token, expires_at: Date.now() + refreshed.expires_in * 1000 };
    saveJson(tokenPath, token);
    return token.access_token;
  }

  async function googleRequest(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${await accessToken()}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    return responseJson(response);
  }

  function authUrl() {
    const config = client();
    if (!config) throw new Error('请先将 Google OAuth 桌面客户端 JSON 放入 admin-data/google-oauth-client.json');
    const state = randomBytes(20).toString('hex');
    const verifier = randomBytes(32).toString('base64url');
    pendingAuth = { state, verifier, expires: Date.now() + 600_000 };
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: config.client_id, redirect_uri: redirectUri, response_type: 'code',
      scope, access_type: 'offline', prompt: 'consent', state,
      code_challenge: challenge, code_challenge_method: 'S256',
    });
  }

  async function callback(query) {
    if (!pendingAuth || query.get('state') !== pendingAuth.state || pendingAuth.expires < Date.now()) throw new Error('Google 授权状态无效，请重新连接');
    const verifier = pendingAuth.verifier;
    pendingAuth = null;
    if (query.get('error')) throw new Error(`Google 授权失败：${query.get('error')}`);
    if (!query.get('code')) throw new Error('Google 未返回授权码');
    const config = client();
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.client_id, client_secret: config.client_secret,
        code: query.get('code'), code_verifier: verifier, redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const granted = await responseJson(response);
    if (!granted.refresh_token) throw new Error('Google 未返回长期授权，请重新授权');
    const sitesResponse = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
      headers: { Authorization: `Bearer ${granted.access_token}` },
    });
    const available = await responseJson(sitesResponse);
    if (!available.siteEntry?.some(site => site.siteUrl === property && site.permissionLevel !== 'siteUnverifiedUser')) {
      throw new Error('这个 Google 账号没有 goodbooks.cc 网域资源权限');
    }
    token = { refresh_token: granted.refresh_token, access_token: granted.access_token, expires_at: Date.now() + granted.expires_in * 1000 };
    saveJson(tokenPath, token);
    setTimeout(() => { if (!job) try { start('submit'); } catch {} }, 1000);
  }

  async function submitSitemap(site) {
    const url = `https://${site.domain}/sitemap.xml`;
    const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/sitemaps/${encodeURIComponent(url)}`;
    await googleRequest(endpoint, { method: 'PUT' });
  }

  async function readSitemap(site) {
    const url = `https://${site.domain}/sitemap.xml`;
    const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/sitemaps/${encodeURIComponent(url)}`;
    const result = await googleRequest(endpoint);
    return {
      status: result.errors ? 'error' : result.lastDownloaded ? 'read' : 'pending',
      errors: result.errors ?? 0,
      warnings: result.warnings ?? 0,
      lastDownloaded: result.lastDownloaded ?? null,
      checkedAt: new Date().toISOString(),
    };
  }

  async function inspect(article) {
    const result = await googleRequest('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
      method: 'POST',
      body: JSON.stringify({ inspectionUrl: article.url, siteUrl: property, languageCode: 'zh-CN' }),
    });
    const details = result.inspectionResult?.indexStatusResult;
    return {
      status: details?.verdict === 'PASS' ? 'indexed' : details?.verdict === 'FAIL' ? 'not_indexed' : 'unknown',
      verdict: details?.verdict ?? 'UNKNOWN',
      coverage: details?.coverageState ?? '',
      lastCrawl: details?.lastCrawlTime ?? null,
      checkedAt: new Date().toISOString(),
    };
  }

  function start(kind, selectedSites = sites.map(site => site.id), slug = '') {
    if (job) throw new Error('Google 收录任务正在运行');
    if (!token?.refresh_token) throw new Error('请先连接 Google Search Console');
    if (!Array.isArray(selectedSites) || selectedSites.some(site => !sites.some(item => item.id === site))) throw new Error('站点列表无效');
    const chosen = sites.filter(site => selectedSites.includes(site.id));
    const articles = inventory().filter(article => selectedSites.includes(article.site) && (!slug || article.url.endsWith(`/posts/${slug}`)));
    if (kind === 'publish' && (!slug || articles.length !== chosen.length)) throw new Error('新文章网址清单不完整');
    const items = kind === 'inspect' ? articles : chosen;
    job = { kind, done: 0, total: items.length, errors: 0, startedAt: new Date().toISOString() };
    const current = job;
    (async () => {
      try {
        for (const item of items) {
          let succeeded = false;
          try {
            if (kind === 'sitemaps') {
              submissions[item.id] = await readSitemap(item);
              saveJson(submissionPath, submissions);
            } else if (kind !== 'inspect') {
              if (kind === 'publish') {
                const expected = `https://${item.domain}/posts/${slug}`;
                let deployed = false;
                for (let attempt = 0; attempt < 40; attempt++) {
                  try {
                    const response = await fetch(`https://${item.domain}/sitemap.xml`, { cache: 'no-store' });
                    if (response.ok && (await response.text()).includes(`<loc>${expected}</loc>`)) { deployed = true; break; }
                  } catch {}
                  await new Promise(resolve => setTimeout(resolve, 15_000));
                }
                if (!deployed) throw new Error(`${item.domain} 部署尚未在站点地图中出现`);
              }
              await submitSitemap(item);
              submissions[item.id] = { status: 'submitted', checkedAt: new Date().toISOString() };
              saveJson(submissionPath, submissions);
            }
            else {
              statuses[item.url] = await inspect(item);
              saveJson(statusPath, statuses);
            }
            succeeded = true;
          } catch (error) {
            current.errors++;
            if (kind === 'inspect') {
              statuses[item.url] = { status: 'error', error: error.message, checkedAt: new Date().toISOString() };
              saveJson(statusPath, statuses);
            } else {
              submissions[item.id] = { status: 'error', error: error.message, checkedAt: new Date().toISOString() };
              saveJson(submissionPath, submissions);
            }
            if (/Google API (401|403|429):/.test(error.message)) {
              current.error = error.message;
              current.done++;
              break;
            }
            if (kind === 'publish') {
              current.error = error.message;
              current.done++;
              break;
            }
          }
          current.done++;
          if (kind === 'inspect') await new Promise(resolve => setTimeout(resolve, 1200));
          if (kind === 'publish' && succeeded) {
            queuedPublishes[0].completed ??= [];
            queuedPublishes[0].completed.push(item.id);
            saveJson(queuePath, queuedPublishes);
          }
        }
      } catch (error) {
        current.error = error.message;
      } finally {
        current.finishedAt = new Date().toISOString();
        lastJob = current;
        job = null;
        if (kind === 'publish') {
          const pending = queuedPublishes[0];
          if (pending.selectedSites.every(site => pending.completed?.includes(site))) queuedPublishes.shift();
          else pending.nextAttemptAt = Date.now() + 15 * 60 * 1000;
          saveJson(queuePath, queuedPublishes);
        }
        if (kind === 'publish' && !current.error) setTimeout(() => { if (!job) try { start('inspect', selectedSites, slug); } catch {} }, 1000);
        if (kind === 'submit') setTimeout(() => { if (!job) try { start('sitemaps'); } catch {} }, 1000);
        if (kind === 'sitemaps') setTimeout(() => { if (!job) try { start('inspect'); } catch {} }, 1000);
      }
    })();
    return current;
  }

  function afterPublish(selectedSites, slug) {
    queuedPublishes.push({ selectedSites, slug, completed: [] });
    saveJson(queuePath, queuedPublishes);
    setTimeout(processQueue, 15_000);
  }

  function processQueue() {
    if (!token?.refresh_token || job || !queuedPublishes.length) return;
    const next = queuedPublishes[0];
    if (next.nextAttemptAt > Date.now()) return;
    try { start('publish', next.selectedSites.filter(site => !next.completed?.includes(site)), next.slug); }
    catch (error) { lastJob = { kind: 'publish', error: error.message, finishedAt: new Date().toISOString() }; }
  }

  if (token?.refresh_token) setTimeout(() => { if (!job) try { start('inspect'); } catch {} }, 30_000);
  setInterval(() => { if (token?.refresh_token && !job) try { start('inspect'); } catch {} }, 24 * 60 * 60 * 1000);
  setInterval(processQueue, 15_000);

  return {
    authUrl, callback, connection, configure, start, afterPublish,
    articles: () => inventory().map(article => ({ ...article, ...(statuses[article.url] ?? { status: 'unchecked' }) })),
  };
}
