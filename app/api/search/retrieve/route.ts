import { NextResponse } from 'next/server';
import { searchPubMed } from '@/lib/search/pubmed';
import { searchEuropePMC } from '@/lib/search/europepmc';
import { searchOpenAlex } from '@/lib/search/openalex';
import { deduplicate } from '@/lib/search/dedup';
import type { SearchQueries, SearchStats } from '@/lib/search/types';

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { queries?: SearchQueries };
    const queries = body.queries;

    if (!queries || !queries.pubmed || !queries.europepmc || !queries.openalex) {
      return NextResponse.json(
        { error: 'Missing required field: queries (pubmed, europepmc, openalex)' },
        { status: 400 }
      );
    }

    // Run all three searches in parallel
    const [pubmedResults, europepmcResults, openalexResults] = await Promise.all([
      searchPubMed(queries.pubmed).catch((err: unknown) => {
        console.error('PubMed search error:', err);
        return [];
      }),
      searchEuropePMC(queries.europepmc).catch((err: unknown) => {
        console.error('Europe PMC search error:', err);
        return [];
      }),
      searchOpenAlex(queries.openalex).catch((err: unknown) => {
        console.error('OpenAlex search error:', err);
        return [];
      }),
    ]);

    const allRecords = [...pubmedResults, ...europepmcResults, ...openalexResults];

    const { unique: records, removed: duplicatesRemoved } = deduplicate(allRecords);

    const stats: SearchStats = {
      pubmedCount: pubmedResults.length,
      europepmcCount: europepmcResults.length,
      openalexCount: openalexResults.length,
      totalRaw: allRecords.length,
      duplicatesRemoved,
      finalCount: records.filter((r) => !r.isDuplicate).length,
    };

    return NextResponse.json({ records, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
