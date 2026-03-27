// Migration types

export interface WordPressPost {
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  publishedAt: number; // unix timestamp
  categories: string[];
  tags: string[];
  featuredImage?: string;
  authorName?: string;
  authorEmail?: string;
  status: 'draft' | 'published';
}

export interface MarkdownPost {
  title: string;
  slug: string;
  content: string;
  excerpt?: string;
  coverImage?: string;
  categories: string[];
  tags: string[];
  publishedAt?: number;
  authorName?: string;
}

export interface ImportBatch {
  id: string;
  type: 'wordpress' | 'markdown';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  totalItems: number;
  processedItems: number;
  successCount: number;
  errorCount: number;
  errors: ImportError[];
  startedAt: number;
  completedAt?: number;
  createdBy: string;
  createdAt: string;
}

export interface ImportError {
  itemIndex: number;
  itemTitle: string;
  error: string;
}

export interface ImportProgress {
  batchId: string;
  status: ImportBatch['status'];
  totalItems: number;
  processedItems: number;
  successCount: number;
  errorCount: number;
  currentItem?: string;
  errors: ImportError[];
}
