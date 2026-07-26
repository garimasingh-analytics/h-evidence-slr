import { NextResponse } from 'next/server';
import { screenBatch } from '@/lib/screen/screener';
import type { ScreeningCriteria, FewShotExample, ScreeningResult } from '@/lib/screen/types';

export const maxDuration = 300;

const MODEL_CHUNK_SIZE = 3; // qwen2.5:14b handles ~3 records per call reliably

interface RequestBody {
  records?: Array<{ id: string; title: string; abstract: string }>;
  criteria?: ScreeningCriteria;
  calibrationExamples?: FewShotExample[];
}

export async function POST(request: Request) {
  let body: RequestBody;

  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { records, criteria, calibrationExamples = [] } = body;

  if (!records || !Array.isArray(records) || records.length === 0) {
    return NextResponse.json(
      { error: 'Missing or empty required field: records' },
      { status: 400 }
    );
  }

  if (!criteria || !criteria.inclusion || !criteria.exclusion) {
    return NextResponse.json(
      { error: 'Missing required field: criteria (inclusion, exclusion)' },
      { status: 400 }
    );
  }

  try {
    // Process in small chunks to stay within model timeout, running A+B in parallel per chunk
    const decisionsA: Record<string, import('@/lib/screen/types').AIDecision> = {};
    const decisionsB: Record<string, import('@/lib/screen/types').AIDecision> = {};

    for (let i = 0; i < records.length; i += MODEL_CHUNK_SIZE) {
      const chunk = records.slice(i, i + MODEL_CHUNK_SIZE);
      const [chunkA, chunkB] = await Promise.all([
        screenBatch(chunk, criteria, 'A', calibrationExamples),
        screenBatch(chunk, criteria, 'B', calibrationExamples),
      ]);
      Object.assign(decisionsA, chunkA);
      Object.assign(decisionsB, chunkB);
    }

    const now = new Date().toISOString();

    const results: ScreeningResult[] = records.map((record) => {
      const passA = decisionsA[record.id] ?? {
        decision: 'flag' as const,
        reason: 'No decision returned.',
        confidence: 'low' as const,
      };
      const passB = decisionsB[record.id] ?? {
        decision: 'flag' as const,
        reason: 'No decision returned.',
        confidence: 'low' as const,
      };

      const agree = passA.decision === passB.decision;
      const consensusDecision = agree ? passA.decision : null;

      return {
        recordId: record.id,
        passA,
        passB,
        agree,
        consensusDecision,
        humanDecision: null,
        humanNote: '',
        screenedAt: now,
        humanReviewedAt: null,
      };
    });

    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Screening error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
