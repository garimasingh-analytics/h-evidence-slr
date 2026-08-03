import { NextResponse } from 'next/server';

export const maxDuration = 60;

interface DiscoveryRecord {
  id: string;
  doi: string | null;
  url: string | null;
}

interface UnpaywallLocation {
  url?: string | null;
  url_for_pdf?: string | null;
  url_for_landing_page?: string | null;
  version?: string | null;
  host_type?: string | null;
}

interface UnpaywallResponse {
  is_oa?: boolean;
  best_oa_location?: UnpaywallLocation | null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { records?: DiscoveryRecord[] };
    if (!Array.isArray(body.records)) {
      return NextResponse.json({ error: 'Missing required field: records' }, { status: 400 });
    }

    // Keep each request bounded. The client sends larger reviews in chunks.
    const records = body.records.slice(0, 25);
    const results = await Promise.all(
      records.map(async (record) => {
        if (!record.doi) {
          return {
            id: record.id,
            isOpenAccess: false,
            fullTextUrl: null,
            landingPageUrl: record.url,
            source: 'record',
          };
        }

        try {
          const url = `https://api.unpaywall.org/v2/${encodeURIComponent(record.doi)}?email=garimakalhansh@gmail.com`;
          const response = await fetch(url, {
            headers: { 'User-Agent': 'H-Evidence-SLR/1.0 (garimakalhansh@gmail.com)' },
            next: { revalidate: 86_400 },
          });
          if (!response.ok) throw new Error(`Unpaywall ${response.status}`);

          const data = (await response.json()) as UnpaywallResponse;
          const location = data.best_oa_location;
          return {
            id: record.id,
            isOpenAccess: data.is_oa === true,
            fullTextUrl: location?.url_for_pdf ?? location?.url ?? null,
            landingPageUrl: location?.url_for_landing_page ?? record.url,
            version: location?.version ?? null,
            hostType: location?.host_type ?? null,
            source: 'unpaywall',
          };
        } catch {
          return {
            id: record.id,
            isOpenAccess: false,
            fullTextUrl: null,
            landingPageUrl: record.url,
            source: 'record',
          };
        }
      })
    );

    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
