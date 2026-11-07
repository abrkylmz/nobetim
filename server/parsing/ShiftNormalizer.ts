// Çizelge hücrelerini (G, N, 08-16, İ …) gerçek tarih-saat aralıklı nöbet kayıtlarına çevirir.
// Saat bilgisi bulunmayan çalışma kayıtları için saat uydurulmaz; kayıt "eksik" işaretlenir.

import { randomUUID } from "node:crypto";
import {
  CATEGORY_META, isWork, levelOf,
  type DraftEntry, type FieldScore, type Issue, type ShiftCategory, type ShiftType,
} from "../../shared/types.js";
import { buildInterval, daysInMonth, formatHM, parseHM, ymd } from "../../shared/time.js";
import type { Legend, RosterCell } from "./types.js";
import { codeKey, fold, foldWords } from "./text.js";

const TIME_RANGE = /(\d{1,2})(?:[:.](\d{2}))?\s*[-–—]\s*(\d{1,2})(?:[:.](\d{2}))?/;

/**
 * Eğik çizgili saat aralığı: "16/08", "08/16", "08:00/16:00", "Ek 16/08".
 * Yalnızca hücre bu biçimdeyse saat sayılır; "G/N" gibi kod birleşimleri ve tarihler (01/11/2026) etkilenmez.
 */
