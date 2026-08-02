import { callModel } from '@/lib/model';
import type { AIDecision, ScreeningCriteria, FewShotExample, ScreenDecision } from './types';

const SYSTEM_PROMPT_A = `You are Reviewer A, an expert systematic review screener with a focus on study methodology.
Screen each paper against the provided criteria. Return ONLY a JSON array, no other text.`;

const SYSTEM_PROMPT_B = `You are Reviewer B, an expert systematic review screener with a focus on clinical relevance and topic scope.
Screen each paper against the provided criteria. Return ONLY a JSON array, no other text.`;

function buildUserPrompt(
  records: Array<{ id: string; title: string; abstract: string }>,
  criteria: ScreeningCriteria,
  calibrationExamples: FewShotExample[]
): string {
  const lines: string[] = [];

  lines.push('Inclusion criteria:');
  lines.push(criteria.inclusion);
  lines.push('');
  lines.push('Exclusion criteria:');
  lines.push(criteria.exclusion);
  lines.push('');

  if (calibrationExamples.length > 0) {
    lines.push('Examples from reviewer corrections (apply the same logic):');
    for (const ex of calibrationExamples) {
      lines.push(`Title: ${ex.title}`);
      lines.push(`Abstract: ${ex.abstract}`);
      lines.push(`Decision: ${ex.decision}`);
      lines.push(`Reason: ${ex.reason}`);
      lines.push('');
    }
  }

  lines.push('Screen these papers. For each, return:');
  lines.push('- id: the paper ID exactly as given');
  lines.push('- decision: "include", "exclude", or "flag" (flag if uncertain or partially meets criteria)');
  lines.push('- reason: 1-2 sentence explanation referencing the criteria');
  lines.push('- confidence: "high", "medium", or "low"');
  lines.push('');
  lines.push('Return a JSON array: [{"id":"...","decision":"...","reason":"...","confidence":"..."}]');
  lines.push('');
  lines.push('Papers to screen:');

  for (const record of records) {
    lines.push(`ID: ${record.id}`);
    lines.push(`Title: ${record.title}`);
    lines.push(`Abstract: ${record.abstract.slice(0, 500)}`);
    lines.push('---');
  }

  return lines.join('\n');
}

interface RawDecision {
  id: string;
  decision: string;
  reason: string;
  confidence: string;
}

function parseResponse(
  raw: string,
  records: Array<{ id: string; title: string; abstract: string }>
): Record<string, AIDecision> {
  const fallback = (): Record<string, AIDecision> => {
    const result: Record<string, AIDecision> = {};
    for (const r of records) {
      result[r.id] = { decision: 'flag', reason: 'Parsing failed — flagged for human review.', confidence: 'low' };
    }
    return result;
  };

  // Strip markdown code fences if present
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let parsed: RawDecision[] | null = null;

  // First try direct JSON.parse
  try {
    parsed = JSON.parse(text) as RawDecision[];
  } catch {
    // Try to extract JSON array with regex
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]) as RawDecision[];
      } catch {
        // Parsing failed entirely
        console.error('Failed to parse screening response:', text.slice(0, 200));
        return fallback();
      }
    } else {
      console.error('No JSON array found in screening response:', text.slice(0, 200));
      return fallback();
    }
  }

  if (!Array.isArray(parsed)) {
    return fallback();
  }

  const result: Record<string, AIDecision> = {};
  const validDecisions = new Set(['include', 'exclude', 'flag']);
  const validConfidences = new Set(['high', 'medium', 'low']);

  for (const item of parsed) {
    if (!item.id) continue;
    const decision: ScreenDecision = validDecisions.has(item.decision) ? (item.decision as ScreenDecision) : 'flag';
    const confidence = validConfidences.has(item.confidence) ? (item.confidence as 'high' | 'medium' | 'low') : 'low';
    result[item.id] = {
      decision,
      reason: item.reason ?? '',
      confidence,
    };
  }

  // Fill any missing records with fallback
  for (const r of records) {
    if (!result[r.id]) {
      result[r.id] = { decision: 'flag', reason: 'No decision returned — flagged for human review.', confidence: 'low' };
    }
  }

  return result;
}

export async function screenBatch(
  records: Array<{ id: string; title: string; abstract: string }>,
  criteria: ScreeningCriteria,
  pass: 'A' | 'B',
  calibrationExamples: FewShotExample[]
): Promise<Record<string, AIDecision>> {
  const systemPrompt = pass === 'A' ? SYSTEM_PROMPT_A : SYSTEM_PROMPT_B;
  const temperature = pass === 'A' ? 0.2 : 0.35;

  const userPrompt = buildUserPrompt(records, criteria, calibrationExamples);

  const raw = await callModel(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    {
      json: true,
      temperature,
      model: process.env.OLLAMA_FAST_MODEL ?? 'qwen2.5:3b',
      groqModel: process.env.GROQ_FAST_MODEL ?? 'qwen/qwen3.6-27b',
    }
  );

  return parseResponse(raw, records);
}
