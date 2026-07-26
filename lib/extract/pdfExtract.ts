import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export interface PDFTextContent {
  pageTexts: string[]; // one entry per page
  fullText: string; // all pages joined with '\n[PAGE N]\n'
}

export async function extractPDFText(file: File): Promise<PDFTextContent> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageTexts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    pageTexts.push(text);
  }

  const fullText = pageTexts
    .map((t, i) => `[PAGE ${i + 1}]\n${t}`)
    .join('\n\n');

  return { pageTexts, fullText };
}
