/**
 * Media Admin API - Image upload to R2 and media library
 */

import { getSessionUser } from '../middleware/auth';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

async function adminAuth(request: Request, env: Env) {
  const sessionUser = await getSessionUser(request, env.DB);
  if (sessionUser) return sessionUser;
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (token === env.API_SECRET) {
    return { id: 'api', username: 'api', email: '', displayName: 'API Client', role: 'admin' };
  }
  return null;
}

function getExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  return map[mimeType] || 'bin';
}

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json({ code: status === 200 ? 200 : 400, data }, { status });
}

function errorResponse(message: string, status = 400): Response {
  return Response.json({ code: status, message }, { status });
}

// In-memory media store (in production, use D1 or KV)
// Key: media:id:${id}, Index: media:list
let mediaIdCounter = 1;
const MEDIA_KEY_PREFIX = 'media:record:';

async function handleList(request: Request, env: Env): Promise<Response> {
  if (!requireAuth(request, env)) return errorResponse('Unauthorized', 401);
  
  const listStr = await env.IMPORT_KV.get('media:list');
  const list: string[] = listStr ? JSON.parse(listStr) : [];
  
  const items = await Promise.all(
    list.slice(-50).reverse().map(async (id) => {
      const key = MEDIA_KEY_PREFIX + id;
      const item = await env.IMPORT_KV.get(key, 'json');
      return item;
    })
  );
  
  return jsonResponse(items.filter(Boolean));
}

async function handleUpload(request: Request, env: Env): Promise<Response> {
  if (!requireAuth(request, env)) return errorResponse('Unauthorized', 401);
  
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return errorResponse('Expected multipart/form-data');
  }
  
  const formData = await request.formData();
  const file = formData.get('file');
  
  if (!file || typeof file === 'string') {
    return errorResponse('No file provided');
  }
  
  const blob = file as Blob;
  
  if (blob.size > MAX_FILE_SIZE) {
    return errorResponse('File too large (max 5MB)');
  }
  
  if (!ALLOWED_TYPES.includes(blob.type)) {
    return errorResponse('Invalid file type. Allowed: jpg, png, gif, webp');
  }
  
  const id = String(mediaIdCounter++);
  const ext = getExtension(blob.type);
  const key = `images/${Date.now()}-${crypto.randomUUID().substring(0, 8)}.${ext}`;
  
  // Upload to R2
  await env.IMAGES_BUCKET.put(key, blob, {
    httpMetadata: {
      contentType: blob.type,
    },
    customMetadata: {
      originalName: file.name || 'unnamed',
      uploadedAt: new Date().toISOString(),
    },
  });
  
  const url = env.R2_PUBLIC_URL 
    ? `${env.R2_PUBLIC_URL}/${key}` 
    : `https://placeholder.r2.dev/${key}`;
  
  const mediaRecord = {
    id,
    filename: file.name || 'unnamed',
    url,
    key,
    mime_type: blob.type,
    size: blob.size,
    created_at: new Date().toISOString(),
  };
  
  // Store record in KV
  await env.IMPORT_KV.put(MEDIA_KEY_PREFIX + id, JSON.stringify(mediaRecord));
  
  // Update list index
  const listStr = await env.IMPORT_KV.get('media:list');
  const list: string[] = listStr ? JSON.parse(listStr) : [];
  list.push(id);
  await env.IMPORT_KV.put('media:list', JSON.stringify(list));
  
  return jsonResponse(mediaRecord);
}

async function handleDelete(request: Request, env: Env, id: string): Promise<Response> {
  if (!requireAuth(request, env)) return errorResponse('Unauthorized', 401);
  
  const key = MEDIA_KEY_PREFIX + id;
  const item = await env.IMPORT_KV.get(key, 'json') as { key?: string } | null;
  
  if (!item) return errorResponse('Not found', 404);
  
  // Delete from R2
  if (item.key) {
    await env.IMAGES_BUCKET.delete(item.key);
  }
  
  // Delete record
  await env.IMPORT_KV.delete(key);
  
  // Update list index
  const listStr = await env.IMPORT_KV.get('media:list');
  const list: string[] = listStr ? JSON.parse(listStr) : [];
  await env.IMPORT_KV.put('media:list', JSON.stringify(list.filter(l => l !== id)));
  
  return jsonResponse({ success: true });
}

export async function handleMediaRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname.replace('/api/admin/media', '') || '/';
  const method = request.method;
  
  // GET /api/admin/media - list
  if (method === 'GET' && pathname === '/') {
    return handleList(request, env);
  }
  
  // POST /api/admin/media/upload - upload
  if (method === 'POST' && pathname === '/upload') {
    return handleUpload(request, env);
  }
  
  // DELETE /api/admin/media/:id - delete
  const deleteMatch = pathname.match(/^\/(\d+)$/);
  if (method === 'DELETE' && deleteMatch) {
    return handleDelete(request, env, deleteMatch[1]);
  }
  
  return errorResponse('Not found', 404);
}
