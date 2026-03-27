/**
 * R2 Storage utility for image downloads
 */

export interface R2UploadResult {
  url: string;
  key: string;
  size: number;
  contentType: string;
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function getImageContentType(url: string): string {
  const ext = url.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return types[ext || ''] || 'application/octet-stream';
}

function generateImageKey(originalUrl: string, postSlug: string): string {
  const ext = originalUrl.split('.').pop()?.toLowerCase() || 'jpg';
  const hash = crypto.randomUUID().substring(0, 8);
  const safeSlug = postSlug.replace(/[^a-z0-9-]/g, '-').substring(0, 50);
  return `images/${safeSlug}-${hash}.${ext}`;
}

export async function downloadImage(
  imageUrl: string,
  postSlug: string,
  env: Env
): Promise<R2UploadResult> {
  try {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'CloudBlog-Importer/1.0',
        Accept: 'image/*',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('Content-Type') || getImageContentType(imageUrl);

    // Validate content type
    if (!ALLOWED_TYPES.some(t => contentType.includes(t))) {
      throw new Error(`Unsupported image type: ${contentType}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const size = arrayBuffer.byteLength;

    // Validate size
    if (size > MAX_IMAGE_SIZE) {
      throw new Error(`Image too large: ${(size / 1024 / 1024).toFixed(2)}MB (max 10MB)`);
    }

    if (size === 0) {
      throw new Error('Empty image response');
    }

    const key = generateImageKey(imageUrl, postSlug);

    // Upload to R2
    await env.IMAGES_BUCKET.put(key, arrayBuffer, {
      httpMetadata: {
        contentType,
        cacheControl: 'public, max-age=31536000',
      },
    });

    const url = `${env.R2_PUBLIC_URL || ''}/${key}`;

    return { url, key, size, contentType };
  } catch (error) {
    throw new Error(`Failed to download image "${imageUrl}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function downloadImages(
  urls: string[],
  postSlug: string,
  env: Env
): Promise<Map<string, R2UploadResult>> {
  const results = new Map<string, R2UploadResult>();

  // Download images in parallel with concurrency limit
  const CONCURRENCY = 5;
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (url) => {
        const result = await downloadImage(url, postSlug, env);
        return { url, result };
      })
    );

    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        results.set(r.value.url, r.value.result);
      }
    }
  }

  return results;
}
