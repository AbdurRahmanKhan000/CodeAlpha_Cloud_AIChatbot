import { jsPDF } from 'jspdf';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Header, Footer, ImageRun,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
} from 'docx';

/**
 * arkAI answer export: professional PDF & Word documents.
 * - arkAI logo at the top of EVERY page (PDF header stamp / Word header)
 * - Real formatted tables (never raw markdown pipes)
 * - Text normalised so maths symbols never garble
 * - Metadata card: model used, gateway, date, the question asked
 */

export interface ExportMeta {
  question: string;
  answer: string;
  modelName?: string;
  modelId?: string;
  gatewayName?: string;
  generatedAt?: Date;
}

// ------------------------------------------------------------ block parsing
type InlineRun = { text: string; bold?: boolean; italic?: boolean; code?: boolean };
type Block =
  | { kind: 'heading'; level: number; runs: InlineRun[] }
  | { kind: 'paragraph'; runs: InlineRun[] }
  | { kind: 'list'; ordered: boolean; items: InlineRun[][] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'hr' }
  | { kind: 'quote'; runs: InlineRun[] };

export function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*\n]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0; let m: RegExpExecArray | null;
  const push = (t: string, extra: Partial<InlineRun> = {}) => {
    if (!t) return;
    runs.push({ text: t.replace(/<br\s*\/?>/gi, '\n'), ...extra });
  };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index));
    if (m[2] !== undefined) push(m[2], { bold: true });
    else if (m[3] !== undefined) push(m[3], { italic: true });
    else if (m[4] !== undefined) push(m[4], { code: true });
    else if (m[5] !== undefined) push(m[5]);
    last = m.index + m[0].length;
  }
  push(text.slice(last));
  return runs.length ? runs : [{ text }];
}

const plain = (runs: InlineRun[]) => runs.map(r => r.text).join('');

function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\||\|$/g, '');
  return inner.split('|').map(c => plain(parseInline(c.trim())));
}

export function parseBlocks(markdown: string): Block[] {
  const lines = (markdown || '').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  const isTableStart = (idx: number) =>
    idx + 1 < lines.length &&
    lines[idx].trim().startsWith('|') &&
    /^\|?[\s:|-]+\|?$/.test(lines[idx + 1].trim()) &&
    lines[idx + 1].includes('-');

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed) { i++; continue; }
    if (trimmed.startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) { buf.push(lines[i]); i++; }
      i++;
      blocks.push({ kind: 'code', text: buf.join('\n') });
      continue;
    }
    if (isTableStart(i)) {
      const headers = splitRow(lines[i]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = splitRow(lines[i]);
        while (cells.length < headers.length) cells.push('');
        rows.push(cells.slice(0, headers.length));
        i++;
      }
      blocks.push({ kind: 'table', headers, rows });
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (h) { blocks.push({ kind: 'heading', level: h[1].length, runs: parseInline(h[2]) }); i++; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { blocks.push({ kind: 'hr' }); i++; continue; }
    if (trimmed.startsWith('>')) { blocks.push({ kind: 'quote', runs: parseInline(trimmed.replace(/^>\s?/, '')) }); i++; continue; }
    if (/^([-*+]|\d+[.)])\s+/.test(trimmed)) {
      const ordered = /^\d+[.)]\s+/.test(trimmed);
      const items: InlineRun[][] = [];
      while (i < lines.length && /^([-*+]|\d+[.)])\s+/.test(lines[i].trim())) {
        items.push(parseInline(lines[i].trim().replace(/^([-*+]|\d+[.)])\s+/, '')));
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    const buf = [trimmed];
    i++;
    while (i < lines.length && lines[i].trim() &&
           !/^(#{1,4})\s/.test(lines[i].trim()) &&
           !lines[i].trim().startsWith('```') &&
           !lines[i].trim().startsWith('|') &&
           !/^([-*+]|\d+[.)])\s+/.test(lines[i].trim()) &&
           !lines[i].trim().startsWith('>') &&
           !/^(-{3,}|\*{3,})$/.test(lines[i].trim())) {
      buf.push(lines[i].trim());
      i++;
    }
    blocks.push({ kind: 'paragraph', runs: parseInline(buf.join(' ')) });
  }
  return blocks;
}

