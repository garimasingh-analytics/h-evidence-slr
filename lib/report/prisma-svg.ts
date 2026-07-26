import type { PRISMAStats } from './types';

const PRIMARY = '#1B3A5C';
const SECONDARY_LIGHT = '#EBF4FA';
const WHITE = '#FFFFFF';
const FONT = 'Arial, sans-serif';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  fillColor: string;
  strokeColor: string;
  textLines: { text: string; bold?: boolean; color?: string; size?: number }[];
}

function rect(b: Box): string {
  return `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${b.fillColor}" stroke="${b.strokeColor}" stroke-width="1.5" rx="4"/>`;
}

function textBlock(
  x: number,
  y: number,
  w: number,
  lines: { text: string; bold?: boolean; color?: string; size?: number }[],
  align: 'middle' | 'start' = 'middle'
): string {
  const lineH = 16;
  const totalH = lines.length * lineH;
  const startY = y - totalH / 2 + lineH / 2;

  return lines
    .map((l, i) => {
      const fontSize = l.size ?? 11;
      const fontWeight = l.bold ? 'bold' : 'normal';
      const fill = l.color ?? PRIMARY;
      const textAnchor = align === 'middle' ? 'middle' : 'start';
      const textX = align === 'middle' ? x + w / 2 : x + 8;
      return `<text x="${textX}" y="${startY + i * lineH}" font-family="${FONT}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${fill}" text-anchor="${textAnchor}" dominant-baseline="middle">${escapeXml(l.text)}</text>`;
    })
    .join('\n');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function arrow(x1: number, y1: number, x2: number, y2: number): string {
  const headSize = 6;
  // Vertical arrow (x1 === x2)
  const points = `${x2},${y2} ${x2 - headSize},${y2 - headSize * 1.5} ${x2 + headSize},${y2 - headSize * 1.5}`;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2 - headSize * 1.5}" stroke="${PRIMARY}" stroke-width="1.5"/>
<polygon points="${points}" fill="${PRIMARY}"/>`;
}

function sideArrow(x1: number, y1: number, x2: number, y2: number): string {
  const headSize = 5;
  const points = `${x2},${y2} ${x2 - headSize * 1.5},${y2 - headSize} ${x2 - headSize * 1.5},${y2 + headSize}`;
  return `<line x1="${x1}" y1="${y1}" x2="${x2 - headSize * 1.5}" y2="${y2}" stroke="${PRIMARY}" stroke-width="1.5"/>
<polygon points="${points}" fill="${PRIMARY}"/>`;
}

export function generatePRISMASVG(stats: PRISMAStats): string {
  const W = 700;
  const H = 540;

  // Column layout
  const leftX = 30;
  const leftW = 380;
  const rightX = 450;
  const rightW = 220;

  // Row y-centers
  const identHeaderY = 40;
  const identBoxY = 115;
  const screenHeaderY = 205;
  const screenBoxY = 275;
  const includedHeaderY = 365;
  const includedBoxY = 430;

  // Box heights
  const headerH = 36;
  const identH = 110;
  const screenH = 60;
  const sideH = 50;
  const includedH = 60;

  const elements: string[] = [];

  // ── IDENTIFICATION header ──
  elements.push(
    `<rect x="${leftX}" y="${identHeaderY - headerH / 2}" width="${leftW}" height="${headerH}" fill="${PRIMARY}" stroke="${PRIMARY}" stroke-width="1.5" rx="4"/>`,
    `<text x="${leftX + leftW / 2}" y="${identHeaderY}" font-family="${FONT}" font-size="12" font-weight="bold" fill="${WHITE}" text-anchor="middle" dominant-baseline="middle">IDENTIFICATION</text>`
  );

  // Identification box
  const identLines = [
    { text: 'Records identified from databases:', bold: true },
    { text: `PubMed (n=${stats.pubmedCount})` },
    { text: `Europe PMC (n=${stats.europepmcCount})` },
    { text: `OpenAlex (n=${stats.openalexCount})` },
    { text: `Total identified (n=${stats.totalIdentified})`, bold: true },
  ];
  elements.push(
    `<rect x="${leftX}" y="${identBoxY - identH / 2}" width="${leftW}" height="${identH}" fill="${SECONDARY_LIGHT}" stroke="${PRIMARY}" stroke-width="1.5" rx="4"/>`,
    textBlock(leftX, identBoxY, leftW, identLines, 'start')
  );

  // Arrow down from identification to screening header
  const arrowY1 = identBoxY + identH / 2;
  const arrowY2 = screenHeaderY - headerH / 2;
  elements.push(arrow(leftX + leftW / 2, arrowY1, leftX + leftW / 2, arrowY2));

  // ── SCREENING header ──
  elements.push(
    `<rect x="${leftX}" y="${screenHeaderY - headerH / 2}" width="${leftW}" height="${headerH}" fill="${PRIMARY}" stroke="${PRIMARY}" stroke-width="1.5" rx="4"/>`,
    `<text x="${leftX + leftW / 2}" y="${screenHeaderY}" font-family="${FONT}" font-size="12" font-weight="bold" fill="${WHITE}" text-anchor="middle" dominant-baseline="middle">SCREENING</text>`
  );

  // Dedup box (records after dedup) — using recordsScreened as the post-dedup count
  elements.push(
    `<rect x="${leftX}" y="${screenBoxY - screenH / 2}" width="${leftW}" height="${screenH}" fill="${SECONDARY_LIGHT}" stroke="${PRIMARY}" stroke-width="1.5" rx="4"/>`,
    textBlock(leftX, screenBoxY, leftW, [
      { text: `Records after deduplication (n=${stats.recordsScreened})`, bold: true },
      { text: `Screened for title/abstract` },
    ], 'start')
  );

  // Side arrow → duplicates removed
  const dedupSideY = screenBoxY;
  elements.push(sideArrow(leftX + leftW, dedupSideY, rightX + rightW, dedupSideY));
  elements.push(
    `<rect x="${rightX}" y="${dedupSideY - sideH / 2}" width="${rightW}" height="${sideH}" fill="${SECONDARY_LIGHT}" stroke="${PRIMARY}" stroke-width="1.5" rx="4"/>`,
    textBlock(rightX, dedupSideY, rightW, [
      { text: 'Duplicates removed', bold: true },
      { text: `(n=${stats.duplicatesRemoved})` },
    ])
  );

  // Arrow down from screening box to included header
  const arrowY3 = screenBoxY + screenH / 2;
  const arrowY4 = includedHeaderY - headerH / 2;

  // Excluded side box sits mid-way
  const excludedSideY = (arrowY3 + arrowY4) / 2;
  elements.push(arrow(leftX + leftW / 2, arrowY3, leftX + leftW / 2, excludedSideY - sideH / 2));

  // Excluded box row
  elements.push(
    `<rect x="${leftX}" y="${excludedSideY - sideH / 2}" width="${leftW}" height="${sideH}" fill="${SECONDARY_LIGHT}" stroke="${PRIMARY}" stroke-width="1.5" rx="4"/>`,
    textBlock(leftX, excludedSideY, leftW, [
      { text: `Records excluded (n=${stats.recordsExcluded})`, bold: true },
    ], 'start')
  );
  elements.push(sideArrow(leftX + leftW, excludedSideY, rightX + rightW, excludedSideY));
  elements.push(
    `<rect x="${rightX}" y="${excludedSideY - sideH / 2}" width="${rightW}" height="${sideH}" fill="${SECONDARY_LIGHT}" stroke="${PRIMARY}" stroke-width="1.5" rx="4"/>`,
    textBlock(rightX, excludedSideY, rightW, [
      { text: 'After title/abstract', bold: false },
      { text: 'screening' },
    ])
  );

  elements.push(arrow(leftX + leftW / 2, excludedSideY + sideH / 2, leftX + leftW / 2, arrowY4));

  // ── INCLUDED header ──
  elements.push(
    `<rect x="${leftX}" y="${includedHeaderY - headerH / 2}" width="${leftW}" height="${headerH}" fill="${PRIMARY}" stroke="${PRIMARY}" stroke-width="1.5" rx="4"/>`,
    `<text x="${leftX + leftW / 2}" y="${includedHeaderY}" font-family="${FONT}" font-size="12" font-weight="bold" fill="${WHITE}" text-anchor="middle" dominant-baseline="middle">INCLUDED</text>`
  );

  // Included box
  const arrowY5 = includedHeaderY + headerH / 2;
  elements.push(arrow(leftX + leftW / 2, arrowY5, leftX + leftW / 2, includedBoxY - includedH / 2));
  elements.push(
    `<rect x="${leftX}" y="${includedBoxY - includedH / 2}" width="${leftW}" height="${includedH}" fill="${SECONDARY_LIGHT}" stroke="${PRIMARY}" stroke-width="1.5" rx="4"/>`,
    textBlock(leftX, includedBoxY, leftW, [
      { text: `Studies included in review (n=${stats.recordsIncluded})`, bold: true },
    ], 'start')
  );

  const svgContent = elements.join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="white"/>
  ${svgContent}
</svg>`;
}
