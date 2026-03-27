/**
 * Import progress tracker using KV namespace
 */

import type { ImportBatch, ImportProgress, ImportError } from '../types/migration';

const BATCH_PREFIX = 'import:batch:';
const PROGRESS_PREFIX = 'import:progress:';

export class ImportProgressTracker {
  constructor(private kv: KVNamespace) {}

  async createBatch(batch: ImportBatch): Promise<void> {
    await this.kv.put(
      BATCH_PREFIX + batch.id,
      JSON.stringify(batch),
      { expirationTtl: 86400 } // 24 hours
    );
  }

  async getBatch(batchId: string): Promise<ImportBatch | null> {
    const data = await this.kv.get(BATCH_PREFIX + batchId);
    return data ? JSON.parse(data) : null;
  }

  async updateProgress(
    batchId: string,
    updates: Partial<ImportBatch>
  ): Promise<ImportBatch | null> {
    const batch = await this.getBatch(batchId);
    if (!batch) return null;

    const updated: ImportBatch = {
      ...batch,
      ...updates,
    };

    await this.kv.put(
      BATCH_PREFIX + batchId,
      JSON.stringify(updated),
      { expirationTtl: 86400 }
    );

    return updated;
  }

  async recordProcessed(
    batchId: string,
    success: boolean,
    error?: ImportError
  ): Promise<void> {
    const batch = await this.getBatch(batchId);
    if (!batch) return;

    batch.processedItems++;
    if (success) {
      batch.successCount++;
    } else if (error) {
      batch.errorCount++;
      batch.errors.push(error);
    }

    if (
      batch.processedItems >= batch.totalItems &&
      batch.status === 'processing'
    ) {
      batch.status = batch.errorCount > 0 ? 'completed' : 'completed';
      batch.completedAt = Date.now();
    }

    await this.kv.put(
      BATCH_PREFIX + batchId,
      JSON.stringify(batch),
      { expirationTtl: 86400 }
    );
  }

  async setStatus(batchId: string, status: ImportBatch['status']): Promise<void> {
    const batch = await this.getBatch(batchId);
    if (!batch) return;
    batch.status = status;
    if (status === 'processing') {
      batch.startedAt = Date.now();
    }
    if (status === 'completed' || status === 'failed') {
      batch.completedAt = Date.now();
    }
    await this.kv.put(
      BATCH_PREFIX + batchId,
      JSON.stringify(batch),
      { expirationTtl: 86400 }
    );
  }

  async getProgress(batchId: string): Promise<ImportProgress | null> {
    const batch = await this.getBatch(batchId);
    if (!batch) return null;

    return {
      batchId: batch.id,
      status: batch.status,
      totalItems: batch.totalItems,
      processedItems: batch.processedItems,
      successCount: batch.successCount,
      errorCount: batch.errorCount,
      errors: batch.errors.slice(0, 10), // Return max 10 errors in progress
    };
  }

  async listBatches(limit = 20): Promise<ImportBatch[]> {
    const list = await this.kv.list({ prefix: BATCH_PREFIX, limit });
    const batches: ImportBatch[] = [];

    for (const key of list.keys) {
      const data = await this.kv.get(key.name);
      if (data) batches.push(JSON.parse(data));
    }

    return batches.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