// ------------------------------------------------------- text normalisation
const SYMBOL_MAP: Record<string, string> = {
  '≈': '~', '≅': '~', '≠': '!=', '≤': '<=', '≥': '>=', '→': '->', '←': '<-',
  '⇒': '=>', '√': 'sqrt', '∞': 'infinity', 'π': 'pi', 'θ': 'theta',
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'λ': 'lambda', 'Δ': 'Delta',
  'Σ': 'sum', 'Ω': 'omega', 'μ': 'mu', '−': '-', '×': 'x', '÷': '/',
  '·': '.', '✓': 'v', '✔': 'v', '✗': 'x', '★': '*',
};
const PDF_SAFE_EXTRA = new Set(['–', '—', '‘', '’', '“', '”', '•', '…', '€', '™', '©', '®', '°', '±', '²', '³', '¹', '¼', '½', '¾']);

/** NFKC folds maths-styled letters back to plain text; the symbol map and a
 *  WinAnsi filter keep jsPDF standard fonts from printing garbage. */
/** Convert LaTeX fragments to readable plain text for documents. */
export function latexToText(text: string): string {
  let t = text || '';
  t = t.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)');
  t = t.replace(/\\sqrt\{([^{}]*)\}/g, 'sqrt($1)');
  t = t.replace(/\\(?:times|cdot|div|pm|approx|leq|geq|neq|infty|pi|theta|alpha|beta|lambda|Delta|sum)\b/g, (m) => {
    const map: Record<string, string> = {
      '\\times': 'x', '\\cdot': '.', '\\div': '/', '\\pm': '+/-', '\\approx': '~',
      '\\leq': '<=', '\\geq': '>=', '\\neq': '!=', '\\infty': 'infinity', '\\pi': 'pi',
      '\\theta': 'theta', '\\alpha': 'alpha', '\\beta': 'beta', '\\lambda': 'lambda',
      '\\Delta': 'Delta', '\\sum': 'sum',
    };
    return map[m] ?? m;
  });
  t = t.replace(/\\[()\[\]]/g, '');
  t = t.replace(/\$(\$)?/g, '');
  t = t.replace(/\^\{([^{}])\}/g, '^$1');
  return t;
}

export function sanitizeForPdf(text: string): string {
  const norm = latexToText(text || '').normalize('NFKC');
  let out = '';
  for (const ch of norm) {
    if (SYMBOL_MAP[ch] !== undefined) { out += SYMBOL_MAP[ch]; continue; }
    const code = ch.codePointAt(0) || 0;
    if (code < 256 || PDF_SAFE_EXTRA.has(ch) || ch === '\n') out += ch;
  }
  return out.replace(/[ \t]{2,}/g, ' ');
}

export function sanitizeForDocx(text: string): string {
  return latexToText(text || '').normalize('NFKC').replace(/[ \t]{2,}/g, ' ');
}

const pdfRuns = (runs: InlineRun[]): InlineRun[] => runs.map(r => ({ ...r, text: sanitizeForPdf(r.text) }));
const docxRuns = (runs: InlineRun[]): InlineRun[] => runs.map(r => ({ ...r, text: sanitizeForDocx(r.text) }));

function fileSlug(question: string): string {
  const slug = (question || 'answer').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 48);
  return `arkAI-answer-${slug || 'chat'}`;
}

