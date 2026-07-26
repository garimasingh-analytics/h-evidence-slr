import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  BorderStyle,
  WidthType,
  ShadingType,
  PageBreak,
} from 'docx';
import type { ManuscriptSection, PRISMAStats } from './types';

const PRIMARY_HEX = '1B3A5C';
const SECONDARY_HEX = 'EBF4FA';
const WHITE_HEX = 'FFFFFF';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function heading1(text: string): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 200 },
    run: { color: PRIMARY_HEX, bold: true },
  });
}

function heading2(text: string): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 160 },
    run: { color: PRIMARY_HEX },
  });
}

function bodyParagraph(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, size: 24 })],
    spacing: { before: 120, after: 120 },
  });
}

function bulletParagraph(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, size: 24 })],
    bullet: { level: 0 },
    spacing: { before: 60, after: 60 },
  });
}

/** Split content string into paragraphs; skip empty lines. */
function contentParagraphs(content: string): Paragraph[] {
  return content
    .split(/\n\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(bodyParagraph);
}

// ──────────────────────────────────────────────────────────────────────────────
// PRISMA Flow Table
// ──────────────────────────────────────────────────────────────────────────────

function headerCell(text: string, columnSpan = 3): TableCell {
  return new TableCell({
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: true, color: WHITE_HEX, size: 22 })],
        alignment: AlignmentType.CENTER,
      }),
    ],
    columnSpan,
    shading: { type: ShadingType.SOLID, color: PRIMARY_HEX, fill: PRIMARY_HEX },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: PRIMARY_HEX },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: PRIMARY_HEX },
      left: { style: BorderStyle.SINGLE, size: 2, color: PRIMARY_HEX },
      right: { style: BorderStyle.SINGLE, size: 2, color: PRIMARY_HEX },
    },
  });
}

function dataCell(children: Paragraph[], columnSpan = 1): TableCell {
  return new TableCell({
    children,
    columnSpan,
    shading: { type: ShadingType.SOLID, color: SECONDARY_HEX, fill: SECONDARY_HEX },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: PRIMARY_HEX },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: PRIMARY_HEX },
      left: { style: BorderStyle.SINGLE, size: 2, color: PRIMARY_HEX },
      right: { style: BorderStyle.SINGLE, size: 2, color: PRIMARY_HEX },
    },
  });
}

function emptyCell(): TableCell {
  return new TableCell({
    children: [new Paragraph('')],
    shading: { type: ShadingType.SOLID, color: WHITE_HEX, fill: WHITE_HEX },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
  });
}

function arrowRow(): TableRow {
  return new TableRow({
    children: [
      dataCell(
        [new Paragraph({ children: [new TextRun({ text: '↓', size: 24 })], alignment: AlignmentType.CENTER })],
        1
      ),
      emptyCell(),
      emptyCell(),
    ],
  });
}

