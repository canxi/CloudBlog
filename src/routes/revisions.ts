/**
 * Post Revisions API - Version history for posts
 */

import { computeDiff, diffToHtml } from '../utils/diff';

const MAX_REVISIONS = 50;

function requireAuth(request: Request, env: Env): boolean {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  return token === env.API_SECRET;
}

// GET /api/revisions/:postId - List revisions for a post
async function handleList(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const postId = url.pathname.split('/').pop();

  if (!postId) {
    return Response.json({ error: 'Missing postId' }, { status: 400 });
  }

  const result = await env.DB
    .prepare(`SELECT id, title, version_number, created_at FROM post_revisions
       WHERE post_id = ? ORDER BY version_number DESC LIMIT ?`)
    .bind(postId, MAX_REVISIONS)
    .all();

  const revisions = (result.results as Record<string, unknown>[]).map(row => ({
    id: String(row.id),
    title: String(row.title),
    versionNumber: Number(row.version_number),
    createdAt: Number(row.created_at),
  }));

  return Response.json({ revisions, count: revisions.length });
}

// GET /api/revisions/:postId/:revisionId - Get specific revision
async function handleGet(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split('/');
  const postId = parts[parts.length - 2];
  const revisionId = parts[parts.length - 1];

  const result = await env.DB
    .prepare(`SELECT * FROM post_revisions WHERE id = ? AND post_id = ?`)
    .bind(revisionId, postId)
    .first();

  if (!result) {
    return Response.json({ error: 'Revision not found' }, { status: 404 });
  }

  const row = result as Record<string, unknown>;
  return Response.json({
    id: String(row.id),
    postId: String(row.post_id),
    title: String(row.title),
    content: String(row.content),
    versionNumber: Number(row.version_number),
    createdAt: Number(row.created_at),
  });
}

// GET /api/revisions/:postId/:revId/diff/:compareId - Compare two revisions
async function handleDiff(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split('/');
  const revId1 = parts[parts.length - 2];
  const revId2 = parts[parts.length - 1];

  const [row1, row2] = await Promise.all([
    env.DB.prepare(`SELECT * FROM post_revisions WHERE id = ?`).bind(revId1).first(),
    env.DB.prepare(`SELECT * FROM post_revisions WHERE id = ?`).bind(revId2).first(),
  ]);

  if (!row1 || !row2) {
    return Response.json({ error: 'Revision not found' }, { status: 404 });
  }

  const r1 = row1 as Record<string, unknown>;
  const r2 = row2 as Record<string, unknown>;
  const oldContent = String(r1.content);
  const newContent = String(r2.content);

  const diff = computeDiff(oldContent, newContent);
  const html = diffToHtml(diff);

  return Response.json({
    from: { id: r1.id, versionNumber: r1.version_number, title: r1.title },
    to: { id: r2.id, versionNumber: r2.version_number, title: r2.title },
    diff: {
      addedCount: diff.addedCount,
      removedCount: diff.removedCount,
      html,
    },
  });
}

// POST /api/revisions/:postId - Create a revision snapshot
async function handleCreate(request: Request, env: Env): Promise<Response> {
  if (!requireAuth(request, env)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const postId = url.pathname.split('/').pop();

  if (!postId) {
    return Response.json({ error: 'Missing postId' }, { status: 400 });
  }

  let body: { title?: string; content?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.title || !body.content) {
    return Response.json({ error: 'title and content required' }, { status: 400 });
  }

  // Get current max version number
  const lastRev = await env.DB
    .prepare(`SELECT MAX(version_number) as max_v FROM post_revisions WHERE post_id = ?`)
    .bind(postId)
    .first<{ max_v: number | null }>();

  const nextVersion = (lastRev?.max_v ?? 0) + 1;
  const revisionId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await env.DB
    .prepare(`INSERT INTO post_revisions (id, post_id, title, content, version_number, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(revisionId, postId, body.title, body.content, nextVersion, now)
    .run();

  // Prune old revisions (keep MAX_REVISIONS)
  await env.DB
    .prepare(`DELETE FROM post_revisions WHERE post_id = ? AND id NOT IN (
       SELECT id FROM post_revisions WHERE post_id = ? ORDER BY version_number DESC LIMIT ?
     )`)
    .bind(postId, postId, MAX_REVISIONS)
    .run();

  return Response.json({ id: revisionId, versionNumber: nextVersion });
}

// POST /api/revisions/:postId/:revisionId/rollback - Rollback to a specific revision
async function handleRollback(request: Request, env: Env): Promise<Response> {
  if (!requireAuth(request, env)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const parts = url.pathname.split('/');
  const postId = parts[parts.length - 3];
  const revisionId = parts[parts.length - 2];

  // Get the revision content
  const revision = await env.DB
    .prepare(`SELECT * FROM post_revisions WHERE id = ? AND post_id = ?`)
    .bind(revisionId, postId)
    .first();

  if (!revision) {
    return Response.json({ error: 'Revision not found' }, { status: 404 });
  }

  const rev = revision as Record<string, unknown>;

  // Update the post with revision content
  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(`UPDATE posts SET title = ?, content = ?, updated_at = ? WHERE id = ?`)
    .bind(rev.title, rev.content, now, postId)
    .run();

  // Create a new revision marking the rollback
  const lastRev = await env.DB
    .prepare(`SELECT MAX(version_number) as max_v FROM post_revisions WHERE post_id = ?`)
    .bind(postId)
    .first<{ max_v: number | null }>();

  const nextVersion = (lastRev?.max_v ?? 0) + 1;
  const newRevisionId = crypto.randomUUID();

  await env.DB
    .prepare(`INSERT INTO post_revisions (id, post_id, title, content, version_number, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(newRevisionId, postId, rev.title, rev.content, nextVersion, now)
    .run();

  return Response.json({
    message: 'Rollback successful',
    newRevisionId,
    versionNumber: nextVersion,
  });
}

export async function handleRevisionsRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/revisions', '');

  // GET /api/revisions/:postId - list
  if (request.method === 'GET' && path.match(/^\/[a-f0-9-]+$/) && !path.includes('/diff/')) {
    return await handleList(request, env);
  }
  // GET /api/revisions/:postId/:revisionId
  if (request.method === 'GET' && path.match(/^\/[a-f0-9-]+\/[a-f0-9-]+$/) && !path.includes('/diff/')) {
    return await handleGet(request, env);
  }
  // POST /api/revisions/:postId - create
  if (request.method === 'POST' && path.match(/^\/[a-f0-9-]+$/) && !path.includes('/rollback')) {
    return await handleCreate(request, env);
  }
  // GET /api/revisions/:postId/:id1/diff/:id2
  if (request.method === 'GET' && path.match(/^\/[a-f0-9-]+\/[a-f0-9-]+\/diff\/[a-f0-9-]+$/)) {
    return await handleDiff(request, env);
  }
  // POST /api/revisions/:postId/:revisionId/rollback
  if (request.method === 'POST' && path.match(/^\/[a-f0-9-]+\/[a-f0-9-]+\/rollback$/)) {
    return await handleRollback(request, env);
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}