async function loadLogoPng(): Promise<string | null> {
  try {
    const res = await fetch('logo.svg');
    if (!res.ok) return null;
    const svgText = await res.text();
    const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('logo load failed'));
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = 240; canvas.height = 240;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, 240, 240);
      return canvas.toDataURL('image/png');
    } finally { URL.revokeObjectURL(url); }
  } catch { return null; }
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------------------------------------------------------------- PDF
const INDIGO: [number, number, number] = [79, 70, 229];
const DARK: [number, number, number] = [24, 24, 27];
const GRAY: [number, number, number] = [113, 113, 122];
const LIGHT_LINE: [number, number, number] = [228, 228, 231];
const HEADER_FILL: [number, number, number] = [224, 231, 255];
const ROW_ALT: [number, number, number] = [248, 250, 252];

export async function downloadAnswerAsPdf(meta: ExportMeta): Promise<void> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 48;
  const contentW = pageW - M * 2;
  const logo = await loadLogoPng();
  const dateStr = (meta.generatedAt || new Date()).toLocaleString();

  const drawHeader = () => {
    if (logo) { try { doc.addImage(logo, 'PNG', M, 26, 30, 30); } catch { /* text fallback */ } }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(...INDIGO);
    doc.text('arkAI', M + 40, 48);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GRAY);
    doc.text('O R C H E S T R A T E D   A I  -  T H E   B E S T   M O D E L   F O R   E V E R Y   Q U E S T I O N', M + 40, 60);
    doc.setDrawColor(...INDIGO); doc.setLineWidth(1.4);
    doc.line(M, 70, pageW - M, 70);
  };

  drawHeader();
  let y = 92;
  let pageTotal = 1;

  // Metadata card
  const metaLines = [
    `Model used: ${sanitizeForPdf(meta.modelName || 'arkAI Orchestrator')}${meta.modelId ? ` (${sanitizeForPdf(meta.modelId)})` : ''}`,
    `Gateway: ${sanitizeForPdf(meta.gatewayName || 'arkAI')}      Generated: ${dateStr}`,
    `Question: ${sanitizeForPdf(meta.question)}`,
  ];
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  const wrappedMeta = metaLines.flatMap(l => doc.splitTextToSize(l, contentW - 20) as string[]);
  const cardH = wrappedMeta.length * 12.5 + 14;
  doc.setFillColor(244, 244, 245); doc.setDrawColor(...LIGHT_LINE);
  doc.roundedRect(M, y, contentW, cardH, 6, 6, 'FD');
  doc.setTextColor(...DARK);
  wrappedMeta.forEach((l, idx) => doc.text(l, M + 10, y + 16 + idx * 12.5));
  y += cardH + 16;

  const newPageIfNeeded = (needed: number) => {
    if (y + needed > pageH - 56) {
      doc.addPage();
      pageTotal = doc.getNumberOfPages();
      drawHeader();
      y = 92;
    }
  };

  const renderRuns = (runsIn: InlineRun[], opts: { size?: number; indent?: number; color?: [number, number, number]; lineH?: number } = {}) => {
    const size = opts.size || 10.5;
    const lineH = opts.lineH || size * 1.5;
    const x0 = M + (opts.indent || 0);
    const maxW = contentW - (opts.indent || 0);
    type Word = { text: string; run: InlineRun; width: number; newline?: boolean };
    const words: Word[] = [];
    const setFontFor = (r: InlineRun) => {
      if (r.code) doc.setFont('courier', 'normal');
      else doc.setFont('helvetica', r.bold ? 'bold' : r.italic ? 'italic' : 'normal');
      doc.setFontSize(size);
    };
    for (const r of pdfRuns(runsIn)) {
      setFontFor(r);
      const segs = r.text.split('\n');
      segs.forEach((seg, si) => {
        if (si > 0) words.push({ text: '', run: r, width: 0, newline: true });
        for (const w of seg.split(/(\s+)/)) {
          if (w) words.push({ text: w, run: r, width: doc.getTextWidth(w) });
        }
      });
    }
    let x = x0;
    newPageIfNeeded(lineH);
    let lineStart = true;
    for (const word of words) {
      if (word.newline) { y += lineH; x = x0; newPageIfNeeded(lineH); lineStart = true; continue; }
      const isSpace = /^\s+$/.test(word.text);
      if (!lineStart && x + word.width > x0 + maxW && !isSpace) { y += lineH; x = x0; newPageIfNeeded(lineH); lineStart = true; }
      if (isSpace && lineStart) continue;
      setFontFor(word.run);
      doc.setTextColor(...(opts.color || DARK));
      doc.text(word.text, x, y);
      x += word.width;
      lineStart = false;
    }
    y += lineH;
  };

  const renderTable = (headers: string[], rows: string[][]) => {
    const size = 9.3; const lineH = 12.5; const padX = 6; const padY = 4.5;
    const weights = headers.map((h, ci) => {
      let max = sanitizeForPdf(h).length;
      for (const r of rows) max = Math.max(max, Math.min(46, sanitizeForPdf(r[ci] || '').length));
      return Math.max(8, max);
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
    const widths = weights.map(w => (w / totalWeight) * contentW);

    const cellLines = (text: string, ci: number, bold: boolean): string[] => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size);
      return sanitizeForPdf(text).split('\n')
        .flatMap(seg => doc.splitTextToSize(seg, Math.max(24, widths[ci] - padX * 2)) as string[]);
    };
    const drawRow = (cells: string[], isHeader: boolean, fillAlt: boolean, repeat = false) => {
      const wrapped = cells.map((c, ci) => cellLines(c, ci, isHeader));
      const rowH = Math.max(1, ...wrapped.map(w => w.length)) * lineH + padY * 2;
      if (!repeat) newPageIfNeeded(rowH + 2); else if (y + rowH > pageH - 56) { doc.addPage(); pageTotal = doc.getNumberOfPages(); drawHeader(); y = 92; }
      if (isHeader) { doc.setFillColor(...HEADER_FILL); doc.rect(M, y - 2, contentW, rowH, 'F'); }
      else if (fillAlt) { doc.setFillColor(...ROW_ALT); doc.rect(M, y - 2, contentW, rowH, 'F'); }
      doc.setDrawColor(...LIGHT_LINE); doc.setLineWidth(0.6);
      doc.rect(M, y - 2, contentW, rowH);
      let x = M;
      wrapped.forEach((cellText, ci) => {
        if (ci > 0) doc.line(x, y - 2, x, y - 2 + rowH);
        doc.setFont('helvetica', isHeader ? 'bold' : 'normal'); doc.setFontSize(size);
        doc.setTextColor(...DARK);
        cellText.forEach((l, li) => doc.text(l, x + padX, y + padY + lineH * 0.82 + li * lineH));
        x += widths[ci];
      });
      y += rowH - 2;
    };
    drawRow(headers, true, false);
    rows.forEach((r, ri) => drawRow(r, false, ri % 2 === 1));
    y += 10;
  };

  for (const block of parseBlocks(meta.answer)) {
    if (block.kind === 'heading') {
      const sizes = [0, 15.5, 13.5, 12, 11.5];
      y += block.level <= 2 ? 8 : 5;
      newPageIfNeeded(22);
      renderRuns(block.runs.map(r => ({ ...r, bold: true })), { size: sizes[block.level] || 11.5, lineH: (sizes[block.level] || 11.5) * 1.35 });
      y += 2;
    } else if (block.kind === 'paragraph') {
      renderRuns(block.runs, {});
      y += 3;
    } else if (block.kind === 'quote') {
      renderRuns(block.runs, { indent: 12, color: GRAY });
      y += 3;
    } else if (block.kind === 'list') {
      block.items.forEach((item, idx) => {
        const marker = block.ordered ? `${idx + 1}.` : '•';
        newPageIfNeeded(16);
        const startY = y;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...DARK);
        doc.text(sanitizeForPdf(marker), M + 6, startY);
        renderRuns(item, { indent: 22 });
        y -= 3;
      });
      y += 6;
    } else if (block.kind === 'code') {
      const size = 8.6; const lineH = 12;
      doc.setFont('courier', 'normal'); doc.setFontSize(size);
      const codeLines = sanitizeForPdf(block.text).split('\n')
        .flatMap(l => (doc.splitTextToSize(l, contentW - 20) as string[]));
      const h = codeLines.length * lineH + 12;
      newPageIfNeeded(Math.min(h, 90));
      doc.setFillColor(244, 244, 245); doc.setDrawColor(...LIGHT_LINE);
      doc.roundedRect(M, y - 4, contentW, Math.min(h, pageH - 56 - y), 5, 5, 'FD');
      doc.setTextColor(...DARK);
      codeLines.forEach((l, li) => {
        const ly = y + 10 + li * lineH;
        if (ly < pageH - 56) doc.text(l, M + 10, ly);
      });
      y += h + 8;
    } else if (block.kind === 'table') {
      renderTable(block.headers, block.rows);
    } else if (block.kind === 'hr') {
      y += 4;
      newPageIfNeeded(10);
      doc.setDrawColor(...LIGHT_LINE); doc.setLineWidth(0.8);
      doc.line(M, y, pageW - M, y);
      y += 10;
    }
  }

  // Footers with the real page total, stamped on every page
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(...LIGHT_LINE); doc.setLineWidth(0.6);
    doc.line(M, pageH - 40, pageW - M, pageH - 40);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRAY);
    doc.text('arkAI - Orchestrated AI', M, pageH - 26);
    const label = `Page ${p} of ${total}`;
    doc.text(label, pageW - M - doc.getTextWidth(label), pageH - 26);
  }

  doc.save(`${fileSlug(meta.question)}.pdf`);
}

