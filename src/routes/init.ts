/**
 * Database initialization - Creates default admin user
 * Run via: wrangler d1 execute cloudblog --local --file=./src/routes/init.sql
 */

export async function ensureAdminUser(env: Env): Promise<void> {
  const ADMIN_USERNAME = 'admin';
  const ADMIN_PASSWORD = 'admin123'; // Default password - should be changed after first login

  // Check if admin user exists
  const existing = await env.DB
    .prepare(`SELECT id FROM users WHERE username = ?`)
    .bind(ADMIN_USERNAME)
    .first();

  if (existing) {
    // Admin exists, update password if it's still plain
    const userRecord = existing as { id: string };
    const userPw = await env.DB
      .prepare(`SELECT password_hash FROM users WHERE id = ?`)
      .bind(userRecord.id)
      .first() as { password_hash: string };

    // If password starts with 'plain:' (old format), update it
    if (userPw?.password_hash?.startsWith('plain:')) {
      const hashedPw = 'plain:' + ADMIN_PASSWORD;
      await env.DB
        .prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`)
        .bind(hashedPw, Math.floor(Date.now() / 1000), userRecord.id)
        .run();
    }
    return;
  }

  // Create admin user with plain password (for initial setup)
  // In production, this would be done via migration
  const adminId = crypto.randomUUID();
  const hashedPassword = 'plain:' + ADMIN_PASSWORD; // Simple prefix for initial setup
  const now = Math.floor(Date.now() / 1000);

  // --完成: 强制改密 - 管理员首次登录必须修改密码
  await env.DB
    .prepare(`
      INSERT INTO users (id, username, email, password_hash, display_name, role, must_change_password, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(adminId, ADMIN_USERNAME, 'admin@cloudblog.local', hashedPassword, 'Administrator', 'admin', 1, now, now)
    .run();
}
