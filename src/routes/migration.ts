/**
 * Content Migration API
 * Handles WordPress XML and Markdown file imports
 */

import { parseWordPressXML, countWordPressPosts } from '../utils/wordpress-parser';
import { parseMarkdownFiles } from '../utils/markdown-importer';
import { downloadImage } from '../utils/r2-storage';
import { ImportProgressTracker } from '../utils/import-progress';
import type { ImportBatch, ImportError, WordPressPost, MarkdownPost } from '../types/migration';

// In-memory queue for processing (in production, use Durable Objects)
const processingQueue = new Map<string, boolean>();

function generateId(): string {
  return crypto.randomUUID();
}

function requireAuth(request: Request, env: Env): string | null {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (token !== env.API_SECRET) {
    return null;
  }
  return 'authenticated'; // simplified for demo
}

// POST /api/migration/wordpress - Start WordPress XML import
async function handleWordPressImport(request: Request, env: Env): Promise<Response> {
  const auth = requireAuth(request, env);
  if (!auth) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let xmlContent: string;
  let authorId = 'system';

  const contentType = request.headers.get('Content-Type') || '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return Response.json({ error: 'No file uploaded' }, { status: 400 });
    }
    xmlContent = await file.text();
    authorId = String(formData.get('author_id') || authorId);
  } else if (contentType.includes('application/json')) {
    const body = await request.json() as { xml?: string; author_id?: string };
    if (!body.xml) {
      return Response.json({ error: 'Missing xml field' }, { status: 400 });
    }
    xmlContent = body.xml;
    authorId = String(body.author_id || authorId);
  } else {
    // Raw text
    xmlContent = await request.text();
  }

  if (!xmlContent || xmlContent.length < 100) {
    return Response.json({ error: 'Invalid XML content' }, { status: 400 });
  }

  const totalItems = countWordPressPosts(xmlContent);
  if (totalItems === 0) {
    return Response.json({ error: 'No valid posts found in XML' }, { status: 400 });
  }

  const batchId = generateId();
  const tracker = new ImportProgressTracker(env.IMPORT_KV);

  const batch: ImportBatch = {
    id: batchId,
    type: 'wordpress',
    status: 'pending',
    totalItems,
    processedItems: 0,
    successCount: 0,
    errorCount: 0,
    errors: [],
    startedAt: Date.now(),
    createdBy: authorId,
    createdAt: new Date().toISOString(),
  };

  await tracker.createBatch(batch);

  // Start async processing
  processWordPressImport(batchId, xmlContent, authorId, env).catch(console.error);

  return Response.json({
    batchId,
    status: 'pending',
    totalItems,
    message: 'Import started. Poll /api/migration/progress/' + batchId + ' for status.',
  }, { status: 202 });
}

// POST /api/migration/markdown - Start Markdown batch import
async function handleMarkdownImport(request: Request, env: Env): Promise<Response> {
  const auth = requireAuth(request, env);
  if (!auth) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let files: { name: string; content: string }[] = [];
  let authorId = 'system';

  const contentType = request.headers.get('Content-Type') || '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    authorId = String(formData.get('author_id') || authorId);

    const fileEntries = formData.getAll('files');
    for (const entry of fileEntries) {
      if (entry instanceof File) {
        files.push({
          name: entry.name,
          content: await entry.text(),
        });
      }
    }
  } else if (contentType.includes('application/json')) {
    const body = await request.json() as { files?: { name: string; content: string }[]; author_id?: string };
    if (!Array.isArray(body.files)) {
      return Response.json({ error: 'Missing files array' }, { status: 400 });
    }
    files = body.files!;
    authorId = String(body.author_id || authorId);
  }

  if (files.length === 0) {
    return Response.json({ error: 'No files provided' }, { status: 400 });
  }

  const batchId = generateId();
  const tracker = new ImportProgressTracker(env.IMPORT_KV);

  const batch: ImportBatch = {
    id: batchId,
    type: 'markdown',
    status: 'pending',
    totalItems: files.length,
    processedItems: 0,
    successCount: 0,
    errorCount: 0,
    errors: [],
    startedAt: Date.now(),
    createdBy: authorId,
    createdAt: new Date().toISOString(),
  };

  await tracker.createBatch(batch);

  processMarkdownImport(batchId, files, authorId, env).catch(console.error);

  return Response.json({
    batchId,
    status: 'pending',
    totalItems: files.length,
    message: 'Import started. Poll /api/migration/progress/' + batchId + ' for status.',
  }, { status: 202 });
}

