/**
 * Image Upload API - /api/upload/image
 * Supports drag/drop/paste/click upload to R2
 */

import { getSessionUser, type AuthUser } from '../middleware/auth';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

async function auth(request: Request, env: Env): Promise<AuthUser | null> {
  return await getSessionUser(request, env.DB);
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

export async function handleUploadImageRequest(request: Request, env: Env): Promise<Response> {
  // Auth check
  const user = await auth(request, env);
  if (!user) {
    return Response.json({ code: 401, message: 'Unauthorized' }, { status: 401 });
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return Response.json({ code: 400, message: 'Expected multipart/form-data' }, { status: 400 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ code: 400, message: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file');

  if (!file || typeof file === 'string') {
    return Response.json({ code: 400, message: 'No file provided' }, { status: 400 });
  }

  const blob = file as Blob;

  if (blob.size > MAX_FILE_SIZE) {
    return Response.json({ code: 400, message: 'File too large (max 5MB)' }, { status: 400 });
  }

  const mimeType = blob.type.toLowerCase();
  if (!ALLOWED_TYPES.includes(mimeType)) {
    return Response.json({ code: 400, message: 'Invalid file type. Allowed: jpg, png, gif, webp' }, { status: 400 });
  }

  // Generate UUID-based filename
  const uuid = crypto.randomUUID();
  const ext = getExtension(mimeType);
  const key = `articles/${uuid}.${ext}`;

  // Upload to R2
  try {
    await env.IMAGES_BUCKET.put(key, blob, {
      httpMetadata: {
        contentType: mimeType,
      },
      customMetadata: {
        originalName: (file as File).name || 'unnamed',
        uploadedBy: user.id,
        uploadedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('R2 upload failed:', err);
    return Response.json({ code: 500, message: 'Upload failed' }, { status: 500 });
  }

  // Construct URL: serve via worker route /images/:key
  // key format: articles/${uuid}.${ext}
  // Final URL: https://domain/images/articles/${uuid}.${ext}
  const origin = new URL(request.url).origin;
  const url = `${origin}/images/${key}`;

  return Response.json({
    code: 200,
    data: {
      url,
      key,
      filename: (file as File).name || 'unnamed',
      size: blob.size,
      mime_type: mimeType,
    },
  });
}
