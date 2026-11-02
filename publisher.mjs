import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const primary = dirname(fileURLToPath(import.meta.url));
const sibling = existsSync(join(primary, '..', 'zengfanblog')) ? 'zengfanblog' : 'goodbooks-secondary-work';
const secondary = resolve(process.env.GOODBOOKS_SECONDARY_DIR ?? join(primary, '..', sibling));
const primarySites = ['home', 'geo', 'atlas', 'blocks', 'fieldnotes', 'gallery', 'signal', 'ledger'];
const secondarySites = ['blog', 'journal', 'archive', 'folio', 'studio', 'type', 'terminal'];
const sites = [...primarySites, ...secondarySites];
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function run(command, args, cwd, trim = true) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed in ${cwd}:\n${result.stderr || result.stdout}`);
  return trim ? result.stdout.trim() : result.stdout;
}

function safePath(base, path) {
  const resolved = resolve(base, path);
  const remainder = relative(base, resolved);
  if (isAbsolute(remainder) || remainder.startsWith('..')) throw new Error(`Path outside draft folder: ${path}`);
  return resolved;
}

function init(slug) {
  if (!slugPattern.test(slug)) throw new Error('Slug must use lowercase letters, numbers, and hyphens');
  const folder = join(primary, 'drafts', slug);
  if (existsSync(folder)) throw new Error(`Draft already exists: ${folder}`);
  mkdirSync(folder, { recursive: true });
  const manifest = { slug, date: new Date().toISOString().slice(0, 10), sites: {} };
  for (const site of sites) {
    manifest.sites[site] = `${site}.json`;
    writeFileSync(join(folder, `${site}.json`), JSON.stringify({
      title: '', description: '', summary: '', category: '', bodyFile: `${site}.html`,
    }, null, 2) + '\n');
    writeFileSync(join(folder, `${site}.html`), '<p></p>\n');
  }
  writeFileSync(join(folder, 'article.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Draft created: ${join(folder, 'article.json')}`);
}

function load(manifestPath) {
  const base = dirname(resolve(manifestPath));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!slugPattern.test(manifest.slug ?? '')) throw new Error('Invalid article slug');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest.date ?? '') || Number.isNaN(Date.parse(`${manifest.date}T00:00:00Z`)) || new Date(`${manifest.date}T00:00:00Z`).toISOString().slice(0, 10) !== manifest.date) throw new Error('Invalid article date');
  const unknown = Object.keys(manifest.sites ?? {}).filter(site => !sites.includes(site));
  if (unknown.length) throw new Error(`Unknown sites: ${unknown.join(', ')}`);
  const selectedSites = sites.filter(site => manifest.sites?.[site]);
  if (!selectedSites.length) throw new Error('Select at least one site');
  const variants = new Map();
  for (const site of selectedSites) {
    const variant = JSON.parse(readFileSync(safePath(base, manifest.sites[site]), 'utf8'));
    for (const field of ['title', 'description', 'summary', 'category', 'bodyFile']) {
      if (typeof variant[field] !== 'string' || !variant[field].trim()) throw new Error(`${site}: ${field} is required`);
    }
    const bodyHtml = readFileSync(safePath(base, variant.bodyFile), 'utf8').trim();
    if (!bodyHtml || bodyHtml === '<p></p>') throw new Error(`${site}: body is empty`);
    const repo = primarySites.includes(site) ? primary : secondary;
    if (existsSync(join(repo, 'posts', `${manifest.slug}.html`))) throw new Error(`${site}: slug collides with an existing article`);
    variants.set(site, { title: variant.title, description: variant.description, summary: variant.summary,
      category: variant.category, bodyHtml, date: manifest.date });
  }
  return { manifest, variants, selectedSites };
}

function preflight(slug, selectedSites) {
  for (const repo of [primary, secondary]) {
    const selected = selectedSites.filter(site => (repo === primary ? primarySites : secondarySites).includes(site));
    if (!selected.length) continue;
    const allowed = new Set(selected.map(site => `content/${site}/${slug}.json`));
    const changes = run('git', ['status', '--porcelain', '--untracked-files=all'], repo, false).split('\n').filter(Boolean);
    if (changes.some(change => {
      const path = change.slice(3);
      const localAdminChange = repo === primary && (path === 'README.md' || path === 'admin-server.mjs' || path === 'publisher.mjs' || path.startsWith('admin/'));
      return ![' ', '?'].includes(change[0]) || (!allowed.has(path) && !localAdminChange);
    })) throw new Error(`Repository has unrelated changes: ${repo}`);
    run('git', ['ls-files', '--error-unmatch', 'build-site.mjs'], repo);
    if (run('git', ['branch', '--show-current'], repo) !== 'main') throw new Error(`Expected main branch: ${repo}`);
    run('git', ['fetch', 'origin', 'main'], repo);
    run('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], repo);
  }
}

function prepare(variants, slug) {
  for (const site of variants.keys()) {
    const repo = primarySites.includes(site) ? primary : secondary;
    const folder = join(repo, 'content', site);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, `${slug}.json`), JSON.stringify(variants.get(site), null, 2) + '\n');
    console.log(run(process.execPath, ['build-site.mjs', site], repo));
  }
}

function publish(slug, selectedSites) {
  for (const repo of [primary, secondary]) {
    const selected = selectedSites.filter(site => (repo === primary ? primarySites : secondarySites).includes(site));
    if (!selected.length) continue;
    for (const site of selected) run('git', ['add', '--', `content/${site}/${slug}.json`], repo);
    if (!run('git', ['diff', '--cached', '--name-only'], repo)) continue;
    run('git', ['-c', 'user.name=sherlock900326', '-c', 'user.email=sherlock900326@users.noreply.github.com', 'commit', '-m', `Publish ${slug}`], repo);
  }
  for (const repo of [primary, secondary]) {
    if (!selectedSites.some(site => (repo === primary ? primarySites : secondarySites).includes(site))) continue;
    run('git', ['push', 'origin', 'main'], repo);
    console.log(`Pushed ${repo}`);
  }
}

const [command, argument] = process.argv.slice(2);
try {
  if (command === 'init' && argument) init(argument);
  else if (['check', 'prepare', 'publish'].includes(command) && argument) {
    const { manifest, variants, selectedSites } = load(argument);
    console.log(`Validated ${variants.size} variants for ${manifest.slug}`);
    if (command === 'publish') preflight(manifest.slug, selectedSites);
    if (command !== 'check') prepare(variants, manifest.slug);
    if (command === 'publish') publish(manifest.slug, selectedSites);
  } else {
    console.error('Usage: node publisher.mjs init <slug> | check|prepare|publish <draft/article.json>');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
