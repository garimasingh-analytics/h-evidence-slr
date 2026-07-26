export type ScreenDecision = 'include' | 'exclude' | 'flag';

export interface AIDecision {
  decision: ScreenDecision;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface ScreeningResult {
  recordId: string;
  passA: AIDecision;
  passB: AIDecision;
  agree: boolean;           // passA.decision === passB.decision
  consensusDecision: ScreenDecision | null;  // null if disagree
  humanDecision: ScreenDecision | null;      // null = awaiting human
  humanNote: string;
  screenedAt: string;       // ISO timestamp
  humanReviewedAt: string | null;
}

export interface ScreeningCriteria {
  inclusion: string;   // free text, multi-line
  exclusion: string;
}

export interface FewShotExample {
  title: string;
  abstract: string;
  decision: ScreenDecision;
  reason: string;
}

export interface CalibrationEntry {
  timestamp: string;
  correctionCount: number;  // how many corrections triggered this calibration
  examplesCount: number;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  type: 'screening_started' | 'screening_batch_complete' | 'human_decision' | 'calibration_update';
  details: Record<string, unknown>;
}

export interface ScreenState {
  criteria: ScreeningCriteria;
  results: Record<string, ScreeningResult>;  // keyed by recordId
  screeningProgress: number;   // index: next record to screen
  screeningComplete: boolean;
  kappa: number | null;
  calibrationExamples: FewShotExample[];
  humanCorrections: Array<{ result: ScreeningResult; originalConsensus: ScreenDecision | null }>;
  calibrationLog: CalibrationEntry[];
  auditLog: AuditEntry[];
}
