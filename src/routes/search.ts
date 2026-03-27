/**
 * Search API routes
 * Full-text search using KV index
 */

const SEARCH_INDEX_KEY = 'search:index';

interface SearchDocument {
  slug: string;
  title: string;
  body: string;
  excerpt: string;
  tags: string[];
  category?: string;
  publishedAt: number;
}

interface SearchResult {
  slug: string;
  title: string;
  excerpt: string;
  score: number;
  matchedIn: ('title' | 'body' | 'tags')[];
}

function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function highlight(text: string, query: string): string {
  const tokens = tokenize(query);
  let result = text;
  for (const token of tokens) {
    const regex = new RegExp(`(${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    result = result.replace(regex, '**$1**');
  }
  return result;
}

function scoreMatch(doc: SearchDocument, query: string): SearchResult | null {
  const q = query.toLowerCase();
  const tokens = tokenize(query);
  
  const titleLower = doc.title.toLowerCase();
  const bodyLower = doc.body.toLowerCase();
  const tagsStr = doc.tags.join(' ').toLowerCase();
  
  let score = 0;
  const matchedIn: ('title' | 'body' | 'tags')[] = [];
  
  // Exact phrase match bonus
  if (titleLower.includes(q)) { score += 100; matchedIn.push('title'); }
  if (bodyLower.includes(q)) { score += 50; matchedIn.push('body'); }
  if (tagsStr.includes(q)) { score += 30; matchedIn.push('tags'); }
  
  // Token match
  for (const token of tokens) {
    if (titleLower.includes(token)) score += 20;
    if (bodyLower.includes(token)) score += 5;
    if (tagsStr.includes(token)) score += 10;
  }
  
  if (score === 0) return null;
  
  return {
    slug: doc.slug,
    title: highlight(doc.title, query),
    excerpt: highlight(doc.excerpt || doc.body.slice(0, 200), query),
    score,
    matchedIn,
  };
}

export async function handleSearchRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  
  // GET /api/search?q=keyword&limit=20
  if (request.method === 'GET') {
    const query = url.searchParams.get('q') || '';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);
    
    if (!query.trim()) {
      return Response.json({ error: 'Query required' }, { status: 400 });
    }
    
    const start = Date.now();
    
    // Read search index from KV
    const indexStr = await env.SEARCH_KV.get(SEARCH_INDEX_KEY);
    if (!indexStr) {
      return Response.json({ results: [], total: 0, time: 0 });
    }
    
    let index: SearchDocument[];
    try {
      index = JSON.parse(indexStr);
    } catch {
      return Response.json({ error: 'Invalid index' }, { status: 500 });
    }
    
    // Score and filter
    const results: SearchResult[] = [];
    for (const doc of index) {
      const result = scoreMatch(doc, query);
      if (result) results.push(result);
    }
    
    // Sort by score desc
    results.sort((a, b) => b.score - a.score);
    
    const responseTime = Date.now() - start;
    const limited = results.slice(0, limit);
    
    return Response.json({
      results: limited,
      total: results.length,
      query,
      time: responseTime,
    }, {
      headers: {
        'Cache-Control': 'public, max-age=60',
      }
    });
  }
  
  // POST /api/search/index - Rebuild search index (admin only)
  if (request.method === 'POST') {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (token !== env.API_SECRET) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    let body: { posts?: Array<{slug: string; title: string; body: string; excerpt?: string; tags?: string[]; category?: string; publishedAt?: number}> };
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    
    const index: SearchDocument[] = (body.posts || []).map(p => ({
      slug: p.slug,
      title: p.title,
      body: p.body,
      excerpt: p.excerpt || p.body.slice(0, 200),
      tags: p.tags || [],
      category: p.category,
      publishedAt: p.publishedAt || Date.now(),
    }));
    
    await env.SEARCH_KV.put(SEARCH_INDEX_KEY, JSON.stringify(index));
    
    return Response.json({ indexed: index.length });
  }
  
  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
