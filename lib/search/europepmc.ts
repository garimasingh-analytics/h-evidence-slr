import type { SearchRecord } from './types';

function normalizeDOI(doi: string | null | undefined): string | null {
  if (!doi) return null;
  return doi
    .toLowerCase()
    .replace(/^https?:\/\/doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .trim() || null;
}

interface EuropePMCAuthor {
  fullName?: string;
  lastName?: string;
  initials?: string;
  firstName?: string;
}

interface EuropePMCResult {
  id?: string;
  source?: string;
  title?: string;
  abstractText?: string;
  doi?: string;
  pubYear?: string | number;
  journalTitle?: string;
  authorList?: {
    author?: EuropePMCAuthor[];
  };
}

export async function searchEuropePMC(
  query: string,
  maxResults = 200
): Promise<SearchRecord[]> {
  const url =
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search` +
    `?query=${encodeURIComponent(query)}&format=json&pageSize=${maxResults}&resultType=core`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'H-Evidence-SLR/1.0 (garimakalhansh@gmail.com)' },
  });

  if (!res.ok) {
    throw new Error(`Europe PMC search failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    resultList?: {
      result?: EuropePMCResult[];
    };
  };

  const results = data.resultList?.result ?? [];

  return results.map((item): SearchRecord => {
    const externalId = item.id ?? `epmc-${Math.random().toString(36).slice(2)}`;
    const sourceCode = item.source ?? 'MED';

    const authors: string[] = (item.authorList?.author ?? []).map((a) => {
      if (a.fullName) return a.fullName;
      const ln = a.lastName ?? '';
      const init = a.initials ?? a.firstName ?? '';
      return [ln, init].filter(Boolean).join(' ');
    });

    const year = item.pubYear ? parseInt(String(item.pubYear), 10) : null;

    return {
      id: `europepmc_${externalId}`,
      title: item.title ?? 'Untitled',
      authors,
      year: isNaN(year!) ? null : year,
      abstract: item.abstractText ?? '',
      doi: normalizeDOI(item.doi),
      source: 'europepmc',
      externalId,
      url: `https://europepmc.org/article/${sourceCode}/${externalId}`,
      journal: item.journalTitle ?? null,
      isDuplicate: false,
      duplicateOf: null,
    };
  });
}
