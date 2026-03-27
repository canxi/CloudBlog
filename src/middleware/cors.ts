/**
 * CORS Middleware
 * Configurable Cross-Origin Resource Sharing for API routes
 */

export interface CorsOptions {
  allowOrigins?: string[];
  allowMethods?: string[];
  allowHeaders?: string[];
  exposeHeaders?: string[];
  maxAge?: number;
  credentials?: boolean;
}

const DEFAULT_OPTIONS: Required<CorsOptions> = {
  allowOrigins: ['*'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposeHeaders: [],
  maxAge: 86400,
  credentials: false,
};

export function cors(options: CorsOptions = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return (request: Request): Response | null => {
    // Handle preflight
    if (request.method === 'OPTIONS') {
      return handlePreflight(request, opts);
    }

    return null; // Continue to handler
  };
}

function handlePreflight(request: Request, opts: Required<CorsOptions>): Response {
  const origin = request.headers.get('Origin');

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': opts.allowMethods.join(', '),
    'Access-Control-Allow-Headers': opts.allowHeaders.join(', '),
    'Access-Control-Max-Age': opts.maxAge.toString(),
  };

  if (origin && (opts.allowOrigins.includes('*') || opts.allowOrigins.includes(origin))) {
    headers['Access-Control-Allow-Origin'] = opts.allowOrigins.includes('*') ? '*' : origin;
  }

  if (opts.credentials) {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  if (opts.exposeHeaders.length > 0) {
    headers['Access-Control-Expose-Headers'] = opts.exposeHeaders.join(', ');
  }

  return new Response(null, {
    status: 204,
    headers,
  });
}

// Helper to add CORS headers to response
export function addCorsHeaders(response: Response, request: Request, opts: Required<CorsOptions>): Response {
  const origin = request.headers.get('Origin');

  const headers: Record<string, string> = {};

  if (origin && (opts.allowOrigins.includes('*') || opts.allowOrigins.includes(origin))) {
    headers['Access-Control-Allow-Origin'] = opts.allowOrigins.includes('*') ? '*' : origin;
  }

  if (opts.credentials) {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  if (opts.exposeHeaders.length > 0) {
    headers['Access-Control-Expose-Headers'] = opts.exposeHeaders.join(', ');
  }

  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }

  return response;
}
