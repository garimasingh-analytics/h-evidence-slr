import * as XLSX from 'xlsx';
import type { ExtractionPrompt } from './types';

export async function parseCodingForm(file: File): Promise<ExtractionPrompt[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('No sheets found in the uploaded file');
  }
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

  if (!rows || rows.length === 0) {
    throw new Error('No column headers found in row 1');
  }

  const headerRow = rows[0] as unknown[];
  const prompts: ExtractionPrompt[] = [];

  headerRow.forEach((cell, idx) => {
    if (cell !== null && cell !== undefined && String(cell).trim() !== '') {
      prompts.push({ index: idx, text: String(cell).trim() });
    }
  });

  if (prompts.length === 0) {
    throw new Error('No column headers found in row 1');
  }

  return prompts;
}

export function assessPromptQuality(prompt: string): 'good' | 'warn' | 'bad' {
  const trimmed = prompt.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);

  // 'bad': single word (no spaces)
  if (words.length <= 1) {
    return 'bad';
  }

  // Check for action verbs and question indicators
  const lower = trimmed.toLowerCase();
  const hasActionVerb =
    lower.includes('what') ||
    lower.includes('list') ||
    lower.includes('describe') ||
    lower.includes('how many') ||
    lower.includes('how much') ||
    lower.includes('which') ||
    lower.includes('when') ||
    lower.includes('who') ||
    lower.includes('where') ||
    lower.includes('explain') ||
    lower.includes('identify') ||
    lower.includes('summarize');

  const endsWithQuestion = trimmed.endsWith('?');

  // 'warn': fewer than 5 words OR no action verbs and doesn't end with ?
  if (words.length < 5 || (!hasActionVerb && !endsWithQuestion)) {
    return 'warn';
  }

  return 'good';
}
