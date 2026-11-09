// Sunucu ve arayüzün ortak kullandığı tipler.

export type ShiftCategory =
  | "day" | "evening" | "night" | "24h" | "extra"
  | "leave" | "sick" | "holiday" | "off" | "other";

export const CATEGORY_META: Record<ShiftCategory, { label: string; color: string; work: boolean }> = {
  day: { label: "Gündüz", color: "#0EA5E9", work: true },
  evening: { label: "Akşam", color: "#F4A261", work: true },
  night: { label: "Gece", color: "#6366F1", work: true },
  "24h": { label: "24 saat", color: "#E11D48", work: true },
  extra: { label: "Ek nöbet", color: "#D97706", work: true },
  leave: { label: "İzin", color: "#16A34A", work: false },
  sick: { label: "Rapor", color: "#64748B", work: false },
  holiday: { label: "Tatil", color: "#0D9488", work: false },
  off: { label: "Boş", color: "#94A3B8", work: false },
  other: { label: "Diğer", color: "#A855F7", work: true },
};

export const isWork = (c: ShiftCategory) => CATEGORY_META[c].work;

export interface ShiftType {
  id: string;
  code: string;
  label: string;
  category: ShiftCategory;
  start: string | null; // "08:00"
  end: string | null;   // "16:00" — başlangıçtan küçük/eşitse ertesi gün
  color: string;
  /** Kullanıcı bu kodun saatlerini onayladı mı? Onaysız varsayılanlar "orta güven" sayılır. */
  verified: boolean;
}

export type Confidence = "high" | "medium" | "low";
export interface FieldScore { score: number; level: Confidence; reason?: string }

export const levelOf = (score: number): Confidence =>
  score >= 0.85 ? "high" : score >= 0.6 ? "medium" : "low";

export type IssueCode =
  | "unknown_code" | "missing_time" | "low_read" | "overlap" | "duplicate"
  | "existing_conflict" | "default_time" | "long_shift" | "invalid_time";

export interface Issue { code: IssueCode; message: string; severity: "warning" | "error" }

export type EntryStatus = "ok" | "check" | "error" | "duplicate";

export interface DraftEntry {
  id: string;
  date: string;          // YYYY-MM-DD (vardiyanın başladığı gün)
  raw: string;           // çizelgedeki hücre içeriği
  code: string;
  label: string;
  category: ShiftCategory;
  start: string | null;  // HH:MM
  end: string | null;
  startAt: string | null; // YYYY-MM-DDTHH:MM (yerel)
  endAt: string | null;
  hours: number | null;
  overnight: boolean;
  isExtra: boolean;
  department: string;
  note: string;
  confidence: { read: FieldScore; type: FieldScore; time: FieldScore; overall: FieldScore };
  issues: Issue[];
  status: EntryStatus;
  verified: boolean;   // kullanıcı elle doğruladı
  excluded: boolean;   // kullanıcı sildi / takvime eklenmeyecek
  edited: boolean;
}

export interface Candidate {
  key: string;
  name: string;
  staffNo?: string;
  title?: string;
  department?: string;
  score: number;
  reason: string;
}

export interface Quality {
  level: "good" | "fair" | "poor";
  problems: string[];
  askReupload: boolean;
  metrics?: { width: number; height: number; sharpness: number; brightness: number };
}

export type ImportStatus = "processing" | "needs_selection" | "review" | "confirmed" | "failed" | "discarded";
export type SourceKind = "excel" | "pdf-text" | "pdf-scan" | "image";

export interface ImportSummary {
  id: string;
  fileName: string;
  createdAt: string;
  status: ImportStatus;
  source: SourceKind | null;
  shiftCount: number;
  confirmedAt: string | null;
  periodYear: number | null;
  periodMonth: number | null;
  personName: string | null;
  duplicateOf: string | null;
  fileAvailable: boolean;
  error: string | null;
  progress: string | null;
}

export interface ImportDetail extends ImportSummary {
  draft: DraftEntry[];
  candidates: Candidate[];
  matchNote: string | null;
  quality: Quality | null;
  notes: string[];
  legend: { code: string; meaning: string }[];
}

export interface Shift {
  id: string;
  date: string;
  startAt: string | null;
  endAt: string | null;
  code: string;
  label: string;
  category: ShiftCategory;
  hours: number;
  isExtra: boolean;
  department: string;
  note: string;
  source: "import" | "manual";
  importId: string | null;
  color: string;
}

export interface Profile {
  fullName: string;
  hospital: string;
  department: string;
  staffNo: string;
  weeklyHours: number;
  overtimeRate: number; // TL / saat
  holidayRate: number;  // TL / saat (resmî tatil çalışması için ek)
  /** Hazır nöbet ücreti tarifesi (shared/payRates.ts); boşsa ücretler elle girilir */
  payGroup: string;
  /** Riskli birim (acil, yoğun bakım, 112…) — %50 artırımlı sütun */
  payRisky: boolean;
}

export interface MonthStats {
  year: number;
  month: number;
  shiftCount: number;
  workHours: number;
  nightShifts: number;
  weekendShifts: number;
  holidayHours: number;
  holidayShifts: number;
  leaveDays: number;
  sickDays: number;
  normHours: number;
  overtimeHours: number;
  estimatedIncome: number;
  /** Hazır tarifeyle hesaplandıysa: saat dilimlerine göre dağılım ve ortalama saat ücreti */
  pay: PayBreakdown | null;
  byCategory: { category: ShiftCategory; count: number; hours: number }[];
}

export interface Me { id: string; email: string; profile: Profile | null }

export interface PayBreakdown {
  groupLabel: string;
  periodLabel: string;
  risky: boolean;
  /** Ay içindeki tüm çalışma saatlerinin dilimlere dağılımı (ücretli saatler bu oranla dağıtılır) */
  buckets: { kind: "day" | "night" | "holiday" | "holidayNight"; hours: number; rate: number }[];
  /** Fazla mesai saatine uygulanan ağırlıklı ortalama saat ücreti */
  avgRate: number;
}
