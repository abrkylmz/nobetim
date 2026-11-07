import * as XLSX from "xlsx";
import { analyzeGrid, mergeResults, type GridMeta, type TableResult } from "./TableAnalyzer.js";
import { ParseError, type Grid, type GridValue } from "./types.js";

const MAX_SHEETS = 25;
const MAX_ROWS = 600;
const MAX_COLS = 120;

/**
 * Excel bazı nöbet kodlarını kendiliğinden tarihe çevirir: "16/08" → 16 Ağustos, "08-16" → Ağustos 2016.
 * Hücrenin biçiminden gün/ay/yıl sırasını çıkarıp tarihe iliştiririz; tablo çözümleyici bununla
 * kullanıcının yazdığı metni ("16/08", "08/16") geri kurar.
 */
export type ExcelDate = Date & { excelOrder?: "dm" | "md" | "my" };

function dateOrder(fmt: string): ExcelDate["excelOrder"] {
  // Köşeli parantez ([$-41F] gibi) ve tırnaklı metinleri at; saat kısmındaki "mm" (dakika) ay sayılmasın
  const plain = fmt.replace(/\[[^\]]*\]|"[^"]*"/g, "").toLowerCase().replace(/h+[^dmy]*m+/g, "h");
  const order = [...plain].filter((ch) => ch === "d" || ch === "m" || ch === "y")
    .filter((ch, i, a) => a.indexOf(ch) === i).join("");
  if (order.startsWith("md")) return "md";
  if (!order.includes("d") && order.includes("m") && order.includes("y")) return order.startsWith("y") ? undefined : "my";
  return "dm";
}

function cellValue(cell: XLSX.CellObject | undefined): GridValue {
  if (!cell || cell.v == null) return null;
  const fmt = (cell.z as string | undefined) ?? "";
  const shown = typeof cell.w === "string" ? cell.w.trim() : "";
  const looksDate = fmt ? XLSX.SSF.is_date(fmt) : /^\d{1,4}[./-]\d{1,2}([./-]\d{1,4})?$|^\d{1,2}:\d{2}/.test(shown);
  if (cell.t === "n" && looksDate) {
    const p = XLSX.SSF.parse_date_code(cell.v as number);
    if (p) {
      const d: ExcelDate = new Date(Date.UTC(p.y, p.m - 1, p.d, p.H, p.M));
      d.excelOrder = dateOrder(fmt || shown);
      return d;
    }
  }
  if (cell.t === "n" && typeof cell.v === "number" && !Number.isInteger(cell.v) && shown) {
    // Ondalık sayılar ekranda göründüğü gibi okunur: "16,08" (16.08 değil, 16.080000000001 hiç değil)
    return shown;
  }
  if (cell.t === "d" && cell.v instanceof Date) return cell.v;
  if (cell.t === "e") return null;
  return cell.v as GridValue;
}

export interface SheetGrid { grid: Grid; meta: GridMeta }

/**
 * Sayfayı ızgaraya çevirir:
 *  - gizli satır ve sütunlar atlanır (kullanıcının gördüğü tablo okunur),
 *  - birleştirilmiş hücrelerin değeri kapsadığı hücrelere yayılır ve bu hücreler "devam" olarak işaretlenir.
 */
export function sheetToGrid(sheet: XLSX.WorkSheet): SheetGrid {
  const empty: SheetGrid = { grid: [], meta: {} };
  if (!sheet["!ref"]) return empty;
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const hiddenCol = (c: number) => !!sheet["!cols"]?.[c]?.hidden;
  const hiddenRow = (r: number) => !!sheet["!rows"]?.[r]?.hidden;

  const srcRows: number[] = [], srcCols: number[] = [];
  for (let r = range.s.r; r <= range.e.r && srcRows.length < MAX_ROWS; r++) if (!hiddenRow(r)) srcRows.push(r);
  for (let c = range.s.c; c <= range.e.c && srcCols.length < MAX_COLS; c++) if (!hiddenCol(c)) srcCols.push(c);
  const rowIdx = new Map(srcRows.map((r, i) => [r, i]));
  const colIdx = new Map(srcCols.map((c, i) => [c, i]));

  const grid: Grid = srcRows.map((r) => srcCols.map((c) =>
    cellValue(sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined)));

  // "satır,sütun" → birleştirmenin sol üst hücresi değil (devam hücresi); h: yatay, v: dikey
  const cont = new Map<string, { h: boolean; v: boolean }>();
  for (const m of sheet["!merges"] ?? []) {
    const top = rowIdx.get(m.s.r), left = colIdx.get(m.s.c);
    if (top == null || left == null) continue;
    const v = grid[top][left];
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        const rr = rowIdx.get(r), cc = colIdx.get(c);
        if (rr == null || cc == null || (r === m.s.r && c === m.s.c)) continue;
        if (v != null) grid[rr][cc] = v;
        cont.set(`${rr},${cc}`, { h: c > m.s.c, v: r > m.s.r });
      }
    }
  }
  return {
    grid,
    meta: {
      isContinuation: (r, c, dir) => {
        const x = cont.get(`${r},${c}`);
        return !!x && (dir === "h" ? x.h && !x.v : dir === "v" ? x.v : true);
      },
    },
  };
}

export interface ExcelParseResult extends TableResult { sheetCount: number; csv: string }

export function parseExcel(buf: Buffer): ExcelParseResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, {
      type: "buffer", sheetRows: MAX_ROWS, cellNF: true, cellStyles: true, // cellStyles: gizli satır/sütun bilgisi
      cellFormula: false, cellHTML: false, bookVBA: false,
    });
  } catch (e) {
    throw new ParseError(`excel: ${(e as Error).message}`, "Excel dosyası açılamadı. Dosya bozuk veya parola korumalı olabilir.");
  }
  const names = wb.SheetNames.filter((n) => wb.Workbook?.Sheets?.find((s) => s.name === n)?.Hidden !== 1 && wb.Workbook?.Sheets?.find((s) => s.name === n)?.Hidden !== 2)
    .slice(0, MAX_SHEETS);
  const parts: TableResult[] = [];
  let csv = "";
  for (const name of names) {
    const sheet = wb.Sheets[name];
    const { grid, meta } = sheetToGrid(sheet);
    const res = analyzeGrid(grid, meta);
    if (res.rows.length) parts.push(res);
    // Yerel çözümleme başarısız olursa yapay zekâya gönderilecek metin
    if (csv.length < 200_000) csv += `### Sayfa: ${name}\n${XLSX.utils.sheet_to_csv(sheet, { blankrows: false })}\n\n`;
  }
  return { ...mergeResults(parts), sheetCount: names.length, csv };
}
