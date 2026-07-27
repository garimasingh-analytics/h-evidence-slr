import { NextRequest, NextResponse } from 'next/server';
import { callModel } from '@/lib/model';
import type { PRISMAStats, ManuscriptSection, IncludedStudy } from '@/lib/report/types';

export const maxDuration = 300;

interface GenerateBody {
  sectionId?: 'abstract' | 'introduction' | 'methods' | 'results' | 'discussion' | 'conclusions';
  question: string;
  pico?: { population: string; intervention: string; comparator: string; outcome: string };
  stats: PRISMAStats;
  includedStudies: IncludedStudy[];
  criteria?: { inclusion: string; exclusion: string };
  narrativeSections?: Array<{ id: string; content: string }>;
  extractionSummary?: string;
}

const SYSTEM = `You are an expert systematic review writer. Write in formal academic English. Be precise and evidence-based. Use specific numbers where provided.`;

async function generateSection(
  prompt: string,
  temperature = 0.3,
  maxTokens = 2048
): Promise<string> {
  const raw = await callModel(
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: prompt },
    ],
    { temperature, maxTokens }
  );
  return raw.trim();
}

export async function POST(req: NextRequest) {
  let body: GenerateBody;
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { question, pico, stats, includedStudies, criteria, narrativeSections, extractionSummary } =
    body;

  if (!question || !stats || !Array.isArray(includedStudies)) {
    return NextResponse.json(
      { error: 'Missing required fields: question, stats, includedStudies' },
      { status: 400 }
    );
  }

  const picoContext = pico
    ? `Population: ${pico.population}\nIntervention: ${pico.intervention}\nComparator: ${pico.comparator}\nOutcome: ${pico.outcome}`
    : '';

  const criteriaContext = criteria
    ? `Inclusion criteria:\n${criteria.inclusion}\n\nExclusion criteria:\n${criteria.exclusion}`
    : '';

  const studyListContext =
    includedStudies.length > 0
      ? includedStudies
          .map(
            (s, i) =>
              `${i + 1}. ${s.title} (${s.authors.slice(0, 2).join(', ')}${s.authors.length > 2 ? ' et al.' : ''}, ${s.year ?? 'n.d.'}) — ${s.journal ?? 'unknown journal'}`
          )
          .join('\n')
      : 'No studies included yet.';

  const sections: ManuscriptSection[] = [];

  // ── 1. Abstract ──
  const abstractPrompt = `Write a structured abstract (~300 words) for a systematic review on:
"${question}"

${picoContext}

Use the following format:
Background: [1-2 sentences on the topic]
Objectives: [state the review aim]
Data Sources: [mention PubMed, Europe PMC, and OpenAlex; searched up to the current date]
Study Selection: [state n=${stats.recordsScreened} records screened, n=${stats.recordsIncluded} included after applying predefined eligibility criteria]
Data Extraction: [describe dual-reviewer extraction process]
Results: [summarise key findings from n=${stats.recordsIncluded} included studies]
Limitations: [1-2 sentences on limitations]
Conclusions: [1-2 sentences on implications]

Write only the abstract text. Do not include the word "Abstract" as a heading.`;

  if (!body.sectionId || body.sectionId === 'abstract') {
    const abstractContent = await generateSection(abstractPrompt, 0.3, 1000);
    sections.push({ id: 'abstract', title: 'Abstract', content: abstractContent, edited: false });
  }

  // ── 2. Introduction ──
  const backgroundBase = narrativeSections?.find((s) => s.id === 'background')?.content ?? '';

  const introPrompt = backgroundBase
    ? `Expand and refine the following background text into a 3-paragraph Introduction (~400 words) for a systematic review on: "${question}".
${picoContext ? '\n' + picoContext : ''}

Base text to draw from:
${backgroundBase}

Your introduction must:
1. Paragraph 1: Establish the clinical/scientific context and importance of the topic.
2. Paragraph 2: Summarise what is already known and identify the gap.
3. Paragraph 3: State the specific objective of this systematic review.

Write only the body text (no section heading).`
    : `Write a 3-paragraph Introduction (~400 words) for a systematic review on: "${question}".
${picoContext ? '\n' + picoContext : ''}

1. Paragraph 1: Establish the clinical/scientific context and importance of the topic.
2. Paragraph 2: Summarise what is already known and identify the gap in the literature.
3. Paragraph 3: State the specific objective of this systematic review.

Write only the body text (no section heading).`;

  if (!body.sectionId || body.sectionId === 'introduction') {
    const introContent = await generateSection(introPrompt, 0.3, 1200);
    sections.push({
      id: 'introduction',
      title: 'Introduction',
      content: introContent,
      edited: false,
    });
  }

  // ── 3. Methods ──
  const methodsPrompt = `Write a Methods section (~500 words, 4 paragraphs) for a systematic review on: "${question}".

${picoContext}

${criteriaContext}

Search details:
- Databases: PubMed (n=${stats.pubmedCount} records), Europe PMC (n=${stats.europepmcCount} records), OpenAlex (n=${stats.openalexCount} records)
- Total identified: ${stats.totalIdentified}; after deduplication: ${stats.recordsScreened}

Paragraph 1: Search strategy overview — databases searched, no date restriction, Boolean operators used.
Paragraph 2: Eligibility criteria — describe inclusion and exclusion criteria stated above (if provided).
Paragraph 3: Screening process — describe dual independent AI screening passes, Cohen's Kappa agreement metric, and human reviewer resolving disagreements and flagged records.
Paragraph 4: Data extraction — describe structured coding form, side-by-side PDF verification interface, human review before recording.

Write only the body text (no section heading).`;

  if (!body.sectionId || body.sectionId === 'methods') {
    const methodsContent = await generateSection(methodsPrompt, 0.3, 1600);
    sections.push({ id: 'methods', title: 'Methods', content: methodsContent, edited: false });
  }

  // ── 4. Results ──
  const resultsPrompt = `Write a Results section (~400 words, 3 paragraphs) for a systematic review on: "${question}".

Search/screening statistics:
- Total records identified: ${stats.totalIdentified} (PubMed: ${stats.pubmedCount}, Europe PMC: ${stats.europepmcCount}, OpenAlex: ${stats.openalexCount})
- Duplicates removed: ${stats.duplicatesRemoved}
- Records screened: ${stats.recordsScreened}
- Records excluded after screening: ${stats.recordsExcluded}
- Studies included: ${stats.recordsIncluded}

Included studies:
${studyListContext}

${extractionSummary ? 'Extraction data:\n' + extractionSummary : ''}

Paragraph 1: Describe the study selection process using the exact numbers above. Reference the PRISMA flow diagram.
Paragraph 2: Describe the characteristics of included studies (years, journals, types, sample sizes if known from extraction data).
Paragraph 3: Summarise the key findings from included studies based on the extraction data (or based on the study list if no extraction data).

Write only the body text (no section heading).`;

  if (!body.sectionId || body.sectionId === 'results') {
    const resultsContent = await generateSection(resultsPrompt, 0.3, 1400);
    sections.push({ id: 'results', title: 'Results', content: resultsContent, edited: false });
  }

  // ── 5. Discussion ──
  const discussionBase = narrativeSections?.find((s) => s.id === 'discussion')?.content ?? '';

  const discussionPrompt = discussionBase
    ? `Expand and refine the following discussion text into a 3-paragraph Discussion (~400 words) for a systematic review on: "${question}".

Base text:
${discussionBase}

Your discussion must:
1. Interpret main findings in context of existing literature.
2. Discuss limitations of the included evidence.
3. Discuss limitations of the review process.

Write only the body text (no section heading).`
    : `Write a 3-paragraph Discussion (~400 words) for a systematic review on: "${question}".

Included studies (${stats.recordsIncluded} total):
${studyListContext}

1. Interpret the main findings in the context of existing literature.
2. Discuss limitations of the included evidence (study designs, heterogeneity, potential biases).
3. Discuss limitations of the review process itself.

Write only the body text (no section heading).`;

  if (!body.sectionId || body.sectionId === 'discussion') {
    const discussionContent = await generateSection(discussionPrompt, 0.3, 1400);
    sections.push({
      id: 'discussion',
      title: 'Discussion',
      content: discussionContent,
      edited: false,
    });
  }

  // ── 6. Conclusions ──
  const conclusionsPrompt = `Write 1–2 short paragraphs (~150 words) as the Conclusions section for a systematic review on: "${question}".

Key result: ${stats.recordsIncluded} studies included.
${extractionSummary ? 'Summary of evidence:\n' + extractionSummary.slice(0, 500) : ''}

Paragraph 1: Overall summary statement of what the review found.
Paragraph 2: Implications for practice and future research.

Write only the body text (no section heading).`;

  if (!body.sectionId || body.sectionId === 'conclusions') {
    const conclusionsContent = await generateSection(conclusionsPrompt, 0.3, 500);
    sections.push({
      id: 'conclusions',
      title: 'Conclusions',
      content: conclusionsContent,
      edited: false,
    });
  }

  return NextResponse.json({ sections });
}
