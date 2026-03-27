/**
 * Backlinks API - Bidirectional linking
 * Handles [[wiki-link]] parsing and backlink tracking
 */

import { parseWikiLinks, extractLinkTargets, titleToSlug } from '../utils/link-parser';
import type { BacklinkInfo } from '../utils/link-parser';

// Build a slug->post map for quick lookup
async function buildPostMap(db: D1Database): Promise<Map<string, { id: string; slug: string; title: string }>> {
  const result = await db.prepare(`SELECT id, slug, title FROM posts WHERE status = 'published'`).all();
  const map = new Map<string, { id: string; slug: string; title: string }>();
  for (const row of result.results as { id: string; slug: string; title: string }[]) {
    map.set(row.slug, { id: row.id, slug: row.slug, title: row.title });
    // Also index by slugified title
    const titleSlug = titleToSlug(row.title);
    if (!map.has(titleSlug)) {
      map.set(titleSlug, { id: row.id, slug: row.slug, title: row.title });
    }
  }
  return map;
}

// Sync backlinks for a post after save
export async function syncBacklinks(
  db: D1Database,
  postId: string,
  content: string
): Promise<void> {
  const postMap = await buildPostMap(db);
  const targetSlugs = extractLinkTargets(content);
  const now = Math.floor(Date.now() / 1000);

  // Delete existing backlinks from this source
  await db.prepare(`DELETE FROM backlinks WHERE source_post_id = ?`).bind(postId).run();

  // Create new backlinks
  for (const targetSlug of targetSlugs) {
    const targetPost = postMap.get(targetSlug);
    if (targetPost && targetPost.id !== postId) {
      const id = crypto.randomUUID();
      await db
        .prepare(`INSERT OR IGNORE INTO backlinks (id, source_post_id, target_post_id, created_at) VALUES (?, ?, ?, ?)`)
        .bind(id, postId, targetPost.id, now)
        .run();
    }
  }
}

// GET /api/backlinks/:postId - Get backlinks TO a post (who links to it)
async function handleGetBacklinks(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const postId = url.pathname.split('/').pop();

  if (!postId) {
    return Response.json({ error: 'Missing postId' }, { status: 400 });
  }

  const result = await env.DB
    .prepare(`SELECT b.source_post_id, p.slug, p.title, p.excerpt
      FROM backlinks b
      JOIN posts p ON p.id = b.source_post_id
      WHERE b.target_post_id = ?`)
    .bind(postId)
    .all();

  const backlinks: BacklinkInfo[] = (result.results as { source_post_id: string; slug: string; title: string; excerpt: string }[]).map(row => ({
    sourcePostId: String(row.source_post_id),
    sourceSlug: String(row.slug),
    sourceTitle: String(row.title),
    linkText: String(row.excerpt || '').substring(0, 100),
  }));

  return Response.json({ backlinks, count: backlinks.length });
}

// GET /api/backlinks/:postId/outgoing - Get outgoing links FROM a post
async function handleGetOutgoing(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const postId = url.pathname.split('/').pop();

  if (!postId) {
    return Response.json({ error: 'Missing postId' }, { status: 400 });
  }

  const result = await env.DB
    .prepare(`SELECT b.target_post_id, p.slug, p.title
      FROM backlinks b
      JOIN posts p ON p.id = b.target_post_id
      WHERE b.source_post_id = ?`)
    .bind(postId)
    .all();

  const outgoing: { targetPostId: string; slug: string; title: string }[] = (result.results as { target_post_id: string; slug: string; title: string }[]).map(row => ({
    targetPostId: String(row.target_post_id),
    slug: String(row.slug),
    title: String(row.title),
  }));

  return Response.json({ outgoing, count: outgoing.length });
}

// GET /api/backlinks/suggest?q= - Get link suggestions for autocomplete
async function handleSuggest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get('q') || '';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 20);

  if (q.length < 1) {
    return Response.json({ suggestions: [] });
  }

  // Search by title or slug
  const like = `%${q}%`;
  const result = await env.DB
    .prepare(`SELECT id, slug, title FROM posts WHERE status = 'published' AND (title LIKE ? OR slug LIKE ?) LIMIT ?`)
    .bind(like, like, limit)
    .all();

  const suggestions = (result.results as { id: string; slug: string; title: string }[]).map(row => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    displayText: row.title, // for [[title]] format
  }));

  return Response.json({ suggestions });
}

export async function handleBacklinksRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/backlinks', '');

  if (request.method === 'GET' && path.match(/^\/[a-f0-9-]+\/outgoing$/)) {
    return await handleGetOutgoing(request, env);
  }
  if (request.method === 'GET' && path.match(/^\/[a-f0-9-]+$/)) {
    return await handleGetBacklinks(request, env);
  }
  if (request.method === 'GET' && path === '/suggest') {
    return await handleSuggest(request, env);
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}
