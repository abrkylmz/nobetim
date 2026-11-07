// Taslak kayıtları doğrular: eksik saat, aşırı uzun vardiya, taslak içi çakışma,
// takvimde zaten olan (mükerrer) ve takvimdeki farklı kayıtlarla çakışan nöbetler.

import { CATEGORY_META, isWork, type DraftEntry, type Issue, type Shift } from "../../shared/types.js";
import { toMs } from "../../shared/time.js";

const DYNAMIC: Issue["code"][] = ["overlap", "duplicate", "existing_conflict", "long_shift", "invalid_time"];

const fmt = (date: string) => {
  const [y, m, d] = date.split("-");
  return `${d}.${m}.${y}`;
};

function interval(e: { startAt: string | null; endAt: string | null }): [number, number] | null {
  if (!e.startAt || !e.endAt) return null;
  return [toMs(e.startAt), toMs(e.endAt)];
}

export function sameShift(e: DraftEntry, s: Shift): boolean {
  if (!isWork(e.category) || !e.startAt) return e.date === s.date && e.category === s.category;
  return e.startAt === s.startAt && e.endAt === s.endAt && (e.category === s.category || e.code === s.code);
}

export function validateDraft(entries: DraftEntry[], existing: Shift[]): DraftEntry[] {
  const active = entries.filter((e) => !e.excluded);

  for (const e of entries) {
    e.issues = e.issues.filter((i) => !DYNAMIC.includes(i.code));
    if (e.excluded) continue;
    const needsTime = isWork(e.category) && !e.startAt;
    if (!needsTime) e.issues = e.issues.filter((i) => i.code !== "missing_time");
    else if (!e.issues.some((i) => i.code === "missing_time")) {
      e.issues.push({ code: "missing_time", severity: "error", message: "Çalışma saati eksik. Başlangıç ve bitiş saatini gir." });
    }
    if (e.hours != null && e.hours > 24) {
      e.issues.push({ code: "invalid_time", severity: "error", message: "Vardiya 24 saatten uzun olamaz." });
    } else if (e.hours != null && e.hours > 16 && e.category !== "24h") {
      e.issues.push({ code: "long_shift", severity: "warning", message: `${e.hours} saatlik vardiya: saatleri kontrol et.` });
    }
  }

  // Taslak içi çakışmalar
  for (let i = 0; i < active.length; i++) {
    const a = interval(active[i]);
    if (!a) continue;
    for (let k = i + 1; k < active.length; k++) {
      const b = interval(active[k]);
      if (b && a[0] < b[1] && b[0] < a[1]) {
        active[i].issues.push({ code: "overlap", severity: "warning", message: `${fmt(active[k].date)} tarihli ${active[k].code} vardiyasıyla saatleri çakışıyor.` });
        active[k].issues.push({ code: "overlap", severity: "warning", message: `${fmt(active[i].date)} tarihli ${active[i].code} vardiyasıyla saatleri çakışıyor.` });
      }
    }
    // Aynı günde çalışma + izin
  }
  for (const e of active) {
    if (isWork(e.category)) continue;
    const clash = active.find((o) => o !== e && o.date === e.date && isWork(o.category));
    if (clash) e.issues.push({ code: "overlap", severity: "warning", message: `Aynı gün hem ${CATEGORY_META[e.category].label.toLowerCase()} hem ${clash.code} vardiyası var.` });
  }

  // Takvimdeki kayıtlar
  for (const e of active) {
    const dup = existing.find((s) => sameShift(e, s));
    if (dup) {
      e.issues.push({ code: "duplicate", severity: "warning", message: "Bu nöbet takvimde zaten var; tekrar eklenmeyecek." });
      continue;
    }
    const a = interval(e);
    const conflict = existing.find((s) => {
      const b = interval(s);
      if (a && b) return a[0] < b[1] && b[0] < a[1];
      return s.date === e.date && (!a || !b);
    });
    if (conflict) {
      e.issues.push({ code: "existing_conflict", severity: "warning",
        message: `Takvimde ${fmt(conflict.date)} için farklı bir kayıt var (${conflict.code}${conflict.startAt ? ` ${conflict.startAt.slice(11)}–${conflict.endAt?.slice(11)}` : ""}).` });
    }
  }

  for (const e of entries) e.status = statusOf(e);
  return entries;
}

export function statusOf(e: DraftEntry): DraftEntry["status"] {
  if (e.issues.some((i) => i.code === "duplicate")) return "duplicate";
  const hardErrors = e.issues.filter((i) => i.severity === "error" && (["missing_time", "invalid_time"].includes(i.code) || !e.verified));
  if (hardErrors.length) return "error";
  if (e.verified) return "ok";
  if (e.confidence.overall.level === "low") return "error";
  if (e.issues.length || e.confidence.overall.level === "medium") return "check";
  return "ok";
}

/** Onaylanabilir mi? Düşük güvenli/hatalı kayıtlar elle düzeltilmeden ya da doğrulanmadan onaylanamaz. */
export function blockingEntries(entries: DraftEntry[]): DraftEntry[] {
  return entries.filter((e) => !e.excluded && e.status === "error");
}
