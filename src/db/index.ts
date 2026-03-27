/**
 * D1 Database Client
 * Cloudflare D1 is an edge SQLite database
 */
import type { D1Database, D1Result, D1PreparedStatement } from '@cloudflare/workers-types';

// Database type singleton for D1 binding
export interface Env {
  DB: D1Database;
}

// Helper to convert D1 results to JSON-serializable format
export function resultToJson<T>(result: D1Result<T>): T[] {
  return result.results || [];
}

// Generate a unique ID using crypto
export function generateId(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Base repository class with common CRUD operations
export abstract class BaseRepository<T extends { id: string }> {
  constructor(protected db: D1Database, protected tableName: string) {}

  async findById(id: string): Promise<T | null> {
    const result = await this.db
      .prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`)
      .bind(id)
      .first<T>();
    return result || null;
  }

  async findAll(limit = 100, offset = 0): Promise<T[]> {
    const result = await this.db
      .prepare(`SELECT * FROM ${this.tableName} LIMIT ? OFFSET ?`)
      .bind(limit, offset)
      .all<T>();
    return resultToJson(result);
  }

  async create(data: Omit<T, 'id'> & { id?: string }): Promise<T> {
    const id = (data.id as string) || generateId();
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = columns.map(() => '?').join(', ');
    
    await this.db
      .prepare(`INSERT INTO ${this.tableName} (${columns.join(', ')}) VALUES (${placeholders})`)
      .bind(...values)
      .run();
    
    return { ...data, id } as T;
  }

  async update(id: string, data: Partial<T>): Promise<boolean> {
    const sets = Object.keys(data).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(data), id];
    
    const result = await this.db
      .prepare(`UPDATE ${this.tableName} SET ${sets} WHERE id = ?`)
      .bind(...values)
      .run();
    
    return result.success;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .prepare(`DELETE FROM ${this.tableName} WHERE id = ?`)
      .bind(id)
      .run();
    return result.success;
  }
}

// User repository
export class UserRepository extends BaseRepository<{
  id: string;
  username: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  role: string;
  created_at: number;
  updated_at: number;
}> {
  constructor(db: D1Database) {
    super(db, 'users');
  }

  async findByUsername(username: string) {
    return this.db
      .prepare('SELECT * FROM users WHERE username = ?')
      .bind(username)
      .first();
  }

  async findByEmail(email: string) {
    return this.db
      .prepare('SELECT * FROM users WHERE email = ?')
      .bind(email)
      .first();
  }
}

// Post repository
export class PostRepository extends BaseRepository<{
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string | null;
  cover_image: string | null;
  author_id: string;
  status: string;
  published_at: number | null;
  created_at: number;
  updated_at: number;
}> {
  constructor(db: D1Database) {
    super(db, 'posts');
  }

  async findBySlug(slug: string) {
    return this.db
      .prepare('SELECT * FROM posts WHERE slug = ?')
      .bind(slug)
      .first();
  }

  async findByStatus(status: string, limit = 50, offset = 0) {
    const result = await this.db
      .prepare('SELECT * FROM posts WHERE status = ? ORDER BY published_at DESC LIMIT ? OFFSET ?')
      .bind(status, limit, offset)
      .all();
    return resultToJson(result);
  }

  async findByAuthor(authorId: string, limit = 50, offset = 0) {
    const result = await this.db
      .prepare('SELECT * FROM posts WHERE author_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .bind(authorId, limit, offset)
      .all();
    return resultToJson(result);
  }
}

// Category repository
export class CategoryRepository extends BaseRepository<{
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parent_id: string | null;
  created_at: number;
}> {
  constructor(db: D1Database) {
    super(db, 'categories');
  }

  async findBySlug(slug: string) {
    return this.db
      .prepare('SELECT * FROM categories WHERE slug = ?')
      .bind(slug)
      .first();
  }
}

// Tag repository
export class TagRepository extends BaseRepository<{
  id: string;
  name: string;
  slug: string;
  created_at: number;
}> {
  constructor(db: D1Database) {
    super(db, 'tags');
  }

  async findBySlug(slug: string) {
    return this.db
      .prepare('SELECT * FROM tags WHERE slug = ?')
      .bind(slug)
      .first();
  }
}

// Comment repository
export class CommentRepository extends BaseRepository<{
  id: string;
  post_id: string;
  author_name: string;
  author_email: string | null;
  content: string;
  parent_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  status: string;
  created_at: number;
}> {
  constructor(db: D1Database) {
    super(db, 'comments');
  }

  async findByPost(postId: string, status = 'approved') {
    const result = await this.db
      .prepare('SELECT * FROM comments WHERE post_id = ? AND status = ? ORDER BY created_at ASC')
      .bind(postId, status)
      .all();
    return resultToJson(result);
  }
}

// Session repository
export class SessionRepository extends BaseRepository<{
  id: string;
  user_id: string;
  expires_at: number;
  created_at: number;
}> {
  constructor(db: D1Database) {
    super(db, 'sessions');
  }

  async findValidSession(sessionId: string) {
    const now = Math.floor(Date.now() / 1000);
    return this.db
      .prepare('SELECT * FROM sessions WHERE id = ? AND expires_at > ?')
      .bind(sessionId, now)
      .first();
  }

  async deleteExpired() {
    const now = Math.floor(Date.now() / 1000);
    await this.db
      .prepare('DELETE FROM sessions WHERE expires_at < ?')
      .bind(now)
      .run();
  }
}
