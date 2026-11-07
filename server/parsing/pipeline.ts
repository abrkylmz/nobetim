// Analiz hattı: dosya → çizelge → kişi eşleştirme → normalizasyon → doğrulama → taslak

import type { Candidate, DraftEntry, Quality, Shift, ShiftType, SourceKind } from "../../shared/types.js";
import { isImageKind, type FileKind } from "../security/fileValidation.js";
import type { AiExtractor, AiRosterResult } from "./AiExtractor.js";
import { parseExcel } from "./ExcelParser.js";
import { parsePdf } from "./PdfParser.js";
import { prepareImage } from "./ImageParser.js";
import { matchPersonnel } from "./PersonnelMatcher.js";
import { normalizeCells } from "./ShiftNormalizer.js";
import { validateDraft } from "./ShiftValidator.js";
import { foldWords } from "./text.js";
import { ParseError, type Legend, type Roster, type RosterCell, type RosterRow } from "./types.js";

export interface InputFile { name: string; buffer: Buffer; kind: FileKind }

export interface AnalyzeProfile { fullName: string; staffNo?: string; department?: string }

export interface AnalyzeInput {
  files: InputFile[];
  profile: AnalyzeProfile;
  shiftTypes: ShiftType[];
  existing: Shift[];
  ai: AiExtractor;
  selected?: { key: string; name: string };
  period?: { year: number; month: number };
  onProgress?: (msg: string) => void;
  now?: Date;
}

export interface PersonRecord { name: string; staffNo?: string; title?: string; department?: string; cells: RosterCell[] }

export interface AnalyzeOutput {
  source: SourceKind;
  status: "needs_selection" | "review";
  year: number;
  month: number;
  periodGuessed: boolean;
  person: PersonRecord | null;
  candidates: Candidate[];
  matchNote: string | null;
  quality: Quality | null;
  notes: string[];
  legend: Legend[];
  draft: DraftEntry[];
}

const CONF_SCORE = { high: 0.95, medium: 0.7, low: 0.35 } as const;

function aiToRoster(ai: AiRosterResult, source: SourceKind, baseQuality: Quality | null): Roster {
  const rows = new Map<string, RosterRow>();
  const key = (name: string, staffNo?: string) => `ai|${foldWords(name)}|${(staffNo ?? "").trim()}`;
  for (const p of ai.people ?? []) {
    if (!p.name?.trim()) continue;
    rows.set(key(p.name, p.staffNo), {
      key: key(p.name, p.staffNo), name: p.name.trim(), staffNo: p.staffNo || undefined, title: p.title || undefined,
      cells: [], cellsLoaded: false,
    });
  }
  for (const t of ai.targetRows ?? []) {
    const k = key(t.name, t.staffNo);
    const cells: RosterCell[] = (t.cells ?? []).filter((c) => c.text?.trim()).map((c) => ({
      day: c.day, raw: c.text.trim(), readScore: CONF_SCORE[c.confidence] ?? 0.35, note: c.note || undefined,
    }));
    rows.set(k, { key: k, name: t.name.trim(), staffNo: t.staffNo || undefined, title: t.title || undefined, cells, cellsLoaded: true });
  }

  const problems = [...(baseQuality?.problems ?? []), ...(ai.problems ?? [])];
  const targetCells = (ai.targetRows ?? []).flatMap((t) => t.cells ?? []);
  const lowShare = targetCells.length ? targetCells.filter((c) => c.confidence === "low").length / targetCells.length : 0;
  if (lowShare > 0.3) problems.push("Hücrelerin önemli bir kısmı net okunamadı. Fotoğrafı yalnızca tabloyu içerecek şekilde kırpıp yeniden yüklemen önerilir.");
  const level: Quality["level"] = !ai.readable || ai.quality === "poor" || lowShare > 0.3
    ? "poor" : ai.quality === "fair" || baseQuality?.level === "fair" ? "fair" : baseQuality?.level ?? "good";

  return {
    source,
    year: ai.year || null,
    month: ai.month >= 1 && ai.month <= 12 ? ai.month : null,
    hospital: ai.hospital || undefined,
    department: ai.department || undefined,
    rows: [...rows.values()],
    legend: ai.legend ?? [],
    quality: { level, problems: [...new Set(problems)], askReupload: level === "poor", metrics: baseQuality?.metrics },
    notes: [],
  };
}

