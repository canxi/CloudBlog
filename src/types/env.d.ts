// Cloudflare Workers environment bindings

interface Env {
	// D1 Database
	DB: D1Database;

	// R2 bucket for images
	IMAGES_BUCKET: R2Bucket;

	// KV for import progress
	IMPORT_KV: KVNamespace;

	// API secret for authentication
	API_SECRET: string;

	// R2 public URL (e.g., https://your-account.r2.cloudflarestorage.com/bucket)
	R2_PUBLIC_URL?: string;
}