// GET /api/migration/progress/:batchId - Get import progress
async function handleProgress(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split('/');
  const batchId = parts[parts.length - 1];

  if (!batchId || batchId === 'progress') {
    return Response.json({ error: 'Missing batchId' }, { status: 400 });
  }

  const tracker = new ImportProgressTracker(env.IMPORT_KV);
  const progress = await tracker.getProgress(batchId);

  if (!progress) {
    return Response.json({ error: 'Batch not found' }, { status: 404 });
  }

  return Response.json(progress);
}

// GET /api/migration/batches - List all batches
async function handleListBatches(request: Request, env: Env): Promise<Response> {
  const auth = requireAuth(request, env);
  if (!auth) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const tracker = new ImportProgressTracker(env.IMPORT_KV);
  const batches = await tracker.listBatches(20);
  return Response.json(batches);
}

// POST /api/migration/image - Download single image to R2
async function handleImageUpload(request: Request, env: Env): Promise<Response> {
  const auth = requireAuth(request, env);
  if (!auth) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json() as { imageUrl?: string; postSlug?: string };
  const { imageUrl, postSlug } = body;

  if (!imageUrl || !postSlug) {
    return Response.json({ error: 'Missing imageUrl or postSlug' }, { status: 400 });
  }

  try {
    const result = await downloadImage(imageUrl, postSlug, env);
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    );
  }
}

// --- Async Processing Functions ---

async function processWordPressImport(
  batchId: string,
  xmlContent: string,
  authorId: string,
  env: Env
): Promise<void> {
  if (processingQueue.get(batchId)) return;
  processingQueue.set(batchId, true);

  const tracker = new ImportProgressTracker(env.IMPORT_KV);
  await tracker.setStatus(batchId, 'processing');

  try {
    const posts = parseWordPressXML(xmlContent);
    const db = env.DB;

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      try {
        await insertWordPressPost(post, authorId, db, env, tracker, batchId, i);
        await tracker.recordProcessed(batchId, true);
      } catch (error) {
        const importError: ImportError = {
          itemIndex: i,
          itemTitle: post.title,
          error: error instanceof Error ? error.message : String(error),
        };
        await tracker.recordProcessed(batchId, false, importError);
      }
    }

    await tracker.setStatus(batchId, 'completed');
  } catch (error) {
    await tracker.setStatus(batchId, 'failed');
  } finally {
    processingQueue.delete(batchId);
  }
}

