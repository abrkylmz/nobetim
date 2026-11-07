import { createHash, randomUUID } from "node:crypto";
import { CATEGORY_META, isWork, levelOf, type DraftEntry, type ShiftCategory } from "../shared/types.js";
import { addDays, daysInMonth, ymd } from "../shared/time.js";
import {
  all, createImport, findImportByHash, getImport, getProfile, insertShift, listShiftTypes, listShifts,
  replaceShiftTypes, run, tx, updateImport, type DB, type ImportRecord, type StoredFile,
} from "./db.js";
import type { FileStore } from "./fileStore.js";
import type { AiExtractor } from "./parsing/AiExtractor.js";
import { analyze, rebuildDraft, type InputFile } from "./parsing/pipeline.js";
import { finalizeEntry } from "./parsing/ShiftNormalizer.js";
import { blockingEntries, sameShift, validateDraft } from "./parsing/ShiftValidator.js";
import { ParseError } from "./parsing/types.js";
import { codeKey } from "./parsing/text.js";
import type { FileKind } from "./security/fileValidation.js";

export class ServiceError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Bu süreden uzun "analiz ediliyor" kalan kayıtlar yarıda kalmış sayılır (Vercel'de fonksiyon süresi 300 sn). */
const STALE_MS = 10 * 60_000;

export interface ImportServiceDeps {
  db: DB;
  files: FileStore;
  ai: AiExtractor;
  retentionDays: number;
  /** Yanıt döndükten sonra arka plan işinin sürmesini sağlar (Vercel: waitUntil). */
  defer?: (p: Promise<unknown>) => void;
}

export function createImportService({ db, files, ai, retentionDays, defer }: ImportServiceDeps) {
  const running = new Map<string, Promise<void>>();

  async function requireImport(userId: string, id: string): Promise<ImportRecord> {
    const imp = await getImport(db, userId, id);
    if (!imp) throw new ServiceError(404, "Kayıt bulunamadı.");
    return imp;
  }

  const periodShifts = (userId: string, year: number, month: number, excludeImport: string) =>
    listShifts(db, userId, addDays(ymd(year, month, 1), -1), addDays(ymd(year, month, daysInMonth(year, month)), 1), excludeImport);

  async function analyzeNow(userId: string, id: string, opts: { selected?: { key: string; name: string }; period?: { year: number; month: number } }) {
    const imp = await requireImport(userId, id);
    const profile = await getProfile(db, userId);
    if (!profile) throw new ServiceError(400, "Önce profil bilgilerini tamamla.");
    if (!imp.storedFiles?.length) throw new ServiceError(410, "Dosya saklama süresi dolduğu için silinmiş. Dosyayı yeniden yükle.");

    const input: InputFile[] = await Promise.all(imp.storedFiles.map(async (f) => ({ name: f.name, kind: f.kind as FileKind, buffer: await files.read(f.path) })));
    const shiftTypes = await listShiftTypes(db, userId);
    try {
      let progress = Promise.resolve();
      const out = await analyze({
        files: input, profile, shiftTypes, existing: [], ai, selected: opts.selected, period: opts.period,
        onProgress: (msg) => { progress = progress.then(() => updateImport(db, id, { progress: msg, processingStartedAt: Date.now() })).catch(() => {}); },
      });
      await progress;
      validateDraft(out.draft, await periodShifts(userId, out.year, out.month, id));
      await updateImport(db, id, {
        status: out.status, source: out.source, progress: null, analyzedAt: new Date().toISOString(),
        periodYear: out.year, periodMonth: out.month, periodGuessed: out.periodGuessed,
        person: out.person, candidates: out.candidates, matchNote: out.matchNote, quality: out.quality,
        notes: out.notes, legend: out.legend, draft: out.draft, shiftCount: out.draft.filter((e) => !e.excluded).length,
      });
    } catch (e) {
      const msg = e instanceof ParseError ? e.userMessage : "Dosya analiz edilirken beklenmeyen bir hata oluştu.";
      if (!(e instanceof ParseError)) console.error("analysis failed", e);
      await updateImport(db, id, { status: "failed", progress: null, error: msg });
    }
  }

  async function start(userId: string, id: string, opts: Parameters<typeof analyzeNow>[2] = {}) {
    await updateImport(db, id, { status: "processing", progress: "Dosya hazırlanıyor", error: null, processingStartedAt: Date.now() });
    const job = analyzeNow(userId, id, opts)
      .catch(async (e) => {
        if (!(e instanceof ServiceError)) console.error("analysis crashed", e);
        await updateImport(db, id, { status: "failed", progress: null, error: e instanceof ServiceError ? e.message : "Analiz başlatılamadı." }).catch(() => {});
      })
      .finally(() => running.delete(id));
    running.set(id, job);
    defer?.(job);
  }

  return {
    running,
    /** Testler için: devam eden tüm analizlerin bitmesini bekler. */
    idle: () => Promise.all([...running.values()]).then(() => undefined),

    async upload(userId: string, uploaded: { name: string; buffer: Buffer; kind: FileKind }[]) {
      const hash = createHash("sha256");
      for (const f of uploaded) hash.update(createHash("sha256").update(f.buffer).digest());
      const fileHash = hash.digest("hex");
      const duplicate = await findImportByHash(db, userId, fileHash);
      const stored: StoredFile[] = [];
      for (const f of uploaded) stored.push({ path: await files.save(f.buffer), name: f.name, kind: f.kind });
      const id = await createImport(db, {
        userId, fileName: uploaded.map((f) => f.name).join(", "), fileHash,
        size: uploaded.reduce((n, f) => n + f.buffer.length, 0), storedFiles: stored,
        fileExpiresAt: Date.now() + retentionDays * 86_400_000, duplicateOf: duplicate?.id ?? null,
      });
      await start(userId, id);
      return { id, duplicateOf: duplicate };
    },

    async reanalyze(userId: string, id: string) {
      const imp = await requireImport(userId, id);
      if (imp.status === "processing") throw new ServiceError(409, "Analiz zaten sürüyor.");
      if (!imp.storedFiles?.length) throw new ServiceError(410, "Dosya saklama süresi dolduğu için silinmiş. Dosyayı yeniden yükle.");
      await start(userId, id);
    },

    async selectPerson(userId: string, id: string, key: string) {
      const imp = await requireImport(userId, id);
      const cand = imp.candidates.find((c) => c.key === key);
      if (!cand) throw new ServiceError(400, "Seçilen kişi aday listesinde yok.");
      if (imp.status === "confirmed") throw new ServiceError(409, "Onaylanmış çizelgede kişi değiştirmek için önce yeniden analiz et.");
      await start(userId, id, { selected: { key: cand.key, name: cand.name } });
    },

    async setPeriod(userId: string, id: string, year: number, month: number) {
      const imp = await requireImport(userId, id);
      if (imp.status !== "review" || !imp.person) throw new ServiceError(409, "Dönem yalnızca kontrol aşamasında değiştirilebilir.");
      const profile = await getProfile(db, userId);
      const draft = rebuildDraft(imp.person, {
        year, month, shiftTypes: await listShiftTypes(db, userId), legend: imp.legend,
        department: profile?.department || imp.person.department || "", existing: await periodShifts(userId, year, month, id),
      });
      await updateImport(db, id, { periodYear: year, periodMonth: month, periodGuessed: false, draft, shiftCount: draft.length });
    },

    async editEntry(userId: string, id: string, entryId: string | null, patch: Partial<Pick<DraftEntry,
      "date" | "code" | "label" | "category" | "start" | "end" | "isExtra" | "note" | "verified" | "excluded" | "department">>) {
      const imp = await requireImport(userId, id);
      if (imp.status !== "review") throw new ServiceError(409, "Bu çizelge düzenlenemez.");
      if (patch.date && !/^\d{4}-\d{2}-\d{2}$/.test(patch.date)) throw new ServiceError(400, "Geçersiz tarih.");
      if (patch.category && !(patch.category in CATEGORY_META)) throw new ServiceError(400, "Geçersiz nöbet türü.");
      const draft = imp.draft;
      let entry = entryId ? draft.find((e) => e.id === entryId) : undefined;
      if (entryId && !entry) throw new ServiceError(404, "Kayıt bulunamadı.");
      if (!entry) {
        // Kontrol ekranında eksik bir nöbeti elle ekleme
        const full = { score: 1, level: "high" as const, reason: "Kullanıcı ekledi" };
        entry = {
          id: randomUUID(), date: patch.date ?? ymd(imp.periodYear!, imp.periodMonth!, 1), raw: "", code: "", label: "",
          category: "day", start: null, end: null, startAt: null, endAt: null, hours: null, overnight: false, isExtra: false,
          department: (await getProfile(db, userId))?.department ?? "", note: "",
          confidence: { read: full, type: full, time: full, overall: full }, issues: [], status: "ok",
          verified: true, excluded: false, edited: true,
        };
        draft.push(entry);
      }

      const contentKeys = ["date", "code", "category", "start", "end", "isExtra", "label"] as const;
      const changed = contentKeys.some((k) => patch[k] !== undefined && patch[k] !== entry![k]);
      Object.assign(entry, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));

      if (changed) {
        const types = await listShiftTypes(db, userId);
        const t = patch.code !== undefined ? types.find((x) => codeKey(x.code) === codeKey(patch.code!)) : undefined;
        if (t) {
          entry.category = patch.category ?? t.category;
          entry.label = patch.label ?? t.label;
          if (patch.start === undefined && patch.end === undefined && isWork(entry.category)) { entry.start = t.start; entry.end = t.end; }
        }
        if (!entry.code) entry.code = CATEGORY_META[entry.category].label;
        if (!entry.label) entry.label = CATEGORY_META[entry.category].label;
        const user = { score: 1, level: levelOf(1), reason: "Kullanıcı düzenledi" };
        entry.confidence = { read: user, type: user, time: user, overall: user };
        entry.issues = entry.issues.filter((i) => !["unknown_code", "default_time", "low_read", "missing_time"].includes(i.code));
        entry.edited = true;
        entry.verified = true;
      }
      finalizeEntry(entry);
      validateDraft(draft, await periodShifts(userId, imp.periodYear!, imp.periodMonth!, id));
      await updateImport(db, id, { draft, shiftCount: draft.filter((e) => !e.excluded).length });
    },

    async confirm(userId: string, id: string, opts: { replaceConflicts: boolean; rememberCodes: boolean }) {
      const imp = await requireImport(userId, id);
      if (imp.status !== "review") throw new ServiceError(409, "Yalnızca kontrol aşamasındaki çizelgeler onaylanabilir.");
      const existing = await periodShifts(userId, imp.periodYear!, imp.periodMonth!, id);
      const draft = validateDraft(imp.draft, existing);
      const blocking = blockingEntries(draft);
      if (blocking.length) {
        await updateImport(db, id, { draft });
        throw new ServiceError(422, `${blocking.length} kayıt düzeltilmeden veya doğrulanmadan onaylanamaz.`);
      }
      const toSave = draft.filter((e) => !e.excluded && e.status !== "duplicate");
      const types = await listShiftTypes(db, userId);

      return tx(db, async (t) => {
        let saved = 0, replaced = 0;
        // Aynı çizelgenin önceki onayı (yeniden analiz) tekrar kayıt oluşturmasın
        await run(t, "DELETE FROM shifts WHERE user_id = ? AND import_id = ?", [userId, id]);
        if (opts.replaceConflicts) {
          for (const e of toSave) {
            if (!e.issues.some((i) => i.code === "existing_conflict")) continue;
            for (const s of existing) {
              if (sameShift(e, s)) continue;
              const overlaps = e.startAt && s.startAt && s.endAt && e.endAt ? e.startAt < s.endAt && s.startAt < e.endAt : e.date === s.date;
              if (overlaps) replaced += await run(t, "DELETE FROM shifts WHERE id = ? AND user_id = ?", [s.id, userId]);
            }
          }
        }
        for (const e of toSave) {
          await insertShift(t, userId, {
            date: e.date, startAt: e.startAt, endAt: e.endAt, code: e.code, label: e.label, category: e.category,
            hours: e.hours ?? 0, isExtra: e.isExtra, department: e.department, note: e.note,
          }, "import", id);
          saved++;
        }

        // Onaylanan kodların saatleri artık doğrulanmış sayılır; düzeltilen yeni kodlar sözlüğe eklenir
        const next = types.map(({ id: _id, ...x }) => x);
        for (const e of toSave) {
          const known = next.find((x) => codeKey(x.code) === codeKey(e.code));
          if (known && !e.edited) known.verified = true;
          if (!known && opts.rememberCodes && e.raw && e.edited && e.code && codeKey(e.code) === codeKey(e.raw)) {
            next.push({ code: e.code, label: e.label, category: e.category as ShiftCategory, start: e.start, end: e.end,
              color: CATEGORY_META[e.category].color, verified: true });
          }
        }
        await replaceShiftTypes(db, userId, next, t);

        await updateImport(t, id, {
          status: "confirmed", confirmedAt: new Date().toISOString(), draft, shiftCount: saved,
          candidates: null, // diğer personelin isimleri saklanmaz
          fileExpiresAt: Date.now() + retentionDays * 86_400_000,
        });
        return { saved, skipped: draft.filter((e) => !e.excluded && e.status === "duplicate").length, replaced };
      });
    },

    async discard(userId: string, id: string) {
      const imp = await requireImport(userId, id);
      if (imp.status === "confirmed") throw new ServiceError(409, "Onaylanmış çizelge reddedilemez; geçmişten silebilirsin.");
      for (const f of imp.storedFiles ?? []) await files.remove(f.path);
      await updateImport(db, id, { status: "discarded", storedFiles: null, candidates: null, draft: [], person: null, shiftCount: 0, progress: null });
    },

    async remove(userId: string, id: string, deleteShifts: boolean) {
      const imp = await requireImport(userId, id);
      if (imp.status === "processing") throw new ServiceError(409, "Analiz sürerken silinemez.");
      const removedShifts = await db.tx(async (t) => {
        const n = deleteShifts ? await run(t, "DELETE FROM shifts WHERE user_id = ? AND import_id = ?", [userId, id]) : 0;
        // Takvimde bırakılan nöbetler elle eklenmiş gibi kalır
        await run(t, "UPDATE shifts SET import_id = NULL, source = 'manual' WHERE user_id = ? AND import_id = ?", [userId, id]);
        await run(t, "DELETE FROM imports WHERE id = ? AND user_id = ?", [id, userId]);
        return n;
      });
      for (const f of imp.storedFiles ?? []) await files.remove(f.path);
      return { removedShifts };
    },

    /** Uzun süredir "analiz ediliyor" görünen (fonksiyonu sonlanmış) kayıtları başarısız işaretler. */
    async expireStale(now = Date.now()) {
      await run(db, `UPDATE imports SET status = 'failed', progress = NULL, error = 'Analiz yarıda kaldı. Yeniden analiz et.'
        WHERE status = 'processing' AND COALESCE(processing_started_at, 0) < ?`, [now - STALE_MS]);
    },

    /** Saklama süresi dolan dosyaları, süresi geçmiş oturumları ve hız sayaçlarını siler. */
    async cleanup(now = Date.now()) {
      const rows = await all(db, "SELECT id, stored_files FROM imports WHERE stored_files IS NOT NULL AND file_expires_at < ?", [now]);
      for (const r of rows) {
        for (const f of JSON.parse(r.stored_files as string) as StoredFile[]) await files.remove(f.path);
        await run(db, "UPDATE imports SET stored_files = NULL, candidates_json = NULL WHERE id = ?", [r.id as string]);
      }
      await run(db, "DELETE FROM sessions WHERE expires_at < ?", [Date.now()]);
      await run(db, "DELETE FROM rate_limits WHERE reset < ?", [Date.now()]);
      await this.expireStale();
      return rows.length;
    },
  };
}

export type ImportService = ReturnType<typeof createImportService>;
