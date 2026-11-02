const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function articleSlug(title, fallbackSlug, requested = '') {
  if (slugPattern.test(requested.trim())) return requested.trim();
  const prefix = (requested.trim() || title).toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/, '');
  return prefix ? `${prefix}-${fallbackSlug.slice(8)}` : fallbackSlug;
}
