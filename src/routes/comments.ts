/**
 * Comments API - Public comment submission and admin review
 */

const SPAM_KEYWORDS = [
  'buy now', 'click here', 'free money', 'casino', 'viagra',
  'cryptocurrency', 'forex', 'investment opportunity', 'lottery',
];

interface Comment {
  id: string;
  postSlug: string;
  author: string;
  email: string;
  content: string;
  avatar?: string;
  status: 'pending' | 'approved' | 'spam';
  createdAt: string;
  ip?: string;
  userAgent?: string;
}

// Rate limit: max 10 comments per IP per hour
const COMMENT_RATE_KEY = 'cmt:rate:';
const COMMENT_RATE_MAX = 10;
const COMMENT_RATE_WINDOW = 3600; // 1 hour

async function checkCommentRate(request: Request, env: Env): Promise<boolean> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = `${COMMENT_RATE_KEY}${ip}`;
  try {
    const stored = await env.IMPORT_KV.get(key, 'json') as { count: number; resetAt: number } | null;
    const now = Math.floor(Date.now() / 1000);
    if (!stored || now > stored.resetAt) {
      await env.IMPORT_KV.put(key, JSON.stringify({ count: 1, resetAt: now + COMMENT_RATE_WINDOW }), { expirationTtl: COMMENT_RATE_WINDOW + 10 });
      return true;
    }
    if (stored.count >= COMMENT_RATE_MAX) return false;
    stored.count++;
    await env.IMPORT_KV.put(key, JSON.stringify(stored), { expirationTtl: stored.resetAt - now + 10 });
    return true;
  } catch {
    return true; // fail open
  }
}

function isSpam(content: string, author: string): boolean {
  const text = (content + ' ' + author).toLowerCase();
  return SPAM_KEYWORDS.some(kw => text.includes(kw));
}

function getGravatarUrl(email: string): string {
  // Simple hash for Gravatar
  const hash = crypto.randomUUID().replace(/-/g, '').substring(0, 32);
  return `https://www.gravatar.com/avatar/${hash}?d=identicon&s=80`;
}

function requireAuth(request: Request, env: Env): boolean {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  return token === env.API_SECRET;
}

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

