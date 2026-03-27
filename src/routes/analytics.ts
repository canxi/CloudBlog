/**
 * Analytics API routes
 */

import { AnalyticsStore } from '../utils/analytics-store';

function requireAuth(request: Request, env: Env): boolean {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  return token === env.API_SECRET;
}

function getCfCountry(request: Request): string | undefined {
  return request.headers.get('CF-IPCountry') || undefined;
}

function getCfCity(request: Request): string | undefined {
  // CF-CF-IPCity is not standard, but we can use CF-Connecting-IP and a geo lookup
  return undefined;
}

// POST /api/analytics/track - Track a page view
async function handleTrack(request: Request, env: Env): Promise<Response> {
  const country = getCfCountry(request);
  const referer = request.headers.get('Referer') || undefined;
  const userAgent = request.headers.get('User-Agent') || '';

  let body: { postId?: string; slug?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.postId || !body.slug) {
    return Response.json({ error: 'Missing postId or slug' }, { status: 400 });
  }

  const store = new AnalyticsStore(env.ANALYTICS_KV);
  await store.trackView({
    postId: body.postId,
    slug: body.slug,
    country,
    referer,
    userAgent,
  });

  return Response.json({ success: true });
}

// GET /api/analytics/overview - Get analytics overview
async function handleOverview(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get('days') || '7');

  const store = new AnalyticsStore(env.ANALYTICS_KV);
  const overview = await store.getOverview(days);

  return Response.json(overview);
}

// GET /api/analytics/daily/:date - Get stats for a specific date
async function handleDaily(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split('/');
  const date = parts[parts.length - 1];

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: 'Invalid date format. Use YYYY-MM-DD' }, { status: 400 });
  }

  const store = new AnalyticsStore(env.ANALYTICS_KV);
  const stats = await store.getDailyStats(date);

  return Response.json(stats);
}

// GET /api/analytics/timeseries - Get time series data
async function handleTimeSeries(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const metric = (url.searchParams.get('metric') || 'pv') as 'pv' | 'uv';
  const days = parseInt(url.searchParams.get('days') || '7');

  if (!['pv', 'uv'].includes(metric)) {
    return Response.json({ error: 'Invalid metric. Use pv or uv' }, { status: 400 });
  }

  const store = new AnalyticsStore(env.ANALYTICS_KV);
  const series = await store.getTimeSeries(metric, days);

  return Response.json(series);
}

// GET /api/analytics/posts/:postId - Get stats for a specific post
async function handlePostStats(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split('/');
  const postId = parts[parts.length - 1];

  if (!postId) {
    return Response.json({ error: 'Missing postId' }, { status: 400 });
  }

  // Get top posts across recent days to find this post's stats
  const store = new AnalyticsStore(env.ANALYTICS_KV);
  const overview = await store.getOverview(30);
  const postStats = overview.topPosts.find(p => p.postId === postId);

  if (!postStats) {
    return Response.json({ postId, views: 0, rank: null });
  }

  const rank = overview.topPosts.findIndex(p => p.postId === postId) + 1;
  return Response.json({ ...postStats, rank });
}

export async function handleAnalyticsRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/analytics', '');

  // Track endpoint is public (but rate-limited by CF)
  if (request.method === 'POST' && path === '/track') {
    return await handleTrack(request, env);
  }

  // All other endpoints require auth
  if (!requireAuth(request, env)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (request.method === 'GET' && path === '/overview') {
    return await handleOverview(request, env);
  }
  if (request.method === 'GET' && path === '/timeseries') {
    return await handleTimeSeries(request, env);
  }
  if (request.method === 'GET' && path.startsWith('/daily/')) {
    return await handleDaily(request, env);
  }
  if (request.method === 'GET' && path.startsWith('/posts/')) {
    return await handlePostStats(request, env);
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}
