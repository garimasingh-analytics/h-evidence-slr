import { callModel } from '@/lib/model';
import type { PICOConcept, SearchQueries } from './types';

function extractJSON(text: string): string {
  // Try to find a JSON object in the text
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1);
  }
  return text;
}

export async function generatePICO(question: string): Promise<PICOConcept> {
  const systemPrompt = `You are an expert systematic reviewer. Your task is to structure a research question into PICO format (Population, Intervention, Comparator, Outcome) for a systematic literature review. Always respond with valid JSON only — no explanation, no markdown.`;

  const userPrompt = `Structure the following research question into PICO format.

Research question: "${question}"

Respond with ONLY a valid JSON object in this exact format:
{
  "population": "description of the patient/population group",
  "intervention": "the intervention or exposure being studied",
  "comparator": "the comparison group or control (use 'No comparator specified' if none)",
  "outcome": "the primary outcome or measure of interest"
}`;

  async function attempt(strict: boolean): Promise<PICOConcept> {
    const prompt = strict
      ? userPrompt +
        '\n\nIMPORTANT: Your entire response must be ONLY the JSON object. Do not include any text before or after the JSON.'
      : userPrompt;

    const result = await callModel(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.2, json: true }
    );

    const cleaned = extractJSON(result);
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    if (
      typeof parsed.population !== 'string' ||
      typeof parsed.intervention !== 'string' ||
      typeof parsed.comparator !== 'string' ||
      typeof parsed.outcome !== 'string'
    ) {
      throw new Error('PICO JSON is missing required string fields');
    }

    return {
      population: parsed.population,
      intervention: parsed.intervention,
      comparator: parsed.comparator,
      outcome: parsed.outcome,
    };
  }

  try {
    return await attempt(false);
  } catch {
    try {
      return await attempt(true);
    } catch (err2) {
      throw new Error(
        `Failed to generate PICO concept after two attempts. Last error: ${String(err2)}`
      );
    }
  }
}

export async function generateQueries(
  pico: PICOConcept,
  question: string
): Promise<SearchQueries> {
  const systemPrompt = `You are an expert systematic review librarian. Your task is to translate a PICO concept into native database query syntax for PubMed, Europe PMC, and OpenAlex. Always respond with valid JSON only — no explanation, no markdown.`;

  const userPrompt = `Generate database search queries for this systematic review PICO concept.

Research question: "${question}"

PICO:
- Population: ${pico.population}
- Intervention: ${pico.intervention}
- Comparator: ${pico.comparator}
- Outcome: ${pico.outcome}

Generate one query per database using the correct NATIVE syntax for each:

1. PubMed: Use field tags like [tiab] for title/abstract and [mesh] for MeSH terms. Use AND/OR boolean operators. Use format: "term"[tiab]. Example: ("diabetes"[tiab] OR "diabetes mellitus"[mesh]) AND ("metformin"[tiab] OR "metformin"[mesh])

2. Europe PMC: Use field prefixes TITLE:, ABSTRACT:, AUTH:. Use AND/OR operators. Example: (TITLE:diabetes OR ABSTRACT:diabetes) AND (TITLE:metformin OR ABSTRACT:metformin)

3. OpenAlex: Use the search parameter value (a plain text query that will be passed as the "search" URL parameter for full-text search over title and abstract). Keep it concise — 3 to 8 key terms joined with spaces or boolean operators appropriate for a keyword search. Example: diabetes metformin treatment outcomes

Respond with ONLY a valid JSON object:
{
  "pubmed": "the pubmed query string",
  "europepmc": "the europe pmc query string",
  "openalex": "the openalex search terms"
}`;

  async function attempt(strict: boolean): Promise<SearchQueries> {
    const prompt = strict
      ? userPrompt +
        '\n\nIMPORTANT: Your entire response must be ONLY the JSON object. Do not include any text before or after the JSON.'
      : userPrompt;

    const result = await callModel(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.1, json: true }
    );

    const cleaned = extractJSON(result);
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    if (
      typeof parsed.pubmed !== 'string' ||
      typeof parsed.europepmc !== 'string' ||
      typeof parsed.openalex !== 'string'
    ) {
      throw new Error('Queries JSON is missing required string fields');
    }

    return {
      pubmed: parsed.pubmed,
      europepmc: parsed.europepmc,
      openalex: parsed.openalex,
    };
  }

  try {
    return await attempt(false);
  } catch {
    try {
      return await attempt(true);
    } catch (err2) {
      throw new Error(
        `Failed to generate search queries after two attempts. Last error: ${String(err2)}`
      );
    }
  }
}
