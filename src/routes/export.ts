/**
 * Data Export API
 * Exports posts in various formats (Markdown, JSON, HTML)
 */

import { postToMarkdown, postToHtml, postsToJson, type ExportedPost } from '../utils/post-exporter';

function requireAuth(request: Request, env: Env): boolean {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  return token === env.API_SECRET;
}

function getPostFromRow(row: Record<string, unknown>): ExportedPost {
  return {
    id: String(row.id),
    title: String(row.title || ''),
    slug: String(row.slug || ''),
    content: String(row.content || ''),
    excerpt: String(row.excerpt || ''),
    coverImage: String(row.cover_image || ''),
    authorId: String(row.author_id || ''),
    status: String(row.status || 'draft'),
    publishedAt: Number(row.published_at) || 0,
    categories: [],
    tags: [],
  };
}

// GET /api/export/markdown - Export all posts as Markdown ZIP
async function handleExportMarkdown(request: Request, env: Env): Promise<Response> {
  if (!requireAuth(request, env)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const category = url.searchParams.get('category') || undefined;
  const startDate = url.searchParams.get('start') || undefined;
  const endDate = url.searchParams.get('end') || undefined;
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  const posts = await queryPosts(env.DB, { category, startDate, endDate, limit, offset });

  if (posts.length === 0) {
    return Response.json({ error: 'No posts found' }, { status: 404 });
  }

  // Generate Markdown content
  const files: { name: string; content: string }[] = [];
  for (const post of posts) {
    const exported = await enrichPost(post, env.DB);
    const content = postToMarkdown(exported);
    files.push({ name: `${exported.slug}.md`, content });
  }

  // For a real ZIP, we'd use a library like JSZip
  // For now, return as a JSON array of files (client can create ZIP)
  return Response.json({
    format: 'markdown',
    count: files.length,
    files,
  });
}

// GET /api/export/json - Export all posts as JSON
async function handleExportJson(request: Request, env: Env): Promise<Response> {
  if (!requireAuth(request, env)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const category = url.searchParams.get('category') || undefined;
  const startDate = url.searchParams.get('start') || undefined;
  const endDate = url.searchParams.get('end') || undefined;
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '500'), 1000);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  const posts = await queryPosts(env.DB, { category, startDate, endDate, limit, offset });

  const enriched = await Promise.all(posts.map(p => enrichPost(p, env.DB)));

  return new Response(postsToJson(enriched), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="cloudblog-export.json"',
    },
  });
}

// GET /api/export/html - Export all posts as HTML files
async function handleExportHtml(request: Request, env: Env): Promise<Response> {
  if (!requireAuth(request, env)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const category = url.searchParams.get('category') || undefined;
  const startDate = url.searchParams.get('start') || undefined;
  const endDate = url.searchParams.get('end') || undefined;
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  const posts = await queryPosts(env.DB, { category, startDate, endDate, limit, offset });

  if (posts.length === 0) {
    return Response.json({ error: 'No posts found' }, { status: 404 });
  }

  const files: { name: string; content: string }[] = [];
  for (const post of posts) {
    const exported = await enrichPost(post, env.DB);
    const content = postToHtml(exported);
    files.push({ name: `${exported.slug}.html`, content });
  }

  return Response.json({
    format: 'html',
    count: files.length,
    files,
  });
}

async function queryPosts(
  db: D1Database,
  opts: {
    category?: string;
    startDate?: string;
    endDate?: string;
    limit: number;
    offset: number;
  }
) {
  let query = `SELECT id, title, slug, content, excerpt, cover_image, author_id, status, published_at FROM posts WHERE status = 'published'`;
  const bindings: (string | number)[] = [];

  if (opts.category) {
    query += ` AND id IN (
      SELECT post_id FROM post_categories pc
      JOIN categories c ON c.id = pc.category_id
      WHERE c.slug = ?
    )`;
    bindings.push(opts.category);
  }

  if (opts.startDate) {
    const ts = Math.floor(new Date(opts.startDate).getTime() / 1000);
    query += ` AND published_at >= ?`;
    bindings.push(ts);
  }

  if (opts.endDate) {
    const ts = Math.floor(new Date(opts.endDate).getTime() / 1000 + 86400);
    query += ` AND published_at <= ?`;
    bindings.push(ts);
  }

  query += ` ORDER BY published_at DESC LIMIT ? OFFSET ?`;
  bindings.push(opts.limit, opts.offset);

  const result = await db.prepare(query).bind(...bindings).all();
  return result.results as Record<string, unknown>[];
}

async function enrichPost(post: Record<string, unknown>, db: D1Database): Promise<ExportedPost> {
  const exported = getPostFromRow(post);

  // Get categories
  const cats = await db
    .prepare(`SELECT c.name FROM categories c
      JOIN post_categories pc ON pc.category_id = c.id
      WHERE pc.post_id = ?`)
    .bind(exported.id)
    .all();
  exported.categories = (cats.results as { name: string }[]).map(r => r.name);

  // Get tags
  const tags = await db
    .prepare(`SELECT t.name FROM tags t
      JOIN post_tags pt ON pt.tag_id = t.id
      WHERE pt.post_id = ?`)
    .bind(exported.id)
    .all();
  exported.tags = (tags.results as { name: string }[]).map(r => r.name);

  return exported;
}

export async function handleExportRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/export', '');

  if (!requireAuth(request, env)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (request.method === 'GET' && path === '/markdown') {
    return await handleExportMarkdown(request, env);
  }
  if (request.method === 'GET' && path === '/json') {
    return await handleExportJson(request, env);
  }
  if (request.method === 'GET' && path === '/html') {
    return await handleExportHtml(request, env);
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}
