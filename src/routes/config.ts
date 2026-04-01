/**
 * Site Config API - /api/config
 * GET: retrieve site configuration
 * PATCH: update site configuration (admin only)
 */

import { getSessionUser } from '../middleware/auth';

const CONFIG_KEY = 'site:config';

// Default config values
const DEFAULT_CONFIG = {
  site_logo_text: 'CloudBlog',
  footer_text: '© 2024 CloudBlog. All rights reserved.',
};

interface SiteConfig {
  site_logo_text: string;
  footer_text: string;
}

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json({ code: 200, data }, { status });
}

function errorResponse(message: string, status = 400): Response {
  return Response.json({ code: status, message }, { status });
}

// GET /api/config - retrieve site configuration
async function handleGet(request: Request, env: Env): Promise<Response> {
  try {
    const configStr = await env.IMPORT_KV.get(CONFIG_KEY);
    const config = configStr ? JSON.parse(configStr) : DEFAULT_CONFIG;

    // Merge with defaults to ensure all fields exist
    return jsonResponse({
      ...DEFAULT_CONFIG,
      ...config,
    });
  } catch (err) {
    console.error('Failed to get config:', err);
    return jsonResponse(DEFAULT_CONFIG);
  }
}

// PATCH /api/config - update site configuration (admin only)
async function handlePatch(request: Request, env: Env): Promise<Response> {
  // Auth check - require admin role
  const user = await getSessionUser(request, env.DB);
  if (!user) {
    return errorResponse('Unauthorized', 401);
  }
  if (user.role !== 'admin') {
    return errorResponse('Forbidden - admin only', 403);
  }

  let body: Partial<SiteConfig>;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  // Validate fields
  const allowedFields = ['site_logo_text', 'footer_text'];
  const updates: Partial<SiteConfig> = {};

  for (const field of allowedFields) {
    if (field in body) {
      const value = body[field as keyof SiteConfig];
      if (typeof value !== 'string') {
        return errorResponse(`${field} must be a string`, 400);
      }
      updates[field as keyof SiteConfig] = value;
    }
  }

  // Get existing config
  const existingStr = await env.IMPORT_KV.get(CONFIG_KEY);
  const existing = existingStr ? JSON.parse(existingStr) : {};

  // Merge updates
  const newConfig: SiteConfig = {
    ...DEFAULT_CONFIG,
    ...existing,
    ...updates,
  };

  // Save to KV
  await env.IMPORT_KV.put(CONFIG_KEY, JSON.stringify(newConfig));

  return jsonResponse(newConfig);
}

export async function handleConfigRequest(request: Request, env: Env): Promise<Response> {
  const method = request.method;

  if (method === 'GET') {
    return handleGet(request, env);
  }

  if (method === 'PATCH') {
    return handlePatch(request, env);
  }

  return errorResponse('Method not allowed', 405);
}
