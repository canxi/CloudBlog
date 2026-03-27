/**
 * CloudBlog - Cloudflare Workers edge blog platform
 * Main entry point with routing
 */

import { handleMigrationRequest } from './routes/migration';
import { handleAnalyticsRequest } from './routes/analytics';
import { handleExportRequest } from './routes/export';
import { handleSnippetsRequest } from './routes/snippets';
import { handleNotesRequest } from './routes/notes';
import { handleBacklinksRequest } from './routes/backlinks';
import { handleRevisionsRequest } from './routes/revisions';
import { handleSearchRequest } from './routes/search';
import { handleMediaRequest } from './routes/media';
import { handleCommentsRequest } from './routes/comments';
import { handlePostsRequest } from './routes/posts';
import { handleCORS, checkRateLimit, getCorsHeaders } from './utils/security';

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
		if (url.pathname.startsWith('/api/migration')) {
			return await handleMigrationRequest(request, env);
		}
		if (url.pathname.startsWith('/api/analytics')) {
			return handleAnalyticsRequest(request, env);
		}
		if (url.pathname.startsWith('/api/export')) {
			return await handleExportRequest(request, env);
		}
		if (url.pathname.startsWith('/api/snippets')) {
			return await handleSnippetsRequest(request, env);
		}
		if (url.pathname.startsWith('/api/notes')) {
			return await handleNotesRequest(request, env);
		}
		if (url.pathname.startsWith('/api/backlinks')) {
			return await handleBacklinksRequest(request, env);
		}
		if (url.pathname.startsWith('/api/revisions')) {
			return await handleRevisionsRequest(request, env);
		}
		if (url.pathname.startsWith('/api/search')) {
			return await handleSearchRequest(request, env);
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

		// Serve write.html for /write route (post editor)
		if (url.pathname === '/write') {
			const writeRes = await fetch(`https://${url.hostname}/write.html`);
			if (writeRes.ok) {
				const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
				addSecurityHeaders(headers);
				headers.set('Cache-Control', 'no-cache');
				return new Response(writeRes.body, { status: 200, headers });
			}
		}

		// Serve post.html for /posts/:slug routes (article detail page)
		if (url.pathname.startsWith('/posts/')) {
			const postRes = await fetch(`https://${url.hostname}/post.html`);
			if (postRes.ok) {
				const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
				addSecurityHeaders(headers);
				headers.set('Cache-Control', 'no-cache');
				return new Response(postRes.body, { status: 200, headers });
			}
		}

		// Post detail route: serve post.html for /posts/:slug
		if (url.pathname.startsWith('/posts/')) {
			const postRes = await fetch(`https://${url.hostname}/post.html`);
			if (postRes.ok) {
				const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
				addSecurityHeaders(headers);
				headers.set('Cache-Control', 'no-cache');
				return new Response(postRes.body, { status: 200, headers });
			}
		}

		// Admin routes
		if (url.pathname.startsWith('/admin')) {
			let page = '/admin/index.html';
			if (url.pathname === '/admin/login' || url.pathname === '/admin') {
				page = '/admin/login.html';
			}
			const adminRes = await fetch(`https://${url.hostname}${page}`);
			if (adminRes.ok) {
				const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
				addSecurityHeaders(headers);
				headers.set('Cache-Control', 'no-cache');
				return new Response(adminRes.body, { status: 200, headers });
			}
		}

		// SPA fallback: serve index.html for all other routes
		const indexRes = await fetch(`https://${url.hostname}/index.html`);
		if (indexRes.ok) {
			const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
			addSecurityHeaders(headers);
			headers.set('Cache-Control', 'no-cache');
			return new Response(indexRes.body, { status: 200, headers });
		}

		return new Response('Not Found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
