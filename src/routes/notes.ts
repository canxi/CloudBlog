/**
 * Quick Notes API - Fleeting notes /灵感速记
 * Minimal input: just content, optional tags
 * Can convert to full post
 */

function requireAuth(request: Request, env: Env): boolean {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  return token === env.API_SECRET;
}

// GET /api/notes - List notes
async function handleList(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const includeArchived = url.searchParams.get('archived') === '1';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  let query = `SELECT id, content, tags, is_archived, created_at, updated_at FROM notes WHERE 1=1`;
  if (!includeArchived) query += ` AND is_archived = 0`;
  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;

  const result = await env.DB.prepare(query).bind(limit, offset).all();

  const notes = (result.results as Record<string, unknown>[]).map(row => ({
    id: String(row.id),
    content: String(row.content),
    tags: row.tags ? JSON.parse(String(row.tags)) : [],
    isArchived: Boolean(row.is_archived),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }));

  return Response.json({ notes });
}

// POST /api/notes - Create note (minimal input)
async function handleCreate(request: Request, env: Env): Promise<Response> {
  if (!requireAuth(request, env)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { content?: string; tags?: string[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.content || !body.content.trim()) {
    return Response.json({ error: 'content is required' }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const tags = JSON.stringify(body.tags || []);

  await env.DB
    .prepare(`INSERT INTO notes (id, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, body.content.trim(), tags, now, now)
    .run();

  return Response.json({ id, message: 'Note created' }, { status: 201 });
}

// PUT /api/notes/:id - Update note
async function handleUpdate(request: Request, env: Env): Promise<Response> {
  if (!requireAuth(request, env)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const id = url.pathname.split('/').pop();

  let body: { content?: string; tags?: string[]; isArchived?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const tags = body.tags !== undefined ? JSON.stringify(body.tags) : null;

  await env.DB
    .prepare(`UPDATE notes SET
       content = COALESCE(?, content),
       tags = COALESCE(?, tags),
       is_archived = COALESCE(?, is_archived),
       updated_at = ?
       WHERE id = ?`)
    .bind(
      body.content ? body.content.trim() : null,
      tags,
      body.isArchived !== undefined ? (body.isArchived ? 1 : 0) : null,
      now,
      id
    )
    .run();

  return Response.json({ message: 'Note updated' });
}

// DELETE /api/notes/:id
async function handleDelete(request: Request, env: Env): Promise<Response> {
  if (!requireAuth(request, env)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const id = url.pathname.split('/').pop();

  await env.DB.prepare(`DELETE FROM notes WHERE id = ?`).bind(id).run();

  return Response.json({ message: 'Note deleted' });
}

// POST /api/notes/:id/convert - Convert note to post
async function handleConvert(request: Request, env: Env): Promise<Response> {
  if (!requireAuth(request, env)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const noteId = url.pathname.split('/')[3]; // /api/notes/{id}/convert

  const note = await env.DB
    .prepare(`SELECT * FROM notes WHERE id = ?`)
    .bind(noteId)
    .first();

  if (!note) {
    return Response.json({ error: 'Note not found' }, { status: 404 });
  }

  const noteRow = note as Record<string, unknown>;
  const content = String(noteRow.content);

  // Extract title from first line if it's a heading
  let title = 'Untitled Note';
  let bodyContent = content;
  const lines = content.split('\n');
  if (lines[0].startsWith('# ')) {
    title = lines[0].substring(2).trim();
    bodyContent = lines.slice(1).join('\n').trim();
  } else if (lines[0].length > 0 && lines[0].length < 100) {
    title = lines[0].trim();
    bodyContent = lines.slice(1).join('\n').trim() || content;
  }

  // Extract tags
  const noteTags: string[] = noteRow.tags ? JSON.parse(String(noteRow.tags)) : [];
  const contentTags: string[] = [];
  const tagRegex = /#(\w+)/g;
  let tagMatch;
  while ((tagMatch = tagRegex.exec(bodyContent)) !== null) {
    if (!contentTags.includes(tagMatch[1])) contentTags.push(tagMatch[1]);
  }
  const allTags = [...new Set([...noteTags, ...contentTags])];

  // Clean hashtags from content
  bodyContent = bodyContent.replace(/#(\w+)/g, '').replace(/\n{3,}/g, '\n\n').trim();

  const postId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const slug = title.toLowerCase().replace(/[^\w]+/g, '-').substring(0, 60);

  // Insert post
  await env.DB
    .prepare(`INSERT INTO posts (id, title, slug, content, excerpt, author_id, status, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`)
    .bind(postId, title, slug, bodyContent, bodyContent.substring(0, 200), 'system', now, now, now)
    .run();

  // Handle tags
  for (const tagName of allTags) {
    const tagSlug = tagName.toLowerCase();
    await env.DB
      .prepare(`INSERT OR IGNORE INTO tags (id, name, slug, created_at) VALUES (?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), tagName, tagSlug, now)
      .run();
    const tag = await env.DB.prepare(`SELECT id FROM tags WHERE name = ?`).bind(tagName).first<{ id: string }>();
    if (tag) {
      await env.DB
        .prepare(`INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)`)
        .bind(postId, tag.id)
        .run();
    }
  }

  // Archive the note
  await env.DB
    .prepare(`UPDATE notes SET is_archived = 1, updated_at = ? WHERE id = ?`)
    .bind(now, noteId)
    .run();

  return Response.json({ postId, slug, title, message: 'Note converted to draft post' });
}

export async function handleNotesRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/notes', '');

  if (request.method === 'GET' && path === '') {
    return await handleList(request, env);
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
  if (request.method === 'POST' && path.match(/^\/[a-f0-9-]+\/convert$/)) {
    return await handleConvert(request, env);
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}
