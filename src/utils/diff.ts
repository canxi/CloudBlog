/**
 * Simple line-by-line diff utility
 * Returns HTML with diff highlighting
 */

export interface DiffLine {
  type: 'unchanged' | 'added' | 'removed';
  content: string;
  lineNum?: number;
}

export interface DiffResult {
  lines: DiffLine[];
  addedCount: number;
  removedCount: number;
}

export function computeDiff(oldText: string, newText: string): DiffResult {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Simple LCS-based diff
  const lcs = longestCommonSubsequence(oldLines, newLines);
  const result: DiffLine[] = [];
  let addedCount = 0;
  let removedCount = 0;

  let oldIdx = 0;
  let newIdx = 0;
  let lcsIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (lcsIdx < lcs.length && oldIdx < oldLines.length && oldLines[oldIdx] === lcs[lcsIdx]) {
      if (newIdx < newLines.length && newLines[newIdx] === lcs[lcsIdx]) {
        // Both match LCS
        result.push({ type: 'unchanged', content: oldLines[oldIdx] });
        oldIdx++;
        newIdx++;
        lcsIdx++;
      } else {
        // Added in new
        result.push({ type: 'added', content: newLines[newIdx] });
        addedCount++;
        newIdx++;
      }
    } else if (oldIdx < oldLines.length) {
      // Removed from old
      result.push({ type: 'removed', content: oldLines[oldIdx] });
      removedCount++;
      oldIdx++;
    } else if (newIdx < newLines.length) {
      // Added in new
      result.push({ type: 'added', content: newLines[newIdx] });
      addedCount++;
      newIdx++;
    }
  }

  return { lines: result, addedCount, removedCount };
}

function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find LCS
  const lcs: string[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}

export function diffToHtml(diff: DiffResult): string {
  return diff.lines.map(line => {
    const escaped = escapeHtml(line.content);
    if (line.type === 'added') {
      return `<div class="diff-line diff-added">+ ${escaped}</div>`;
    } else if (line.type === 'removed') {
      return `<div class="diff-line diff-removed">- ${escaped}</div>`;
    } else {
      return `<div class="diff-line">  ${escaped}</div>`;
    }
  }).join('\n');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
