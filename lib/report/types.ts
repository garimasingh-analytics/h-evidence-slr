export interface PRISMAStats {
  pubmedCount: number;
  europepmcCount: number;
  openalexCount: number;
  totalIdentified: number;
  duplicatesRemoved: number;
  recordsScreened: number;
  recordsExcluded: number;        // excluded after AI+human screening
  recordsIncluded: number;        // final included count
  exclusionReasons: Record<string, number>; // reason → count (from AI reasons)
}

export interface ManuscriptSection {
  id: string;
  title: string;
  content: string;
  edited: boolean;
}

export interface ChecklistItem {
  number: number;         // 1-27
  section: string;        // e.g. "TITLE", "METHODS"
  item: string;           // short label
  description: string;    // full PRISMA description
  status: 'met' | 'partial' | 'missing' | 'pending';
  note: string;           // auditor's note
}

export interface ReportState {
  sections: ManuscriptSection[];
  checklist: ChecklistItem[];
  generating: boolean;
  auditComplete: boolean;
  generatedAt: string | null;
}

export interface IncludedStudy {
  title: string;
  authors: string[];
  year: number | null;
  journal: string | null;
  doi: string | null;
  abstract: string;
  source: string;
}
