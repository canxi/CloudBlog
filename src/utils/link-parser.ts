/**
 * Bidirectional link parser
 * Parses [[Article Title]] or [[slug|Display Text]] syntax
 */

export interface ParsedLink {
  raw: string;        // Full match e.g. [[Article Title]]
  slug?: string;       // Extracted slug
  title: string;       // Display text
  isValid: boolean;   // Whether the linked post exists
}

export interface BacklinkInfo {
  sourcePostId: string;
  sourceSlug: string;
  sourceTitle: string;
  linkText: string;
}

// Pattern: [[slug|title]] or [[title]]
const WIKI_LINK_REGEX = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export function parseWikiLinks(content: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  let match;

  while ((match = WIKI_LINK_REGEX.exec(content)) !== null) {
    const raw = match[0];
    const rawTitle = match[1].trim();
    const displayText = match[2]?.trim() || rawTitle;

    // Convert title to potential slug
    const slug = titleToSlug(rawTitle);

    links.push({
      raw,
      slug,
      title: displayText,
      isValid: false, // Will be validated in context
    });
  }

  return links;
}

export function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

export function renderWikiLinks(content: string, postMap: Map<string, { id: string; slug: string; title: string }>): string {
  return content.replace(WIKI_LINK_REGEX, (match, rawTitle, displayText) => {
    const title = rawTitle.trim();
    const slug = titleToSlug(title);
    const post = postMap.get(slug);

    if (post) {
      const text = displayText?.trim() || title;
      return `<a href="/posts/${post.slug}" class="wiki-link" data-post-id="${post.id}">${escapeHtml(text)}</a>`;
    } else {
      // Broken link - render as text with indicator
      return `<span class="wiki-link-broken">${escapeHtml(displayText?.trim() || title)}</span>`;
    }
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Extract unique link targets from content
export function extractLinkTargets(content: string): string[] {
  const links = parseWikiLinks(content);
  const slugs = new Set<string>();
  for (const link of links) {
    if (link.slug) slugs.add(link.slug);
  }
  return Array.from(slugs);
}
