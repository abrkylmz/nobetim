// Veritabanı: libSQL (Turso). Yerelde ve testlerde "file:" adresiyle SQLite dosyası,
// Vercel'de Turso bulut veritabanı kullanılır. Tüm sorgular asenkrondur.

import { createClient, type Client, type InArgs, type Row as LibRow } from "@libsql/client";
import { randomUUID } from "node:crypto";
import type {
  Candidate, DraftEntry, ImportDetail, ImportStatus, ImportSummary, Profile, Quality, Shift, ShiftCategory, ShiftType, SourceKind,
} from "../shared/types.js";
import { CATEGORY_META } from "../shared/types.js";
import type { Legend } from "./parsing/types.js";
import type { PersonRecord } from "./parsing/pipeline.js";

/** İstemci ya da açık bir işlem (transaction): ikisi de `execute` sağlar. */
export type Exec = Pick<Client, "execute">;
export type DB = Client;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT PRIMARY KEY, full_name TEXT NOT NULL, hospital TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '',
    staff_no TEXT NOT NULL DEFAULT '', weekly_hours REAL NOT NULL DEFAULT 40, overtime_rate REAL NOT NULL DEFAULT 0, holiday_rate REAL NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS shift_types (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, code TEXT NOT NULL, label TEXT NOT NULL, category TEXT NOT NULL,
    start TEXT, end TEXT, color TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS shift_types_user ON shift_types(user_id)`,
  `CREATE TABLE IF NOT EXISTS imports (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, file_name TEXT NOT NULL, file_hash TEXT NOT NULL, size INTEGER NOT NULL,
    stored_files TEXT, file_expires_at INTEGER, status TEXT NOT NULL, source TEXT, progress TEXT, error TEXT,
    created_at TEXT NOT NULL, analyzed_at TEXT, confirmed_at TEXT, period_year INTEGER, period_month INTEGER,
    period_guessed INTEGER NOT NULL DEFAULT 0, person_json TEXT, candidates_json TEXT, match_note TEXT, quality_json TEXT,
    notes_json TEXT, legend_json TEXT, draft_json TEXT, shift_count INTEGER NOT NULL DEFAULT 0, duplicate_of TEXT,
    processing_started_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS imports_user ON imports(user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, import_id TEXT, date TEXT NOT NULL, start_at TEXT, end_at TEXT,
    code TEXT NOT NULL, label TEXT NOT NULL, category TEXT NOT NULL, hours REAL NOT NULL DEFAULT 0, is_extra INTEGER NOT NULL DEFAULT 0,
    department TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS shifts_user_date ON shifts(user_id, date)`,
  `CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, n INTEGER NOT NULL, reset INTEGER NOT NULL)`,
];

// Önceki sürümlerden kalan veritabanları için sütun eklemeleri (varsa hata yok sayılır)
const MIGRATIONS = [
  "ALTER TABLE imports ADD COLUMN processing_started_at INTEGER",
];

export async function openDb(url: string, authToken?: string): Promise<DB> {
  const db = createClient({ url, authToken });
  if (url.startsWith("file:")) await db.execute("PRAGMA busy_timeout = 5000");
  await db.batch(SCHEMA, "write");
  for (const m of MIGRATIONS) {
    try { await db.execute(m); } catch { /* sütun zaten var */ }
  }
  return db;
}

/** Bir işlem içinde çalıştırır; hata olursa geri alır. */
export async function tx<T>(db: DB, fn: (t: Exec) => Promise<T>): Promise<T> {
  const t = await db.transaction("write");
  try {
    const r = await fn(t);
    await t.commit();
    return r;
  } catch (e) {
    await t.rollback().catch(() => {});
    throw e;
  } finally {
    t.close();
  }
}

type Row = Record<string, unknown>;
export async function all(e: Exec, sql: string, args: InArgs = []): Promise<Row[]> {
  return (await e.execute({ sql, args })).rows as unknown as Row[];
}
export async function one(e: Exec, sql: string, args: InArgs = []): Promise<Row | undefined> {
  return (await all(e, sql, args))[0];
}
export async function run(e: Exec, sql: string, args: InArgs = []): Promise<number> {
  return (await e.execute({ sql, args })).rowsAffected;
}

const json = <T>(v: unknown, fallback: T): T => (typeof v === "string" && v ? (JSON.parse(v) as T) : fallback);
const nowIso = () => new Date().toISOString();
const num = (v: unknown) => (v == null ? null : Number(v));

// ---------- hız sınırı (tüm sunucu örnekleri arasında ortak) ----------

export async function hit(e: Exec, key: string, windowMs: number): Promise<{ n: number; reset: number }> {
  const now = Date.now();
  const r = await one(e, `INSERT INTO rate_limits (key, n, reset) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      n = CASE WHEN rate_limits.reset < ? THEN 1 ELSE rate_limits.n + 1 END,
      reset = CASE WHEN rate_limits.reset < ? THEN excluded.reset ELSE rate_limits.reset END
    RETURNING n, reset`, [key, now + windowMs, now, now]);
  return { n: Number(r!.n), reset: Number(r!.reset) };
}

// ---------- profil ----------

export async function getProfile(e: Exec, userId: string): Promise<Profile | null> {
  const r = await one(e, "SELECT * FROM profiles WHERE user_id = ?", [userId]);
  if (!r) return null;
  return {
    fullName: r.full_name as string, hospital: r.hospital as string, department: r.department as string, staffNo: r.staff_no as string,
    weeklyHours: Number(r.weekly_hours), overtimeRate: Number(r.overtime_rate), holidayRate: Number(r.holiday_rate),
  };
}

export async function saveProfile(e: Exec, userId: string, p: Profile) {
  await run(e, `INSERT INTO profiles (user_id, full_name, hospital, department, staff_no, weekly_hours, overtime_rate, holiday_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET full_name = excluded.full_name, hospital = excluded.hospital, department = excluded.department,
      staff_no = excluded.staff_no, weekly_hours = excluded.weekly_hours, overtime_rate = excluded.overtime_rate, holiday_rate = excluded.holiday_rate`,
  [userId, p.fullName, p.hospital, p.department, p.staffNo, p.weeklyHours, p.overtimeRate, p.holidayRate]);
}

// ---------- vardiya kodları ----------

export const DEFAULT_SHIFT_TYPES: Omit<ShiftType, "id" | "verified">[] = [
  { code: "G", label: "Gündüz", category: "day", start: "08:00", end: "16:00", color: CATEGORY_META.day.color },
  { code: "S", label: "Sabah", category: "day", start: "08:00", end: "16:00", color: "#38BDF8" },
  { code: "A", label: "Akşam", category: "evening", start: "16:00", end: "24:00", color: CATEGORY_META.evening.color },
  { code: "N", label: "Nöbet", category: "night", start: "16:00", end: "08:00", color: CATEGORY_META.night.color },
  { code: "GC", label: "Gece", category: "night", start: "20:00", end: "08:00", color: "#4F46E5" },
  { code: "24", label: "24 saat nöbet", category: "24h", start: "08:00", end: "08:00", color: CATEGORY_META["24h"].color },
  { code: "EK", label: "Ek nöbet", category: "extra", start: null, end: null, color: CATEGORY_META.extra.color },
  { code: "İ", label: "İzin", category: "leave", start: null, end: null, color: CATEGORY_META.leave.color },
  { code: "Yİ", label: "Yıllık izin", category: "leave", start: null, end: null, color: "#15803D" },
  { code: "R", label: "Rapor", category: "sick", start: null, end: null, color: CATEGORY_META.sick.color },
  { code: "HT", label: "Hafta tatili", category: "off", start: null, end: null, color: CATEGORY_META.off.color },
  { code: "RT", label: "Resmî tatil", category: "holiday", start: null, end: null, color: CATEGORY_META.holiday.color },
];

const toShiftType = (r: Row): ShiftType => ({
  id: r.id as string, code: r.code as string, label: r.label as string, category: r.category as ShiftCategory,
  start: (r.start as string) ?? null, end: (r.end as string) ?? null, color: r.color as string, verified: !!Number(r.verified),
});

export async function listShiftTypes(e: Exec, userId: string): Promise<ShiftType[]> {
  return (await all(e, "SELECT * FROM shift_types WHERE user_id = ? ORDER BY sort, code", [userId])).map(toShiftType);
}

/** Dış işlem verilirse onun içinde, verilmezse kendi işleminde çalışır. */
export async function replaceShiftTypes(db: DB, userId: string, types: Omit<ShiftType, "id">[], inTx?: Exec) {
  const work = async (t: Exec) => {
    await run(t, "DELETE FROM shift_types WHERE user_id = ?", [userId]);
    for (const [i, s] of types.entries()) {
      await run(t, "INSERT INTO shift_types (id, user_id, code, label, category, start, end, color, verified, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [randomUUID(), userId, s.code, s.label, s.category, s.start, s.end, s.color, s.verified ? 1 : 0, i]);
    }
  };
  if (inTx) await work(inTx); else await tx(db, work);
}

export const seedShiftTypes = (db: DB, userId: string) =>
  replaceShiftTypes(db, userId, DEFAULT_SHIFT_TYPES.map((t) => ({ ...t, verified: false })));

// ---------- nöbetler ----------

const toShift = (r: Row, types: ShiftType[]): Shift => {
  const t = types.find((x) => x.code === r.code);
  const category = r.category as ShiftCategory;
  return {
    id: r.id as string, date: r.date as string, startAt: (r.start_at as string) ?? null, endAt: (r.end_at as string) ?? null,
    code: r.code as string, label: r.label as string, category, hours: Number(r.hours), isExtra: !!Number(r.is_extra),
    department: r.department as string, note: r.note as string, source: r.source as Shift["source"],
    importId: (r.import_id as string) ?? null, color: t?.color ?? CATEGORY_META[category]?.color ?? "#94A3B8",
  };
};

export async function listShifts(e: Exec, userId: string, from: string, to: string, excludeImport?: string): Promise<Shift[]> {
  const types = await listShiftTypes(e, userId);
  // Önceki günden sarkan gece nöbetlerini de kapsamak için bir gün geriden başla
  const rows = await all(e, `SELECT * FROM shifts WHERE user_id = ? AND date >= date(?, '-1 day') AND date <= ?
    AND (? IS NULL OR import_id IS NULL OR import_id != ?) ORDER BY date, start_at`,
  [userId, from, to, excludeImport ?? null, excludeImport ?? null]);
  return rows.map((r) => toShift(r, types));
}

export async function getShift(e: Exec, userId: string, id: string): Promise<Shift | null> {
  const r = await one(e, "SELECT * FROM shifts WHERE id = ? AND user_id = ?", [id, userId]);
  return r ? toShift(r, await listShiftTypes(e, userId)) : null;
}

export interface ShiftInput {
  date: string; startAt: string | null; endAt: string | null; code: string; label: string; category: ShiftCategory;
  hours: number; isExtra: boolean; department: string; note: string;
}

export async function insertShift(e: Exec, userId: string, s: ShiftInput, source: Shift["source"], importId: string | null): Promise<string> {
  const id = randomUUID();
  await run(e, `INSERT INTO shifts (id, user_id, import_id, date, start_at, end_at, code, label, category, hours, is_extra, department, note, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [id, userId, importId, s.date, s.startAt, s.endAt, s.code, s.label, s.category, s.hours, s.isExtra ? 1 : 0, s.department, s.note, source, nowIso()]);
  return id;
}

export async function updateShift(e: Exec, userId: string, id: string, s: ShiftInput) {
  await run(e, `UPDATE shifts SET date = ?, start_at = ?, end_at = ?, code = ?, label = ?, category = ?, hours = ?, is_extra = ?, department = ?, note = ?
    WHERE id = ? AND user_id = ?`,
  [s.date, s.startAt, s.endAt, s.code, s.label, s.category, s.hours, s.isExtra ? 1 : 0, s.department, s.note, id, userId]);
}

export const deleteShift = async (e: Exec, userId: string, id: string) =>
  (await run(e, "DELETE FROM shifts WHERE id = ? AND user_id = ?", [id, userId])) > 0;

// ---------- içe aktarmalar ----------

export interface StoredFile { path: string; name: string; kind: string }

export interface ImportRecord extends ImportDetail {
  userId: string;
  fileHash: string;
  storedFiles: StoredFile[] | null;
  periodGuessed: boolean;
  person: PersonRecord | null;
}

function toImport(r: Row): ImportRecord {
  const stored = json<StoredFile[] | null>(r.stored_files, null);
  const person = json<PersonRecord | null>(r.person_json, null);
  return {
    id: r.id as string, userId: r.user_id as string, fileName: r.file_name as string, fileHash: r.file_hash as string,
    createdAt: r.created_at as string, status: r.status as ImportStatus, source: (r.source as SourceKind) ?? null,
    shiftCount: Number(r.shift_count), confirmedAt: (r.confirmed_at as string) ?? null,
    periodYear: num(r.period_year), periodMonth: num(r.period_month), periodGuessed: !!Number(r.period_guessed),
    personName: person?.name ?? null,
    duplicateOf: (r.duplicate_of as string) ?? null, fileAvailable: !!stored?.length,
    error: (r.error as string) ?? null, progress: (r.progress as string) ?? null,
    storedFiles: stored, person,
    draft: json<DraftEntry[]>(r.draft_json, []),
    candidates: json<Candidate[]>(r.candidates_json, []),
    matchNote: (r.match_note as string) ?? null,
    quality: json<Quality | null>(r.quality_json, null),
    notes: json<string[]>(r.notes_json, []),
    legend: json<Legend[]>(r.legend_json, []),
  };
}

export async function createImport(e: Exec, v: { userId: string; fileName: string; fileHash: string; size: number; storedFiles: StoredFile[]; fileExpiresAt: number; duplicateOf: string | null }): Promise<string> {
  const id = randomUUID();
  await run(e, `INSERT INTO imports (id, user_id, file_name, file_hash, size, stored_files, file_expires_at, status, progress, created_at, duplicate_of, processing_started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', 'Sırada', ?, ?, ?)`,
  [id, v.userId, v.fileName, v.fileHash, v.size, JSON.stringify(v.storedFiles), v.fileExpiresAt, nowIso(), v.duplicateOf, Date.now()]);
  return id;
}

export async function getImport(e: Exec, userId: string, id: string): Promise<ImportRecord | null> {
  const r = await one(e, "SELECT * FROM imports WHERE id = ? AND user_id = ?", [id, userId]);
  return r ? toImport(r) : null;
}

export async function listImports(e: Exec, userId: string): Promise<ImportSummary[]> {
  return (await all(e, "SELECT * FROM imports WHERE user_id = ? ORDER BY created_at DESC LIMIT 200", [userId])).map((r) => {
    const { draft: _d, candidates: _c, legend: _l, notes: _n, quality: _q, matchNote: _m, storedFiles: _s, person: _p, userId: _u, fileHash: _h, periodGuessed: _g, ...summary } = toImport(r);
    return summary;
  });
}

export async function findImportByHash(e: Exec, userId: string, hash: string): Promise<ImportSummary | null> {
  const r = await one(e, "SELECT * FROM imports WHERE user_id = ? AND file_hash = ? AND status != 'discarded' ORDER BY created_at DESC LIMIT 1", [userId, hash]);
  return r ? toImport(r) : null;
}

const COLS: Record<string, string> = {
  status: "status", source: "source", progress: "progress", error: "error", analyzedAt: "analyzed_at", confirmedAt: "confirmed_at",
  periodYear: "period_year", periodMonth: "period_month", periodGuessed: "period_guessed", person: "person_json",
  candidates: "candidates_json", matchNote: "match_note", quality: "quality_json", notes: "notes_json", legend: "legend_json",
  draft: "draft_json", shiftCount: "shift_count", storedFiles: "stored_files", fileExpiresAt: "file_expires_at",
  processingStartedAt: "processing_started_at",
};
const JSON_COLS = new Set(["person", "candidates", "quality", "notes", "legend", "draft", "storedFiles"]);

export async function updateImport(e: Exec, id: string, patch: Record<string, unknown>) {
  const keys = Object.keys(patch).filter((k) => COLS[k]);
  if (!keys.length) return;
  const values = keys.map((k) => {
    const v = patch[k];
    if (JSON_COLS.has(k)) return v == null ? null : JSON.stringify(v);
    if (typeof v === "boolean") return v ? 1 : 0;
    return (v ?? null) as string | number | null;
  });
  await run(e, `UPDATE imports SET ${keys.map((k) => `${COLS[k]} = ?`).join(", ")} WHERE id = ?`, [...values, id]);
}

/** Kullanıcının tüm verisini siler (yabancı anahtar zincirine güvenmeden). */
export async function deleteUserData(db: DB, userId: string) {
  await db.batch([
    { sql: "DELETE FROM shifts WHERE user_id = ?", args: [userId] },
    { sql: "DELETE FROM imports WHERE user_id = ?", args: [userId] },
    { sql: "DELETE FROM shift_types WHERE user_id = ?", args: [userId] },
    { sql: "DELETE FROM profiles WHERE user_id = ?", args: [userId] },
    { sql: "DELETE FROM sessions WHERE user_id = ?", args: [userId] },
    { sql: "DELETE FROM users WHERE id = ?", args: [userId] },
  ], "write");
}

export type { LibRow };
