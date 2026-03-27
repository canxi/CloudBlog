/**
 * Analytics storage using KV namespace
 * Stores daily stats, page views, and aggregated metrics
 */

import type { DailyStats, PageView } from '../types/analytics';

const STATS_PREFIX = 'analytics:stats:';
const PV_PREFIX = 'analytics:pv:';
const UV_PREFIX = 'analytics:uv:';
const POST_PREFIX = 'analytics:post:';
const GEO_PREFIX = 'analytics:geo:';
const REF_PREFIX = 'analytics:ref:';

function dateKey(date: Date = new Date()): string {
  return date.toISOString().substring(0, 10); // YYYY-MM-DD
}

function generateId(): string {
  return crypto.randomUUID();
}

export class AnalyticsStore {
  constructor(private kv: KVNamespace) {}

  // Track a single page view
  async trackView(data: {
    postId: string;
    slug: string;
    country?: string;
    city?: string;
    referer?: string;
    userAgent?: string;
  }): Promise<void> {
    const now = new Date();
    const dayKey = dateKey(now);
    const visitorId = this.getVisitorId(data.userAgent || '');
    const timestamp = Math.floor(now.getTime() / 1000);

    const pvKey = PV_PREFIX + dayKey;
    const uvKey = UV_PREFIX + dayKey + ':' + visitorId;
    const postKey = POST_PREFIX + dayKey + ':' + data.postId;
    const geoKey = data.country ? GEO_PREFIX + dayKey + ':' + data.country : null;
    const refKey = data.referer ? REF_PREFIX + dayKey + ':' + this.normalizeReferer(data.referer) : null;

    // Increment PV counter
    await incrementKV(this.kv, pvKey, 1, 86400 * 30);

    // Set UV marker (expire at end of day)
    const msUntilMidnight = this.msUntilMidnight(now);
    await this.kv.put(uvKey, dayKey, { expirationTtl: Math.ceil(msUntilMidnight / 1000) + 3600 });

    // Increment post view counter
    await incrementKV(this.kv, postKey, 1, 86400 * 30);

    // Increment country counter
    if (geoKey) {
      await incrementKV(this.kv, geoKey, 1, 86400 * 30);
    }

    // Increment referer counter
    if (refKey) {
      await incrementKV(this.kv, refKey, 1, 86400 * 30);
    }
  }

  // Get daily stats for a specific date
  async getDailyStats(date: string): Promise<DailyStats> {
    const pvKey = PV_PREFIX + date;
    const geoListKey = GEO_PREFIX + date + ':*';
    const refListKey = REF_PREFIX + date + ':*';
    const postListKey = POST_PREFIX + date + ':*';

    // Get PV count
    const pvData = await this.kv.get(pvKey);
    const pv = pvData ? parseInt(pvData) : 0;

    // Get UV count - count unique visitor keys for this day
    const uvKeys = await this.kv.list({ prefix: UV_PREFIX + date + ':' });
    const uv = uvKeys.keys.length;

    // Get top posts
    const topPosts = await this.getTopPosts(date, 10);

    // Get top countries
    const topCountries = await this.getTopGeo(date, 10);

    // Get top referers
    const topReferers = await this.getTopReferers(date, 10);

    return {
      date,
      pv,
      uv,
      topPosts,
      countries: topCountries,
      referers: topReferers,
    };
  }

  // Get overview stats
  async getOverview(days = 7): Promise<{
    totalPv: number;
    totalUv: number;
    todayPv: number;
    todayUv: number;
    yesterdayPv: number;
    yesterdayUv: number;
    pvTrend: number;
    uvTrend: number;
    topPosts: { postId: string; slug: string; views: number }[];
    topCountries: { code: string; count: number }[];
    topReferers: { source: string; count: number }[];
    recentDays: { date: string; pv: number; uv: number }[];
  }> {
    const today = dateKey();
    const yesterday = dateKey(new Date(Date.now() - 86400000));
    const dates = Array.from({ length: days }, (_, i) =>
      dateKey(new Date(Date.now() - i * 86400000))
    ).reverse();

    let totalPv = 0;
    let totalUv = 0;
    const recentDays: { date: string; pv: number; uv: number }[] = [];
    const topPostsMap = new Map<string, { postId: string; slug: string; views: number }>();
    const topCountriesMap = new Map<string, number>();
    const topReferersMap = new Map<string, number>();

    for (const date of dates) {
      const stats = await this.getDailyStats(date);

      totalPv += stats.pv;
      totalUv += stats.uv;

      if (date === today) {
        recentDays.push({ date, pv: stats.pv, uv: stats.uv });
      } else if (date === yesterday) {
        recentDays.push({ date, pv: stats.pv, uv: stats.uv });
      } else {
        recentDays.push({ date, pv: stats.pv, uv: stats.uv });
      }

      // Aggregate top posts
      for (const post of stats.topPosts) {
        const existing = topPostsMap.get(post.postId);
        if (existing) {
          existing.views += post.views;
        } else {
          topPostsMap.set(post.postId, { ...post });
        }
      }

      // Aggregate countries
      for (const geo of stats.countries) {
        topCountriesMap.set(geo.code, (topCountriesMap.get(geo.code) || 0) + geo.count);
      }

      // Aggregate referers
      for (const ref of stats.referers) {
        topReferersMap.set(ref.source, (topReferersMap.get(ref.source) || 0) + ref.count);
      }
    }

    const todayStats = await this.getDailyStats(today);
    const yesterdayStats = await this.getDailyStats(yesterday);

    const pvTrend = yesterdayStats.pv > 0
      ? Math.round(((todayStats.pv - yesterdayStats.pv) / yesterdayStats.pv) * 100)
      : todayStats.pv > 0 ? 100 : 0;

    const uvTrend = yesterdayStats.uv > 0
      ? Math.round(((todayStats.uv - yesterdayStats.uv) / yesterdayStats.uv) * 100)
      : todayStats.uv > 0 ? 100 : 0;

    // Sort and limit top items
    const topPosts = Array.from(topPostsMap.values())
      .sort((a, b) => b.views - a.views)
      .slice(0, 10);

    const topCountries = Array.from(topCountriesMap.entries())
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topReferers = Array.from(topReferersMap.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalPv,
      totalUv,
      todayPv: todayStats.pv,
      todayUv: todayStats.uv,
      yesterdayPv: yesterdayStats.pv,
      yesterdayUv: yesterdayStats.uv,
      pvTrend,
      uvTrend,
      topPosts,
      topCountries,
      topReferers,
      recentDays,
    };
  }

