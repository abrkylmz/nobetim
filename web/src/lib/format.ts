import { CATEGORY_META, type Shift, type ShiftCategory } from "../../../shared/types";
import { toMs, weekday } from "../../../shared/time";

export const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
export const MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
export const WEEKDAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
export const WEEKDAYS_SHORT = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

/** Tarayıcının yerel saati, sunucuyla aynı "kayan" biçimde (YYYY-MM-DDTHH:MM) */
export function nowLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const todayStr = () => nowLocal().slice(0, 10);

export function fmtDate(date: string, opts: { weekday?: boolean; year?: boolean } = {}) {
  const [y, m, d] = date.split("-").map(Number);
  let s = `${d} ${MONTHS[m - 1]}`;
  if (opts.year) s += ` ${y}`;
  if (opts.weekday) s += `, ${WEEKDAYS[weekday(date)]}`;
  return s;
}

export const fmtTime = (local: string | null) => (local ? local.slice(11, 16) : "");
export const fmtHours = (h: number) => `${h.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} sa`;
export const fmtNum = (n: number, d = 1) => n.toLocaleString("tr-TR", { maximumFractionDigits: d });
export const fmtMoney = (n: number) => n.toLocaleString("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });

export function shiftRange(s: Pick<Shift, "startAt" | "endAt" | "date">) {
  if (!s.startAt || !s.endAt) return "Tüm gün";
  const next = s.endAt.slice(0, 10) !== s.date;
  return `${fmtTime(s.startAt)} – ${fmtTime(s.endAt)}${next ? " (+1)" : ""}`;
}

/** Dar alanlar için kısa kod: "20:00-08:00" → "20-08" */
export function shortCode(code: string) {
  const m = /^(\d{1,2})(?::00)?\s*[-–]\s*(\d{1,2})(?::00)?$/.exec(code.trim());
  return m ? `${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : code.length > 5 ? code.slice(0, 4) + "…" : code;
}

export const catLabel =(c: ShiftCategory) => CATEGORY_META[c].label;

/** "2 gün 4 sa", "3 sa 12 dk" */
export function untilText(fromLocal: string, toLocal: string) {
  const min = Math.max(0, Math.round((toMs(toLocal) - toMs(fromLocal)) / 60000));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return { d, h, m, text: d ? `${d} gün ${h} sa` : h ? `${h} sa ${m} dk` : `${m} dk` };
}

export function greeting() {
  const h = new Date().getHours();
  return h < 6 ? "İyi geceler" : h < 12 ? "Günaydın" : h < 18 ? "İyi günler" : "İyi akşamlar";
}

export const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? "";
export const initials = (full: string) => full.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toLocaleUpperCase("tr");

export function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
