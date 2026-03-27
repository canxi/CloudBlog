/**
 * Snippets API - CRUD for code snippets
 */

function requireAuth(request: Request, env: Env): boolean {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  return token === env.API_SECRET;
}

function requireOwner(request: Request, env: Env): string | null {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (token !== env.API_SECRET) return null;
  // In production, decode JWT to get user ID
  // For now, return a placeholder
  return 'system';
}

// GET /api/snippets - List snippets
async function handleList(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const language = url.searchParams.get('language') || undefined;
  const tag = url.searchParams.get('tag') || undefined;
  const q = url.searchParams.get('q') || undefined;
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  let query = `SELECT id, title, description, code, language, tags, created_at, updated_at FROM snippets WHERE is_public = 1`;
  const bindings: (string | number)[] = [];

  if (language) {
    query += ` AND language = ?`;
    bindings.push(language);
  }

  if (q) {
    query += ` AND (title LIKE ? OR description LIKE ? OR code LIKE ?)`;
    const like = `%${q}%`;
    bindings.push(like, like, like);
  }

  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  bindings.push(limit, offset);

  const result = await env.DB.prepare(query).bind(...bindings).all();

  const snippets = (result.results as Record<string, unknown>[]).map(row => ({
    id: String(row.id),
    title: String(row.title),
    description: String(row.description || ''),
    code: String(row.code),
    language: String(row.language),
    tags: row.tags ? JSON.parse(String(row.tags)) : [],
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }));

  return Response.json({ snippets, total: snippets.length });
}

// GET /api/snippets/:id - Get single snippet
async function handleGet(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const id = url.pathname.split('/').pop();

  const result = await env.DB
    .prepare(`SELECT * FROM snippets WHERE id = ?`)
    .bind(id)
    .first();

  if (!result) {
    return Response.json({ error: 'Snippet not found' }, { status: 404 });
  }

  const row = result as Record<string, unknown>;
  return Response.json({
    id: String(row.id),
    title: String(row.title),
    description: String(row.description || ''),
    code: String(row.code),
    language: String(row.language),
    tags: row.tags ? JSON.parse(String(row.tags)) : [],
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  });
}

// POST /api/snippets - Create snippet
async function handleCreate(request: Request, env: Env): Promise<Response> {
  if (!requireOwner(request, env)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    title?: string;
    description?: string;
    code?: string;
    language?: string;
    tags?: string[];
    isPublic?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.title || !body.code) {
    return Response.json({ error: 'title and code are required' }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const tags = JSON.stringify(body.tags || []);

  await env.DB
    .prepare(`INSERT INTO snippets (id, title, description, code, language, tags, is_public, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      id,
      body.title,
      body.description || '',
      body.code,
      body.language || 'javascript',
      tags,
      body.isPublic !== false ? 1 : 0,
      now,
      now
    )
    .run();

  return Response.json({ id, message: 'Snippet created' }, { status: 201 });
}

// PUT /api/snippets/:id - Update snippet
async function handleUpdate(request: Request, env: Env): Promise<Response> {
  if (!requireOwner(request, env)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const id = url.pathname.split('/').pop();

  const existing = await env.DB
    .prepare(`SELECT id FROM snippets WHERE id = ?`)
    .bind(id)
    .first();

  if (!existing) {
    return Response.json({ error: 'Snippet not found' }, { status: 404 });
  }

  let body: {
    title?: string;
    description?: string;
    code?: string;
    language?: string;
    tags?: string[];
    isPublic?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const tags = body.tags ? JSON.stringify(body.tags) : undefined;

  await env.DB
    .prepare(`UPDATE snippets SET
       title = COALESCE(?, title),
       description = COALESCE(?, description),
       code = COALESCE(?, code),
       language = COALESCE(?, language),
       tags = COALESCE(?, tags),
       is_public = COALESCE(?, is_public),
       updated_at = ?
       WHERE id = ?`)
    .bind(
      body.title || null,
      body.description || null,
      body.code || null,
      body.language || null,
      tags || null,
      body.isPublic !== undefined ? (body.isPublic ? 1 : 0) : null,
      now,
      id
    )
    .run();

  return Response.json({ message: 'Snippet updated' });
}

// DELETE /api/snippets/:id
async function handleDelete(request: Request, env: Env): Promise<Response> {
  if (!requireOwner(request, env)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const id = url.pathname.split('/').pop();

  await env.DB.prepare(`DELETE FROM snippets WHERE id = ?`).bind(id).run();

  return Response.json({ message: 'Snippet deleted' });
}

export async function handleSnippetsRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/snippets', '');

  if (!requireAuth(request, env) && !path.match(/^\/\d+$/) && request.method === 'GET') {
    // Allow public read access
  }

  if (request.method === 'GET' && path === '') {
    return await handleList(request, env);
  }
  if (request.method === 'GET' && path.match(/^\/[a-f0-9-]+$/)) {
    return await handleGet(request, env);
  }
  if (request.method === 'POST' && path === '') {
    return await handleCreate(request, env);
  }
  if (request.method === 'PUT' && path.match(/^\/[a-f0-9-]+$/)) {
    return await handleUpdate(request, env);
  }
  if (request.method === 'DELETE' && path.match(/^\/[a-f0-9-]+$/)) {
    return await handleDelete(request, env);
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}
