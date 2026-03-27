/**
 * Posts API - Blog post CRUD operations
 */

import { syncBacklinks } from './backlinks';

function requireAuth(request: Request, env: Env): boolean {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  return token === env.API_SECRET;
}

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

// GET /api/posts - List published posts
async function handleList(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
  const category = url.searchParams.get('category') || undefined;
  const tag = url.searchParams.get('tag') || undefined;

  let query = `
    SELECT p.id, p.title, p.slug, p.excerpt, p.cover_image, p.status, 
           p.published_at, p.created_at, p.updated_at,
           u.display_name as author_name, u.avatar_url as author_avatar
    FROM posts p
    LEFT JOIN users u ON p.author_id = u.id
    WHERE p.status = 'published'
  `;
  const bindings: (string | number)[] = [];

  if (category) {
    query += ` AND p.id IN (
      SELECT pc.post_id FROM post_categories pc 
      JOIN categories c ON pc.category_id = c.id WHERE c.slug = ?
    )`;
    bindings.push(category);
  }

  if (tag) {
    query += ` AND p.id IN (
      SELECT pt.post_id FROM post_tags pt
      JOIN tags t ON pt.tag_id = t.id WHERE t.slug = ?
    )`;
    bindings.push(tag);
  }

  query += ` ORDER BY p.published_at DESC LIMIT ? OFFSET ?`;
  bindings.push(limit, (page - 1) * limit);

  const result = await env.DB.prepare(query).bind(...bindings).all();
  const posts = (result.results as Record<string, unknown>[]).map(row => ({
    id: String(row.id),
    title: String(row.title),
    slug: String(row.slug),
    excerpt: row.excerpt ? String(row.excerpt) : '',
    coverImage: row.cover_image ? String(row.cover_image) : '',
    status: String(row.status),
    publishedAt: row.published_at ? Number(row.published_at) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    author: {
      name: row.author_name ? String(row.author_name) : 'Unknown',
      avatar: row.author_avatar ? String(row.author_avatar) : '',
    },
  }));

  return jsonResponse({ posts, page, limit });
}

// GET /api/posts/:slug - Get single post by slug
async function handleGetBySlug(request: Request, env: Env, slug: string): Promise<Response> {
  const result = await env.DB
    .prepare(`
      SELECT p.*, u.display_name as author_name, u.avatar_url as author_avatar
      FROM posts p
      LEFT JOIN users u ON p.author_id = u.id
      WHERE p.slug = ? AND p.status = 'published'
    `)
    .bind(slug)
    .first();

  if (!result) {
    return jsonResponse({ error: 'Post not found' }, 404);
  }

  const row = result as Record<string, unknown>;

  // Get categories
  const cats = await env.DB
    .prepare(`
      SELECT c.name, c.slug FROM categories c
      JOIN post_categories pc ON c.id = pc.category_id
      WHERE pc.post_id = ?
    `)
    .bind(String(row.id))
    .all();
  const categories = (cats.results as { name: string; slug: string }[]).map(c => ({ name: c.name, slug: c.slug }));

  // Get tags
  const tags = await env.DB
    .prepare(`
      SELECT t.name, t.slug FROM tags t
      JOIN post_tags pt ON t.id = pt.tag_id
      WHERE pt.post_id = ?
    `)
    .bind(String(row.id))
    .all();
  const tagList = (tags.results as { name: string; slug: string }[]).map(t => ({ name: t.name, slug: t.slug }));

  return jsonResponse({
    id: String(row.id),
    title: String(row.title),
    slug: String(row.slug),
    content: String(row.content),
    excerpt: row.excerpt ? String(row.excerpt) : '',
    coverImage: row.cover_image ? String(row.cover_image) : '',
    status: String(row.status),
    publishedAt: row.published_at ? Number(row.published_at) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    author: {
      name: row.author_name ? String(row.author_name) : 'Unknown',
      avatar: row.author_avatar ? String(row.author_avatar) : '',
    },
    categories,
    tags: tagList,
  });
}