async function insertWordPressPost(
  post: WordPressPost,
  authorId: string,
  db: D1Database,
  env: Env,
  tracker: ImportProgressTracker,
  batchId: string,
  index: number
): Promise<void> {
  // Download featured image if present
  let coverImage = '';
  if (post.featuredImage) {
    try {
      const img = await downloadImage(post.featuredImage, post.slug, env);
      coverImage = img.url;
    } catch {
      // Non-fatal: continue without image
    }
  }

  const postId = crypto.randomUUID();

  // Insert post
  await db
    .prepare(
      `INSERT INTO posts (id, title, slug, content, excerpt, cover_image, author_id, status, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      postId,
      post.title,
      post.slug,
      post.content,
      post.excerpt,
      coverImage,
      authorId,
      post.status,
      post.publishedAt,
      Math.floor(Date.now() / 1000),
      Math.floor(Date.now() / 1000)
    )
    .run();

  // Handle categories
  for (const catName of post.categories) {
    await ensureCategory(catName, db);
    const cat = await db
      .prepare('SELECT id FROM categories WHERE name = ?')
      .bind(catName)
      .first<{ id: string }>();
    if (cat) {
      await db
        .prepare('INSERT OR IGNORE INTO post_categories (post_id, category_id) VALUES (?, ?)')
        .bind(postId, cat.id)
        .run();
    }
  }

  // Handle tags
  for (const tagName of post.tags) {
    await ensureTag(tagName, db);
    const tag = await db
      .prepare('SELECT id FROM tags WHERE name = ?')
      .bind(tagName)
      .first<{ id: string }>();
    if (tag) {
      await db
        .prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)')
        .bind(postId, tag.id)
        .run();
    }
  }
}

async function ensureCategory(name: string, db: D1Database): Promise<void> {
  const slug = name.toLowerCase().replace(/[^\w]+/g, '-');
  await db
    .prepare(
      `INSERT OR IGNORE INTO categories (id, name, slug, created_at) VALUES (?, ?, ?, ?)`
    )
    .bind(crypto.randomUUID(), name, slug, Math.floor(Date.now() / 1000))
    .run();
}

async function ensureTag(name: string, db: D1Database): Promise<void> {
  const slug = name.toLowerCase().replace(/[^\w]+/g, '-');
  await db
    .prepare(
      `INSERT OR IGNORE INTO tags (id, name, slug, created_at) VALUES (?, ?, ?, ?)`
    )
    .bind(crypto.randomUUID(), name, slug, Math.floor(Date.now() / 1000))
    .run();
}

async function processMarkdownImport(
  batchId: string,
  files: { name: string; content: string }[],
  authorId: string,
  env: Env
): Promise<void> {
  if (processingQueue.get(batchId)) return;
  processingQueue.set(batchId, true);

  const tracker = new ImportProgressTracker(env.IMPORT_KV);
  await tracker.setStatus(batchId, 'processing');

  try {
    const posts = parseMarkdownFiles(files);
    const db = env.DB;

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      try {
        await insertMarkdownPost(post, authorId, db, env, batchId, i);
        await tracker.recordProcessed(batchId, true);
      } catch (error) {
        const importError: ImportError = {
          itemIndex: i,
          itemTitle: post.title,
          error: error instanceof Error ? error.message : String(error),
        };
        await tracker.recordProcessed(batchId, false, importError);
      }
    }

    await tracker.setStatus(batchId, 'completed');
  } catch (error) {
    await tracker.setStatus(batchId, 'failed');
  } finally {
    processingQueue.delete(batchId);
  }
}

async function insertMarkdownPost(
  post: MarkdownPost,
  authorId: string,
  db: D1Database,
  env: Env,
  batchId: string,
  index: number
): Promise<void> {
  // Download cover image if present
  let coverImage = '';
  if (post.coverImage && (post.coverImage.startsWith('http://') || post.coverImage.startsWith('https://'))) {
    try {
      const img = await downloadImage(post.coverImage, post.slug, env);
      coverImage = img.url;
    } catch {
      // Non-fatal
    }
  }

  const postId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const publishedAt = post.publishedAt || now;

  await db
    .prepare(
      `INSERT INTO posts (id, title, slug, content, excerpt, cover_image, author_id, status, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      postId,
      post.title,
      post.slug,
      post.content,
      post.excerpt || '',
      coverImage,
      authorId,
      publishedAt ? 'published' : 'draft',
      publishedAt,
      now,
      now
    )
    .run();

  // Handle categories
  for (const catName of post.categories) {
    await ensureCategory(catName, db);
    const cat = await db
      .prepare('SELECT id FROM categories WHERE name = ?')
      .bind(catName)
      .first<{ id: string }>();
    if (cat) {
      await db
        .prepare('INSERT OR IGNORE INTO post_categories (post_id, category_id) VALUES (?, ?)')
        .bind(postId, cat.id)
        .run();
    }
  }

  // Handle tags
  for (const tagName of post.tags) {
    await ensureTag(tagName, db);
    const tag = await db
      .prepare('SELECT id FROM tags WHERE name = ?')
      .bind(tagName)
      .first<{ id: string }>();
    if (tag) {
      await db
        .prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)')
        .bind(postId, tag.id)
        .run();
    }
  }
}

export async function handleMigrationRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/migration', '');

  if (request.method === 'POST' && path === '/wordpress') {
    return await handleWordPressImport(request, env);
  }
  if (request.method === 'POST' && path === '/markdown') {
    return await handleMarkdownImport(request, env);
  }
  if (request.method === 'POST' && path === '/image') {
    return await handleImageUpload(request, env);
  }
  if (request.method === 'GET' && path.startsWith('/progress/')) {
    return await handleProgress(request, env);
  }
  if (request.method === 'GET' && path === '/batches') {
    return await handleListBatches(request, env);
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}
