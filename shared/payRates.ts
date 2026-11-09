// Saatlik nöbet ücreti tarifeleri (657 s. Kanun ek 33. madde).
// Kaynak: "2026 Temmuz dönemi zamlı saatlik nöbet ücretleri" tablosu — Ocak 2026 tutarlarına %13,52 zam,
// %10 gece artırımı zamlı tutar üzerinden. Yeni dönem tabloları geldikçe PAY_PERIODS'a eklenmelidir.
//
// Sütunlar: Normal · Bayram (dinî bayram günleri) · Riskli (acil, yoğun bakım, 112 vb.) · Riskli bayram;
// her biri için [gündüz, gece (20:00–08:00, %10 artırımlı)] TL/saat.

export type RatePair = readonly [day: number, night: number];

export interface PayGroup {
  id: string;
  label: string;
  normal: RatePair;
  holiday: RatePair;
  risky: RatePair;
  riskyHoliday: RatePair;
}

export interface PayPeriod {
  /** Bu tablonun geçerli olduğu ilk ay (YYYY-MM) */
  from: string;
  label: string;
  groups: PayGroup[];
}

export const PAY_PERIODS: PayPeriod[] = [
  {
    from: "2026-07",
    label: "Temmuz 2026 dönemi (%13,52 zamlı)",
    groups: [
      { id: "lisans-kadrolu", label: "Lisans / Önlisans · Kadrolu", normal: [156.35, 171.99], holiday: [195.45, 215.0], risky: [234.53, 257.98], riskyHoliday: [293.17, 322.49] },
      { id: "lisans-sozlesmeli", label: "Lisans / Önlisans · Sözleşmeli", normal: [134.29, 147.72], holiday: [167.87, 184.66], risky: [201.45, 221.6], riskyHoliday: [251.81, 276.99] },
      { id: "ortaogretim-kadrolu", label: "Ortaöğretim · Kadrolu", normal: [132.9, 146.19], holiday: [166.13, 182.74], risky: [199.35, 219.29], riskyHoliday: [249.19, 274.11] },
      { id: "ortaogretim-sozlesmeli", label: "Ortaöğretim · Sözleşmeli", normal: [114.16, 125.58], holiday: [142.69, 156.96], risky: [171.23, 188.35], riskyHoliday: [214.04, 235.44] },
    ],
  },
];

/** Gece dilimi: 20:00–08:00 */
export const NIGHT_START_HOUR = 20;
export const NIGHT_END_HOUR = 8;

/** Bir ay için geçerli tablo: o aydan önce başlayan en yeni dönem; daha eskiyse ilk dönem */
export function periodFor(year: number, month: number): PayPeriod {
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const sorted = [...PAY_PERIODS].sort((a, b) => a.from.localeCompare(b.from));
  return [...sorted].reverse().find((p) => p.from <= key) ?? sorted[0];
}

export function payGroup(id: string, year?: number, month?: number): PayGroup | undefined {
  const period = year && month ? periodFor(year, month) : PAY_PERIODS[PAY_PERIODS.length - 1];
  return period.groups.find((g) => g.id === id);
}

export function isPayGroupId(id: string) {
  return PAY_PERIODS.some((p) => p.groups.some((g) => g.id === id));
}

/** Kullanıcının birimine göre [normal, bayram] çifti */
export function ratesOf(g: PayGroup, risky: boolean): { normal: RatePair; holiday: RatePair } {
  return risky ? { normal: g.risky, holiday: g.riskyHoliday } : { normal: g.normal, holiday: g.holiday };
}
