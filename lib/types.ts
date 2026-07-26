export type WizardStep = 'search' | 'screen' | 'extract' | 'report';

export const WIZARD_STEPS: { key: WizardStep; label: string; description: string }[] = [
  {
    key: 'search',
    label: 'Search',
    description: 'Generate search strategy and retrieve candidate papers from PubMed, Europe PMC, and OpenAlex.',
  },
  {
    key: 'screen',
    label: 'Screen',
    description: 'AI-assisted title/abstract screening with human-in-the-loop review and active-learning calibration.',
  },
  {
    key: 'extract',
    label: 'Extract',
    description: 'Upload PDFs and a coding form; extract structured data with side-by-side PDF verification.',
  },
  {
    key: 'report',
    label: 'Report',
    description: 'Generate a PRISMA-2020-compliant Word manuscript with flow diagram and references.',
  },
];

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string; // ISO date string
  currentStep: WizardStep;
}