const SLASH_RANGE = /^(?:(ek)\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*\/\s*(\d{1,2})(?:[:.](\d{2}))?(?:\s*(ek))?$/i;

export function parseTimeRange(s: string): { start: string; end: string } | null {
  const sl = SLASH_RANGE.exec(s.trim());
  const m = sl ? [sl[0], sl[2], sl[3], sl[4], sl[5]] : TIME_RANGE.exec(s);
  if (!m) return null;
  const s1 = parseHM(`${m[1]}:${m[2] ?? "00"}`), e1 = parseHM(`${m[3]}:${m[4] ?? "00"}`);
  if (s1 == null || e1 == null) return null;
  return { start: formatHM(s1), end: e1 === 1440 ? "24:00" : formatHM(e1) };
}

/** Saat aralığından nöbet türü */
export function categoryFromTimes(start: string, end: string): ShiftCategory {
  const s = parseHM(start)!, e0 = parseHM(end)!;
  const e = e0 <= s ? e0 + 1440 : e0;
  const dur = (e - s) / 60;
  if (dur >= 23) return "24h";
  if (s >= 5 * 60 && s < 12 * 60 && e <= 19 * 60) return "day";
  if (s >= 12 * 60 && s < 20 * 60 && e <= 25 * 60 && dur <= 10) return "evening";
  if (e > 24 * 60 || s >= 20 * 60 || s < 5 * 60) return "night";
  return "day";
}

function categoryFromWords(text: string): ShiftCategory | null {
  const t = foldWords(text);
  if (/\b(yillik izin|yillik|mazeret|izin|izinli|ucretsiz izin|dogum izni|idari izin)\b/.test(t)) return "leave";
  if (/\b(rapor|raporlu|hastalik)\b/.test(t)) return "sick";
  if (/\b(resmi tatil|bayram|tatil|hafta tatili)\b/.test(t)) return "holiday";
  if (/\b(bos|off)\b/.test(t)) return "off";
  if (/\b(24 saat|24 saatlik)\b/.test(t)) return "24h";
  if (/\b(gece)\b/.test(t)) return "night";
  if (/\b(aksam)\b/.test(t)) return "evening";
  if (/\b(gunduz|sabah|mesai)\b/.test(t)) return "day";
  if (/\b(ek nobet)\b/.test(t)) return "extra";
  if (/\b(nobet)\b/.test(t)) return "night";
  return null;
}

const score = (s: number, reason?: string): FieldScore => ({ score: s, level: levelOf(s), reason });

interface Resolution {
  code: string;
  label: string;
  category: ShiftCategory;
  start: string | null;
  end: string | null;
  isExtra: boolean;
  type: FieldScore;
  time: FieldScore;
  issues: Issue[];
}

export interface NormalizeContext {
  year: number;
  month: number;
  shiftTypes: ShiftType[];
  legend: Legend[];
  department: string;
}

function resolvePart(raw: string, ctx: NormalizeContext): Resolution {
  const text = raw.trim();
  const folded = foldWords(text);
  const isExtra = /(^|\s)ek(\s|$)/.test(folded) || /\*$/.test(text) || /^ek/.test(codeKey(text));
  const base = text.replace(/\bek\b\.?/gi, "").replace(/^ek/i, "").replace(/\*+$/, "").trim() || text;
  const issues: Issue[] = [];

  const legendEntry = ctx.legend.find((l) => codeKey(l.code) === codeKey(base) || codeKey(l.code) === codeKey(text));
  const legendTimes = legendEntry ? parseTimeRange(legendEntry.meaning) : null;

  // 1) Hücrede açık saat aralığı: "08-16", "20:00-08:00"
  const range = parseTimeRange(text);
  if (range) {
    const category = categoryFromTimes(range.start, range.end);
    const word = SLASH_RANGE.test(text) ? "" : text.replace(TIME_RANGE, "").replace(/\bek\b/gi, "").trim();
    return {
      code: text, label: word || CATEGORY_META[category].label,
      category, start: range.start, end: range.end, isExtra,
      type: score(0.95, "Saat aralığından belirlendi"), time: score(1, "Saat hücrede yazılı"), issues,
    };
  }

  // 2) Kullanıcının kod sözlüğü
  const type = ctx.shiftTypes.find((t) => codeKey(t.code) === codeKey(base))
    ?? ctx.shiftTypes.find((t) => codeKey(t.code) === codeKey(text))
    ?? ctx.shiftTypes.find((t) => codeKey(t.label) === codeKey(base));
  if (type) {
    const res: Resolution = {
      code: type.code, label: type.label, category: type.category, start: null, end: null,
      isExtra: isExtra || type.category === "extra", type: score(0.97, "Kod sözlüğünde tanımlı"), time: score(1), issues,
    };
    if (isWork(type.category)) {
      if (legendTimes) {
        res.start = legendTimes.start; res.end = legendTimes.end;
        res.time = score(0.95, "Saat çizelgedeki açıklamadan alındı");
      } else if (type.start && type.end) {
        res.start = type.start; res.end = type.end;
        if (type.verified) res.time = score(0.95, "Onaylı kod saati");
        else {
          res.time = score(0.7, "Varsayılan kod saati kullanıldı");
          issues.push({ code: "default_time", severity: "warning",
            message: `"${type.code}" için varsayılan saat (${type.start}–${type.end}) kullanıldı. Çizelgendeki saatle aynı mı kontrol et.` });
        }
      } else {
        res.time = score(0, "Saat bilgisi yok");
        issues.push({ code: "missing_time", severity: "error", message: `"${type.code}" kodunun saatleri tanımlı değil. Başlangıç ve bitiş saatini gir.` });
      }
    }
    return res;
  }

  // 3) Çizelgedeki açıklama (lejant)
  if (legendEntry) {
    const category = legendTimes ? categoryFromTimes(legendTimes.start, legendTimes.end) : categoryFromWords(legendEntry.meaning) ?? "other";
    const res: Resolution = {
      code: text, label: legendEntry.meaning.replace(TIME_RANGE, "").replace(/[()]/g, "").trim() || legendEntry.meaning,
      category: isExtra && !legendTimes ? "extra" : category,
      start: legendTimes?.start ?? null, end: legendTimes?.end ?? null, isExtra: isExtra || /ek nobet/.test(fold(legendEntry.meaning)),
      type: score(0.9, "Çizelgedeki açıklamadan belirlendi"), time: legendTimes ? score(0.95, "Saat çizelgedeki açıklamadan alındı") : score(1), issues,
    };
    if (isWork(res.category) && !legendTimes) {
      res.time = score(0, "Saat bilgisi yok");
      issues.push({ code: "missing_time", severity: "error", message: `"${text}" için saat bilgisi bulunamadı. Başlangıç ve bitiş saatini gir.` });
    }
    return res;
  }

  // 4) Sözcükten tahmin ("Yıllık İzin", "Rapor", "Gece")
  const guessed = categoryFromWords(text);
  if (guessed) {
    const res: Resolution = {
      code: text, label: text, category: isExtra && isWork(guessed) ? guessed : guessed, start: null, end: null, isExtra,
      type: score(0.75, "Yazıdan tahmin edildi"), time: score(1), issues,
    };
    if (isWork(guessed)) {
      res.time = score(0, "Saat bilgisi yok");
      issues.push({ code: "missing_time", severity: "error", message: `"${text}" için saat bilgisi yok. Başlangıç ve bitiş saatini gir.` });
    }
    return res;
  }

  // 5) Tanınmayan kod
  issues.push({ code: "unknown_code", severity: "error",
    message: `"${text}" kodu tanınmadı. Türünü ve saatini seç; kodu Ayarlar'a da ekleyebilirsin.` });
  return {
    code: text, label: text, category: isExtra ? "extra" : "other", start: null, end: null, isExtra,
    type: score(0.2, "Kod tanınmadı"), time: score(0, "Saat bilgisi yok"), issues,
  };
}

/** "G + N", "08-16/16-24" gibi tek hücredeki birden çok vardiyayı ayırır. */
export function splitParts(raw: string, ctx: NormalizeContext): string[] {
  const text = raw.trim();
  const parts = text.split(/\s*(?:\+|\/|,|;|&|\s+ve\s+)\s*/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return [text];
  const ok = parts.every((p) => !resolvePart(p, ctx).issues.some((i) => i.code === "unknown_code"));
  return ok ? parts : [text];
}

export function finalizeEntry(e: DraftEntry): DraftEntry {
  const interval = isWork(e.category) ? buildInterval(e.date, e.start, e.end) : null;
  e.startAt = interval?.startAt ?? null;
  e.endAt = interval?.endAt ?? null;
  e.hours = interval ? interval.hours : isWork(e.category) ? null : 0;
  e.overnight = interval?.overnight ?? false;
  if (!isWork(e.category)) { e.start = null; e.end = null; }
  const o = Math.min(e.confidence.read.score, e.confidence.type.score, e.confidence.time.score);
  e.confidence.overall = score(o);
  return e;
}

export function normalizeCells(cells: RosterCell[], ctx: NormalizeContext): DraftEntry[] {
  const out: DraftEntry[] = [];
  const dim = daysInMonth(ctx.year, ctx.month);
  for (const cell of cells) {
    if (cell.day < 1 || cell.day > dim || !cell.raw.trim()) continue;
    const date = ymd(ctx.year, ctx.month, cell.day);
    for (const part of splitParts(cell.raw, ctx)) {
      const r = resolvePart(part, ctx);
      const read = score(cell.readScore, cell.note || (cell.readScore >= 0.99 ? "Dijital dosyadan okundu" : undefined));
      const issues = [...r.issues];
      if (read.level !== "high") {
        issues.push({ code: "low_read", severity: read.level === "low" ? "error" : "warning",
          message: `Hücre net okunamadı${cell.note ? ` (${cell.note})` : ""}. Okunan değer: "${cell.raw}".` });
      }
      out.push(finalizeEntry({
        id: randomUUID(), date, raw: cell.raw, code: r.code, label: r.label, category: r.category,
        start: r.start, end: r.end, startAt: null, endAt: null, hours: null, overnight: false,
        isExtra: r.isExtra, department: ctx.department, note: "",
        confidence: { read, type: r.type, time: r.time, overall: read },
        issues, status: "ok", verified: false, excluded: false, edited: false,
      }));
    }
  }
  return out;
}
