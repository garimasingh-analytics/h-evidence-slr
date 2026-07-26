import type { IncludedStudy } from './types';

/**
 * Convert an author string to "Last, F. M." format.
 * Handles a variety of incoming formats:
 *   "Smith JA"       → "Smith, J. A."
 *   "Smith, JA"      → "Smith, J. A."
 *   "John A Smith"   → "Smith, J. A."
 *   "Smith, John A." → "Smith, J. A."
 */
function normaliseAuthor(raw: string): string {
  raw = raw.trim();
  if (!raw) return '';

  // Already "Last, First" format?
  if (raw.includes(',')) {
    const [last, rest] = raw.split(',', 2);
    const initials = (rest ?? '')
      .trim()
      .split(/\s+/)
      .map((part) => {
        // Could be "John" or "J" or "J."
        const clean = part.replace(/\./g, '');
        return clean.length > 0 ? clean[0].toUpperCase() + '.' : '';
      })
      .filter(Boolean)
      .join(' ');
    return `${last.trim()}${initials ? ', ' + initials : ''}`;
  }

  // Tokens with no comma
  const tokens = raw.split(/\s+/);
  if (tokens.length === 1) {
    // Only one token — treat as last name
    return tokens[0];
  }

  // Last token is last name? Or first token? Heuristic: if last token is
  // all-caps initials or very short, treat first token as last name
  // Otherwise treat last token as last name (e.g. "John A Smith").
  const lastToken = tokens[tokens.length - 1];
  const firstToken = tokens[0];

  let last: string;
  let firstParts: string[];

  // If the string looks like "Smith JA" (last token is short initials)
  if (/^[A-Z]{1,4}$/.test(lastToken) && tokens.length === 2) {
    last = firstToken;
    firstParts = [lastToken];
  } else {
    // Standard: "John A Smith" → last = Smith
    last = lastToken;
    firstParts = tokens.slice(0, -1);
  }

  const initials = firstParts
    .map((p) => {
      const clean = p.replace(/\./g, '');
      return clean.length > 0 ? clean[0].toUpperCase() + '.' : '';
    })
    .filter(Boolean)
    .join(' ');

  return `${last}${initials ? ', ' + initials : ''}`;
}

/**
 * Format an array of authors per APA 7 rules.
 */
function formatAuthors(authors: string[]): string {
  if (!authors || authors.length === 0) return '';

  const normalised = authors.map(normaliseAuthor);

  if (normalised.length === 1) return normalised[0];
  if (normalised.length === 2) return `${normalised[0]}, & ${normalised[1]}`;
  if (normalised.length <= 20) {
    const allButLast = normalised.slice(0, -1).join(', ');
    return `${allButLast}, & ${normalised[normalised.length - 1]}`;
  }
  // >20 authors: first 19, ellipsis, last
  const first19 = normalised.slice(0, 19).join(', ');
  return `${first19}, ... ${normalised[normalised.length - 1]}`;
}

/**
 * Convert a title to sentence case: uppercase first letter and first letter
 * after a colon; lowercase everything else (preserves acronyms heuristically
 * only for the first word).
 */
function toSentenceCase(title: string): string {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/(^|:\s+)([a-z])/g, (_m, prefix, letter) => prefix + letter.toUpperCase());
}

/**
 * Format a single study as APA 7th edition reference.
 */
export function formatAPA7(study: IncludedStudy): string {
  const authors = formatAuthors(study.authors);
  const year = study.year ? `(${study.year})` : '(n.d.)';
  const title = toSentenceCase(study.title ?? '');
  const journal = study.journal ?? '';
  const doi = study.doi
    ? `https://doi.org/${study.doi.replace(/^https?:\/\/doi\.org\//i, '')}`
    : null;

  // Build parts
  let ref = '';
  if (authors) ref += `${authors}. `;
  ref += `${year}. `;
  ref += `${title}`;
  if (!ref.endsWith('.')) ref += '.';
  if (journal) ref += ` ${journal}.`;
  if (doi) ref += ` ${doi}`;
  else if (ref.endsWith('.')) {
    // already ends with period — fine
  }

  return ref.trim();
}

/**
 * Returns array of APA-formatted reference strings sorted alphabetically
 * by the first author's last name.
 */
export function formatReferenceList(studies: IncludedStudy[]): string[] {
  const formatted = studies.map((s) => ({ study: s, ref: formatAPA7(s) }));

  formatted.sort((a, b) => {
    const getLastName = (s: IncludedStudy) =>
      (s.authors?.[0] ?? s.title ?? '').split(/[,\s]/)[0].toLowerCase();
    return getLastName(a.study).localeCompare(getLastName(b.study));
  });

  return formatted.map((f) => f.ref);
}
