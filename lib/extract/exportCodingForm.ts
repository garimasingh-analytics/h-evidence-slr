import * as XLSX from 'xlsx';
import type { CodingFormRow, ExtractionPrompt } from './types';

export function exportToExcel(rows: CodingFormRow[], prompts: ExtractionPrompt[]): void {
  // Build array of plain objects for the sheet
  const data = rows.map((row) => {
    const obj: Record<string, string> = { 'PDF File': row.pdfName };
    for (const prompt of prompts) {
      obj[prompt.text] = row[prompt.text] ?? '';
    }
    return obj;
  });

  const sheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Extraction Form');
  XLSX.writeFile(workbook, 'extraction_form.xlsx');
}
