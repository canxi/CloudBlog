/**
 * Posts API - Blog post CRUD operations
 */

import { getSessionUser } from '../middleware/auth';

// [CLEANUP] API_SECRET fallback removed - session-only auth
// --完成: 移除 API_SECRET 硬编码鉴权 --
async function adminAuth(request: Request, env: Env) {
  return await getSessionUser(request, env.DB);
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
    SELECT p.id, p.post_num, p.title, p.slug, p.excerpt, p.cover_image, p.status, 
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
    post_num: row.post_num ? Number(row.post_num) : null,
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

// GET /api/admin/posts - List all posts including drafts (admin only)
async function handleAdminList(request: Request, env: Env): Promise<Response> {
  const user = await adminAuth(request, env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const result = await env.DB
    .prepare(`
      SELECT p.id, p.post_num, p.title, p.slug, p.excerpt, p.cover_image, p.status,
             p.published_at, p.created_at, p.updated_at,
             u.display_name as author_name, u.avatar_url as author_avatar
      FROM posts p
      LEFT JOIN users u ON p.author_id = u.id
      ORDER BY p.created_at DESC
    `)
    .all();

  const posts = await Promise.all((result.results as Record<string, unknown>[]).map(async row => {
    // Fetch tags for each post
    const tagRows = await env.DB
      .prepare(`SELECT t.name, t.slug FROM tags t JOIN post_tags pt ON t.id = pt.tag_id WHERE pt.post_id = ?`)
      .bind(String(row.id))
      .all();
    const tags = (tagRows.results as { name: string; slug: string }[]).map(t => t.name);

    return {
      id: String(row.id),
      post_num: row.post_num ? Number(row.post_num) : null,
      title: String(row.title),
      slug: String(row.slug),
      excerpt: row.excerpt ? String(row.excerpt) : '',
      coverImage: row.cover_image ? String(row.cover_image) : '',
      status: String(row.status),
      publishedAt: row.published_at ? Number(row.published_at) : null,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      tags,
      author: {
        name: row.author_name ? String(row.author_name) : 'Unknown',
        avatar: row.author_avatar ? String(row.author_avatar) : '',
      },
    };
  }));

  return jsonResponse({ posts });
}

// GET /api/posts/:slug - Get single post by slug or by post_num
async function handleGetBySlug(request: Request, env: Env, slug: string): Promise<Response> {
  // Decode URL-encoded slug (handle double-encoding: %25E6 -> %E6 -> 测试)
  let decodedSlug = slug;
  for (let i = 0; i < 5; i++) {
    const next = decodeURIComponent(decodedSlug);
    if (next === decodedSlug) break;
    decodedSlug = next;
  }
  // Check if user is authenticated admin - allow fetching drafts for editing
  const user = await getSessionUser(request, env.DB);
  const isAdmin = user && user.role === 'admin';

  // If slug looks like a number, try looking up by post_num first
  const num = parseInt(decodedSlug);
  let result;
  if (!isNaN(num) && String(num) === decodedSlug) {
    result = await env.DB
      .prepare(`
        SELECT p.*, u.display_name as author_name, u.avatar_url as author_avatar
        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        WHERE p.post_num = ? ${isAdmin ? '' : "AND p.status = 'published'"}
      `)
      .bind(num)
      .first();
  } else {
    result = await env.DB
      .prepare(`
        SELECT p.*, u.display_name as author_name, u.avatar_url as author_avatar
        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        WHERE p.slug = ? ${isAdmin ? '' : "AND p.status = 'published'"}
      `)
      .bind(decodedSlug)
      .first();
  }

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
    post_num: row.post_num ? Number(row.post_num) : null,
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
  const user = await adminAuth(request, env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  // Body size limit
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > 2 * 1024 * 1024) {
    return jsonResponse({ error: 'Request body too large (max 2MB)' }, 413);
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

  const postId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const publishedAt = status === 'published' ? now : null;

  // Get next post_num
  const maxResult = await env.DB.prepare(`SELECT MAX(post_num) as max_num FROM posts`).first() as { max_num: number | null };
  const nextNum = (maxResult?.max_num ?? 0) + 1;

  // If slug is empty, use post_num as slug
  const postSlug = slug ? slug.slice(0, 100) : String(nextNum);

  await env.DB
    .prepare(`
      INSERT INTO posts (id, post_num, title, slug, content, excerpt, cover_image, author_id, status, published_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(postId, nextNum, title, postSlug, content, excerpt || '', coverImage || '', authorId, status, publishedAt, now, now)
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

  return jsonResponse({ id: postId, slug: postSlug }, 201);
}

// PUT /api/posts/:slug - Update post (admin)
async function handleUpdate(request: Request, env: Env, slug: string): Promise<Response> {
  const user = await adminAuth(request, env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  let decodedSlug = slug;
  for (let i = 0; i < 5; i++) {
    const next = decodeURIComponent(decodedSlug);
    if (next === decodedSlug) break;
    decodedSlug = next;
  }

  // If slug looks like a number, look up by post_num
  const num = parseInt(decodedSlug);
  let existing;
  if (!isNaN(num) && String(num) === decodedSlug) {
    existing = await env.DB.prepare(`SELECT id FROM posts WHERE post_num = ?`).bind(num).first();
  } else {
    existing = await env.DB.prepare(`SELECT id FROM posts WHERE slug = ?`).bind(decodedSlug).first();
  }
  if (!existing) {
    return jsonResponse({ error: 'Post not found' }, 404);
  }
  const postId = String((existing as Record<string, unknown>).id);

  let body: {
    title?: string;
    slug?: string;
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
  if (body.slug) { updates.push('slug = ?'); bindings.push(body.slug.slice(0, 100)); }
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

  return jsonResponse({ success: true });
}

// DELETE /api/posts/:slug - Delete post (admin)
async function handleDelete(request: Request, env: Env, slug: string): Promise<Response> {
  const user = await adminAuth(request, env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  let decodedSlug = slug;
  for (let i = 0; i < 5; i++) {
    const next = decodeURIComponent(decodedSlug);
    if (next === decodedSlug) break;
    decodedSlug = next;
  }

  // If slug looks like a number, look up by post_num first, then fallback to slug
  const num = parseInt(decodedSlug);
  let existing;
  if (!isNaN(num) && String(num) === decodedSlug) {
    // Try post_num first
    existing = await env.DB.prepare(`SELECT id FROM posts WHERE post_num = ?`).bind(num).first();
    // Fallback to slug if post_num not found (handles slugs like "123")
    if (!existing) {
      existing = await env.DB.prepare(`SELECT id FROM posts WHERE slug = ?`).bind(decodedSlug).first();
    }
  } else {
    existing = await env.DB.prepare(`SELECT id FROM posts WHERE slug = ?`).bind(decodedSlug).first();
    // Fallback: if slug was "null" or empty, try IS NULL (posts created without slug)
    if (!existing && (decodedSlug === 'null' || decodedSlug === '')) {
      existing = await env.DB.prepare(`SELECT id FROM posts WHERE slug IS NULL LIMIT 1`).first();
    }
    // Fallback: if slug looks like a UUID, try looking up by id
    if (!existing && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decodedSlug)) {
      existing = await env.DB.prepare(`SELECT id FROM posts WHERE id = ?`).bind(decodedSlug).first();
    }
  }
  if (!existing) {
    return jsonResponse({ error: 'Post not found' }, 404);
  }

  const postId = String((existing as Record<string, unknown>).id);
  await env.DB.prepare(`DELETE FROM posts WHERE id = ?`).bind(postId).run();

  return jsonResponse({ success: true });
}

export async function handlePostsRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname.replace('/api/posts', '');
  const method = request.method;

  // GET /api/posts - list published posts
  if (method === 'GET' && (pathname === '/' || pathname === '')) {
    return handleList(request, env);
  }

  // GET /api/posts/:slug - get by slug (supports Unicode slugs)
  const getMatch = pathname.match(/^\/(.+)$/);
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

// Separate handler for admin post routes (includes drafts)
export async function handleAdminPostsRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname.replace('/api/admin/posts', '');
  const method = request.method;

  // GET /api/admin/posts - list all posts including drafts
  if (method === 'GET' && (pathname === '/' || pathname === '')) {
    return handleAdminList(request, env);
  }

  // GET /api/admin/posts/by-id/:id - get post by internal UUID
  const byIdMatch = pathname.match(/^\/by-id\/(.+)$/);
  if (method === 'GET' && byIdMatch) {
    const id = byIdMatch[1];
    const user = await adminAuth(request, env);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    const row = await env.DB
      .prepare(`SELECT * FROM posts WHERE id = ?`)
      .bind(id)
      .first();

    if (!row) return jsonResponse({ error: 'Post not found' }, 404);

    const r = row as Record<string, unknown>;
    const tagRows = await env.DB
      .prepare(`SELECT t.name, t.slug FROM tags t JOIN post_tags pt ON t.id = pt.tag_id WHERE pt.post_id = ?`)
      .bind(String(r.id))
      .all();
    const tags = (tagRows.results as { name: string; slug: string }[]).map(t => t.name);

    const catRows = await env.DB
      .prepare(`SELECT c.name, c.slug FROM categories c JOIN post_categories pc ON c.id = pc.category_id WHERE pc.post_id = ?`)
      .bind(String(r.id))
      .all();
    const categories = (catRows.results as { name: string; slug: string }[]).map(c => c.name);

    // Fetch author info
    const authorId = r.author_id ? String(r.author_id) : null;
    let authorName = 'Unknown';
    let authorAvatar = '';
    if (authorId) {
      const userRow = await env.DB.prepare(`SELECT display_name, avatar_url FROM users WHERE id = ?`).bind(authorId).first() as { display_name: string; avatar_url: string } | null;
      if (userRow) {
        authorName = userRow.display_name || authorId;
        authorAvatar = userRow.avatar_url || '';
      }
    }

    return jsonResponse({
      id: String(r.id),
      post_num: r.post_num ? Number(r.post_num) : null,
      title: String(r.title),
      slug: String(r.slug || ''),
      content: String(r.content || ''),
      excerpt: r.excerpt ? String(r.excerpt) : '',
      coverImage: r.cover_image ? String(r.cover_image) : '',
      status: String(r.status),
      publishedAt: r.published_at ? Number(r.published_at) : null,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      author: { name: authorName, avatar: authorAvatar },
      categories,
      tags,
    });
  }

  // GET /api/admin/posts/by-num/:num - get post by sequential number
  const byNumMatch = pathname.match(/^\/by-num\/(\d+)$/);
  if (method === 'GET' && byNumMatch) {
    const num = Number(byNumMatch[1]);
    const user = await adminAuth(request, env);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    const row = await env.DB
      .prepare(`SELECT * FROM posts WHERE post_num = ?`)
      .bind(num)
      .first();

    if (!row) return jsonResponse({ error: 'Post not found' }, 404);

    const r = row as Record<string, unknown>;
    const tagRows = await env.DB
      .prepare(`SELECT t.name, t.slug FROM tags t JOIN post_tags pt ON t.id = pt.tag_id WHERE pt.post_id = ?`)
      .bind(String(r.id))
      .all();
    const tags = (tagRows.results as { name: string; slug: string }[]).map(t => t.name);

    const catRows = await env.DB
      .prepare(`SELECT c.name, c.slug FROM categories c JOIN post_categories pc ON c.id = pc.category_id WHERE pc.post_id = ?`)
      .bind(String(r.id))
      .all();
    const categories = (catRows.results as { name: string; slug: string }[]).map(c => c.name);

    // Fetch author info
    const authorId = r.author_id ? String(r.author_id) : null;
    let authorName = 'Unknown';
    let authorAvatar = '';
    if (authorId) {
      const userRow = await env.DB.prepare(`SELECT display_name, avatar_url FROM users WHERE id = ?`).bind(authorId).first() as { display_name: string; avatar_url: string } | null;
      if (userRow) {
        authorName = userRow.display_name || authorId;
        authorAvatar = userRow.avatar_url || '';
      }
    }

    return jsonResponse({
      id: String(r.id),
      post_num: r.post_num ? Number(r.post_num) : null,
      title: String(r.title),
      slug: String(r.slug || ''),
      content: String(r.content || ''),
      excerpt: r.excerpt ? String(r.excerpt) : '',
      coverImage: r.cover_image ? String(r.cover_image) : '',
      status: String(r.status),
      publishedAt: r.published_at ? Number(r.published_at) : null,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      author: { name: authorName, avatar: authorAvatar },
      categories,
      tags,
    });
  }

  return jsonResponse({ error: 'Not found' }, 404);
}
