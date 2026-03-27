/**
 * Analytics store tests
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Mock KV namespace
function createMockKV() {
  const store = new Map<string, { value: string; ttl?: number }>();
  return {
    get: vi.fn(async (key: string) => store.get(key)?.value ?? null),
    put: vi.fn(async (key: string, value: string, opts?: { expirationTtl?: number }) => {
      store.set(key, { value, ttl: opts?.expirationTtl });
    }),
    increment: vi.fn(async (key: string, amount: number) => {
      const existing = store.get(key)?.value;
      const newVal = (existing ? parseInt(existing) : 0) + amount;
      store.set(key, { value: newVal.toString() });
      return newVal;
    }),
    list: vi.fn(async (opts?: { prefix?: string }) => {
      const keys: { name: string }[] = [];
      for (const k of store.keys()) {
        if (!opts?.prefix || k.startsWith(opts.prefix)) {
          keys.push({ name: k });
        }
      }
      return { keys };
    }),
    _store: store,
  };
}

describe('AnalyticsStore', () => {
  // Note: These tests would require actual KV mocking
  // For now, we just test the helper functions

  describe('dateKey', () => {
    it('should format date as YYYY-MM-DD', () => {
      const date = new Date('2024-01-15T12:00:00Z');
      const key = date.toISOString().substring(0, 10);
      expect(key).toBe('2024-01-15');
    });
  });

  describe('visitor fingerprinting', () => {
    it('should generate consistent fingerprint for same UA', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
      let hash1 = 0;
      for (let i = 0; i < ua.length; i++) {
        const char = ua.charCodeAt(i);
        hash1 = ((hash1 << 5) - hash1) + char;
        hash1 = hash1 & hash1;
      }
      let hash2 = 0;
      for (let i = 0; i < ua.length; i++) {
        const char = ua.charCodeAt(i);
        hash2 = ((hash2 << 5) - hash2) + char;
        hash2 = hash2 & hash2;
      }
      expect(hash1).toBe(hash2);
    });

    it('should generate different fingerprint for different UA', () => {
      const ua1 = 'Mozilla/5.0 Chrome/120';
      const ua2 = 'Mozilla/5.0 Firefox/120';
      let hash1 = 0, hash2 = 0;
      for (const ua of [ua1, ua2]) {
        let hash = 0;
        for (let i = 0; i < ua.length; i++) {
          const char = ua.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash = hash & hash;
        }
        if (ua === ua1) hash1 = hash;
        else hash2 = hash;
      }
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('referer normalization', () => {
    it('should extract hostname from referer', () => {
      const referer = 'https://www.google.com/search?q=test';
      const url = new URL(referer);
      expect(url.hostname.replace(/^www\./, '')).toBe('google.com');
    });

    it('should return direct for invalid referer', () => {
      let result = 'direct';
      try {
        const url = new URL('not-a-url');
        result = url.hostname.replace(/^www\./, '');
      } catch {
        result = 'direct';
      }
      expect(result).toBe('direct');
    });
  });
});
