// Satır/sütun ızgarasından (Excel sayfası ya da PDF sayfası) nöbet çizelgesi çıkarır.
// İki yerleşim desteklenir:
//  A) Personel satırlarda, günler sütunlarda (en yaygın aylık çizelge)
//  B) Tarihler satırlarda, vardiyalar sütunlarda, isimler hücrelerde (günlük nöbet listesi)

import type { Grid, GridValue, Legend, RosterCell, RosterRow } from "./types.js";
import { cellText, fold, foldWords, hasLetters, MONTHS_TR } from "./text.js";

export interface TableResult {
  rows: RosterRow[];
  year: number | null;
  month: number | null;
  legend: Legend[];
  hospital?: string;
  department?: string;
  layout: "rows" | "dates" | null;
}

interface DayHead { day: number; date?: { y: number; m: number } }

const WEEKDAY_WORDS = /^(pzt|pazartesi|sal|sali|car|carsamba|per|persembe|cum|cuma|cmt|cumartesi|paz|pazar|pts|cts|ct|pz|pt|ca|pe|cu|mon|tue|wed|thu|fri|sat|sun)\.?$/;
const SKIP_NAME = /^(toplam|genel toplam|imza|onay|onaylayan|hazirlayan|aciklama|aciklamalar|not|notlar|kod|kodlar|lejant|nobet listesi|calisma listesi|tarih|gun|adi soyadi|ad soyad|isim|personel)$|^(toplam|imza|aciklama|onaylayan|hazirlayan)\b/;
const NAME_HEAD = /(ad[i]?\s*soyad|isim|personel ad|personelin ad|ad soyad|^ad$|^adi$|hemsire ad|calisan)/;
const STAFF_HEAD = /(sicil|kimlik|tc no|t c|personel no|sicil no)/;
const TITLE_HEAD = /(unvan|gorev|kadro|unvani)/;
const DEPT_HEAD = /(servis|birim|bolum|klinik|unite)/;

function dayHead(v: GridValue): DayHead | null {
  if (v instanceof Date && !isNaN(v.getTime()) && v.getUTCFullYear() > 1901) {
    return { day: v.getUTCDate(), date: { y: v.getUTCFullYear(), m: v.getUTCMonth() + 1 } };
  }
  if (typeof v === "number") return Number.isInteger(v) && v >= 1 && v <= 31 ? { day: v } : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s+\p{L}+\.?)?$/u.exec(s);
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    if (+m[1] <= 31 && +m[2] <= 12) return { day: +m[1], date: { y, m: +m[2] } };
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return { day: +m[3], date: { y: +m[1], m: +m[2] } };
  m = /^(\d{1,2})(?:[.)]?\s*(?:\p{L}{2,}\.?)?)?$/u.exec(s) ?? /^\p{L}{2,}\.?\s+(\d{1,2})$/u.exec(s);
  if (m && +m[1] >= 1 && +m[1] <= 31) return { day: +m[1] };
  return null;
}

interface Run { start: number; len: number; firstDay: number; date?: { y: number; m: number } }

function longestRun(values: GridValue[]): Run {
  let best: Run = { start: -1, len: 0, firstDay: 0 };
  for (let i = 0; i < values.length; i++) {
    const h = dayHead(values[i]);
    if (!h) continue;
    let len = 1;
    while (i + len < values.length) {
      const n = dayHead(values[i + len]);
      if (n && n.day === h.day + len) len++; else break;
    }
    if (len > best.len) best = { start: i, len, firstDay: h.day, date: h.date };
  }
  return best;
}

function findPeriod(grid: Grid): { year: number | null; month: number | null } {
  const texts = grid.slice(0, 40).flat().filter((v) => typeof v === "string").map((v) => foldWords(v as string));
  const all = texts.join(" | ");
  for (const t of texts) {
    const mi = MONTHS_TR.findIndex((mn) => new RegExp(`\\b${mn}\\b`).test(t));
    if (mi >= 0) {
      const y = /\b(20\d{2})\b/.exec(t) ?? /\b(20\d{2})\b/.exec(all);
      return { month: mi + 1, year: y ? +y[1] : null };
    }
  }
  const mm = /\b(0?[1-9]|1[0-2])\s(20\d{2})\b/.exec(all);
  if (mm) return { month: +mm[1], year: +mm[2] };
  return { year: null, month: null };
}