// POST /api/comments - Submit a comment (public)
async function handleSubmit(request: Request, env: Env): Promise<Response> {
  // Rate limit
  const allowed = await checkCommentRate(request, env);
  if (!allowed) {
    return jsonResponse({ error: 'Too many comments. Please wait before posting again.' }, 429);
  }

  let body: { postSlug?: string; author?: string; email?: string; content?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const { postSlug, author, email, content } = body;
  if (!postSlug || !author || !email || !content) {
    return jsonResponse({ error: 'Missing required fields' }, 400);
  }

  if (content.length > 2000) {
    return jsonResponse({ error: 'Comment too long (max 2000 chars)' }, 400);
  }

  const status = isSpam(content, author) ? 'spam' : 'pending';
  const ip = request.headers.get('CF-Connecting-IP') || undefined;
  const userAgent = request.headers.get('User-Agent') || undefined;

  const comment: Comment = {
    id: crypto.randomUUID(),
    postSlug,
    author: author.slice(0, 100),
    email: email.slice(0, 254),
    content: content.slice(0, 2000),
    avatar: getGravatarUrl(email),
    status,
    createdAt: new Date().toISOString(),
    ip,
    userAgent,
  };

  // Store in KV (list by post + global list)
  const key = `comment:${comment.id}`;
  await env.IMPORT_KV.put(key, JSON.stringify(comment));
  
  const postKey = `comments:post:${postSlug}`;
  const postListStr = await env.IMPORT_KV.get(postKey);
  const postList: string[] = postListStr ? JSON.parse(postListStr) : [];
  postList.push(comment.id);
  await env.IMPORT_KV.put(postKey, JSON.stringify(postList));

  if (status === 'spam') {
    return jsonResponse({ message: 'Comment submitted and will be reviewed' });
  }

  return jsonResponse({ 
    message: 'Comment submitted and awaiting review',
    id: comment.id,
  });
}

// GET /api/comments/:slug - Get approved comments for a post
async function handleGetByPost(request: Request, env: Env, slug: string): Promise<Response> {
  const postKey = `comments:post:${slug}`;
  const postListStr = await env.IMPORT_KV.get(postKey);
  if (!postListStr) return jsonResponse([]);
  
  const postList: string[] = JSON.parse(postListStr);
  const comments = await Promise.all(
    postList.map(async (id) => {
      const c = await env.IMPORT_KV.get(`comment:${id}`, 'json') as Comment | null;
      return c?.status === 'approved' ? c : null;
    })
  );
  
  const approved = comments.filter(Boolean).sort(
    (a, b) => new Date(a!.createdAt).getTime() - new Date(b!.createdAt).getTime()
  );
  
  return jsonResponse(approved);
}

// GET /api/admin/comments - List all comments (admin)
async function handleListAdmin(request: Request, env: Env): Promise<Response> {
  if (!requireAuth(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);
  
  const url = new URL(request.url);
  const status = url.searchParams.get('status'); // pending | approved | spam
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = 20;
  
  // Get all comment keys (simplified - in production use a separate index)
  const allKeys = await env.IMPORT_KV.list({ prefix: 'comment:' });
  const allComments = await Promise.all(
    allKeys.keys.map(async (k) => {
      const c = await env.IMPORT_KV.get(k.name, 'json') as Comment | null;
      return c;
    })
  );
  
  let filtered = allComments.filter(Boolean);
  if (status) {
    filtered = filtered.filter(c => c!.status === status);
  }
  
  filtered.sort((a, b) => 
    new Date(b!.createdAt).getTime() - new Date(a!.createdAt).getTime()
  );
  
  const start = (page - 1) * limit;
  const paginated = filtered.slice(start, start + limit);
  
  return jsonResponse({
    comments: paginated,
    total: filtered.length,
    page,
    pages: Math.ceil(filtered.length / limit),
  });
}

// PATCH /api/admin/comments/:id - Update comment status (approve/spam)
async function handleUpdate(request: Request, env: Env, id: string): Promise<Response> {
  if (!requireAuth(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);
  
  let body: { status?: 'pending' | 'approved' | 'spam' };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }
  
  const key = `comment:${id}`;
  const existing = await env.IMPORT_KV.get(key, 'json') as Comment | null;
  if (!existing) return jsonResponse({ error: 'Not found' }, 404);
  
  const updated: Comment = { ...existing, status: body.status || existing.status };
  await env.IMPORT_KV.put(key, JSON.stringify(updated));
  
  return jsonResponse(updated);
}

// DELETE /api/admin/comments/:id - Delete comment
async function handleDelete(request: Request, env: Env, id: string): Promise<Response> {
  if (!requireAuth(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);
  
  const key = `comment:${id}`;
  const existing = await env.IMPORT_KV.get(key, 'json') as Comment | null;
  if (!existing) return jsonResponse({ error: 'Not found' }, 404);
  
  await env.IMPORT_KV.delete(key);
  
  // Remove from post list
  const postKey = `comments:post:${existing.postSlug}`;
  const postListStr = await env.IMPORT_KV.get(postKey);
  if (postListStr) {
    const postList: string[] = JSON.parse(postListStr);
    await env.IMPORT_KV.put(postKey, JSON.stringify(postList.filter(l => l !== id)));
  }
  
  return jsonResponse({ success: true });
}

export async function handleCommentsRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname.replace('/api/comments', '');
  
  // POST /api/comments - submit
  if (request.method === 'POST' && (pathname === '/' || pathname === '')) {
    return handleSubmit(request, env);
  }
  
  // GET /api/comments/:slug - get by post
  const getMatch = pathname.match(/^\/([a-z0-9-]+)$/);
  if (request.method === 'GET' && getMatch) {
    return handleGetByPost(request, env, getMatch[1]);
  }
  
  // Admin routes
  if (url.pathname.startsWith('/api/admin/comments')) {
    const adminPath = url.pathname.replace('/api/admin/comments', '');
    
    // GET /api/admin/comments
    if (request.method === 'GET' && (adminPath === '/' || adminPath === '')) {
      return handleListAdmin(request, env);
    }
    
    // PATCH /api/admin/comments/:id
    const patchMatch = adminPath.match(/^\/([a-f0-9-]+)$/);
    if (request.method === 'PATCH' && patchMatch) {
      return handleUpdate(request, env, patchMatch[1]);
    }
    
    // DELETE /api/admin/comments/:id
    if (request.method === 'DELETE' && patchMatch) {
      return handleDelete(request, env, patchMatch[1]);
    }
  }
  
  return jsonResponse({ error: 'Not found' }, 404);
}
