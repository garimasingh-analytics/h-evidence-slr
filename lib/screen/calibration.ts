import type { ScreenState, FewShotExample, ScreeningResult, ScreenDecision } from './types';

export const CALIBRATION_TRIGGER = 5;  // corrections before recalibrating
export const MAX_EXAMPLES = 5;         // max few-shot examples to inject

export function shouldCalibrate(corrections: ScreenState['humanCorrections']): boolean {
  return corrections.length > 0 && corrections.length % CALIBRATION_TRIGGER === 0;
}

export function selectCalibrationExamples(
  corrections: ScreenState['humanCorrections']
): FewShotExample[] {
  if (corrections.length === 0) return [];

  // Score each correction by informativeness
  type ScoredCorrection = {
    entry: ScreenState['humanCorrections'][number];
    score: number;
  };

  const scored: ScoredCorrection[] = corrections.map((entry, index) => {
    let score = index; // base: recency (higher index = more recent = higher base score)

    const { result, originalConsensus } = entry;
    const humanDecision = result.humanDecision as ScreenDecision;

    // Priority 1: AI was high confidence but human overrode — most surprising
    const aiWasHighConfidence =
      result.passA.confidence === 'high' && result.passB.confidence === 'high';
    const humanOverrode = humanDecision !== originalConsensus;
    if (aiWasHighConfidence && humanOverrode) {
      score += 1000;
    }

    // Priority 2: human chose include but AI consensus was exclude — hardest edge cases
    if (humanDecision === 'include' && originalConsensus === 'exclude') {
      score += 500;
    }

    return { entry, score };
  });

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  // Take top MAX_EXAMPLES
  return scored.slice(0, MAX_EXAMPLES).map(({ entry }) => {
    const { result } = entry;
    // We need the original record's title/abstract — they're stored on the result via recordId
    // The caller must have stored it; we'll use what we have on the result object.
    // Use humanNote if present, otherwise AI reason from the overridden pass.
    const reason =
      result.humanNote?.trim() ||
      result.passA.reason ||
      result.passB.reason ||
      '';

    return {
      title: (result as ScreeningResult & { title?: string }).title ?? result.recordId,
      abstract: (result as ScreeningResult & { abstract?: string }).abstract ?? '',
      decision: result.humanDecision as ScreenDecision,
      reason,
    };
  });
}
