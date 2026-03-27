/**
 * Security utilities - rate limiting, input validation, CORS
 */

const RATE_LIMIT_KV = 'rate:'; // prefix in KV
const RATE_LIMIT_WINDOW = 60; // seconds
const RATE_LIMIT_MAX = 60; // requests per window for public, 300 for auth'd

function getClientIP(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    request.headers.get('X-Real-IP') ||
    'unknown'
  );
}

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function getCorsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigins = [
    'https://blog.flpt.de',
    'https://cloudblog.xiaozhong94520.workers.dev',
  ];

  const validOrigin = origin && allowedOrigins.includes(origin) ? origin : (allowedOrigins[0] || '*');

  return {
    'Access-Control-Allow-Origin': validOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400',
  };
}

export function handleCORS(request: Request): Response | null {
  if (request.method === 'OPTIONS') {
    const origin = request.headers.get('Origin');
    const headers = getCorsHeaders(origin);
    return new Response(null, { status: 204, headers });
  }
  return null;
}

// Rate limiter using KV
export async function checkRateLimit(
  request: Request,
  env: Env,
  maxRequests = 60,
  windowSeconds = 60
): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  const ip = getClientIP(request);
  const key = `${RATE_LIMIT_KV}${ip}`;
  const now = Math.floor(Date.now() / 1000);

  try {
    const stored = await env.IMPORT_KV.get(key, 'json') as { count: number; resetAt: number } | null;

    if (!stored || now > stored.resetAt) {
      // New window
      await env.IMPORT_KV.put(key, JSON.stringify({ count: 1, resetAt: now + windowSeconds }), {
        expirationTtl: windowSeconds + 10,
      });
      return { allowed: true, remaining: maxRequests - 1, resetIn: windowSeconds };
    }

    if (stored.count >= maxRequests) {
      return { allowed: false, remaining: 0, resetIn: stored.resetAt - now };
    }

    stored.count++;
    await env.IMPORT_KV.put(key, JSON.stringify(stored), {
      expirationTtl: stored.resetAt - now + 10,
    });

    return { allowed: true, remaining: maxRequests - stored.count, resetIn: stored.resetAt - now };
  } catch {
    // If KV fails, allow the request (fail open)
    return { allowed: true, remaining: maxRequests, resetIn: 0 };
  }
}

// Validate request body size
export function validateBodySize(request: Request, maxBytes = 1024 * 1024): Promise<boolean> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > maxBytes) {
    return Promise.resolve(false);
  }
  return Promise.resolve(true);
}

// Sanitize string input
export function sanitizeString(str: string, maxLength = 10000): string {
  if (typeof str !== 'string') return '';
  return str.slice(0, maxLength).replace(/[\x00-\x1F\x7F]/g, '');
}

// Validate slug format
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 100;
}

// Require auth with rate limiting
export async function requireAuthRateLimited(
  request: Request,
  env: Env,
  maxRequests = 300
): Promise<{ authed: boolean; rateLimited: boolean; response?: Response }> {
  const rate = await checkRateLimit(request, env, maxRequests);
  if (!rate.allowed) {
    return {
      authed: false,
      rateLimited: true,
      response: jsonResponse(
        { error: 'Too many requests', retryAfter: rate.resetIn },
        429
      ),
    };
  }

  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  const authed = token === env.API_SECRET;

  return { authed, rateLimited: false };
}
