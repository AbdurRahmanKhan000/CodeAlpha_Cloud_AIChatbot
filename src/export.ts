/**
 * arkAI Answer Export - branded PDF & Word downloads for a single AI reply.
 *
 * Both formats carry the arkAI logo + wordmark at the top of EVERY page,
 * a metadata strip (model used, gateway, date, original question), styled
 * content (headings, lists, code blocks) and a footer with page numbers.
 * PDF: jsPDF (header/footer drawn on each page). Word: docx (real Word
 * header/footer sections repeat on every page automatically).
 */
import { jsPDF } from 'jspdf';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Header, Footer, PageNumber, ImageRun, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle,
} from 'docx';

export interface ExportMeta {
  question: string;
  answer: string;
  modelName: string;
  modelId?: string;
  gatewayName?: string;
  generatedAt?: Date;
}

const BRAND = { navy: [24, 24, 27] as const, indigo: [99, 102, 241] as const, cyan: [6, 182, 212] as const, violet: [139, 92, 246] as const, light: [244, 244, 245] as const, grey: [113, 113, 122] as const };

/** Rasterise public/logo.svg to a PNG data URL (for embedding in files). */
async function loadLogoPng(): Promise<string | null> {
  try {
    const res = await fetch('logo.svg');
    if (!res.ok) return null;
    const svgText = await res.text();
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
      const canvas = document.createElement('canvas');
      canvas.width = 240; canvas.height = 240;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, 240, 240);
      return canvas.toDataURL('image/png');
    } finally { URL.revokeObjectURL(url); }
  } catch { return null; }
}

/** Split markdown into simple blocks: heading / code / list / paragraph. */
export function parseMarkdownBlocks(md: string): Array<{ type: string; text: string; level?: number }> {
  const blocks: Array<{ type: string; text: string; level?: number }> = [];
  const lines = (md || '').split('\n');
  let inCode = false; let codeBuf: string[] = []; let paraBuf: string[] = [];
  const flushPara = () => { if (paraBuf.length) { blocks.push({ type: 'paragraph', text: paraBuf.join(' ').trim() }); paraBuf = []; } };
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCode) { blocks.push({ type: 'code', text: codeBuf.join('\n') }); codeBuf = []; inCode = false; }
      else { flushPara(); inCode = true; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { flushPara(); blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() }); continue; }
    const li = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
    if (li) { flushPara(); blocks.push({ type: 'list', text: li[1].trim() }); continue; }
    if (!line.trim()) { flushPara(); continue; }
    paraBuf.push(line.trim());
  }
  flushPara();
  if (codeBuf.length) blocks.push({ type: 'code', text: codeBuf.join('\n') });
  return blocks.filter(b => b.text);
}

const stripMd = (t: string) => t.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[(.*?)\]\(.*?\)/g, '$1');
const fileBase = (meta: ExportMeta) => 'arkAI-answer-' + (meta.question || 'response').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

// ------------------------------------------------------------------ PDF
export async function downloadAnswerPdf(meta: ExportMeta): Promise<void> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentW = pageW - margin * 2;
  const logo = await loadLogoPng();
  const when = (meta.generatedAt || new Date()).toLocaleString();

  const drawHeaderFooter = (pageNum: number, total: number) => {
    // header band
    doc.setFillColor(...BRAND.navy); doc.rect(0, 0, pageW, 64, 'F');
    doc.setFillColor(...BRAND.indigo); doc.rect(0, 64, pageW, 3, 'F');
    if (logo) { try { doc.addImage(logo, 'PNG', margin, 12, 40, 40); } catch { /* text logo fallback below */ } }
    if (!logo) {
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(22);
      doc.text('A', margin + 8, 44);
    }
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
    doc.text('arkAI', margin + 52, 34);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...BRAND.cyan);
    doc.text('ORCHESTRATED AI  ·  THE BEST MODEL FOR EVERY QUESTION', margin + 52, 50);
    doc.setTextColor(...BRAND.grey); doc.setFontSize(8);
    doc.text('arkAI — Orchestrated AI', margin, pageH - 24);
    doc.text(`Page ${pageNum} of ${total}`, pageW - margin, pageH - 24, { align: 'right' });
  };

  let y = 92;
  const ensureSpace = (needed: number) => { if (y + needed > pageH - 56) { doc.addPage(); y = 92; } };

  // metadata card
  doc.setFillColor(...BRAND.light); doc.roundedRect(margin, y - 14, contentW, 58, 6, 6, 'F');
  doc.setTextColor(...BRAND.navy); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
  doc.text(`Model used:  ${meta.modelName}${meta.modelId ? `  (${meta.modelId})` : ''}`, margin + 12, y + 4);
  doc.setFont('helvetica', 'normal'); doc.setTextColor(...BRAND.grey); doc.setFontSize(9);
  doc.text(`Gateway: ${meta.gatewayName || 'arkAI Orchestrator'}      Generated: ${when}`, margin + 12, y + 20);
  const qLines = doc.splitTextToSize('Question: ' + stripMd(meta.question), contentW - 24);
  doc.text(qLines.slice(0, 2), margin + 12, y + 34);
  y += 66;

  for (const block of parseMarkdownBlocks(meta.answer)) {
    const text = stripMd(block.text);
    if (block.type === 'heading') {
      ensureSpace(30);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(block.level === 1 ? 15 : 12.5);
      doc.setTextColor(...BRAND.navy);
      const lines = doc.splitTextToSize(text, contentW);
      doc.text(lines, margin, y); y += lines.length * ((block.level === 1 ? 15 : 12.5) + 4) + 4;
    } else if (block.type === 'code') {
      doc.setFont('courier', 'normal'); doc.setFontSize(8.5);
      const lines = doc.splitTextToSize(block.text, contentW - 20);
      const h = lines.length * 11 + 14;
      ensureSpace(Math.min(h, 120));
      doc.setFillColor(24, 24, 27); doc.roundedRect(margin, y - 10, contentW, Math.min(h, pageH - y - 60), 5, 5, 'F');
      doc.setTextColor(228, 228, 231);
      let ly = y + 4;
      for (const ln of lines) { if (ly > pageH - 56) { doc.addPage(); y = 92; ly = y + 4; doc.setFillColor(24, 24, 27); } doc.text(ln, margin + 10, ly); ly += 11; }
      y = ly + 10;
      doc.setTextColor(...BRAND.navy);
    } else if (block.type === 'list') {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
      const lines = doc.splitTextToSize(text, contentW - 16);
      ensureSpace(lines.length * 14 + 4);
      doc.setTextColor(...BRAND.indigo); doc.text('•', margin + 2, y);
      doc.setTextColor(...BRAND.navy); doc.text(lines, margin + 16, y);
      y += lines.length * 14 + 3;
    } else {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(39, 39, 42);
      const lines = doc.splitTextToSize(text, contentW);
      for (const ln of lines) { ensureSpace(15); doc.text(ln, margin, y); y += 14.5; }
      y += 5;
    }
  }

  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) { doc.setPage(i); drawHeaderFooter(i, total); }
  doc.save(fileBase(meta) + '.pdf');
}

