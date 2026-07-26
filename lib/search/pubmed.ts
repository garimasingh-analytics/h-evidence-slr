import type { SearchRecord } from './types';

function normalizeDOI(doi: string | null): string | null {
  if (!doi) return null;
  return doi
    .toLowerCase()
    .replace(/^https?:\/\/doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .trim();
}

function extractFirst(xml: string, pattern: RegExp): string {
  const match = xml.match(pattern);
  return match ? match[1].trim() : '';
}

function extractAll(xml: string, pattern: RegExp): string[] {
  const results: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  while ((match = re.exec(xml)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

function stripXMLTags(str: string): string {
  return str.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function searchPubMed(
  query: string,
  maxResults = 200
): Promise<SearchRecord[]> {
  // Step 1: esearch
  const esearchUrl =
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi` +
    `?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&usehistory=y&retmode=json`;

  const esearchRes = await fetch(esearchUrl, {
    headers: { 'User-Agent': 'H-Evidence-SLR/1.0 (garimakalhansh@gmail.com)' },
  });

  if (!esearchRes.ok) {
    throw new Error(`PubMed esearch failed: ${esearchRes.status}`);
  }

  const esearchData = (await esearchRes.json()) as {
    esearchresult: {
      count: string;
      webenv: string;
      querykey: string;
      idlist: string[];
    };
  };

  const { webenv, querykey, idlist } = esearchData.esearchresult;
  if (!idlist || idlist.length === 0) return [];

  // Respect PubMed rate limits
  await sleep(500);

  // Step 2: efetch
  const efetchUrl =
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi` +
    `?db=pubmed&WebEnv=${encodeURIComponent(webenv)}&query_key=${encodeURIComponent(querykey)}` +
    `&rettype=xml&retmode=xml&retmax=${maxResults}`;

  const efetchRes = await fetch(efetchUrl, {
    headers: { 'User-Agent': 'H-Evidence-SLR/1.0 (garimakalhansh@gmail.com)' },
  });

  if (!efetchRes.ok) {
    throw new Error(`PubMed efetch failed: ${efetchRes.status}`);
  }

  const xmlText = await efetchRes.text();

  // Split into individual PubmedArticle blocks
  const articlePattern = /<PubmedArticle[\s\S]*?<\/PubmedArticle>/g;
  const articles: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = articlePattern.exec(xmlText)) !== null) {
    articles.push(m[0]);
  }

  const records: SearchRecord[] = [];

  for (const article of articles) {
    // Extract PMID
    const pmid = extractFirst(article, /<PMID Version="1">(.*?)<\/PMID>/);
    if (!pmid) continue;

    // Extract title (may contain nested tags like <i>)
    const titleRaw = extractFirst(article, /<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/);
    const title = stripXMLTags(titleRaw) || 'Untitled';

    // Extract abstract - may have multiple AbstractText elements
    const abstractParts = extractAll(article, /<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/);
    const abstract = abstractParts.map(stripXMLTags).join(' ').trim();

    // Extract DOI from ArticleId
    const doiRaw = (() => {
      const doiMatch = article.match(/<ArticleId IdType="doi">(.*?)<\/ArticleId>/);
      return doiMatch ? doiMatch[1].trim() : '';
    })();

    // Extract year from PubDate
    const yearMatch = article.match(/<PubDate>[\s\S]*?<Year>(.*?)<\/Year>[\s\S]*?<\/PubDate>/s);
    const yearStr = yearMatch ? yearMatch[1].trim() : '';
    const year = yearStr ? parseInt(yearStr, 10) : null;

    // Extract journal title — look inside <Journal> block
    const journalBlock = article.match(/<Journal>([\s\S]*?)<\/Journal>/);
    const journal = journalBlock
      ? extractFirst(journalBlock[1], /<Title>(.*?)<\/Title>/)
      : null;

    // Extract authors by LastName
    const lastNames = extractAll(article, /<LastName>(.*?)<\/LastName>/);
    const authors = lastNames.length > 0 ? lastNames : [];

    const doi = normalizeDOI(doiRaw || null);
    const externalId = pmid;

    records.push({
      id: `pubmed_${externalId}`,
      title,
      authors,
      year,
      abstract,
      doi,
      source: 'pubmed',
      externalId,
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      journal: journal || null,
      isDuplicate: false,
      duplicateOf: null,
    });
  }

  return records;
}
