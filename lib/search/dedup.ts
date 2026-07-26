import type { SearchRecord } from './types';

const SOURCE_PRIORITY: Record<string, number> = {
  pubmed: 0,
  europepmc: 1,
  openalex: 2,
};

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'and', 'or', 'for', 'to', 'with', 'on',
  'at', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'that', 'this', 'it', 'its', 'as', 'not', 'but', 'if', 'into', 'through',
]);

function titleWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 0 && !STOP_WORDS.has(w))
  );
}

function titleSimilarity(a: string, b: string): number {
  const setA = titleWords(a);
  const setB = titleWords(b);
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

export function deduplicate(records: SearchRecord[]): {
  unique: SearchRecord[];
  removed: number;
} {
  // Work on a copy; sort by source priority so preferred sources come first
  const sorted = [...records].sort(
    (a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source]
  );

  // Mark all as not duplicate initially
  for (const r of sorted) {
    r.isDuplicate = false;
    r.duplicateOf = null;
  }

  // Step 1: DOI-based deduplication
  const doiMap = new Map<string, SearchRecord>();

  for (const record of sorted) {
    if (!record.doi) continue;
    if (doiMap.has(record.doi)) {
      // Already seen this DOI — mark this record as duplicate
      const kept = doiMap.get(record.doi)!;
      record.isDuplicate = true;
      record.duplicateOf = kept.id;
    } else {
      doiMap.set(record.doi, record);
    }
  }

  // Step 2: Title similarity for records without DOI (and not already marked)
  const noDOIRecords = sorted.filter(
    (r) => !r.doi && !r.isDuplicate
  );

  for (let i = 0; i < noDOIRecords.length; i++) {
    if (noDOIRecords[i].isDuplicate) continue;
    for (let j = i + 1; j < noDOIRecords.length; j++) {
      if (noDOIRecords[j].isDuplicate) continue;
      const sim = titleSimilarity(noDOIRecords[i].title, noDOIRecords[j].title);
      if (sim >= 0.85) {
        // Keep [i] (lower source priority = higher preference), mark [j] as duplicate
        noDOIRecords[j].isDuplicate = true;
        noDOIRecords[j].duplicateOf = noDOIRecords[i].id;
      }
    }
  }

  const removed = sorted.filter((r) => r.isDuplicate).length;

  return { unique: sorted, removed };
}
