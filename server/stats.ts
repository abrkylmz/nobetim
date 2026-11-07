// Aylık istatistikler. Saatler gerçek zaman aralıkları üzerinden hesaplanır:
// ay sınırını aşan bir gece nöbetinin saatleri iki aya bölünür.

import { CATEGORY_META, isWork, type MonthStats, type Profile, type Shift, type ShiftCategory } from "../shared/types.js";
import { DAY, HOUR, daysInMonth, isWeekend, monthRange, overlapMs, round2, toMs, ymd, weekday } from "../shared/time.js";
import { holidayHours, holidayOn } from "../shared/holidays.js";

const nightWindowHours = (s: number, e: number) => {
  // 00:00–06:00 aralığına düşen saatler
  let total = 0;
  for (let d = Math.floor(s / DAY) * DAY; d < e; d += DAY) total += overlapMs(s, e, d, d + 6 * HOUR);
  return total / HOUR;
};

export function isNightShift(s: Shift): boolean {
  if (!s.startAt || !s.endAt) return false;
  return s.category === "night" || nightWindowHours(toMs(s.startAt), toMs(s.endAt)) >= 2;
}

export function monthStats(shifts: Shift[], year: number, month: number, profile: Profile | null): MonthStats {
  const [m0, m1] = monthRange(year, month);
  const prefix = ymd(year, month, 1).slice(0, 7);
  const byCat = new Map<ShiftCategory, { count: number; hours: number }>();
  let workHours = 0, shiftCount = 0, nightShifts = 0, weekendShifts = 0, holidayH = 0, holidayShifts = 0, leaveDays = 0, sickDays = 0;
  const offWeekdays = new Set<string>();

  for (const s of shifts) {
    if (isWork(s.category) && s.startAt && s.endAt) {
      const a = toMs(s.startAt), b = toMs(s.endAt);
      const inMonth = overlapMs(a, b, m0, m1) / HOUR;
      if (inMonth <= 0) continue;
      workHours += inMonth;
      const startsHere = s.date.startsWith(prefix);
      if (startsHere) {
        shiftCount++;
        if (isNightShift(s)) nightShifts++;
        if (isWeekend(s.date)) weekendShifts++;
      }
      const hh = holidayHours(Math.max(a, m0), Math.min(b, m1));
      holidayH += hh;
      if (hh > 0 && startsHere) holidayShifts++;
      const c = byCat.get(s.category) ?? { count: 0, hours: 0 };
      if (startsHere) c.count++;
      c.hours += inMonth;
      byCat.set(s.category, c);
    } else if (s.date.startsWith(prefix)) {
      if (s.category === "leave") leaveDays++;
      if (s.category === "sick") sickDays++;
      if ((s.category === "leave" || s.category === "sick") && weekday(s.date) < 5) offWeekdays.add(s.date);
      const c = byCat.get(s.category) ?? { count: 0, hours: 0 };
      c.count++;
      byCat.set(s.category, c);
    }
  }

  // Yasal çalışma normu: hafta içi iş günleri (resmî tatil ve izin/rapor günleri hariç) × günlük saat
  const dailyNorm = (profile?.weeklyHours ?? 40) / 5;
  let normDays = 0;
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    const date = ymd(year, month, d);
    if (weekday(date) >= 5 || offWeekdays.has(date)) continue;
    const h = holidayOn(date);
    normDays += h ? (h.half ? 0.5 : 0) : 1;
  }
  const normHours = normDays * dailyNorm;
  const overtimeHours = Math.max(0, workHours - normHours);
  const estimatedIncome = overtimeHours * (profile?.overtimeRate ?? 0) + holidayH * (profile?.holidayRate ?? 0);

  return {
    year, month,
    shiftCount, workHours: round2(workHours), nightShifts, weekendShifts,
    holidayHours: round2(holidayH), holidayShifts, leaveDays, sickDays,
    normHours: round2(normHours), overtimeHours: round2(overtimeHours), estimatedIncome: Math.round(estimatedIncome),
    byCategory: [...byCat].map(([category, v]) => ({ category, count: v.count, hours: round2(v.hours) }))
      .sort((a, b) => Object.keys(CATEGORY_META).indexOf(a.category) - Object.keys(CATEGORY_META).indexOf(b.category)),
  };
}
