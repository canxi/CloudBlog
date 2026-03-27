/**
 * WordPress XML Export Parser
 * Parses WordPress WXR (WordPress eXtended RSS) export files
 */

import type { WordPressPost } from '../types/migration';

const ITEM_PER_PAGE = 50;

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

function parseContentEncoded(content: string): string {
  // WordPress uses CDATA for content
  const match = content.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return match ? match[1] : content;
}

function parseDate(dateStr: string): number {
  if (!dateStr) return Date.now() / 1000;
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? Date.now() / 1000 : Math.floor(date.getTime() / 1000);
}

function extractImageUrl(html: string): string | undefined {
  // Match common WordPress image patterns
  const patterns = [
    /<img[^>]+src=["']([^"']+)["']/i,
    /<a[^>]+href=["']([^"']+\.(jpg|jpeg|png|gif|webp))["'][^>]*>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return undefined;
}

export function parseWordPressXML(xmlContent: string): WordPressPost[] {
  const posts: WordPressPost[] = [];

  // Extract all <item> elements
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let itemMatch;

  while ((itemMatch = itemRegex.exec(xmlContent)) !== null) {
    const item = itemMatch[1];

    // Skip non-post items (attachments, etc)
    const postType = extractTag(item, 'wp:post_type') || 'post';
    if (postType !== 'post') continue;

    // Skip revisions
    const status = extractTag(item, 'wp:status');
    if (status === 'revision') continue;

    const title = decodeHTMLEntities(parseContentEncoded(extractTag(item, 'title') || 'Untitled'));
    const rawContent = parseContentEncoded(extractTag(item, 'content:encoded') || '');
    const rawExcerpt = parseContentEncoded(extractTag(item, 'excerpt:encoded') || '');

    // Extract categories
    const categories: string[] = [];
    const catRegex =/<category[^>]*domain=["']category["'][^>]*>([\s\S]*?)<\/category>/gi;
    let catMatch;
    while ((catMatch = catRegex.exec(item)) !== null) {
      const raw = catMatch[1];
      // Handle CDATA or plain text
      const cdataMatch = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
      const cat = decodeHTMLEntities(cdataMatch ? cdataMatch[1] : raw).trim();
      if (cat && !categories.includes(cat)) categories.push(cat);
    }

    // Extract tags
    const tags: string[] = [];
    const tagRegex =/<category[^>]*domain=["']post_tag["'][^>]*>([\s\S]*?)<\/category>/gi;
    let tagMatch;
    while ((tagMatch = tagRegex.exec(item)) !== null) {
      const raw = tagMatch[1];
      const cdataMatch = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
      const tag = decodeHTMLEntities(cdataMatch ? cdataMatch[1] : raw).trim();
      if (tag && !tags.includes(tag)) tags.push(tag);
    }

    // Extract featured image
    const featuredImage = extractTag(item, 'wp:postmeta')
      ? extractPostMeta(item, 'wp:featured_image') || extractImageUrl(rawContent)
      : extractImageUrl(rawContent);

    const pubDate = extractTag(item, 'pubDate');
    const rawSlug = extractTag(item, 'wp:slug') || extractTag(item, 'wp:post_name') || '';
    const slugCdata = rawSlug.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
    const slug = (slugCdata ? slugCdata[1] : rawSlug) || slugify(title);

    posts.push({
      title,
      slug: slug || generateId(),
      content: rawContent,
      excerpt: rawExcerpt || rawContent.substring(0, 200).replace(/<[^>]+>/g, '') + '...',
      publishedAt: pubDate ? parseDate(pubDate) : Date.now() / 1000,
      categories,
      tags,
      featuredImage,
      status: status === 'publish' ? 'published' : 'draft',
    });
  }

  return posts;
}

function extractTag(xml: string, tagName: string): string | undefined {
  // Handle namespaced tags like <wp:post_id>
  const patterns = [
    new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'i'),
    new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = xml.match(pattern);
    if (match) return match[1].trim();
  }
  return undefined;
}

function extractPostMeta(xml: string, metaKey: string): string | undefined {
  const regex = new RegExp(`<wp:postmeta>[\\s\\S]*?<wp:meta_key>${metaKey}<\\/wp:meta_key>[\\s\\S]*?<wp:meta_value>([\\s\\S]*?)<\\/wp:meta_value>[\\s\\S]*?<\\/wp:postmeta>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : undefined;
}

function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([a-fA-F0-9]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function countWordPressPosts(xmlContent: string): number {
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let count = 0;
  let itemMatch;

  while ((itemMatch = itemRegex.exec(xmlContent)) !== null) {
    const item = itemMatch[1];
    const postType = extractTag(item, 'wp:post_type') || 'post';
    const status = extractTag(item, 'wp:status');
    if (postType === 'post' && status !== 'revision') {
      count++;
    }
  }

  return count;
}
