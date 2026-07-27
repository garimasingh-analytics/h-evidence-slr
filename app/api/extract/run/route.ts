import { NextResponse } from 'next/server';
import { callModel } from '@/lib/model';
import type { ExtractionResponse } from '@/lib/extract/types';

export const maxDuration = 300;

interface RequestBody {
  pdfText?: string;
  prompts?: string[];
  pdfName?: string;
}

function buildPrompt(prompts: string[], pdfText: string): string {
  const MAX_CHARS = 12000;
  let truncated = pdfText;
  let truncationNote = '';
  if (pdfText.length > MAX_CHARS) {
    truncated = pdfText.slice(0, MAX_CHARS);
    truncationNote =
      '\n\n[Note: The paper text was truncated to 12,000 characters due to length. Some information may be beyond the cut-off.]';
  }

  const questionLines = prompts
    .map((p, i) => `${i + 1}. ${p}`)
    .join('\n');

  return `Extract answers to the following questions from this research paper.

For EACH question, return:
- prompt: the exact question text
- response: concise accurate answer (or "Not reported" if not found)
- source: the exact verbatim sentence/phrase from the paper where you found the answer (empty string if not reported)
- page: the page number (look for [PAGE N] markers in the text) as a string (empty string if not reported)

Return ONLY a JSON object: {"responses": [...]}

Questions:
${questionLines}

Research paper text:
${truncated}${truncationNote}`;
}

function fallbackResponses(prompts: string[]): ExtractionResponse[] {
  return prompts.map((p) => ({
    prompt: p,
    response: 'Extraction failed — please review manually',
    source: '',
    page: '',
    edited: false,
  }));
}

function validateAndNormalise(
  raw: unknown,
  prompts: string[]
): ExtractionResponse[] {
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !Array.isArray((raw as Record<string, unknown>).responses)
  ) {
    return fallbackResponses(prompts);
  }

  const items = (raw as { responses: unknown[] }).responses;
  const out: ExtractionResponse[] = [];

  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    if (
      typeof obj.prompt !== 'string' ||
      typeof obj.response !== 'string' ||
      typeof obj.source !== 'string' ||
      typeof obj.page !== 'string'
    ) {
      continue;
    }
    // Normalise page: strip [PAGE N] format the model sometimes echoes back
    const rawPage = String(obj.page);
    const pageMatch = rawPage.match(/\[?PAGE\s*(\d+)\]?/i);
    const page = pageMatch ? pageMatch[1] : rawPage.replace(/[^\d]/g, '') || rawPage;

    out.push({
      prompt: obj.prompt,
      response: obj.response,
      source: obj.source,
      page,
      edited: false,
    });
  }

  // If the model returned fewer items than prompts, pad with fallback
  if (out.length < prompts.length) {
    const coveredPrompts = new Set(out.map((r) => r.prompt));
    for (const p of prompts) {
      if (!coveredPrompts.has(p)) {
        out.push({
          prompt: p,
          response: 'Extraction failed — please review manually',
          source: '',
          page: '',
          edited: false,
        });
      }
    }
  }

  return out;
}

export async function POST(request: Request) {
  let body: RequestBody;

  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { pdfText, prompts, pdfName } = body;

  if (!pdfText || typeof pdfText !== 'string') {
    return NextResponse.json(
      { error: 'Missing required field: pdfText' },
      { status: 400 }
    );
  }
  if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
    return NextResponse.json(
      { error: 'Missing or empty required field: prompts' },
      { status: 400 }
    );
  }
  if (!pdfName || typeof pdfName !== 'string') {
    return NextResponse.json(
      { error: 'Missing required field: pdfName' },
      { status: 400 }
    );
  }

  const systemPrompt =
    'You are an expert systematic review data extractor. Extract information precisely from the provided research paper. Never fabricate information — respond with "Not reported" if not found.';

  const userPrompt = buildPrompt(prompts, pdfText);

  try {
    const raw = await callModel(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      // A coding form normally needs far less than 4,096 output tokens. Keeping
      // the response bounded makes laptop-hosted Ollama substantially faster.
      {
        json: true,
        temperature: 0.1,
        maxTokens: Math.min(2400, Math.max(800, prompts.length * 220)),
        model: process.env.OLLAMA_FAST_MODEL ?? 'qwen2.5:3b',
      }
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Sometimes the model wraps JSON in markdown fences — try to strip them
      const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        try {
          parsed = JSON.parse(match[1]);
        } catch {
          parsed = null;
        }
      } else {
        parsed = null;
      }
    }

    const responses = validateAndNormalise(parsed, prompts);
    return NextResponse.json({ responses, pdfName });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Extraction error:', message);
    // Return graceful fallback so the UI can still display the results
    return NextResponse.json({
      responses: fallbackResponses(prompts),
      pdfName,
      error: message,
    });
  }
}
