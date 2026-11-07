// Yerel ("kayan") tarih-saat yardımcıları. Türkiye'de yaz saati uygulaması olmadığından
// tüm süreler UTC milisaniye üzerinden hesaplanır; böylece saat dilimi sorunları oluşmaz.

export const pad2 = (n: number) => String(n).padStart(2, "0");
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** "2026-11-03" veya "2026-11-03T20:00" → ms */
export function toMs(local: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(local);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
}

export function fromMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export const dateOf = (ms: number) => fromMs(ms).slice(0, 10);
export const ymd = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;
export const addDays = (date: string, n: number) => dateOf(toMs(date) + n * DAY);
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** 0 = Pazartesi … 6 = Pazar */
export const weekday = (date: string) => (new Date(toMs(date)).getUTCDay() + 6) % 7;
export const isWeekend = (date: string) => weekday(date) >= 5;
export const monthRange = (y: number, m: number): [number, number] => [Date.UTC(y, m - 1, 1), Date.UTC(y, m, 1)];

/** "08:00" / "8.30" / "24:00" → dakika */
export function parseHM(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(s.trim());
  if (!m) return null;
  const h = +m[1], min = m[2] ? +m[2] : 0;
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

export const formatHM = (min: number) => `${pad2(Math.floor(min / 60) % 24)}:${pad2(min % 60)}`;

/**
 * Başlangıç günü ve saatlerden gerçek zaman aralığı üretir.
 * Bitiş başlangıçtan küçük veya eşitse vardiya ertesi güne sarkar:
 * 20:00–08:00 = 12 saat, 08:00–08:00 = 24 saat.
 */
export function buildInterval(date: string, start: string | null, end: string | null) {
  const s = parseHM(start), e = parseHM(end);
  if (s == null || e == null) return null;
  const base = toMs(date);
  if (Number.isNaN(base)) return null;
  const startMs = base + s * 60_000;
  let endMs = base + e * 60_000;
  if (endMs <= startMs) endMs += DAY;
  return {
    startAt: fromMs(startMs),
    endAt: fromMs(endMs),
    hours: Math.round(((endMs - startMs) / HOUR) * 100) / 100,
    overnight: dateOf(endMs - 1) !== date,
  };
}

export const overlapMs = (a0: number, a1: number, b0: number, b1: number) =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

export const round2 = (n: number) => Math.round(n * 100) / 100;
