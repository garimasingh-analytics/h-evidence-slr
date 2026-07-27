import { NextResponse } from 'next/server';
import { generatePICO, generateQueries } from '@/lib/search/pico';

export const maxDuration = 300

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

    const pico = await generatePICO(question);
    const queries = await generateQueries(pico, question);

    return NextResponse.json({ pico, queries });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
