import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src";

describe("CloudBlog API", () => {
	describe("health endpoint", () => {
		it('/health returns ok status', async () => {
			const request = new Request("http://example.com/health");
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);
			const json = await response.json();
			expect(json.status).toBe('ok');
			expect(json.timestamp).toBeDefined();
		});
	});

	describe("404 for unknown API routes", () => {
		it('/api/unknown returns 404', async () => {
			const request = new Request("http://example.com/api/unknown");
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);
			expect(response.status).toBe(404);
		});
	});

	describe("404 for static routes", () => {
		it('non-API routes return 404', async () => {
			const request = new Request("http://example.com/");
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);
			expect(response.status).toBe(404);
		});
	});
});
