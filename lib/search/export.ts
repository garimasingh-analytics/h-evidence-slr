import type { SearchRecord } from './types';

function escapeCSV(value: string | null | undefined | number): string {
  if (value === null || value === undefined) return '""';
  const str = String(value);
  // Wrap in quotes and escape internal double quotes as ""
  return '"' + str.replace(/"/g, '""') + '"';
}

export function toCSV(records: SearchRecord[]): string {
  const unique = records.filter((r) => !r.isDuplicate);

  const headers = [
    'Title',
    'Authors',
    'Year',
    'Journal',
    'DOI',
    'Source',
    'Abstract',
    'URL',
  ];

  const rows = unique.map((r) => {
    const authors = r.authors.join('; ');
    return [
      escapeCSV(r.title),
      escapeCSV(authors),
      escapeCSV(r.year),
      escapeCSV(r.journal),
      escapeCSV(r.doi),
      escapeCSV(r.source),
      escapeCSV(r.abstract),
      escapeCSV(r.url),
    ].join(',');
  });

  return [headers.map(escapeCSV).join(','), ...rows].join('\r\n');
}
