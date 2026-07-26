import { NextResponse } from 'next/server';
import { callModel } from '@/lib/model';
import { searchPubMed } from '@/lib/search/pubmed';

export const maxDuration = 30;

function extractJSON(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1);
  }
  return text;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { question?: string };
    const question = body.question?.trim();

    if (!question) {
      return NextResponse.json(
        { error: 'Missing required field: question' },
        { status: 400 }
      );
    }

    // Step 1: Extract key terms
    const termsResult = await callModel(
      [
        {
          role: 'system',
          content:
            'You are a systematic review expert. Extract the most important search terms from a research question. Respond with ONLY valid JSON.',
        },
        {
          role: 'user',
          content: `Extract 3-5 key search terms from this research question for finding existing systematic reviews.

Research question: "${question}"

Respond with ONLY a valid JSON object:
{"keyTerms": ["term1", "term2", "term3"]}`,
        },
      ],
      { temperature: 0.1, json: true }
    );

    let keyTerms: string[] = [];
    try {
      const parsed = JSON.parse(extractJSON(termsResult)) as {
        keyTerms?: unknown;
      };
      if (Array.isArray(parsed.keyTerms)) {
        keyTerms = parsed.keyTerms.filter((t): t is string => typeof t === 'string');
      }
    } catch {
      // Fallback: just use some words from the question
      keyTerms = question
        .split(/\s+/)
        .filter((w) => w.length > 4)
        .slice(0, 4);
    }

    if (keyTerms.length === 0) {
      keyTerms = question.split(/\s+/).slice(0, 4);
    }

    // Step 2: Build PubMed query for systematic reviews
    const termsQuery = keyTerms
      .map((t) => `"${t}"[tiab]`)
      .join(' AND ');
    const pubmedQuery =
      `(${termsQuery}) AND ("systematic review"[pt] OR "meta-analysis"[pt] OR ` +
      `"systematic review"[tiab] OR "meta-analysis"[tiab]) AND ` +
      `("2014/01/01"[PDat]:"3000"[PDat])`;

    // Step 3: Search PubMed
    const reviews = await searchPubMed(pubmedQuery, 10);

    // Step 4: Generate summary
    const reviewTitles =
      reviews.length > 0
        ? reviews
            .slice(0, 5)
            .map((r, i) => `${i + 1}. "${r.title}" (${r.year ?? 'n.d.'})`)
            .join('\n')
        : 'No systematic reviews found.';

    const summaryResult = await callModel(
      [
        {
          role: 'system',
          content:
            'You are a systematic review expert. Provide a brief, helpful summary about existing evidence.',
        },
        {
          role: 'user',
          content: `Research question: "${question}"

Existing systematic reviews found on PubMed:
${reviewTitles}

Write a 2-3 sentence summary of what this finding means for the proposed review — specifically whether existing reviews mean the planned review might be redundant, or whether there are gaps that justify a new review. Be direct and concise.`,
        },
      ],
      { temperature: 0.3 }
    );

    return NextResponse.json({
      reviews: reviews.filter((r) => !r.isDuplicate),
      summary: summaryResult.trim(),
      keyTerms,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
