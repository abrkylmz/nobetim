// PDF metin katmanını konum bilgisiyle okuyup tabloyu yeniden kurar.
// Metin katmanı yoksa (taranmış PDF) `scanned: true` döner; OCR için yapay zekâ kullanılır.

import { analyzeGrid, findLegend, mergeResults, type TableResult } from "./TableAnalyzer.js";
import { ParseError, type Grid } from "./types.js";

const MAX_PAGES = 30;

interface Seg { x: number; x2: number; y: number; fs: number; s: string }

let pdfjsPromise: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null = null;
// Çalışan (worker) modülü önceden yüklenir: sunucusuz paketlemede ayrı dosya aranmaz.
const pdfjs = () => (pdfjsPromise ??= (async () => {
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  return import("pdfjs-dist/legacy/build/pdf.mjs");
})());

const isDayNum = (s: string) => /^\d{1,2}$/.test(s) && +s >= 1 && +s <= 31;

function toLines(segs: Seg[]): Seg[][] {
  const sorted = [...segs].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Seg[][] = [];
  for (const s of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].y - s.y) <= Math.max(2, line[0].fs * 0.45)) line.push(s);
    else lines.push([s]);
  }
  // Satır içinde soldan sağa sırala; yalnızca kelime ortasından bölünmüş parçaları birleştir.
  // Sütunlara ayırma lineToRow'da yapılır (bitişik sütunlar burada birleşmesin).
  return lines.map((line) => {
    line.sort((a, b) => a.x - b.x);
    const merged: Seg[] = [];
    for (const s of line) {
      const prev = merged[merged.length - 1];
      const gap = prev ? s.x - prev.x2 : Infinity;
      if (prev && gap > -prev.fs * 0.2 && gap < prev.fs * 0.12 && !(/\d$/.test(prev.s) && /^\d/.test(s.s))) {
        prev.s += s.s;
        prev.x2 = s.x2;
      } else merged.push({ ...s });
    }
    return merged;
  });
}

/** Başlıktaki "Adı" + "Soyadı" gibi aynı etikete ait parçaları birleştirir. */
function mergeLabels(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    if (prev && s.x - prev.x2 < prev.fs * 0.45) { prev.s = `${prev.s} ${s.s}`; prev.x2 = s.x2; }
    else out.push({ ...s });
  }
  return out;
}

interface Columns { dayX: number[]; firstDay: number; spacing: number; metaX: number[]; metaLabels: string[] }

function findHeader(line: Seg[]): Columns | null {
  let best: Seg[] = [];
  for (let i = 0; i < line.length; i++) {
    if (!isDayNum(line[i].s)) continue;
    const run = [line[i]];
    for (let k = i + 1; k < line.length && isDayNum(line[k].s) && +line[k].s === +run[run.length - 1].s + 1; k++) run.push(line[k]);
    if (run.length > best.length) best = run;
  }
  if (best.length < 7) return null;
  const dayX = best.map((s) => (s.x + s.x2) / 2);
  const spacing = (dayX[dayX.length - 1] - dayX[0]) / (dayX.length - 1);
  const meta = mergeLabels(line.filter((s) => (s.x + s.x2) / 2 < dayX[0] - spacing / 2));
  return { dayX, firstDay: +best[0].s, spacing, metaX: meta.map((s) => s.x), metaLabels: meta.map((s) => s.s) };
}

function lineToRow(line: Seg[], cols: Columns): string[] {
  const nMeta = Math.max(1, cols.metaX.length);
  const row: string[] = Array(nMeta + cols.dayX.length).fill("");
  const put = (i: number, s: string) => { row[i] = row[i] ? `${row[i]} ${s}` : s; };
  for (const s of line) {
    // Hücre genişliğini aşan metinler (ör. "20:00-08:00") başladığı sütuna aittir
    const cx = s.x + Math.min(s.x2 - s.x, cols.spacing) / 2;
    if (cx < cols.dayX[0] - cols.spacing / 2) {
      let k = 0;
      for (let i = 0; i < cols.metaX.length; i++) if (cols.metaX[i] <= s.x + s.fs) k = i;
      put(k, s.s);
      continue;
    }
    let bi = -1, bd = Infinity;
    cols.dayX.forEach((x, i) => { const d = Math.abs(x - cx); if (d < bd) { bd = d; bi = i; } });
    if (bi >= 0 && bd <= cols.spacing * 0.65) put(nMeta + bi, s.s);
  }
  return row;
}

export interface PdfParseResult extends TableResult {
  pageCount: number;
  scanned: boolean;
  textLength: number;
}

export async function parsePdf(buf: Buffer): Promise<PdfParseResult> {
  const { getDocument } = await pdfjs();
  let doc;
  let task: ReturnType<typeof getDocument> | null = null;
  try {
    task = getDocument({
      data: new Uint8Array(buf),
      disableFontFace: true,
      useSystemFonts: false,
      enableXfa: false,
      verbosity: 0,
    });
    doc = await task.promise;
  } catch (e) {
    const msg = (e as Error).message ?? "";
    throw new ParseError(`pdf: ${msg}`, /password/i.test(msg)
      ? "PDF parola korumalı. Parolasız bir kopyasını yükle."
      : "PDF dosyası açılamadı. Dosya bozuk olabilir.");
  }

  const pageCount = Math.min(doc.numPages, MAX_PAGES);
  const parts: TableResult[] = [];
  const textGrid: Grid = [];
  let textLength = 0;
  let lastCols: Columns | null = null;

  for (let p = 1; p <= pageCount; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const segs: Seg[] = [];
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      const [, , c, d, e, f] = it.transform as number[];
      const fs = Math.hypot(c, d) || it.height || 8;
      segs.push({ x: e, x2: e + it.width, y: f, fs, s: it.str.trim() });
      textLength += it.str.trim().length;
    }
    const lines = toLines(segs);
    const grid: Grid = [];
    let cols: Columns | null = null;
    for (const line of lines) {
      const h = findHeader(line);
      if (h) { cols = h; lastCols = h; }
      const active = cols ?? lastCols;
      if (h) {
        const metaN = Math.max(1, h.metaLabels.length);
        grid.push([...Array.from({ length: metaN }, (_, i) => h.metaLabels[i] ?? ""), ...h.dayX.map((_, i) => h.firstDay + i)]);
      } else if (active) {
        grid.push(lineToRow(line, active));
      } else {
        grid.push([line.map((s) => s.s).join(" ")]);
      }
      textGrid.push([line.map((s) => s.s).join(" ")]);
    }
    // Önceki sayfanın başlığıyla devam eden sayfalarda başlık satırını yeniden ekle
    if (!cols && lastCols) {
      const metaN = Math.max(1, lastCols.metaLabels.length);
      grid.unshift([...Array.from({ length: metaN }, (_, i) => lastCols!.metaLabels[i] ?? ""), ...lastCols.dayX.map((_, i) => lastCols!.firstDay + i)]);
    }
    const res = analyzeGrid(grid);
    if (res.rows.length || res.month) parts.push(res);
    page.cleanup();
  }
  await task.destroy();

  const merged = mergeResults(parts);
  if (!merged.legend.length) merged.legend = findLegend(textGrid);
  if (!merged.month) {
    const fromText = analyzeGrid(textGrid);
    merged.year = fromText.year;
    merged.month = fromText.month;
  }
  return { ...merged, pageCount, textLength, scanned: textLength < 40 * pageCount };
}