async function readRoster(input: AnalyzeInput, selectedName?: string): Promise<Roster> {
  const { files, ai, profile } = input;
  const progress = input.onProgress ?? (() => {});
  const target = { fullName: profile.fullName, staffNo: profile.staffNo, selectedName };
  const first = files[0];

  if (first.kind === "xlsx" || first.kind === "xls" || first.kind === "csv") {
    progress("Excel çalışma sayfaları inceleniyor");
    const res = parseExcel(first.buffer);
    if (res.rows.length) {
      return { source: "excel", year: res.year, month: res.month, hospital: res.hospital, rows: res.rows, legend: res.legend, quality: null,
        notes: [`${res.sheetCount} çalışma sayfası incelendi.`] };
    }
    if (!ai.available) throw new ParseError("excel: no table", "Excel dosyasında nöbet tablosu bulunamadı. Günlerin (1, 2, 3…) sütun başlığı olduğu bir çizelge yükle.");
    progress("Tablo yapısı tanınmadı, yapay zekâ ile çözümleniyor");
    const r = aiToRoster(await ai.extract({ kind: "text", text: res.csv }, target), "excel", null);
    r.notes.push("Tablo yapısı standart değildi; yapay zekâ ile çözümlendi.");
    return r;
  }

  if (first.kind === "pdf") {
    progress("PDF metin katmanı okunuyor");
    const res = await parsePdf(first.buffer);
    if (!res.scanned && res.rows.length) {
      return { source: "pdf-text", year: res.year, month: res.month, hospital: res.hospital, rows: res.rows, legend: res.legend, quality: null,
        notes: [`${res.pageCount} sayfa incelendi.`] };
    }
    progress(res.scanned ? "Taranmış PDF: OCR uygulanıyor" : "PDF tablosu çözümleniyor (OCR)");
    const r = aiToRoster(await ai.extract({ kind: "pdf", pdf: first.buffer }, target), res.scanned ? "pdf-scan" : "pdf-text", null);
    r.notes.push(res.scanned ? `Taranmış PDF (${res.pageCount} sayfa): OCR ile okundu.` : `${res.pageCount} sayfalık PDF yapay zekâ ile çözümlendi.`);
    if (!r.year && res.year) r.year = res.year;
    if (!r.month && res.month) r.month = res.month;
    return r;
  }

  if (files.every((f) => isImageKind(f.kind))) {
    progress("Fotoğraf kalitesi değerlendiriliyor");
    const prepared = await Promise.all(files.map((f) => prepareImage(f.buffer)));
    const worst = prepared.find((p) => p.quality.level === "poor") ?? prepared.find((p) => p.quality.level === "fair") ?? prepared[0];
    if (worst.quality.askReupload) {
      throw new ParseError("image: poor quality", `Fotoğraf okunamayacak kadar düşük kalitede. ${worst.quality.problems.join(" ")}`);
    }
    progress("Tablo okunuyor (OCR)");
    const r = aiToRoster(await ai.extract({ kind: "image", images: prepared.map((p) => p.jpeg) }, target), "image", worst.quality);
    r.notes.push(files.length > 1 ? `${files.length} fotoğraf birlikte okundu.` : "Fotoğraf OCR ile okundu.");
    return r;
  }
  throw new ParseError("mixed files", "Birden fazla dosya yalnızca fotoğraflar için birlikte yüklenebilir.");
}

export async function analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
  const now = input.now ?? new Date();
  let roster = await readRoster(input, input.selected?.name);
  if (roster.quality && !roster.rows.some((r) => r.cells.length) && roster.quality.level === "poor") {
    throw new ParseError("unreadable", `Çizelge okunamadı. ${roster.quality.problems.join(" ")}`);
  }

  // Kişi seçimi
  let row: RosterRow | null = null;
  let candidates: Candidate[] = [];
  let matchNote: string | null = null;
  if (input.selected) {
    row = roster.rows.find((r) => r.key === input.selected!.key)
      ?? roster.rows.find((r) => r.cellsLoaded && foldWords(r.name) === foldWords(input.selected!.name))
      ?? null;
    if (!row) throw new ParseError("selected row missing", "Seçilen kişi çizelgede bulunamadı. Yeniden analiz et.");
    matchNote = "Kişi kullanıcı tarafından seçildi.";
  } else {
    const m = matchPersonnel(roster.rows, input.profile);
    candidates = m.candidates;
    matchNote = m.note;
    row = m.selected;
  }

  // Yapay zekâ seçilen kişinin hücrelerini çıkarmadıysa yalnızca o satırı yeniden oku
  if (row && !row.cellsLoaded) {
    input.onProgress?.(`${row.name} satırı okunuyor`);
    const again = await readRoster(input, row.name);
    const found = again.rows.find((r) => r.cellsLoaded && foldWords(r.name) === foldWords(row!.name)) ?? again.rows.find((r) => r.cellsLoaded);
    if (!found) throw new ParseError("row not extracted", "Seçilen kişinin satırı okunamadı. Fotoğrafı yeniden çekip dene.");
    roster = { ...roster, legend: again.legend.length ? again.legend : roster.legend };
    row = found;
  }

  let year = input.period?.year ?? roster.year ?? 0;
  let month = input.period?.month ?? roster.month ?? 0;
  let periodGuessed = false;
  if (!month || !year) {
    const guess = new Date(now.getFullYear(), now.getMonth() + (now.getDate() > 20 ? 1 : 0), 1);
    if (!month) month = guess.getMonth() + 1;
    if (!year) year = guess.getFullYear();
    periodGuessed = true;
  }
  const notes = [...roster.notes];
  if (periodGuessed && !input.period) notes.push("Çizelgede ay/yıl bilgisi bulunamadı; tahmin edildi. Kontrol ekranında düzeltebilirsin.");

  const base = {
    source: roster.source, year, month, periodGuessed: periodGuessed && !input.period,
    candidates, matchNote, quality: roster.quality, notes, legend: roster.legend,
  };
  if (!row) return { ...base, status: "needs_selection", person: null, draft: [] };

  const draft = normalizeCells(row.cells, {
    year, month, shiftTypes: input.shiftTypes, legend: roster.legend,
    department: input.profile.department || row.department || roster.department || "",
  });
  validateDraft(draft, input.existing);
  return {
    ...base,
    status: "review",
    person: { name: row.name, staffNo: row.staffNo, title: row.title, department: row.department, cells: row.cells },
    draft,
  };
}

/** Ay/yıl değiştiğinde saklanan kişi satırından taslağı yeniden üretir (dosyayı yeniden okumadan). */
export function rebuildDraft(person: PersonRecord, ctx: { year: number; month: number; shiftTypes: ShiftType[]; legend: Legend[]; department: string; existing: Shift[] }) {
  const draft = normalizeCells(person.cells, { ...ctx });
  return validateDraft(draft, ctx.existing);
}
