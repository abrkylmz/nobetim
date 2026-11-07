import { DAY, HOUR, overlapMs, toMs, ymd, addDays } from "./time.js";

export interface Holiday { date: string; name: string; half: boolean }

const FIXED: [string, string][] = [
  ["01-01", "Yılbaşı"],
  ["04-23", "Ulusal Egemenlik ve Çocuk Bayramı"],
  ["05-01", "Emek ve Dayanışma Günü"],
  ["05-19", "Atatürk'ü Anma, Gençlik ve Spor Bayramı"],
  ["07-15", "Demokrasi ve Millî Birlik Günü"],
  ["08-30", "Zafer Bayramı"],
  ["10-29", "Cumhuriyet Bayramı"],
];

// Dinî bayramlar her yıl değişir: [arife günü, ad, bayram gün sayısı].
// Kaynak: Diyanet takvimi. Yeni yıllar eklendikçe güncellenmelidir.
const RELIGIOUS: Record<number, [string, string, number][]> = {
  2025: [["2025-03-29", "Ramazan Bayramı", 3], ["2025-06-05", "Kurban Bayramı", 4]],
  2026: [["2026-03-19", "Ramazan Bayramı", 3], ["2026-05-26", "Kurban Bayramı", 4]],
  2027: [["2027-03-08", "Ramazan Bayramı", 3], ["2027-05-15", "Kurban Bayramı", 4]],
};

const cache = new Map<number, Holiday[]>();

export function holidaysOf(year: number): Holiday[] {
  if (cache.has(year)) return cache.get(year)!;
  const list: Holiday[] = FIXED.map(([md, name]) => ({ date: `${year}-${md}`, name, half: false }));
  list.push({ date: ymd(year, 10, 28), name: "Cumhuriyet Bayramı arifesi", half: true });
  for (const [arife, name, days] of RELIGIOUS[year] ?? []) {
    list.push({ date: arife, name: `${name} arifesi`, half: true });
    for (let i = 1; i <= days; i++) list.push({ date: addDays(arife, i), name: `${name} ${i}. gün`, half: false });
  }
  list.sort((a, b) => a.date.localeCompare(b.date));
  cache.set(year, list);
  return list;
}

export const holidayOn = (date: string) => holidaysOf(+date.slice(0, 4)).find((h) => h.date === date);

/** Bir zaman aralığının resmî tatile denk gelen saatleri (arife günleri 13:00'ten itibaren). */
export function holidayHours(startMs: number, endMs: number): number {
  let total = 0;
  const y0 = new Date(startMs).getUTCFullYear(), y1 = new Date(endMs).getUTCFullYear();
  for (let y = y0; y <= y1; y++) {
    for (const h of holidaysOf(y)) {
      const d = toMs(h.date);
      total += overlapMs(startMs, endMs, h.half ? d + 13 * HOUR : d, d + DAY);
    }
  }
  return total / HOUR;
}

export const hasHolidayData = (year: number) => year in RELIGIOUS;
