/**
 * CloudBlog - Cloudflare Workers edge blog platform
 * Main entry point with routing
 */

import { handleMigrationRequest } from './routes/migration';
import { handleSearchRequest } from './routes/search';
import { handleMediaRequest } from './routes/media';
import { handleUploadImageRequest } from './routes/upload';
import { handleConfigRequest } from './routes/config';
import { handleCommentsRequest } from './routes/comments';
import { handlePostsRequest, handleAdminPostsRequest } from './routes/posts';
import { handleAdminMigrateRequest } from './routes/admin-migrate';
import { handleAuthRequest } from './routes/auth';
import { handleCORS, checkRateLimit, getCorsHeaders } from './utils/security';

const STATIC_EXTENSIONS = ['.js', '.css', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.map', '.txt'];

// Inject site config (logo/footer) into HTML using env vars — no KV lookup needed
function injectSiteConfig(html: string, env: Env): string {
  const logo = env.SITE_LOGO_TEXT || 'CloudBlog';
  const footer = env.SITE_FOOTER_TEXT || '© 2024 CloudBlog. All rights reserved.';
  const result = html
    .replaceAll('{{SITE_LOGO}}', logo)
    .replaceAll('{{FOOTER}}', footer);
  console.log('[inject] logo:', logo, 'footer:', footer, 'had_SITE_LOGO:', html.includes('{{SITE_LOGO}}'));
  return result;
}

// Serve static file from R2, with site config injection for HTML
async function serveStaticFile(pathname: string, env: Env, request: Request): Promise<Response> {
  // Normalize path: remove leading /
  let key = pathname.slice(1);

  // Special case: empty key → index.html
  if (!key) {
    const obj = await env.STATIC_BUCKET.get('index.html');
    if (obj) {
      const body = injectSiteConfig(await obj.text(), env);
      const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
      headers.set('Cache-Control', 'no-cache');
      addSecurityHeaders(headers);
      return new Response(body, { status: 200, headers });
    }
    return new Response('Not Found', { status: 404 });
  }

  // Try the direct key first (e.g., write.html, post.html, admin/index.html)
  let object = await env.STATIC_BUCKET.get(key);
  if (!object) {
    // For paths without extension (e.g., /write, /admin), try with /index.html suffix
    if (!key.includes('.')) {
      object = await env.STATIC_BUCKET.get(key + '/index.html');
    }
    if (!object) {
      return new Response('Not Found', { status: 404 });
    }
  }

  // Inject site config into HTML files
  const contentType = object.httpMetadata?.contentType || getMimeType(key);
  const isHtml = contentType.includes('html') || key.endsWith('.html');
  const body = isHtml ? injectSiteConfig(await object.text(), env) : object.body;

  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', isHtml ? 'no-cache' : 'public, max-age=31536000, immutable');
  addSecurityHeaders(headers);
  return new Response(body, { status: 200, headers });
}

function getMimeType(pathname: string): string {
  const ext = pathname.split('.').pop()?.toLowerCase() || '';
  const mimeMap: Record<string, string> = {
    js: 'application/javascript', css: 'text/css', svg: 'image/svg+xml',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', ico: 'image/x-icon', woff: 'font/woff',
    woff2: 'font/woff2', ttf: 'font/ttf', eot: 'application/vnd.ms-fontobject',
    map: 'application/json', txt: 'text/plain', html: 'text/html; charset=utf-8',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

function isStaticAsset(pathname: string): boolean {
  const ext = '.' + pathname.split('.').pop()?.toLowerCase();
  return STATIC_EXTENSIONS.includes(ext);
}

const STATIC_EXTENSIONS = ['.js', '.css', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.map'];

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function isStaticAsset(pathname: string): boolean {
  return STATIC_EXTENSIONS.some(ext => pathname.includes(ext));
}

function addSecurityHeaders(headers: Headers): void {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const origin = request.headers.get('Origin');

		// Handle CORS preflight
		const corsPreflight = handleCORS(request);
		if (corsPreflight) {
			const headers = new Headers();
			addSecurityHeaders(headers);
			for (const [k, v] of Object.entries(getCorsHeaders(origin))) {
				headers.set(k, v);
			}
			return new Response(corsPreflight.body, { status: corsPreflight.status, headers });
		}

		// Rate limit all API routes
		if (url.pathname.startsWith('/api/')) {
			const rate = await checkRateLimit(request, env, 120, 60);
			if (!rate.allowed) {
				const headers = new Headers({ 'Content-Type': 'application/json' });
				addSecurityHeaders(headers);
				for (const [k, v] of Object.entries(getCorsHeaders(origin))) {
					headers.set(k, v);
				}
				headers.set('Retry-After', String(rate.resetIn));
				return new Response(JSON.stringify({ error: 'Too many requests', retryAfter: rate.resetIn }), { status: 429, headers });
			}
		}

		// API routes
		if (url.pathname.startsWith('/api/auth')) {
			return await handleAuthRequest(request, env);
		}
		if (url.pathname.startsWith('/api/migration')) {
			return await handleMigrationRequest(request, env);
		}
		if (url.pathname.startsWith('/api/search')) {
			return await handleSearchRequest(request, env);
		}
		if (url.pathname.startsWith('/api/admin/posts')) {
			return await handleAdminPostsRequest(request, env);
		}
		if (url.pathname.startsWith('/api/admin/migrate')) {
			return await handleAdminMigrateRequest(request, env);
		}
		if (url.pathname.startsWith('/api/posts')) {
			return await handlePostsRequest(request, env);
		}
		if (url.pathname.startsWith('/api/comments') || url.pathname.startsWith('/api/admin/comments')) {
			return await handleCommentsRequest(request, env);
		}
		if (url.pathname.startsWith('/api/admin/media')) {
			return await handleMediaRequest(request, env);
		}
		if (url.pathname === '/api/upload/image') {
			return await handleUploadImageRequest(request, env);
		}
		if (url.pathname === '/api/config') {
			return await handleConfigRequest(request, env);
		}

		// Debug: check env vars
		if (url.pathname === '/api/debug/env') {
			return new Response(JSON.stringify({
				SITE_LOGO_TEXT: env.SITE_LOGO_TEXT,
				SITE_FOOTER_TEXT: env.SITE_FOOTER_TEXT,
				hasStaticBucket: !!env.STATIC_BUCKET,
			}), { headers: { 'Content-Type': 'application/json' } });
		}

		// Serve R2 images at /images/:key (e.g., /images/articles/uuid.png)
		if (url.pathname.startsWith('/images/')) {
			const key = url.pathname.replace('/images/', '');
			const object = await env.IMAGES_BUCKET.get(key);
			if (!object) {
				return new Response('Not found', { status: 404 });
			}
			const headers = new Headers();
			headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
			headers.set('Cache-Control', 'public, max-age=31536000, immutable');
			headers.set('ETag', object.etag);
			addSecurityHeaders(headers);
			return new Response(object.body, { status: 200, headers });
		}

		// Health check
		if (url.pathname === '/health') {
			const headers = new Headers({ 'Content-Type': 'application/json' });
			addSecurityHeaders(headers);
			return new Response(JSON.stringify({ status: 'ok', timestamp: Date.now() }), { status: 200, headers });
		}

		// 404 for API
		if (url.pathname.startsWith('/api/')) {
			const headers = new Headers({ 'Content-Type': 'application/json' });
			addSecurityHeaders(headers);
			for (const [k, v] of Object.entries(getCorsHeaders(origin))) {
				headers.set(k, v);
			}
			return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });
		}

		// For static assets (JS, CSS, images), fetch from self
		if (isStaticAsset(url.pathname)) {
			const assetUrl = `https://${url.hostname}${url.pathname}`;
			try {
				const assetRes = await fetch(assetUrl, request);
				if (assetRes.ok) {
					const headers = new Headers(assetRes.headers);
					addSecurityHeaders(headers);
					headers.set('Cache-Control', 'public, max-age=31536000, immutable');
					return new Response(assetRes.body, { status: assetRes.status, headers });
				}
			} catch {
				// fall through to 404
			}
		}

		// Serve /write.html for /write route (post editor)
		if (url.pathname === '/write' || url.pathname === '/write.html') {
			const writeRes = await fetch(`https://${url.hostname}/write.html`);
			if (writeRes.ok) {
				const body = await writeRes.text();
				const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
				addSecurityHeaders(headers);
				headers.set('Cache-Control', 'no-cache');
				return new Response(body, { status: 200, headers });
			}
		}

		// Serve post.html for /posts/:num routes (article detail page by sequential number)
		const postsMatch = url.pathname.match(/^\/posts\/(\d+)$/);
		if (postsMatch) {
			const postRes = await fetch(`https://${url.hostname}/post.html`);
			if (postRes.ok) {
				const body = await postRes.text();
				const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
				addSecurityHeaders(headers);
				headers.set('Cache-Control', 'no-cache');
				return new Response(body, { status: 200, headers });
			}
		}

		// Admin routes
		if (url.pathname.startsWith('/admin')) {
			let page = '/admin/index.html';
			if (url.pathname === '/admin/login' || url.pathname === '/admin') {
				page = '/admin/login.html';
			} else if (url.pathname === '/admin/settings') {
				page = '/admin/settings.html';
			}
			const adminRes = await fetch(`https://${url.hostname}${page}`);
			if (adminRes.ok) {
				const body = await adminRes.text();
				const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
				addSecurityHeaders(headers);
				headers.set('Cache-Control', 'no-cache');
				return new Response(body, { status: 200, headers });
			}
		}

		// SPA fallback: serve index.html for root and unmatched routes
		const indexRes = await fetch(`https://${url.hostname}/index.html`);
		if (indexRes.ok) {
			const body = await indexRes.text();
			const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
			addSecurityHeaders(headers);
			headers.set('Cache-Control', 'no-cache');
			return new Response(body, { status: 200, headers });
		}

		return new Response('Not Found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
