// Cloudflare Workers environment bindings

interface Env {
	// D1 Database
	DB: D1Database;

	// R2 bucket for images
	IMAGES_BUCKET: R2Bucket;

	// KV for import progress
	IMPORT_KV: KVNamespace;

	// KV for search index
	SEARCH_KV: KVNamespace;

	// R2 public URL (e.g., https://your-account.r2.cloudflarestorage.com/bucket)
	R2_PUBLIC_URL?: string;

	// CDN custom domain (e.g., cdn.yourdomain.com)
	CDN_DOMAIN?: string;

	// R2 bucket for static assets
	STATIC_BUCKET: R2Bucket;

	// Site config vars (plain text, set in wrangler.jsonc)
	SITE_LOGO_TEXT: string;
	SITE_FOOTER_TEXT: string;

	// Admin credentials for initial setup (set via wrangler secret put)
	ADMIN_USERNAME?: string;
	ADMIN_PASSWORD?: string;
}
