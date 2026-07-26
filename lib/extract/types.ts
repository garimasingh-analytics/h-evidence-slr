export interface ExtractionPrompt {
  index: number;
  text: string; // the question, e.g. "What is the total sample size?"
}

export interface ExtractionResponse {
  prompt: string;
  response: string;
  source: string; // quoted text from paper
  page: string; // page number as string
  edited: boolean; // true if human manually changed the AI response
}

export interface ExtractionResult {
  pdfName: string;
  responses: ExtractionResponse[];
  recorded: boolean;
  extractedAt: string;
}

export interface CodingFormRow {
  pdfName: string;
  [promptText: string]: string; // prompt → answer
}

export interface ExtractState {
  prompts: ExtractionPrompt[];
  promptsConfirmed: boolean;
  results: Record<string, ExtractionResult>; // keyed by pdfName
  recordedRows: CodingFormRow[];
}
