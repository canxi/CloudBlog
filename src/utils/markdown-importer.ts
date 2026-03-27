/**
 * Markdown file batch importer
 * Parses Markdown files with frontmatter (YAML)
 */

import type { MarkdownPost } from '../types/migration';

function generateId(): string {
  return crypto.randomUUID();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const fmRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(fmRegex);

  if (!match) {
    return { data: {}, body: content };
  }

  const fmString = match[1];
  const body = match[2];
  const data: Record<string, unknown> = {};

  // Simple YAML parser for frontmatter
  const lines = fmString.split('\n');
  let currentKey = '';
  let currentArray: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Array item (multi-line YAML list)
    if (trimmed.startsWith('- ')) {
      currentArray.push(trimmed.substring(2).trim());
      continue;
    }

    // Flush previous array if exists
    if (currentKey && currentArray.length > 0) {
      data[currentKey] = [...currentArray];
      currentKey = '';
      currentArray = [];
    }

    // Key-value pair
    const kvMatch = trimmed.match(/^(\w+(?:_?\w+)*):\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      let value = kvMatch[2].trim();

      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // Inline array
      if (value.startsWith('[') && value.endsWith(']')) {
        data[currentKey] = value.slice(1, -1).split(',').map(v =>
          v.trim().replace(/^["']|["']$/g, '')
        ).filter(Boolean);
        currentKey = '';
      } else if (value === '' || value === '|' || value === '>') {
        // Multi-line value follows on next lines, treat as empty string for now
        currentArray = []; // prepare for list detection on next line
      } else {
        data[currentKey] = value;
        currentKey = '';
      }
    }
  }

  // Flush last key/array
  if (currentKey) {
    if (currentArray.length > 0) {
      data[currentKey] = currentArray;
    }
  }

  return { data, body };
}

function extractFirstImage(markdown: string): string | undefined {
  const patterns = [
    /!\[.*?\]\((.*?)\)/,
    /<img[^>]+src=["']([^"']+)["']/i,
  ];

  for (const pattern of patterns) {
    const match = markdown.match(pattern);
    if (match) return match[1];
  }
  return undefined;
}

function extractExcerpt(markdown: string, maxLength = 200): string {
  // Remove markdown syntax
  const plain = markdown
    .replace(/!\[.*?\]\(.*?\)/g, '') // images
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1') // links
    .replace(/#{1,6}\s/g, '') // headers
    .replace(/[*_`~]/g, '') // emphasis
    .replace(/\n+/g, ' ')
    .trim();

  if (plain.length <= maxLength) return plain;
  return plain.substring(0, maxLength).replace(/\s+\S*$/, '') + '...';
}

function parseDate(dateStr: unknown): number | undefined {
  if (!dateStr) return undefined;
  if (typeof dateStr === 'number') return dateStr;
  const date = new Date(String(dateStr));
  return isNaN(date.getTime()) ? undefined : Math.floor(date.getTime() / 1000);
}

export function parseMarkdownFile(content: string, filename: string): MarkdownPost {
  const { data, body } = parseFrontmatter(content);

  const title = String(data.title || filename.replace(/\.md$/i, '').replace(/[-_]/g, ' '));
  const slug = String(data.slug || slugify(title));

  let coverImage = String(data.cover_image || data.coverImage || data.image || '');
  if (!coverImage) {
    coverImage = extractFirstImage(body) || '';
  }

  const categories = Array.isArray(data.categories)
    ? data.categories.map(String)
    : data.categories
      ? String(data.categories).split(',').map(s => s.trim())
      : [];

  const tags = Array.isArray(data.tags)
    ? data.tags.map(String)
    : data.tags
      ? String(data.tags).split(',').map(s => s.trim())
      : [];

  const authorName = data.author ? String(data.author) : undefined;

  return {
    title,
    slug: slug || generateId(),
    content: body,
    excerpt: data.excerpt
      ? String(data.excerpt)
      : extractExcerpt(body),
    coverImage,
    categories,
    tags,
    publishedAt: parseDate(data.date || data.published_at || data.publish_date),
    authorName,
  };
}

export function parseMarkdownFiles(
  files: { name: string; content: string }[]
): MarkdownPost[] {
  return files.map(f => parseMarkdownFile(f.content, f.name));
}

export function countMarkdownFiles(content: string): number {
  // Each file is separated by ---
  // Count frontmatter boundaries
  const matches = content.match(/^---\s*\n/m);
  return matches ? (content.match(/^---\s*\n/g) || []).length : 1;
}