/** "G: 08-16 Gündüz, N = 16:00-08:00 Nöbet, İ: İzin" gibi açıklamaları toplar. */
export function findLegend(grid: Grid): Legend[] {
  const out = new Map<string, Legend>();
  // Sonraki kod harfle başlamalı (ya da "24 =" gibi rakam + eşittir); "08:00" saatini kod sanma
  const re = /(?:^|[\s,;(|])([\p{Lu}\d]{1,4}\*?)\s*[:=]\s*(.+?)(?=\s*[,;|]|\s+(?:\p{Lu}[\p{Lu}\d]{0,3}\*?\s*[:=]|\d{1,2}\s*=)|$)/gu;
  for (const v of grid.flat()) {
    if (typeof v !== "string" || v.length > 400) continue;
    for (const m of v.matchAll(re)) {
      const code = m[1].trim(), meaning = m[2].trim();
      if (/^\d+$/.test(code) && /^\d/.test(meaning)) continue; // "08:00" gibi saatler
      if (!/\p{L}/u.test(meaning) && !/\d{1,2}\s*[-–]\s*\d{1,2}/.test(meaning)) continue;
      if (!out.has(code)) out.set(code, { code, meaning });
    }
  }
  return [...out.values()];
}

/** Izgarayı üreten kaynağın (Excel) ek bilgisi: birleştirilmiş hücrelerin devamı mı? */
export interface GridMeta {
  /** dir "h": yatay birleştirmenin devamı (aynı satır), "v": dikey birleştirmenin alt satırı */
  isContinuation?(r: number, c: number, dir?: "h" | "v"): boolean;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Nöbet hücresinin metni; Excel'in kendiliğinden yaptığı dönüşümleri geri alır:
 *  - "16/08" → 16 Ağustos tarihi → yeniden "16/08" (hücre biçimindeki gün/ay sırasıyla)
 *  - "08-16" → Ağustos 2016 (ay-yıl) → "08/16"
 *  - "16,08" → ondalık sayı → "16/08"
 */
export function shiftCellText(v: GridValue): string {
  return readShiftCell(v).text;
}

/** converted: Excel'in dönüştürdüğü bir değer geri kuruldu; bu bir yorum olduğu için kullanıcı kontrol etmeli. */
export function readShiftCell(v: GridValue): { text: string; converted?: "date" | "decimal" } {
  if (v instanceof Date && !isNaN(v.getTime()) && v.getUTCFullYear() > 1901) {
    const d = pad2(v.getUTCDate()), m = pad2(v.getUTCMonth() + 1), y = pad2(v.getUTCFullYear() % 100);
    const order = (v as Date & { excelOrder?: string }).excelOrder;
    return { text: order === "md" ? `${m}/${d}` : order === "my" ? `${m}/${y}` : `${d}/${m}`, converted: "date" };
  }
  const text = cellText(v);
  const dec = /^(\d{1,2})[.,](\d{2})$/.exec(text);
  if (dec && +dec[1] <= 24 && +dec[2] <= 24) return { text: `${pad2(+dec[1])}/${dec[2]}`, converted: "decimal" };
  return { text };
}

interface DayColumns {
  start: number;
  firstDay: number;
  date?: { y: number; m: number };
  /** Her gün bir veya daha fazla sütundan oluşabilir (birleştirilmiş gün başlığı / alt sütunlar) */
  days: { day: number; cols: number[] }[];
}

/**
 * Başlık satırında ardışık gün sütunlarını bulur. Bir gün başlığı birden çok sütunu kapsıyorsa
 * (birleştirilmiş "1" hücresinin altında iki alt sütun gibi) bu sütunlar aynı güne bağlanır.
 */
function dayColumns(row: GridValue[], r: number, meta: GridMeta): DayColumns {
  const isCont = (c: number) => !!meta.isContinuation?.(r, c, "h");
  const blank = (c: number) => row[c] == null || cellText(row[c]) === "";
  let best: DayColumns = { start: -1, firstDay: 0, days: [] };
  for (let c = 0; c < row.length; c++) {
    if (isCont(c)) continue;
    const h = dayHead(row[c]);
    if (!h) continue;
    const days = [{ day: h.day, cols: [c] }];
    for (let k = c + 1; k < row.length; k++) {
      const last = days[days.length - 1];
      if (isCont(k) || blank(k)) { last.cols.push(k); continue; }
      const n = dayHead(row[k]);
      if (n && n.day === last.day + 1) days.push({ day: n.day, cols: [k] });
      else break;
    }
    if (days.length > best.days.length) best = { start: c, firstDay: h.day, date: h.date, days };
  }
  // Son günün arkasındaki boş başlık hücreleri (tablonun sağ tarafı) güne eklenmesin
  if (best.days.length > 1) {
    const widths = best.days.slice(0, -1).map((d) => d.cols.length).sort((a, b) => a - b);
    const typical = widths[Math.floor(widths.length / 2)];
    const last = best.days[best.days.length - 1];
    last.cols = last.cols.slice(0, typical);
  }
  return best;
}

function pickColumn(heads: string[], re: RegExp): number {
  return heads.findIndex((h) => h && re.test(h));
}

const rowKey = (name: string, staffNo?: string) => `${foldWords(name)}|${staffNo ?? ""}`;

function addRow(map: Map<string, RosterRow>, row: Omit<RosterRow, "key" | "cellsLoaded">) {
  const key = rowKey(row.name, row.staffNo);
  const existing = map.get(key);
  if (!existing) {
    map.set(key, { ...row, key, cellsLoaded: true });
    return;
  }
  for (const c of row.cells) {
    const prev = existing.cells.find((x) => x.day === c.day);
    if (!prev) existing.cells.push(c);
    else if (prev.raw !== c.raw && !prev.raw.split(" + ").includes(c.raw)) prev.raw = `${prev.raw} + ${c.raw}`;
  }
  existing.title ??= row.title;
  existing.department ??= row.department;
}

// ---------- Yerleşim A: kişiler satırlarda ----------

function analyzeRows(grid: Grid, rowsOut: Map<string, RosterRow>, meta: GridMeta): { found: boolean; date?: { y: number; m: number } } {
  const headers: { r: number; run: DayColumns }[] = [];
  grid.forEach((row, r) => {
    const run = dayColumns(row ?? [], r, meta);
    if (run.days.length >= 7) headers.push({ r, run });
  });
  if (!headers.length) return { found: false };

  let date: { y: number; m: number } | undefined;
  headers.forEach(({ r, run }, hi) => {
    if (run.date && !date) date = run.date;
    const end = hi + 1 < headers.length ? headers[hi + 1].r : grid.length;
    const metaHeads = Array.from({ length: run.start }, (_, c) => {
      const here = foldWords(cellText(grid[r]?.[c]));
      const above = r > 0 ? foldWords(cellText(grid[r - 1]?.[c])) : "";
      return here || above;
    });
    const bodyStart = r + 1;
    const body = grid.slice(bodyStart, end);

    let nameCol = pickColumn(metaHeads, NAME_HEAD);
    if (nameCol < 0) {
      // Başlık yoksa: en çok "iki kelimelik yazı" içeren sütun
      let best = -1, bestCount = 0;
      for (let c = 0; c < run.start; c++) {
        const n = body.filter((row) => hasLetters(row?.[c]) && cellText(row?.[c]).split(" ").length >= 2).length;
        if (n > bestCount) { bestCount = n; best = c; }
      }
      nameCol = best;
    }
    if (nameCol < 0) return;
    const staffCol = pickColumn(metaHeads, STAFF_HEAD);
    const titleCol = pickColumn(metaHeads, TITLE_HEAD);
    const deptCol = pickColumn(metaHeads, DEPT_HEAD);

    body.forEach((row, bi) => {
      if (!row) return;
      // Gün adlarının yazdığı ikinci başlık satırını atla
      const dayCells = run.days.map((d) => foldWords(cellText(row[d.cols[0]])));
      if (dayCells.filter((d) => WEEKDAY_WORDS.test(d)).length >= 3) return;

      // İsim hücresi üst satırdan birleştirilerek gelmişse bu satır aynı kişinin ikinci satırıdır
      // (ör. üstte kodlar, altta saatler). Ayrı kişi ya da ek nöbet sayılmaz.
      if (meta.isContinuation?.(bodyStart + bi, nameCol, "v")) return;

      const name = cellText(row[nameCol]);
      if (!hasLetters(name) || SKIP_NAME.test(foldWords(name)) || /[:=]/.test(name)) return;

      const cells: RosterCell[] = [];
      for (const d of run.days) {
        const read = d.cols.map((c) => readShiftCell(row[c])).filter((x) => x.text);
        const parts = [...new Set(read.map((x) => x.text))];
        if (!parts.length) continue;
        const conv = read.find((x) => x.converted);
        cells.push(conv
          ? { day: d.day, raw: parts.join(" + "), readScore: 0.75,
              note: `Excel bu hücreyi ${conv.converted === "date" ? "tarihe" : "ondalık sayıya"} çevirmişti; "${conv.text}" olarak yorumlandı` }
          : { day: d.day, raw: parts.join(" + "), readScore: 1 });
      }
      if (!cells.length) return;
      addRow(rowsOut, {
        name,
        staffNo: staffCol >= 0 ? cellText(row[staffCol]) || undefined : undefined,
        title: titleCol >= 0 ? cellText(row[titleCol]) || undefined : undefined,
        department: deptCol >= 0 ? cellText(row[deptCol]) || undefined : undefined,
        cells,
      });
    });
  });
  return { found: rowsOut.size > 0, date };
}

// ---------- Yerleşim B: tarihler satırlarda ----------

function analyzeDates(grid: Grid, rowsOut: Map<string, RosterRow>): { found: boolean; date?: { y: number; m: number } } {
  const width = Math.max(0, ...grid.map((r) => r?.length ?? 0));
  let best: (Run & { col: number }) | null = null;
  for (let c = 0; c < width; c++) {
    const run = longestRun(grid.map((r) => r?.[c]));
    if (run.len >= 7 && (!best || run.len > best.len)) best = { ...run, col: c };
  }
  if (!best) return { found: false };

  const headRow = best.start - 1;
  const heads = (grid[headRow] ?? []).map((v) => cellText(v));
  const deptCol = pickColumn(heads.map(foldWords), DEPT_HEAD);
  const shiftCols: number[] = [];
  for (let c = 0; c < width; c++) {
    if (c === best.col || c === deptCol || !heads[c]) continue;
    if (/^(gun|gunler|tarih|aciklama|not)$/.test(foldWords(heads[c]))) continue;
    shiftCols.push(c);
  }
  if (!shiftCols.length) return { found: false };

  for (let i = 0; i < best.len; i++) {
    const row = grid[best.start + i] ?? [];
    const day = best.firstDay + i;
    for (const c of shiftCols) {
      const names = cellText(row[c]).split(/\s*(?:[,;\n/]|\s-\s|\s{2,})\s*/).map((s) => s.trim()).filter(hasLetters);
      for (const name of names) {
        if (SKIP_NAME.test(foldWords(name))) continue;
        addRow(rowsOut, {
          name,
          department: deptCol >= 0 ? cellText(row[deptCol]) || undefined : undefined,
          cells: [{ day, raw: heads[c], readScore: 1 }],
        });
      }
    }
  }
  return { found: rowsOut.size > 0, date: best.date };
}

export function analyzeGrid(grid: Grid, meta: GridMeta = {}): TableResult {
  const rows = new Map<string, RosterRow>();
  let layout: TableResult["layout"] = null;
  let res = analyzeRows(grid, rows, meta);
  if (res.found) layout = "rows";
  else {
    res = analyzeDates(grid, rows);
    if (res.found) layout = "dates";
  }
  const period = res.date ? { year: res.date.y, month: res.date.m } : findPeriod(grid);
  for (const r of rows.values()) r.cells.sort((a, b) => a.day - b.day);

  const titleText = grid.slice(0, 6).flat().filter(hasLetters).map((v) => cellText(v));
  const hospital = titleText.find((t) => /hastane|tıp merkezi|tip merkezi|hastanesi/i.test(fold(t)));
  return { rows: [...rows.values()], ...period, legend: findLegend(grid), hospital, layout };
}

/** Birden çok sayfa/tablodan gelen sonuçları birleştirir. */
export function mergeResults(parts: TableResult[]): TableResult {
  const rows = new Map<string, RosterRow>();
  for (const p of parts) for (const r of p.rows) addRow(rows, r);
  const legend = new Map<string, Legend>();
  for (const p of parts) for (const l of p.legend) if (!legend.has(l.code)) legend.set(l.code, l);
  const withPeriod = parts.find((p) => p.month);
  for (const r of rows.values()) r.cells.sort((a, b) => a.day - b.day);
  return {
    rows: [...rows.values()],
    year: withPeriod?.year ?? null,
    month: withPeriod?.month ?? null,
    legend: [...legend.values()],
    hospital: parts.find((p) => p.hospital)?.hospital,
    layout: parts.find((p) => p.layout)?.layout ?? null,
  };
}
