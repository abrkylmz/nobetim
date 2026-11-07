import * as XLSX from "xlsx";
import { analyzeGrid, mergeResults, type TableResult } from "./TableAnalyzer.js";
import { ParseError, type Grid, type GridValue } from "./types.js";

const MAX_SHEETS = 25;
const MAX_ROWS = 600;
const MAX_COLS = 120;

/** Biçim dizesinde (ör. "dd/mm", "m/d/yy", "[$-41F]d mmm") gün mü ay mı önce geliyor? Varsayılan: gün (Türkçe). */
function markDayFirst(d: Date, fmt: string) {
  const plain = fmt.replace(/\[[^\]]*\]|"[^"]*"/g, "").toLowerCase();
  const di = plain.indexOf("d"), mi = plain.indexOf("m");
  (d as Date & { dayFirst?: boolean }).dayFirst = !(mi >= 0 && (di < 0 || mi < di));
}

function cellValue(cell: XLSX.CellObject | undefined): GridValue {
  if (!cell || cell.v == null) return null;
  const fmt = (cell.z as string | undefined) ?? "";
  const looksDate = fmt ? XLSX.SSF.is_date(fmt) : typeof cell.w === "string" && /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$|^\d{1,2}:\d{2}/.test(cell.w);
  if (cell.t === "n" && looksDate) {
    const p = XLSX.SSF.parse_date_code(cell.v as number);
    if (p) {
      const d = new Date(Date.UTC(p.y, p.m - 1, p.d, p.H, p.M));
      // Excel "16/08" gibi saat kodlarını tarihe çevirebilir; gün mü ay mı önce yazıldığını sakla
      markDayFirst(d, fmt || String(cell.w ?? ""));
      return d;
    }
  }
  if (cell.t === "d" && cell.v instanceof Date) return cell.v;
  if (cell.t === "e") return null;
  return cell.v as GridValue;
}

/** Sayfayı ızgaraya çevirir; birleştirilmiş hücrelerin değeri kapsadığı tüm hücrelere yayılır. */
export function sheetToGrid(sheet: XLSX.WorkSheet): Grid {
  if (!sheet["!ref"]) return [];
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const rows = Math.min(range.e.r - range.s.r + 1, MAX_ROWS);
  const cols = Math.min(range.e.c - range.s.c + 1, MAX_COLS);
  const grid: Grid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) =>
      cellValue(sheet[XLSX.utils.encode_cell({ r: r + range.s.r, c: c + range.s.c })] as XLSX.CellObject | undefined)));

  for (const m of sheet["!merges"] ?? []) {
    const v = grid[m.s.r - range.s.r]?.[m.s.c - range.s.c];
    if (v == null) continue;
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        const rr = r - range.s.r, cc = c - range.s.c;
        if (rr < rows && cc < cols && grid[rr]) grid[rr][cc] = v;
      }
    }
  }
  return grid;
}

export interface ExcelParseResult extends TableResult { sheetCount: number; csv: string }

export function parseExcel(buf: Buffer): ExcelParseResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "buffer", sheetRows: MAX_ROWS, cellNF: true, cellFormula: false, cellHTML: false, bookVBA: false });
  } catch (e) {
    throw new ParseError(`excel: ${(e as Error).message}`, "Excel dosyası açılamadı. Dosya bozuk veya parola korumalı olabilir.");
  }
  const names = wb.SheetNames.slice(0, MAX_SHEETS);
  const parts: TableResult[] = [];
  let csv = "";
  for (const name of names) {
    const sheet = wb.Sheets[name];
    const grid = sheetToGrid(sheet);
    const res = analyzeGrid(grid);
    if (res.rows.length) parts.push(res);
    // Yerel çözümleme başarısız olursa yapay zekâya gönderilecek metin
    if (csv.length < 200_000) csv += `### Sayfa: ${name}\n${XLSX.utils.sheet_to_csv(sheet, { blankrows: false })}\n\n`;
  }
  return { ...mergeResults(parts), sheetCount: names.length, csv };
}
