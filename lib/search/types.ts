export interface SearchRecord {
  id: string;           // generated: source_externalId
  title: string;
  authors: string[];
  year: number | null;
  abstract: string;
  doi: string | null;   // normalized: lowercase, no "https://doi.org/" prefix
  source: 'pubmed' | 'europepmc' | 'openalex';
  externalId: string;   // pmid / europepmc-id / openalex-id
  url: string | null;
  journal: string | null;
  isDuplicate: boolean;
  duplicateOf: string | null; // id of the kept record
}

export interface PICOConcept {
  population: string;
  intervention: string;
  comparator: string;
  outcome: string;
}

export interface SearchQueries {
  pubmed: string;
  europepmc: string;
  openalex: string;
}

export interface SearchStats {
  pubmedCount: number;
  europepmcCount: number;
  openalexCount: number;
  totalRaw: number;
  duplicatesRemoved: number;
  finalCount: number;
}
