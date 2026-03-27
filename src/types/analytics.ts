// Analytics types

export interface PageView {
  postId: string;
  slug: string;
  timestamp: number;
  country?: string;
  city?: string;
  referer?: string;
  userAgent?: string;
}

export interface DailyStats {
  date: string; // YYYY-MM-DD
  pv: number;
  uv: number;
  topPosts: { postId: string; slug: string; views: number }[];
  countries: { code: string; count: number }[];
  referers: { source: string; count: number }[];
}

export interface AnalyticsOverview {
  totalPv: number;
  totalUv: number;
  todayPv: number;
  todayUv: number;
  yesterdayPv: number;
  yesterdayUv: number;
  pvTrend: number; // percentage change vs yesterday
  uvTrend: number;
  topPosts: { postId: string; slug: string; views: number }[];
  topCountries: { code: string; count: number }[];
  topReferers: { source: string; count: number }[];
  recentDays: { date: string; pv: number; uv: number }[];
}

export interface TimeSeriesPoint {
  timestamp: number;
  value: number;
}
