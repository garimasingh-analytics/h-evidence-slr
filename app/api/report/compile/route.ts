import { NextRequest } from 'next/server';
import { generateDocx } from '@/lib/report/docx-generator';
import { formatReferenceList } from '@/lib/report/references';
import type { ManuscriptSection, PRISMAStats, IncludedStudy } from '@/lib/report/types';

export const maxDuration = 30;

interface CompileBody {
  title: string;
  sections: ManuscriptSection[];
  includedStudies: IncludedStudy[];
  stats: PRISMAStats;
  queries?: { pubmed: string; europepmc: string; openalex: string };
  criteria?: { inclusion: string; exclusion: string };
}

export async function POST(req: NextRequest) {
  let body: CompileBody;
  try {
    body = (await req.json()) as CompileBody;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { title, sections, includedStudies, stats, queries, criteria } = body;

  if (!title || !sections || !stats) {
    return new Response(JSON.stringify({ error: 'title, sections, and stats are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const references = formatReferenceList(includedStudies ?? []);

    const buffer = await generateDocx({
      title,
      sections,
      references,
      stats,
      queries: queries ?? null,
      criteria: criteria ?? null,
    });

    const safeTitle = (title ?? 'systematic_review')
      .slice(0, 40)
      .replace(/[^a-z0-9]/gi, '_');

    // Convert Node Buffer to ArrayBuffer for the Web Response API (BodyInit-compatible)
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;

    return new Response(arrayBuffer, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${safeTitle}_systematic_review.docx"`,
      },
    });
  } catch (err) {
    console.error('[compile] docx generation error:', err);
    return new Response(
      JSON.stringify({ error: 'Document generation failed', detail: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
