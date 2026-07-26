export interface NarrativeSection {
  id: 'background' | 'discussion';
  title: string;
  content: string;    // generated prose
  edited: boolean;    // true if user edited
}

export interface NarrativeDraft {
  sections: NarrativeSection[];
  generatedAt: string;   // ISO timestamp
  question: string;      // research question used
  studyCount: number;    // included studies used as context
}

export interface NarrativeState {
  enabled: boolean;      // per-project toggle
  draft: NarrativeDraft | null;
  generating: boolean;   // UI-only flag, don't persist
}
