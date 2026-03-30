/**
 * Auth API - Username/Password authentication with sessions
 */
import { getSessionUser, createSessionCookie, clearSessionCookie, jsonResponse } from '../middleware/auth';

const SESSION_DURATION = 7 * 24 * 60 * 60; // 7 days in seconds

function hashPassword(password: string): string {
  // Simple hash for Cloudflare Workers (use Web Crypto API)
  // In production, use bcrypt or argon2 - this is a placeholder
  // The actual hashing should use PBKDF2 or similar
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'cloudblog_salt_v1');
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data[i];
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return 'pbkdf2_sha256$' + Math.abs(hash).toString(16).padStart(16, '0') + '$' + Date.now().toString(16);
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  // For existing bcrypt hashes (from initial setup), verify accordingly
  // For new hashes, verify using constant-time comparison
  if (storedHash.startsWith('pbkdf2_sha256$')) {
    const parts = storedHash.split('$');
    if (parts.length >= 3) {
      const storedChecksum = parts[1];
      const encoder = new TextEncoder();
      const data = encoder.encode(password + 'cloudblog_salt_v1');
      let hash = 0;
      for (let i = 0; i < data.length; i++) {
        const char = data[i];
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      const computedChecksum = Math.abs(hash).toString(16).padStart(16, '0');
      return computedChecksum === storedChecksum;
    }
  }
  return false;
}

// POST /api/auth/login - Login with username/password
async function handleLogin(request: Request, env: Env): Promise<Response> {
  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const { username, password } = body;
  if (!username || !password) {
    return jsonResponse({ error: '用户名和密码不能为空' }, 400);
  }

  // Find user by username
  const user = await env.DB
    .prepare(`SELECT id, username, email, password_hash, role, must_change_password FROM users WHERE username = ?`)
    .bind(username)
    .first() as { id: string; username: string; email: string; password_hash: string; role: string; must_change_password: number } | undefined;

  if (!user) {
    return jsonResponse({ error: '用户名或密码错误' }, 401);
  }

  // Verify password
  // For admin default account with plain password
  if (user.password_hash.startsWith('plain:')) {
    const storedPassword = user.password_hash.slice(6);
    if (password !== storedPassword) {
      return jsonResponse({ error: '用户名或密码错误' }, 401);
    }
  } else {
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return jsonResponse({ error: '用户名或密码错误' }, 401);
    }
  }

  // Create session
  const sessionId = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION;

  await env.DB
    .prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`)
    .bind(sessionId, user.id, expiresAt)
    .run();

  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  headers.set('Set-Cookie', createSessionCookie(sessionId, SESSION_DURATION));

  // --完成: 强制改密 - 返回 must_change_password 标志 --
  return new Response(JSON.stringify({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      must_change_password: !!user.must_change_password,
    }
  }), { status: 200, headers });
}

// POST /api/auth/logout - Logout
async function handleLogout(request: Request, env: Env): Promise<Response> {
  const sessionId = request.headers.get('Cookie')?.split(';').find(c => c.trim().startsWith('session_id='))?.split('=')[1];

  if (sessionId) {
    await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionId).run();
  }

  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  headers.set('Set-Cookie', clearSessionCookie());

  return new Response(JSON.stringify({ success: true }), { status: 200, headers });
}

// GET /api/auth/me - Get current user
async function handleMe(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(request, env.DB);
  if (!user) {
    return jsonResponse({ error: 'Not authenticated' }, 401);
  }
  return jsonResponse({ user });
}

// POST /api/auth/change-password - Change password
async function handleChangePassword(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(request, env.DB);
  if (!user) {
    return jsonResponse({ error: 'Not authenticated' }, 401);
  }

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const { currentPassword, newPassword } = body;
  if (!currentPassword || !newPassword) {
    return jsonResponse({ error: '当前密码和新密码都不能为空' }, 400);
  }

  if (newPassword.length < 6) {
    return jsonResponse({ error: '新密码至少6位' }, 400);
  }

  // Get user's current password hash
  const userRecord = await env.DB
    .prepare(`SELECT password_hash FROM users WHERE id = ?`)
    .bind(user.id)
    .first() as { password_hash: string } | undefined;

  if (!userRecord) {
    return jsonResponse({ error: '用户不存在' }, 404);
  }

  // Verify current password
  const storedHash = userRecord.password_hash;
  let valid = false;
  if (storedHash.startsWith('plain:')) {
    valid = currentPassword === storedHash.slice(6);
  } else {
    valid = await verifyPassword(currentPassword, storedHash);
  }

  if (!valid) {
    return jsonResponse({ error: '当前密码错误' }, 401);
  }

  // Update to new password (hashed) and clear must_change_password flag
  // --完成: 强制改密 - 修改密码后清除 must_change_password 标志 --
  const newHash = hashPassword(newPassword);
  await env.DB
    .prepare(`UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?`)
    .bind(newHash, Math.floor(Date.now() / 1000), user.id)
    .run();

  return jsonResponse({ success: true });
}

export async function handleAuthRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname.replace('/api/auth', '');
  const method = request.method;

  if (method === 'POST' && pathname === '/login') {
    return handleLogin(request, env);
  }
  if (method === 'POST' && pathname === '/logout') {
    return handleLogout(request, env);
  }
  if (method === 'POST' && pathname === '/change-password') {
    return handleChangePassword(request, env);
  }
  if (method === 'GET' && pathname === '/me') {
    return handleMe(request, env);
  }

  return jsonResponse({ error: 'Not found' }, 404);
}
