/**
 * Authentication Middleware
 * JWT-less token auth using sessions stored in D1
 */
import type { D1Database } from '@cloudflare/workers-types';

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  role: string;
}

export interface AuthContext {
  user: AuthUser | null;
  db: D1Database;
}

export async function getSessionUser(
  request: Request,
  db: D1Database
): Promise<AuthUser | null> {
  const sessionId = getSessionIdFromRequest(request);
  if (!sessionId) return null;

  const now = Math.floor(Date.now() / 1000);
  const session = await db
    .prepare(
      `SELECT s.*, u.id as user_id, u.username, u.email, u.display_name, u.role
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = ? AND s.expires_at > ?`
    )
    .bind(sessionId, now)
    .first<{
      user_id: string;
      username: string;
      email: string;
      display_name: string | null;
      role: string;
    }>();

  if (!session) return null;

  return {
    id: session.user_id,
    username: session.username,
    email: session.email,
    displayName: session.display_name,
    role: session.role,
  };
}

export function getSessionIdFromRequest(request: Request): string | null {
  // Try cookie first
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  if (cookies.session_id) return cookies.session_id;

  // Try Authorization header
  const auth = request.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) {
    return auth.slice(7);
  }

  return null;
}

export function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');
    if (key) {
      cookies[key] = valueParts.join('=');
    }
  }
  return cookies;
}

export function requireAuth(
  handler: (request: Request, env: Env, ctx: { user: AuthUser }) => Promise<Response>
) {
  return async (request: Request, env: Env): Promise<Response> => {
    const user = await getSessionUser(request, env.DB);
    if (!user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    return handler(request, env, { user });
  };
}

export function requireRole(
  roles: string[],
  handler: (request: Request, env: Env, ctx: { user: AuthUser }) => Promise<Response>
) {
  return async (request: Request, env: Env): Promise<Response> => {
    const user = await getSessionUser(request, env.DB);
    if (!user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    if (!roles.includes(user.role)) {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }
    return handler(request, env, { user });
  };
}

// Helper to create session cookie
export function createSessionCookie(sessionId: string, expiresIn = 7 * 24 * 60 * 60): string {
  const expires = new Date(Date.now() + expiresIn * 1000).toUTCString();
  return `session_id=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}`;
}

export function clearSessionCookie(): string {
  return 'session_id=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
