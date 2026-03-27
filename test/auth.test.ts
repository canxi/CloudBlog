/**
 * Auth Validation Tests — Auth Layer Only
 *
 * Tests authentication enforcement without requiring a database.
 * These tests verify the auth middleware layer works correctly:
 * 1. Protected routes return 401 without auth
 * 2. Protected routes accept valid Bearer token
 * 3. Invalid tokens return 401
 * 4. Public routes are accessible without auth
 */

import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src";

const API_SECRET = env.API_SECRET || "test-secret-key";

function makeRequest(
	path: string,
	method = "GET",
	body?: unknown,
	extraHeaders: Record<string, string> = {}
) {
	const options: RequestInit = { method };
	const headers: Record<string, string> = { ...extraHeaders };
	if (body) {
		options.body = JSON.stringify(body);
		headers["Content-Type"] = "application/json";
	}
	options.headers = headers;
	return new Request(`http://example.com${path}`, options);
}

async function sendRequest(req: Request) {
	const ctx = createExecutionContext();
	const response = await worker.fetch(req, env, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

// ==========================================
// Test: Protected routes reject unauthenticated
// ==========================================

describe("Unauthenticated → 401 on all protected routes", () => {
	// All POST/PUT/DELETE routes + admin GET routes
	const protectedRoutes = [
		// Posts write
		{ path: "/api/posts", method: "POST", body: { title: "T", content: "C" } },
		{ path: "/api/posts/slug", method: "PUT", body: { title: "U" } },
		{ path: "/api/posts/slug", method: "DELETE" },
		// Notes write
		{ path: "/api/notes", method: "POST", body: { content: "n" } },
		{ path: "/api/notes/12345678-1234-1234-1234-123456789012", method: "PUT", body: { content: "u" } },
		{ path: "/api/notes/12345678-1234-1234-1234-123456789012", method: "DELETE" },
		// Snippets write
		{ path: "/api/snippets", method: "POST", body: { title: "T", code: "x", language: "js" } },
		{ path: "/api/snippets/12345678-1234-1234-1234-123456789012", method: "PUT", body: { title: "U" } },
		{ path: "/api/snippets/12345678-1234-1234-1234-123456789012", method: "DELETE" },
		// Admin comments
		{ path: "/api/admin/comments", method: "GET" },
		{ path: "/api/admin/comments/12345678-1234-1234-1234-123456789012", method: "PATCH", body: { status: "approved" } },
		{ path: "/api/admin/comments/12345678-1234-1234-1234-123456789012", method: "DELETE" },
		// Admin media
		{ path: "/api/admin/media", method: "GET" },
		// Analytics management GET
		{ path: "/api/analytics/overview", method: "GET" },
		{ path: "/api/analytics/timeseries", method: "GET" },
		// Export
		{ path: "/api/export/markdown", method: "GET" },
		{ path: "/api/export/json", method: "GET" },
		// Revisions — THE KEY FIX: now requires auth
		{ path: "/api/revisions/12345678-1234-1234-1234-123456789012", method: "GET" },
		{ path: "/api/revisions/12345678-1234-1234-1234-123456789012/abc", method: "GET" },
		{ path: "/api/revisions/12345678-1234-1234-1234-123456789012/abc/diff/def", method: "GET" },
		{ path: "/api/revisions/12345678-1234-1234-1234-123456789012", method: "POST", body: { title: "T", content: "C" } },
		// Migration
		{ path: "/api/migration/batches", method: "GET" },
		// Search index rebuild
		{ path: "/api/search/index", method: "POST", body: { posts: [] } },
	];

	for (const r of protectedRoutes) {
		it(`${r.method} ${r.path} → 401`, async () => {
			const req = makeRequest(r.path, r.method, r.body);
			const res = await sendRequest(req);
			expect(res.status, `${r.method} ${r.path} got ${res.status}`).toBe(401);
		});
	}
});

// ==========================================
// Test: Valid token is accepted (not rejected)
// ==========================================

describe("Valid Bearer token → not rejected by auth layer", () => {
	const withToken = { Authorization: `Bearer ${API_SECRET}` };

	// These routes auth check passes but DB may not be set up; we only care auth doesn't reject
	const authRoutes = [
		{ path: "/api/posts", method: "POST", body: { title: "T", content: "C" } },
		{ path: "/api/notes", method: "POST", body: { content: "n" } },
		{ path: "/api/snippets", method: "POST", body: { title: "T", code: "x", language: "js" } },
		// KEY FIX TEST: revision GET now accepts valid token (previously was public)
		{ path: "/api/revisions/12345678-1234-1234-1234-123456789012", method: "GET" },
		{ path: "/api/revisions/12345678-1234-1234-1234-123456789012/abc", method: "GET" },
		{ path: "/api/revisions/12345678-1234-1234-1234-123456789012/abc/diff/def", method: "GET" },
		{ path: "/api/revisions/12345678-1234-1234-1234-123456789012", method: "POST", body: { title: "T", content: "C" } },
		// Migration batches: fixed in this patch
		{ path: "/api/migration/batches", method: "GET" },
		{ path: "/api/search/index", method: "POST", body: { posts: [] } },
		{ path: "/api/admin/comments", method: "GET" },
		{ path: "/api/analytics/overview", method: "GET" },
	];

	for (const r of authRoutes) {
		it(`${r.method} ${r.path} → not 401 with valid token`, async () => {
			const req = makeRequest(r.path, r.method, r.body, withToken);
			const res = await sendRequest(req);
			expect(res.status, `${r.method} ${r.path} got ${res.status}`).not.toBe(401);
		});
	}
});

// ==========================================
// Test: Invalid tokens are rejected
// ==========================================

describe("Invalid token → 401", () => {
	const invalidTokens = [
		{ label: "wrong secret", token: "Bearer wrong-secret" },
		{ label: "malformed", token: "NotBearer token" },
		{ label: "empty", token: "" },
		{ label: "bearer-only", token: "Bearer" },
	];

	for (const t of invalidTokens) {
		it(`${t.label} → 401`, async () => {
			const req = makeRequest("/api/posts", "POST", { title: "T", content: "C" }, { Authorization: t.token });
			const res = await sendRequest(req);
			expect(res.status).toBe(401);
		});
	}
});

// ==========================================
// Test: Public routes are accessible without auth
// ==========================================

describe("Public routes → accessible without auth", () => {
	it("GET /health → 200", async () => {
		const req = makeRequest("/health");
		const res = await sendRequest(req);
		expect(res.status).toBe(200);
	});

	it("GET /api/search → not 401 (public search, may be 400 no-index)", async () => {
		const req = makeRequest("/api/search?q=test");
		const res = await sendRequest(req);
		expect(res.status).not.toBe(401);
	});

	it("POST /api/analytics/track → not 401 (intentionally public)", async () => {
		const req = makeRequest("/api/analytics/track", "POST", { postId: "1", slug: "s" });
		const res = await sendRequest(req);
		// Returns 400/500 because KV not set up, but NOT 401 — track is public
		expect(res.status).not.toBe(401);
	});

	it("POST /api/comments → not 401 (public comment submission, spam-filtered)", async () => {
		const req = makeRequest("/api/comments", "POST", {
			postSlug: "test",
			author: "Tester",
			email: "test@test.com",
			content: "Great post!",
		});
		const res = await sendRequest(req);
		// Returns 400/500 because KV not set up, but NOT 401 — comments are public
		expect(res.status).not.toBe(401);
	});
});
