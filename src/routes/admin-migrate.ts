/**
 * Admin migration utilities
 * Adds post_num column for human-readable sequential IDs
 */

import { getSessionUser } from '../middleware/auth';

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export async function handleAdminMigrateRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname.replace('/api/admin/migrate', '');
  const method = request.method;

  if (method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  // Add post_num column to posts table if not exists
  if (pathname === '/add-post-num') {
    const user = await getSessionUser(request, env.DB);
    if (!user || user.role !== 'admin') {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    try {
      // Check if column exists
      const columns = await env.DB.prepare(`PRAGMA table_info(posts)`).all();
      const colNames = (columns.results as { name: string }[]).map(c => c.name);
      if (!colNames.includes('post_num')) {
        await env.DB.prepare(`ALTER TABLE posts ADD COLUMN post_num INTEGER`).run();
      }

      // Check if post_num is already populated
      const countResult = await env.DB.prepare(`SELECT COUNT(*) as cnt FROM posts WHERE post_num IS NOT NULL`).first() as { cnt: number };
      if (countResult.cnt === 0) {
        // Backfill with sequential numbers based on created_at order
        const posts = await env.DB.prepare(`SELECT id FROM posts ORDER BY created_at ASC`).all();
        const rows = posts.results as { id: string }[];
        for (let i = 0; i < rows.length; i++) {
          await env.DB.prepare(`UPDATE posts SET post_num = ? WHERE id = ?`).bind(i + 1, rows[i].id).run();
        }
      }

      return jsonResponse({ success: true, message: 'post_num column added and backfilled' });
    } catch (err) {
      console.error('Migration failed:', err);
      return jsonResponse({ error: 'Migration failed: ' + String(err) }, 500);
    }
  }

  return jsonResponse({ error: 'Not found' }, 404);
}