// ------------------------------------------------------------------ Word
export async function downloadAnswerDocx(meta: ExportMeta): Promise<void> {
  const logo = await loadLogoPng();
  const when = (meta.generatedAt || new Date()).toLocaleString();

  const headerChildren: any[] = [];
  if (logo) {
    try {
      const pngBytes = Uint8Array.from(atob(logo.split(',')[1]), c => c.charCodeAt(0));
      headerChildren.push(new Paragraph({ children: [new ImageRun({ data: pngBytes, transformation: { width: 34, height: 34 }, type: 'png' })] }));
    } catch { /* fall through to text logo */ }
  }
  headerChildren.push(new Paragraph({
    children: [
      new TextRun({ text: 'arkAI', bold: true, size: 30, color: '18181B' }),
      new TextRun({ text: '   ORCHESTRATED AI · THE BEST MODEL FOR EVERY QUESTION', size: 15, color: '6366F1' }),
    ],
  }));

  const metaTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: [new TableCell({
      shading: { type: ShadingType.CLEAR, fill: 'F4F4F5' },
      children: [
        new Paragraph({ children: [new TextRun({ text: `Model used: ${meta.modelName}${meta.modelId ? ` (${meta.modelId})` : ''}`, bold: true, size: 19 })] }),
        new Paragraph({ children: [new TextRun({ text: `Gateway: ${meta.gatewayName || 'arkAI Orchestrator'}    Generated: ${when}`, size: 18, color: '71717A' })] }),
        new Paragraph({ children: [new TextRun({ text: `Question: ${stripMd(meta.question)}`, size: 18, color: '3F3F46' })] }),
      ],
    })] })],
  });

  const body: any[] = [metaTable, new Paragraph({ text: '' })];
  for (const block of parseMarkdownBlocks(meta.answer)) {
    const text = stripMd(block.text);
    if (block.type === 'heading') {
      body.push(new Paragraph({ text, heading: block.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2, spacing: { before: 220, after: 100 } }));
    } else if (block.type === 'code') {
      for (const ln of block.text.split('\n')) {
        body.push(new Paragraph({ shading: { type: ShadingType.CLEAR, fill: '18181B' }, children: [new TextRun({ text: ln || ' ', font: 'Consolas', size: 17, color: 'E4E4E7' })] }));
      }
      body.push(new Paragraph({ text: '' }));
    } else if (block.type === 'list') {
      body.push(new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 60 } }));
    } else {
      body.push(new Paragraph({ text, spacing: { after: 120 } }));
    }
  }

  const document = new Document({
    creator: 'arkAI', title: `arkAI Answer — ${meta.question.slice(0, 60)}`,
    sections: [{
      headers: { default: new Header({ children: headerChildren }) },
      footers: { default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: 'arkAI — Orchestrated AI   ·   Page ', size: 16, color: '71717A' }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '71717A' }),
          new TextRun({ text: ' of ', size: 16, color: '71717A' }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '71717A' }),
        ],
      })] }) },
      children: body,
    }],
  });

  const blob = await Packer.toBlob(document);
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement('a');
  a.href = url; a.download = fileBase(meta) + '.docx';
  window.document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
