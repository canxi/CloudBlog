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

		// Health check
		if (url.pathname === '/health') {
			return Response.json({ status: 'ok', timestamp: Date.now() });
		}

		// 404 for API
		if (url.pathname.startsWith('/api/')) {
			return Response.json({ error: 'Not found' }, { status: 404 });
		}

		// Serve static assets
		return Response.json({ error: 'Not found' }, { status: 404 });
	},
} satisfies ExportedHandler<Env>;
