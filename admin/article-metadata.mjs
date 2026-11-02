function plainText(value) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|#39);/g, ' ')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function inferMetadata(markdown, filename = '') {
  let content = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  let category = '';
  if (content.startsWith('---\n')) {
    const end = content.indexOf('\n---\n', 4);
    if (end !== -1) {
      const frontmatter = content.slice(4, end);
      category = /^(?:category|分类)\s*[:：]\s*(.+)$/im.exec(frontmatter)?.[1]?.trim() ?? '';
      content = content.slice(end + 5).trim();
    }
  }
  const lines = content.split('\n').map(line => line.trim()).filter(Boolean);
  const heading = lines.find(line => /^#\s+/.test(line));
  const firstLine = heading ?? lines.find(line => !/^(?:#{2,6}\s+|>|[-*+]\s+|\d+\.\s+|```|~~~|!\[)/.test(line)) ?? '';
  const title = plainText(firstLine.replace(/^#\s+/, '')).slice(0, 120)
    || plainText(filename.replace(/\.(?:docx?|md|txt)$/i, '')).slice(0, 180);
  const excerptContent = heading || !firstLine ? content : content.replace(firstLine, '').trim();
  const paragraphs = excerptContent.split(/\n\s*\n/).map(paragraph => paragraph.split('\n')
    .filter(line => !/^\s*(?:#{1,6}\s+|```|~~~|!\[)/.test(line))
    .map(line => line.replace(/^\s*(?:>|[-*+]\s+|\d+\.\s+)/, '')).join(' '))
    .map(plainText).filter(paragraph => paragraph && paragraph !== title);
  const excerpt = paragraphs[0] ?? title;
  return {
    title,
    category: category.slice(0, 60) || '文章',
    description: excerpt.slice(0, 160),
    summary: excerpt.slice(0, 240),
  };
}