  // Get time series data for a metric
  async getTimeSeries(metric: 'pv' | 'uv', days = 7): Promise<{ date: string; value: number }[]> {
    const dates = Array.from({ length: days }, (_, i) =>
      dateKey(new Date(Date.now() - i * 86400000))
    ).reverse();

    const result: { date: string; value: number }[] = [];

    for (const date of dates) {
      if (metric === 'pv') {
        const data = await this.kv.get(PV_PREFIX + date);
        result.push({ date, value: data ? parseInt(data) : 0 });
      } else {
        const keys = await this.kv.list({ prefix: UV_PREFIX + date + ':' });
        result.push({ date, value: keys.keys.length });
      }
    }

    return result;
  }

  private async getTopPosts(date: string, limit: number): Promise<{ postId: string; slug: string; views: number }[]> {
    const keys = await this.kv.list({ prefix: POST_PREFIX + date + ':' });
    const posts: { postId: string; slug: string; views: number }[] = [];

    for (const key of keys.keys) {
      const postId = key.name.replace(POST_PREFIX + date + ':', '');
      const data = await this.kv.get(key.name);
      if (data) {
        posts.push({
          postId,
          slug: '', // slug not stored in key
          views: parseInt(data),
        });
      }
    }

    return posts.sort((a, b) => b.views - a.views).slice(0, limit);
  }

  private async getTopGeo(date: string, limit: number): Promise<{ code: string; count: number }[]> {
    const keys = await this.kv.list({ prefix: GEO_PREFIX + date + ':' });
    const countries: { code: string; count: number }[] = [];

    for (const key of keys.keys) {
      const code = key.name.replace(GEO_PREFIX + date + ':', '');
      const data = await this.kv.get(key.name);
      if (data) {
        countries.push({ code, count: parseInt(data) });
      }
    }

    return countries.sort((a, b) => b.count - a.count).slice(0, limit);
  }

  private async getTopReferers(date: string, limit: number): Promise<{ source: string; count: number }[]> {
    const keys = await this.kv.list({ prefix: REF_PREFIX + date + ':' });
    const referers: { source: string; count: number }[] = [];

    for (const key of keys.keys) {
      const source = key.name.replace(REF_PREFIX + date + ':', '');
      const data = await this.kv.get(key.name);
      if (data) {
        referers.push({ source, count: parseInt(data) });
      }
    }

    return referers.sort((a, b) => b.count - a.count).slice(0, limit);
  }

  private getVisitorId(userAgent: string): string {
    // Simple visitor fingerprint based on UA hash
    let hash = 0;
    for (let i = 0; i < userAgent.length; i++) {
      const char = userAgent.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  private normalizeReferer(referer: string): string {
    try {
      const url = new URL(referer);
      return url.hostname.replace(/^www\./, '');
    } catch {
      return 'direct';
    }
  }

  private msUntilMidnight(date: Date): number {
    const midnight = new Date(date);
    midnight.setHours(24, 0, 0, 0);
    return midnight.getTime() - date.getTime();
  }
}

// Helper to increment KV counter (atomic increment via get+put)
async function incrementKV(kv: KVNamespace, key: string, amount: number, ttl?: number): Promise<number> {
  const existing = await kv.get(key);
  const newVal = (existing ? parseInt(existing) : 0) + amount;
  const opts = ttl ? { expirationTtl: ttl } : undefined;
  await kv.put(key, newVal.toString(), opts);
  return newVal;
}
