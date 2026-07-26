import type { ScreeningResult, ScreenDecision } from './types';

export function computeKappa(results: ScreeningResult[]): number {
  const N = results.length;
  if (N === 0) return 0;

  const categories: ScreenDecision[] = ['include', 'exclude', 'flag'];

  // Proportion observed agreement
  const agreingCount = results.filter((r) => r.passA.decision === r.passB.decision).length;
  const Po = agreingCount / N;

  // Expected agreement by chance
  let Pe = 0;
  for (const c of categories) {
    const p1c = results.filter((r) => r.passA.decision === c).length / N;
    const p2c = results.filter((r) => r.passB.decision === c).length / N;
    Pe += p1c * p2c;
  }

  if (Pe >= 1) return 1;

  const kappa = (Po - Pe) / (1 - Pe);

  // Clamp to [-1, 1]
  return Math.max(-1, Math.min(1, kappa));
}

export function kappaLabel(k: number): string {
  if (k < 0) return 'Poor';
  if (k < 0.2) return 'Slight';
  if (k < 0.4) return 'Fair';
  if (k < 0.6) return 'Moderate';
  if (k < 0.8) return 'Substantial';
  return 'Almost perfect';
}

export function kappaColor(k: number): string {
  if (k < 0.2) return 'text-red-500';
  if (k < 0.4) return 'text-yellow-500';
  if (k < 0.6) return 'text-blue-500';
  return 'text-green-500';
}
