import { NextRequest, NextResponse } from 'next/server';
import { callModel } from '@/lib/model';
import { PRISMA_CHECKLIST } from '@/lib/report/checklist-items';
import type { ChecklistItem } from '@/lib/report/types';

export const maxDuration = 300;

interface AuditBody {
  manuscriptText: string;
}

export async function POST(req: NextRequest) {
  let body: AuditBody;
  try {
    body = (await req.json()) as AuditBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { manuscriptText } = body;
  if (!manuscriptText?.trim()) {
    return NextResponse.json({ error: 'manuscriptText is required' }, { status: 400 });
  }

  const checklistText = PRISMA_CHECKLIST.map(
    (item) => `${item.number}. [${item.section}] ${item.item}: ${item.description}`
  ).join('\n');

  const prompt = `You are a PRISMA 2020 systematic review auditor. Evaluate whether each PRISMA checklist item is clearly addressed in the provided manuscript excerpt.

PRISMA 2020 Checklist (27 items):
${checklistText}

---
MANUSCRIPT:
${manuscriptText.slice(0, 12000)}
---

For each of the 27 items, output a JSON array with one object per item in this exact format:
[{"number": 1, "status": "met", "note": "Brief explanation"},
 {"number": 2, "status": "partial", "note": "Abstract present but missing synthesis methods"},
 ...]

Status values: "met" = clearly and fully addressed, "partial" = mentioned but incomplete, "missing" = not addressed at all.
Return ONLY the JSON array, no other text.`;

  let auditResults: Array<{ number: number; status: string; note: string }> = [];

  try {
    const raw = await callModel(
      [
        {
          role: 'system',
          content:
            'You are a PRISMA 2020 systematic review auditor. Evaluate whether each PRISMA checklist item is addressed in the provided manuscript.',
        },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.1, json: true, maxTokens: 3000 }
    );

    // Parse — model might wrap in markdown fences
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      auditResults = parsed as Array<{ number: number; status: string; note: string }>;
    }
  } catch {
    // If model fails or returns malformed JSON, return all as 'pending'
    const checklist: ChecklistItem[] = PRISMA_CHECKLIST.map((item) => ({
      ...item,
      status: 'pending' as const,
      note: 'Audit could not be completed — model returned invalid output.',
    }));
    return NextResponse.json({ checklist });
  }

  // Merge model output with static definitions
  const auditMap = new Map(auditResults.map((r) => [r.number, r]));

  const checklist: ChecklistItem[] = PRISMA_CHECKLIST.map((item) => {
    const result = auditMap.get(item.number);
    const rawStatus = result?.status ?? 'pending';
    const status: ChecklistItem['status'] =
      rawStatus === 'met' || rawStatus === 'partial' || rawStatus === 'missing'
        ? rawStatus
        : 'pending';
    return {
      ...item,
      status,
      note: result?.note ?? '',
    };
  });

  return NextResponse.json({ checklist });
}
