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

const STATIC_EXTENSIONS = ['.js', '.css', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.map'];

function isStaticAsset(pathname: string): boolean {
  return STATIC_EXTENSIONS.some(ext => pathname.includes(ext));
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// CORS headers
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		};

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
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
			return Response.json({ status: 'ok', timestamp: Date.now() });
		}

		// 404 for API
		if (url.pathname.startsWith('/api/')) {
			return Response.json({ error: 'Not found' }, { status: 404 });
		}

		// For static assets (JS, CSS, images), fetch from self
		if (isStaticAsset(url.pathname)) {
			const origin = `https://${url.hostname}`;
			const assetUrl = `${origin}${url.pathname}`;
			try {
				const assetRes = await fetch(assetUrl, request);
				if (assetRes.ok) {
					return new Response(assetRes.body, {
						status: assetRes.status,
						headers: {
							...Object.fromEntries(assetRes.headers.entries()),
							'Cache-Control': 'public, max-age=31536000, immutable',
						},
					});
				}
			} catch {
				// fall through to 404
			}
		}

		// SPA fallback: serve index.html for all other routes
		// Use a synthetic request to avoid infinite loop
		const origin = url.hostname;
		try {
			const indexRes = await fetch(`https://${origin}/index.html`);
			if (indexRes.ok) {
				return new Response(indexRes.body, {
					status: 200,
					headers: {
						'Content-Type': 'text/html; charset=utf-8',
						'Cache-Control': 'no-cache',
					},
				});
			}
		} catch {
			// fall through
		}

		return Response.json({ error: 'Not found' }, { status: 404 });
	},
} satisfies ExportedHandler<Env>;
