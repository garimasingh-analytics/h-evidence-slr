import type { ExtractionPrompt, CodingFormRow } from './types';
import type { SearchRecord } from '@/lib/search/types';

const DEFAULT_QUESTIONS = [
  'What is the study title?',
  'Who are the authors?',
  'What year was the study published?',
  'Which journal published the study?',
  'What is the DOI?',
  'What is the study objective?',
  'What study design was used?',
  'What population was studied?',
  'What intervention or exposure was evaluated?',
  'What comparator was used?',
  'What outcomes were measured?',
  'What were the main findings?',
  'What sample size was analysed?',
  'What limitations were reported?',
  'What funding sources or conflicts of interest were reported?',
];

export const DEFAULT_EXTRACTION_PROMPTS: ExtractionPrompt[] = DEFAULT_QUESTIONS.map(
  (text, index) => ({ index, text })
);

export function createMetadataCodingRow(record: SearchRecord): CodingFormRow {
  const row: CodingFormRow = {
    pdfName: record.title,
    'Study ID': record.id,
    'Record source': record.source,
    'Full text status': 'Not uploaded — metadata and abstract carried forward automatically',
  };

  row[DEFAULT_QUESTIONS[0]] = record.title || 'Not reported';
  row[DEFAULT_QUESTIONS[1]] = record.authors.join(', ') || 'Not reported';
  row[DEFAULT_QUESTIONS[2]] = record.year?.toString() ?? 'Not reported';
  row[DEFAULT_QUESTIONS[3]] = record.journal ?? 'Not reported';
  row[DEFAULT_QUESTIONS[4]] = record.doi ?? 'Not reported';
  row[DEFAULT_QUESTIONS[5]] = record.abstract || 'Not reported';

  for (const question of DEFAULT_QUESTIONS.slice(6)) {
    row[question] = 'Not reported — full text review recommended';
  }

  return row;
}
