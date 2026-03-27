/**
 * Post export utilities
 * Converts posts to Markdown, JSON, or HTML format
 */

export interface ExportedPost {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  coverImage: string;
  authorId: string;
  status: string;
  publishedAt: number;
  categories: string[];
  tags: string[];
}

export function postToMarkdown(post: ExportedPost): string {
  const lines: string[] = [];

  // Frontmatter
  lines.push('---');
  lines.push(`title: "${escapeYaml(post.title)}"`);
  lines.push(`slug: ${post.slug}`);
  if (post.excerpt) lines.push(`excerpt: "${escapeYaml(post.excerpt)}"`);
  if (post.coverImage) lines.push(`cover_image: ${post.coverImage}`);
  if (post.publishedAt) lines.push(`date: ${formatDate(post.publishedAt)}`);
  if (post.categories.length > 0) {
    lines.push('categories:');
    for (const cat of post.categories) {
      lines.push(`  - ${cat}`);
    }
  }
  if (post.tags.length > 0) {
    lines.push('tags:');
    for (const tag of post.tags) {
      lines.push(`  - ${tag}`);
    }
  }
  lines.push('---');
  lines.push('');

  // Title as H1
  lines.push(`# ${post.title}`);
  lines.push('');

  // Content
  lines.push(post.content);

  return lines.join('\n');
}

export function postToHtml(post: ExportedPost): string {
  const htmlContent = markdownToHtml(post.content);
  const publishDate = post.publishedAt ? formatDate(post.publishedAt) : '';
  const categories = post.categories.join(', ');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(post.title)}</title>
  <meta name="description" content="${escapeHtml(post.excerpt)}">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; line-height: 1.7; color: #333; }
    h1 { font-size: 2em; margin-bottom: 0.5em; }
    .meta { color: #666; font-size: 0.9em; margin-bottom: 2em; padding-bottom: 1em; border-bottom: 1px solid #eee; }
    img { max-width: 100%; height: auto; border-radius: 8px; }
    pre { background: #f4f4f4; padding: 16px; border-radius: 8px; overflow-x: auto; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 4px solid #3b82f6; margin: 0; padding-left: 20px; color: #666; }
  </style>
</head>
<body>
  <article>
    <h1>${escapeHtml(post.title)}</h1>
    <div class="meta">${publishDate}${categories ? ` · ${escapeHtml(categories)}` : ''}</div>
    ${post.coverImage ? `<img src="${escapeHtml(post.coverImage)}" alt="${escapeHtml(post.title)}">` : ''}
    ${htmlContent}
  </article>
</body>
</html>`;
}

export function postsToJson(posts: ExportedPost[]): string {
  return JSON.stringify(posts, null, 2);
}

export function postsToZipManifest(posts: ExportedPost[]): {
  files: { name: string; content: string }[];
} {
  const files: { name: string; content: string }[] = [];

  for (const post of posts) {
    const filename = `${post.slug}.md`;
    files.push({
      name: filename,
      content: postToMarkdown(post),
    });
  }

  return { files };
}

function markdownToHtml(markdown: string): string {
  // Simple markdown to HTML conversion
  let html = markdown;

  // Headers
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  html = html.replace(/`(.+?)`/g, '<code>$1</code>');

  // Links
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');

  // Images
  html = html.replace(/!\[(.+?)\]\((.+?)\)/g, '<img src="$2" alt="$1">');

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Paragraphs
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<h[1-6]>)/g, '$1');
  html = html.replace(/(<\/h[1-6]>)<\/p>/g, '$1');
  html = html.replace(/<p>(<pre>)/g, '$1');
  html = html.replace(/(<\/pre>)<\/p>/g, '$1');
  html = html.replace(/<p>(<ul>)/g, '$1');
  html = html.replace(/(<\/ul>)<\/p>/g, '$1');
  html = html.replace(/<p>(<blockquote>)/g, '$1');
  html = html.replace(/(<\/blockquote>)<\/p>/g, '$1');
  html = html.replace(/<p>(<img)/g, '$1');
  html = html.replace(/<p>(<li>)/g, '$1');

  return html;
}

function escapeYaml(str: string): string {
  return str.replace(/"/g, '\\"').replace(/\n/g, ' ');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toISOString().substring(0, 10);
}