// POST /api/posts - Create post (admin)
async function handleCreate(request: Request, env: Env): Promise<Response> {
  if (!requireAuth(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body: {
    title?: string;
    slug?: string;
    content?: string;
    excerpt?: string;
    coverImage?: string;
    status?: string;
    category?: string;
    tags?: string[];
    authorId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const { title, slug, content, excerpt, coverImage, status = 'draft', category, tags = [], authorId = 'system' } = body;

  if (!title || !content) {
    return jsonResponse({ error: 'title and content are required' }, 400);
  }

  const postSlug = slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const postId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const publishedAt = status === 'published' ? now : null;

  await env.DB
    .prepare(`
      INSERT INTO posts (id, title, slug, content, excerpt, cover_image, author_id, status, published_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(postId, title, postSlug, content, excerpt || '', coverImage || '', authorId, status, publishedAt, now, now)
    .run();

  // Handle category
  if (category) {
    const catResult = await env.DB.prepare(`SELECT id FROM categories WHERE slug = ?`).bind(category).first();
    if (catResult) {
      await env.DB
        .prepare(`INSERT OR IGNORE INTO post_categories (post_id, category_id) VALUES (?, ?)`)
        .bind(postId, String((catResult as Record<string, unknown>).id))
        .run();
    }
  }

  // Handle tags
  for (const tagName of tags) {
    const tagSlug = tagName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    let tagId: string;
    const existing = await env.DB.prepare(`SELECT id FROM tags WHERE slug = ?`).bind(tagSlug).first();
    if (existing) {
      tagId = String((existing as Record<string, unknown>).id);
    } else {
      tagId = crypto.randomUUID();
      await env.DB.prepare(`INSERT INTO tags (id, name, slug) VALUES (?, ?, ?)`).bind(tagId, tagName, tagSlug).run();
    }
    await env.DB
      .prepare(`INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)`)
      .bind(postId, tagId)
      .run();
  }

  // Sync backlinks
  await syncBacklinks(env.DB, postId, content);

  return jsonResponse({ id: postId, slug: postSlug }, 201);
}

// PUT /api/posts/:slug - Update post (admin)
async function handleUpdate(request: Request, env: Env, slug: string): Promise<Response> {
  if (!requireAuth(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const existing = await env.DB.prepare(`SELECT id FROM posts WHERE slug = ?`).bind(slug).first();
  if (!existing) {
    return jsonResponse({ error: 'Post not found' }, 404);
  }
  const postId = String((existing as Record<string, unknown>).id);

  let body: {
    title?: string;
    content?: string;
    excerpt?: string;
    coverImage?: string;
    status?: string;
    category?: string;
    tags?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const updates: string[] = [];
  const bindings: (string | number | null)[] = [];

  if (body.title) { updates.push('title = ?'); bindings.push(body.title); }
  if (body.content) { updates.push('content = ?'); bindings.push(body.content); }
  if (body.excerpt !== undefined) { updates.push('excerpt = ?'); bindings.push(body.excerpt || ''); }
  if (body.coverImage !== undefined) { updates.push('cover_image = ?'); bindings.push(body.coverImage || ''); }
  if (body.status) {
    updates.push('status = ?');
    bindings.push(body.status);
    if (body.status === 'published') {
      updates.push('published_at = COALESCE(published_at, ?)');
      bindings.push(now);
    }
  }

  updates.push('updated_at = ?');
  bindings.push(now);
  bindings.push(postId);

  await env.DB
    .prepare(`UPDATE posts SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...bindings)
    .run();

  // Sync backlinks if content changed
  if (body.content) {
    await syncBacklinks(env.DB, postId, body.content);
  }

  return jsonResponse({ success: true });
}

// DELETE /api/posts/:slug - Delete post (admin)
async function handleDelete(request: Request, env: Env, slug: string): Promise<Response> {
  if (!requireAuth(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const existing = await env.DB.prepare(`SELECT id FROM posts WHERE slug = ?`).bind(slug).first();
  if (!existing) {
    return jsonResponse({ error: 'Post not found' }, 404);
  }

  await env.DB.prepare(`DELETE FROM posts WHERE slug = ?`).bind(slug).run();

  return jsonResponse({ success: true });
}

export async function handlePostsRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname.replace('/api/posts', '');
  const method = request.method;

  // GET /api/posts - list
  if (method === 'GET' && (pathname === '/' || pathname === '')) {
    return handleList(request, env);
  }

  // GET /api/posts/:slug - get by slug
  const getMatch = pathname.match(/^\/([a-z0-9-]+)$/);
  if (method === 'GET' && getMatch) {
    return handleGetBySlug(request, env, getMatch[1]);
  }

  // POST /api/posts - create
  if (method === 'POST' && (pathname === '/' || pathname === '')) {
    return handleCreate(request, env);
  }

  // PUT /api/posts/:slug - update
  if (method === 'PUT' && getMatch) {
    return handleUpdate(request, env, getMatch[1]);
  }

  // DELETE /api/posts/:slug - delete
  if (method === 'DELETE' && getMatch) {
    return handleDelete(request, env, getMatch[1]);
  }

  return jsonResponse({ error: 'Not found' }, 404);
}
