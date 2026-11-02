export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function inline(source) {
  return escapeHtml(source)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => `<a href="${url}" rel="noopener noreferrer">${label}</a>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function renderMarkdown(source) {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const result = [];
  let paragraph = [];
  let list = null;
  let code = null;

  function flushParagraph() {
    if (paragraph.length) result.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  }

  function closeList() {
    if (list) result.push(`</${list}>`);
    list = null;
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      flushParagraph();
      closeList();
      if (code) {
        result.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        code = null;
      } else code = [];
      continue;
    }
    if (code) { code.push(line); continue; }
    if (!line.trim()) { flushParagraph(); closeList(); continue; }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph(); closeList();
      const level = heading[1].length + 1;
      result.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    const numbered = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const nextList = bullet ? 'ul' : 'ol';
      if (list !== nextList) { closeList(); result.push(`<${nextList}>`); list = nextList; }
      result.push(`<li>${inline((bullet || numbered)[1])}</li>`);
      continue;
    }
    closeList();
    if (line.startsWith('> ')) {
      flushParagraph();
      result.push(`<blockquote><p>${inline(line.slice(2))}</p></blockquote>`);
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph(); closeList();
  if (code) result.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  return result.join('\n');
}