function buildPrismaTable(stats: PRISMAStats): Table {
  const rows: TableRow[] = [];

  // Row 1: IDENTIFICATION header
  rows.push(new TableRow({ children: [headerCell('IDENTIFICATION', 3)] }));

  // Row 2: sources box (span 2) + side note (span 1)
  rows.push(
    new TableRow({
      children: [
        dataCell(
          [
            new Paragraph({
              children: [new TextRun({ text: 'Records identified from databases:', bold: true, size: 22 })],
            }),
            new Paragraph({
              children: [new TextRun({ text: `PubMed (n=${stats.pubmedCount})`, size: 22 })],
            }),
            new Paragraph({
              children: [new TextRun({ text: `Europe PMC (n=${stats.europepmcCount})`, size: 22 })],
            }),
            new Paragraph({
              children: [new TextRun({ text: `OpenAlex (n=${stats.openalexCount})`, size: 22 })],
            }),
            new Paragraph({
              children: [new TextRun({ text: `Total identified (n=${stats.totalIdentified})`, bold: true, size: 22 })],
            }),
          ],
          2
        ),
        emptyCell(),
      ],
    })
  );

  // Row 3: arrow
  rows.push(arrowRow());

  // Row 4: SCREENING header
  rows.push(new TableRow({ children: [headerCell('SCREENING', 3)] }));

  // Row 5: after deduplication (left, span 2) | duplicates removed (right, span 1)
  rows.push(
    new TableRow({
      children: [
        dataCell(
          [
            new Paragraph({
              children: [new TextRun({ text: `Records after deduplication (n=${stats.recordsScreened})`, bold: true, size: 22 })],
            }),
          ],
          2
        ),
        dataCell(
          [
            new Paragraph({
              children: [new TextRun({ text: `Duplicates removed (n=${stats.duplicatesRemoved})`, size: 22 })],
            }),
          ],
          1
        ),
      ],
    })
  );

  // Row 6: arrow
  rows.push(arrowRow());

  // Row 7: screened (left, span 2) | excluded (right, span 1)
  rows.push(
    new TableRow({
      children: [
        dataCell(
          [
            new Paragraph({
              children: [new TextRun({ text: `Records screened (n=${stats.recordsScreened})`, bold: true, size: 22 })],
            }),
          ],
          2
        ),
        dataCell(
          [
            new Paragraph({
              children: [new TextRun({ text: `Records excluded (n=${stats.recordsExcluded})`, size: 22 })],
            }),
          ],
          1
        ),
      ],
    })
  );

  // Row 8: arrow
  rows.push(arrowRow());

  // Row 9: INCLUDED header
  rows.push(new TableRow({ children: [headerCell('INCLUDED', 3)] }));

  // Row 10: included studies
  rows.push(
    new TableRow({
      children: [
        dataCell(
          [
            new Paragraph({
              children: [
                new TextRun({ text: `Studies included in review (n=${stats.recordsIncluded})`, bold: true, size: 22 }),
              ],
            }),
          ],
          3
        ),
      ],
    })
  );

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [3600, 2400, 2400], // twips, total ~8400 for A4
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Main export
// ──────────────────────────────────────────────────────────────────────────────

export async function generateDocx(params: {
  title: string;
  sections: ManuscriptSection[];
  references: string[];
  stats: PRISMAStats;
  queries: { pubmed: string; europepmc: string; openalex: string } | null;
  criteria: { inclusion: string; exclusion: string } | null;
}): Promise<Buffer> {
  const { title, sections, references, stats, queries, criteria } = params;

  const getSection = (id: string) => sections.find((s) => s.id === id);

  const today = new Date().toISOString().split('T')[0];

  // ── Title page ──
  const titlePageChildren: Paragraph[] = [
    new Paragraph({
      children: [
        new TextRun({ text: title, bold: true, size: 40, color: PRIMARY_HEX }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 1440, after: 360 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'A Systematic Review', size: 28, italics: true })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `Date: ${today}`, size: 24 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'Conducted using H Evidence AI SLR Tool', size: 22, color: '666666' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 1440 },
    }),
    new Paragraph({
      children: [new PageBreak()],
    }),
  ];

  // ── Abstract ──
  const abstractSection = getSection('abstract');
  const abstractChildren: Paragraph[] = [
    heading1('Abstract'),
    ...(abstractSection ? contentParagraphs(abstractSection.content) : [bodyParagraph('[Abstract not generated]')]),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  // ── Introduction ──
  const introSection = getSection('introduction');
  const introChildren: Paragraph[] = [
    heading1('Introduction'),
    ...(introSection ? contentParagraphs(introSection.content) : [bodyParagraph('[Introduction not generated]')]),
  ];

  // ── Methods ──
  const methodsSection = getSection('methods');
  const methodsChildren: Paragraph[] = [
    heading1('Methods'),
    ...(methodsSection ? contentParagraphs(methodsSection.content) : [bodyParagraph('[Methods not generated]')]),
  ];

  if (queries) {
    methodsChildren.push(
      heading2('Search Strategies'),
      bodyParagraph('The following search strategies were used for each database:'),
      new Paragraph({
        children: [new TextRun({ text: `PubMed: ${queries.pubmed}`, font: 'Courier New', size: 20 })],
        spacing: { before: 100, after: 60 },
        indent: { left: 720 },
      }),
      new Paragraph({
        children: [new TextRun({ text: `Europe PMC: ${queries.europepmc}`, font: 'Courier New', size: 20 })],
        spacing: { before: 60, after: 60 },
        indent: { left: 720 },
      }),
      new Paragraph({
        children: [new TextRun({ text: `OpenAlex: ${queries.openalex}`, font: 'Courier New', size: 20 })],
        spacing: { before: 60, after: 100 },
        indent: { left: 720 },
      })
    );
  }

  if (criteria) {
    methodsChildren.push(heading2('Eligibility Criteria'));
    methodsChildren.push(bodyParagraph('Inclusion criteria:'));
    criteria.inclusion
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((line) => methodsChildren.push(bulletParagraph(line)));
    methodsChildren.push(bodyParagraph('Exclusion criteria:'));
    criteria.exclusion
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((line) => methodsChildren.push(bulletParagraph(line)));
  }

  // ── Results ──
  const resultsSection = getSection('results');
  const resultsChildren: (Paragraph | Table)[] = [
    heading1('Results'),
    ...(resultsSection ? contentParagraphs(resultsSection.content) : [bodyParagraph('[Results not generated]')]),
    new Paragraph({ text: '', spacing: { before: 200, after: 200 } }),
    heading2('PRISMA Flow Diagram'),
    buildPrismaTable(stats),
    new Paragraph({ text: '', spacing: { before: 200, after: 200 } }),
  ];

  // ── Discussion ──
  const discussionSection = getSection('discussion');
  const discussionChildren: Paragraph[] = [
    heading1('Discussion'),
    ...(discussionSection ? contentParagraphs(discussionSection.content) : [bodyParagraph('[Discussion not generated]')]),
  ];

  // ── Conclusions ──
  const conclusionsSection = getSection('conclusions');
  const conclusionsChildren: Paragraph[] = [
    heading1('Conclusions'),
    ...(conclusionsSection ? contentParagraphs(conclusionsSection.content) : [bodyParagraph('[Conclusions not generated]')]),
  ];

  // ── References ──
  const referenceChildren: Paragraph[] = [
    heading1('References'),
    ...references.map(
      (ref) =>
        new Paragraph({
          children: [new TextRun({ text: ref, size: 22 })],
          indent: { left: 720, hanging: 720 },
          spacing: { before: 100, after: 100 },
        })
    ),
  ];

  if (references.length === 0) {
    referenceChildren.push(bodyParagraph('[No references — no included studies with metadata.]'));
  }

  // ── Assemble all children into one section ──
  const allChildren: (Paragraph | Table)[] = [
    ...titlePageChildren,
    ...abstractChildren,
    ...introChildren,
    ...methodsChildren,
    ...resultsChildren,
    ...discussionChildren,
    ...conclusionsChildren,
    ...referenceChildren,
  ];

  const doc = new Document({
    creator: 'H Evidence AI SLR Tool',
    title,
    description: 'Systematic Review Manuscript — generated by H Evidence AI SLR Tool',
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 24 },
        },
      },
    },
    sections: [
      {
        children: allChildren,
      },
    ],
  });

  return Packer.toBuffer(doc) as Promise<Buffer>;
}
