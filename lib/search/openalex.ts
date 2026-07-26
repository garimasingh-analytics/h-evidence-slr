import type { SearchRecord } from './types';

function normalizeDOI(doi: string | null | undefined): string | null {
  if (!doi) return null;
  return doi
    .toLowerCase()
    .replace(/^https?:\/\/doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .trim() || null;
}

function reconstructAbstract(
  invIndex: Record<string, number[]> | null | undefined
): string {
  if (!invIndex) return '';
  const positions: [number, string][] = [];
  for (const [word, idxs] of Object.entries(invIndex)) {
    for (const i of idxs) positions.push([i, word]);
  }
  return positions
    .sort(([a], [b]) => a - b)
    .map(([, w]) => w)
    .join(' ');
}

interface OpenAlexAuthorship {
  author?: {
    display_name?: string;
  };
}

interface OpenAlexPrimaryLocation {
  landing_page_url?: string;
  source?: {
    display_name?: string;
  };
}

interface OpenAlexWork {
  id?: string;
  title?: string;
  display_name?: string;
  authorships?: OpenAlexAuthorship[];
  publication_year?: number | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  doi?: string | null;
  primary_location?: OpenAlexPrimaryLocation | null;
}

export async function searchOpenAlex(
  query: string,
  maxResults = 200
): Promise<SearchRecord[]> {
  const perPage = Math.min(maxResults, 200);
  const url =
    `https://api.openalex.org/works` +
    `?search=${encodeURIComponent(query)}` +
    `&per-page=${perPage}` +
    `&select=id,title,authorships,publication_year,abstract_inverted_index,doi,primary_location,display_name` +
    `&mailto=garimakalhansh@gmail.com`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'H-Evidence-SLR/1.0 (garimakalhansh@gmail.com)' },
  });

  if (!res.ok) {
    throw new Error(`OpenAlex search failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    results?: OpenAlexWork[];
  };

  const works = data.results ?? [];

  return works.map((work): SearchRecord => {
    const openAlexId = work.id ?? `oa-${Math.random().toString(36).slice(2)}`;
    // Extract short ID from full URI like "https://openalex.org/W12345"
    const externalId = openAlexId.split('/').pop() ?? openAlexId;

    const authors = (work.authorships ?? [])
      .map((a) => a.author?.display_name ?? '')
      .filter(Boolean);

    const abstract = reconstructAbstract(work.abstract_inverted_index);
    const doi = normalizeDOI(work.doi);

    const url =
      work.primary_location?.landing_page_url ??
      `https://openalex.org/${externalId}`;

    const journal = work.primary_location?.source?.display_name ?? null;

    return {
      id: `openalex_${externalId}`,
      title: work.display_name ?? work.title ?? 'Untitled',
      authors,
      year: work.publication_year ?? null,
      abstract,
      doi,
      source: 'openalex',
      externalId,
      url,
      journal,
      isDuplicate: false,
      duplicateOf: null,
    };
  });
}
