import { NextRequest, NextResponse } from 'next/server';
import { callModel } from '@/lib/model';
import type { NarrativeSection } from '@/lib/narrative/types';

export const maxDuration = 180;

interface IncludedStudy {
  title: string;
  authors: string[];
  year: number | null;
  abstract: string;
  journal: string | null;
}

interface GenerateRequestBody {
  question: string;
  includedStudies: IncludedStudy[];
  extractionSummary: string;
}

function formatStudyList(studies: IncludedStudy[]): string {
  return studies
    .slice(0, 20)
    .map((s) => {
      const firstAuthor = s.authors[0] ?? 'Unknown';
      const year = s.year ?? 'n.d.';
      const abstractSnippet = s.abstract ? s.abstract.slice(0, 200) : '';
      return `- ${firstAuthor} et al. (${year}): ${s.title}. ${abstractSnippet}`;
    })
    .join('\n');
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: GenerateRequestBody;
  try {
    body = (await req.json()) as GenerateRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { question, includedStudies, extractionSummary } = body;

  if (!question || typeof question !== 'string' || question.trim() === '') {
    return NextResponse.json({ error: 'Missing or empty "question" field' }, { status: 400 });
  }
  if (!Array.isArray(includedStudies)) {
    return NextResponse.json({ error: '"includedStudies" must be an array' }, { status: 400 });
  }

  const systemPrompt =
    'You are an expert academic writer specialising in systematic review manuscripts. ' +
    'Write in formal academic English. Use inline citations in (Author, Year) format ' +
    'referencing the provided studies.';

  const studyList = formatStudyList(includedStudies);
  const N = includedStudies.length;

  // ── Background call ────────────────────────────────────────────────────────
  const backgroundUserPrompt = `Research question: ${question}

Available studies (${N} included):
${studyList}

Write a Background section (3 paragraphs) for a systematic review on this topic:
1. Context — scope, prevalence, and clinical/practical relevance of the topic
2. Current evidence — what is known, referencing the listed studies by (Author, Year)
3. Rationale — knowledge gaps and justification for this review

Return ONLY the prose text, no headings, no markdown, no JSON.`;

  let backgroundContent: string;
  try {
    backgroundContent = await callModel(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: backgroundUserPrompt },
      ],
      { temperature: 0.4, maxTokens: 800 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Background generation failed: ${msg}` },
      { status: 502 }
    );
  }

  // ── Discussion call ────────────────────────────────────────────────────────
  const discussionUserPrompt = `Research question: ${question}

Extraction summary from ${N} included studies:
${extractionSummary}

Write a Discussion section (3 paragraphs) for a systematic review on this topic:
1. Summary of findings — what the evidence shows across the included studies
2. Comparison with existing literature — implications and consistency with prior work
3. Limitations and future research — limitations of the included studies, gaps to address

Return ONLY the prose text, no headings, no markdown, no JSON.`;

  let discussionContent: string;
  try {
    discussionContent = await callModel(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: discussionUserPrompt },
      ],
      { temperature: 0.4, maxTokens: 800 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Discussion generation failed: ${msg}` },
      { status: 502 }
    );
  }

  const sections: NarrativeSection[] = [
    {
      id: 'background',
      title: 'Background',
      content: backgroundContent.trim(),
      edited: false,
    },
    {
      id: 'discussion',
      title: 'Discussion',
      content: discussionContent.trim(),
      edited: false,
    },
  ];

  return NextResponse.json({ sections, studyCount: N });
}