// ---------------------------------------------------------------- Word
function toDocxRuns(runs: InlineRun[], size = 22): TextRun[] {
  return docxRuns(runs).flatMap(r => r.text.split('\n').map((seg, i) => new TextRun({
    text: seg, bold: !!r.bold, italics: !!r.italic,
    font: r.code ? 'Consolas' : 'Calibri', size,
    break: i > 0 ? 1 : undefined,
  })));
}

export async function downloadAnswerAsDocx(meta: ExportMeta): Promise<void> {
  const logo = await loadLogoPng();
  let logoRun: ImageRun | null = null;
  if (logo) {
    try {
      const bytes = Uint8Array.from(atob(logo.split(',')[1]), c => c.charCodeAt(0));
      logoRun = new ImageRun({ data: bytes, transformation: { width: 34, height: 34 }, type: 'png' } as any);
    } catch { logoRun = null; }
  }

  const dateStr = (meta.generatedAt || new Date()).toLocaleString();
  const cellBorders = {
    top: { style: BorderStyle.SINGLE, size: 4, color: 'D4D4D8' },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D4D4D8' },
    left: { style: BorderStyle.SINGLE, size: 4, color: 'D4D4D8' },
    right: { style: BorderStyle.SINGLE, size: 4, color: 'D4D4D8' },
  };

  const body: any[] = [
    new Paragraph({
      children: [new TextRun({ text: 'arkAI - Answer Export', bold: true, size: 30, color: '4F46E5', font: 'Calibri' })],
      spacing: { after: 60 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: 'Model used: ', bold: true, size: 20 }),
        new TextRun({ text: `${meta.modelName || 'arkAI Orchestrator'}${meta.modelId ? ` (${meta.modelId})` : ''}`, size: 20 }),
      ],
      shading: { type: ShadingType.CLEAR, fill: 'F4F4F5' },
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: 'Gateway: ', bold: true, size: 20 }),
        new TextRun({ text: `${meta.gatewayName || 'arkAI'}    Generated: ${dateStr}`, size: 20 }),
      ],
      shading: { type: ShadingType.CLEAR, fill: 'F4F4F5' },
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: 'Question: ', bold: true, size: 20 }),
        new TextRun({ text: sanitizeForDocx(meta.question), size: 20 }),
      ],
      shading: { type: ShadingType.CLEAR, fill: 'F4F4F5' },
      spacing: { after: 200 },
    }),
  ];

  for (const block of parseBlocks(meta.answer)) {
    if (block.kind === 'heading') {
      const levels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];
      body.push(new Paragraph({ heading: levels[block.level] || HeadingLevel.HEADING_2, children: toDocxRuns(block.runs.map(r => ({ ...r, bold: true })), 26), spacing: { before: 220, after: 90 } }));
    } else if (block.kind === 'paragraph') {
      body.push(new Paragraph({ children: toDocxRuns(block.runs), spacing: { after: 110 } }));
    } else if (block.kind === 'quote') {
      body.push(new Paragraph({ children: toDocxRuns(block.runs.map(r => ({ ...r, italic: true }))), indent: { left: 360 }, spacing: { after: 110 } }));
    } else if (block.kind === 'list') {
      block.items.forEach((item, idx) => {
        body.push(new Paragraph({
          children: [new TextRun({ text: block.ordered ? `${idx + 1}.  ` : '•  ', size: 22 }), ...toDocxRuns(item)],
          indent: { left: 360, hanging: 180 }, spacing: { after: 60 },
        }));
      });
      body.push(new Paragraph({ spacing: { after: 80 } }));
    } else if (block.kind === 'code') {
      body.push(new Paragraph({
        children: [new TextRun({ text: sanitizeForDocx(block.text), font: 'Consolas', size: 18 })],
        shading: { type: ShadingType.CLEAR, fill: 'F4F4F5' }, spacing: { after: 140 },
      }));
    } else if (block.kind === 'table') {
      const headerRow = new TableRow({
        tableHeader: true,
        children: block.headers.map(h => new TableCell({
          borders: cellBorders,
          shading: { type: ShadingType.CLEAR, fill: 'E0E7FF' },
          children: [new Paragraph({ children: [new TextRun({ text: sanitizeForDocx(h), bold: true, size: 20, font: 'Calibri' })] })],
        })),
      });
      const dataRows = block.rows.map((row, ri) => new TableRow({
        children: row.map(cell => new TableCell({
          borders: cellBorders,
          shading: ri % 2 === 1 ? { type: ShadingType.CLEAR, fill: 'F8FAFC' } : undefined,
          children: [new Paragraph({ children: toDocxRuns(parseInline(cell), 20) })],
        })),
      }));
      body.push(new Table({ rows: [headerRow, ...dataRows], width: { size: 100, type: WidthType.PERCENTAGE } }));
      body.push(new Paragraph({ spacing: { after: 120 } }));
    } else if (block.kind === 'hr') {
      body.push(new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'E4E4E7' } },
        spacing: { after: 160 },
      }));
    }
  }

  const headerPara = new Paragraph({
    children: [
      ...(logoRun ? [logoRun, new TextRun({ text: '  ' })] : []),
      new TextRun({ text: 'arkAI', bold: true, size: 26, color: '4F46E5', font: 'Calibri' }),
      new TextRun({ text: '   ORCHESTRATED AI - THE BEST MODEL FOR EVERY QUESTION', size: 15, color: '71717A', font: 'Calibri' }),
    ],
    border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: '4F46E5' } },
    spacing: { after: 120 },
  });
  const footerPara = new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'arkAI - Orchestrated AI', size: 16, color: '71717A', font: 'Calibri' })],
  });

  const document = new Document({
    sections: [{
      headers: { default: new Header({ children: [headerPara] }) },
      footers: { default: new Footer({ children: [footerPara] }) },
      children: body,
    }],
  });

  const blob = await Packer.toBlob(document);
  saveBlob(blob, `${fileSlug(meta.question)}.docx`);
}

export async function downloadAnswer(meta: ExportMeta, format: 'pdf' | 'docx'): Promise<void> {
  if (format === 'pdf') return downloadAnswerAsPdf(meta);
  return downloadAnswerAsDocx(meta);
}

// Aliases matching the names the UI imports
export const downloadAnswerPdf = downloadAnswerAsPdf;
export const downloadAnswerDocx = downloadAnswerAsDocx;
