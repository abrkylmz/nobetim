import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { CATEGORY_META, isWork, type Profile, type ShiftCategory, type ShiftType } from "../shared/types.js";
import { buildInterval, daysInMonth, fromMs, ymd } from "../shared/time.js";
import { holidaysOf } from "../shared/holidays.js";
import {
  deleteShift, deleteUserData, getImport, getProfile, getShift, insertShift, listImports, listShiftTypes, listShifts,
  one, openDb, replaceShiftTypes, run, saveProfile, seedShiftTypes, updateShift, type DB, type ShiftInput,
} from "./db.js";
import { COOKIE, createSession, createUser, destroySession, findUserByEmail, rateLimit, requireAuth, verifyPassword, type AuthedRequest } from "./auth.js";
import type { FileStore } from "./fileStore.js";
import { createImportService, ServiceError } from "./importService.js";
import type { AiExtractor } from "./parsing/AiExtractor.js";
import { FileRejected, isImageKind, MAX_IMAGES_PER_IMPORT, validateFile } from "./security/fileValidation.js";
import { monthStats } from "./stats.js";

export interface AppOptions {
  /** postgres://… (Neon), pglite:<klasör> (yerel) veya memory: (testler) */
  dbUrl: string;
  files: FileStore;
  ai: AiExtractor;
  retentionDays?: number;
  secureCookies?: boolean;
  trustProxy?: boolean;
  maxUploadBytes?: number;
  cronSecret?: string;
  staticDir?: string;
  /** Sunucusuz ortamda yanıttan sonra süren işler için (Vercel waitUntil) */
  defer?: (p: Promise<unknown>) => void;
  /** Uzun ömürlü sunucuda periyodik temizlik (Vercel'de Cron kullanılır) */
  cleanupInterval?: boolean;
}

const uid = (req: Request) => (req as AuthedRequest).userId;
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isHM = (s: unknown) => s == null || s === "" || (typeof s === "string" && /^([01]\d|2[0-4]):[0-5]\d$/.test(s));
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown, min: number, max: number, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const param = (req: Request, k: string) => String(req.params[k]);

/** multer dosya adlarını latin1 çözer; Türkçe karakterler için UTF-8'e çevir ve temizle. */
function cleanFileName(name: string): string {
  let n = name;
  try { n = Buffer.from(name, "latin1").toString("utf8"); } catch { /* olduğu gibi */ }
  return path.basename(n).replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").slice(-120) || "dosya";
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function createApp(opts: AppOptions) {
  if (opts.dbUrl.startsWith("pglite:")) fs.mkdirSync(opts.dbUrl.slice("pglite:".length), { recursive: true });
  const db: DB = await openDb(opts.dbUrl);
  const files = opts.files;
  const maxUpload = opts.maxUploadBytes ?? 15 * 1024 * 1024;
  const imports = createImportService({ db, files, ai: opts.ai, retentionDays: opts.retentionDays ?? 30, defer: opts.defer });

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", opts.trustProxy ? true : "loopback");

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
    res.setHeader("Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    next();
  });
  app.use(cookieParser());
  app.use(express.json({ limit: "300kb" }));

  // Vercel Cron: saklama süresi dolan dosyaları ve yarıda kalan analizleri temizler
  app.get("/api/cron/cleanup", async (req, res) => {
    const auth = req.get("authorization") ?? "";
    if (!opts.cronSecret || !safeEqual(auth, `Bearer ${opts.cronSecret}`)) return res.status(401).json({ error: "Yetkisiz." });
    res.json({ removedFiles: await imports.cleanup() });
  });

  // CSRF koruması: durum değiştiren isteklerde özel başlık zorunlu (SameSite=Strict çereze ek olarak)
  app.use("/api", (req, res, next) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && req.get("X-Nobetim") !== "1") {
      return res.status(403).json({ error: "Geçersiz istek." });
    }
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  const setCookie = (res: Response, token: string, maxAge: number) =>
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: "strict", secure: !!opts.secureCookies, maxAge, path: "/" });

  // ---------- kimlik ----------
  const authLimit = rateLimit(db, 20, 15 * 60_000, (req) => `auth:${req.ip}`);

  app.post("/api/auth/register", authLimit, async (req, res) => {
    const email = str(req.body?.email, 200).toLowerCase();
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Geçerli bir e-posta adresi gir." });
    if (password.length < 8 || password.length > 200) return res.status(400).json({ error: "Parola en az 8 karakter olmalı." });
    if (await findUserByEmail(db, email)) return res.status(409).json({ error: "Bu e-posta ile kayıtlı bir hesap var." });
    const id = await createUser(db, email, password);
    await seedShiftTypes(db, id);
    const s = await createSession(db, id);
    setCookie(res, s.token, s.maxAge);
    res.status(201).json({ id, email, profile: null });
  });

  app.post("/api/auth/login", authLimit, async (req, res) => {
    const email = str(req.body?.email, 200).toLowerCase();
    const user = await findUserByEmail(db, email);
    if (!user || !(await verifyPassword(String(req.body?.password ?? ""), user.pass_hash))) {
      return res.status(401).json({ error: "E-posta veya parola hatalı." });
    }
    const s = await createSession(db, user.id);
    setCookie(res, s.token, s.maxAge);
    res.json({ id: user.id, email: user.email, profile: await getProfile(db, user.id) });
  });

  app.post("/api/auth/logout", async (req, res) => {
    await destroySession(db, req.cookies?.[COOKIE]);
    res.clearCookie(COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  const auth = requireAuth(db);
  app.use("/api", (req, res, next) => (req.path.startsWith("/auth/") ? next() : auth(req, res, next)));

  app.get("/api/me", async (req, res) => {
    const u = await one(db, "SELECT id, email FROM users WHERE id = ?", [uid(req)]);
    res.json({ ...u, profile: await getProfile(db, uid(req)), aiAvailable: opts.ai.available, uploadLimitBytes: maxUpload });
  });

  app.delete("/api/account", async (req, res) => {
    const user = await one(db, "SELECT pass_hash FROM users WHERE id = ?", [uid(req)]);
    if (!user || !(await verifyPassword(String(req.body?.password ?? ""), user.pass_hash as string))) return res.status(401).json({ error: "Parola hatalı." });
    for (const imp of await listImports(db, uid(req))) {
      for (const f of (await getImport(db, uid(req), imp.id))?.storedFiles ?? []) await files.remove(f.path);
    }
    await deleteUserData(db, uid(req));
    res.clearCookie(COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  // ---------- profil ve kodlar ----------
  app.put("/api/profile", async (req, res) => {
    const b = req.body ?? {};
    const p: Profile = {
      fullName: str(b.fullName, 120), hospital: str(b.hospital, 160), department: str(b.department, 120), staffNo: str(b.staffNo, 40),
      weeklyHours: num(b.weeklyHours, 0, 80, 40), overtimeRate: num(b.overtimeRate, 0, 100_000, 0), holidayRate: num(b.holidayRate, 0, 100_000, 0),
    };
    if (p.fullName.split(/\s+/).length < 2) return res.status(400).json({ error: "Ad ve soyadını çizelgede yazdığı gibi gir." });
    await saveProfile(db, uid(req), p);
    res.json(p);
  });

  app.get("/api/shift-types", async (req, res) => res.json(await listShiftTypes(db, uid(req))));
  app.put("/api/shift-types", async (req, res) => {
    const list = Array.isArray(req.body) ? req.body.slice(0, 80) : null;
    if (!list) return res.status(400).json({ error: "Geçersiz liste." });
    const types: Omit<ShiftType, "id">[] = [];
    for (const t of list) {
      const category = t?.category as ShiftCategory;
      if (!str(t?.code, 12) || !(category in CATEGORY_META) || !isHM(t.start) || !isHM(t.end)) {
        return res.status(400).json({ error: `Geçersiz kod: ${str(t?.code, 12) || "(boş)"}` });
      }
      const work = isWork(category);
      types.push({
        code: str(t.code, 12), label: str(t.label, 60) || CATEGORY_META[category].label, category,
        start: work && t.start ? t.start : null, end: work && t.end ? t.end : null,
        color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : CATEGORY_META[category].color, verified: t.verified !== false,
      });
    }
    await replaceShiftTypes(db, uid(req), types);
    res.json(await listShiftTypes(db, uid(req)));
  });

  // ---------- dosya yükleme ve analiz ----------
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxUpload, files: MAX_IMAGES_PER_IMPORT, fields: 4, parts: 10 } });
  const uploadLimit = rateLimit(db, 30, 10 * 60_000, (req) => `up:${uid(req)}`);
  const mb = Math.round(maxUpload / 1024 / 1024);

  app.post("/api/imports", uploadLimit, (req, res, next) => {
    upload.array("files", MAX_IMAGES_PER_IMPORT)(req, res, (err: unknown) => {
      if (err) {
        const code = (err as { code?: string }).code;
        return res.status(400).json({
          error: code === "LIMIT_FILE_SIZE" ? `Dosya ${mb} MB sınırını aşıyor.` : code === "LIMIT_FILE_COUNT" ? `En fazla ${MAX_IMAGES_PER_IMPORT} dosya yüklenebilir.` : "Dosya yüklenemedi.",
        });
      }
      next();
    });
  }, async (req, res) => {
    if (!(await getProfile(db, uid(req)))) return res.status(400).json({ error: "Önce profil bilgilerini tamamla." });
    const list = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!list.length) return res.status(400).json({ error: "Dosya seçilmedi." });
    try {
      const checked = list.map((f) => {
        const name = cleanFileName(f.originalname);
        return { name, buffer: f.buffer, kind: validateFile(name, f.buffer, maxUpload) };
      });
      if (checked.length > 1 && !checked.every((f) => isImageKind(f.kind))) {
        return res.status(400).json({ error: "Birden fazla dosya yalnızca aynı çizelgenin fotoğrafları için birlikte yüklenebilir." });
      }
      const { id, duplicateOf } = await imports.upload(uid(req), checked);
      res.status(202).json({ id, duplicateOf });
    } catch (e) {
      if (e instanceof FileRejected) return res.status(400).json({ error: e.message });
      throw e;
    }
  });

  app.get("/api/imports", async (req, res) => {
    await imports.expireStale();
    res.json(await listImports(db, uid(req)));
  });

  const detail = async (req: Request, res: Response, status = 200) => {
    const imp = await getImport(db, uid(req), param(req, "id"));
    if (!imp) return res.status(404).json({ error: "Kayıt bulunamadı." });
    const { storedFiles: _s, userId: _u, fileHash: _h, person, ...d } = imp;
    res.status(status).json({ ...d, periodGuessed: imp.periodGuessed, personTitle: person?.title ?? null, personStaffNo: person?.staffNo ?? null });
  };

  app.get("/api/imports/:id", async (req, res) => { await imports.expireStale(); await detail(req, res); });
  app.post("/api/imports/:id/select", async (req, res) => { await imports.selectPerson(uid(req), param(req, "id"), str(req.body?.key, 400)); await detail(req, res, 202); });
  app.post("/api/imports/:id/reanalyze", async (req, res) => { await imports.reanalyze(uid(req), param(req, "id")); await detail(req, res, 202); });
  app.post("/api/imports/:id/period", async (req, res) => {
    const year = num(req.body?.year, 2000, 2100, 0), month = num(req.body?.month, 1, 12, 0);
    if (!year || !month) throw new ServiceError(400, "Geçersiz dönem.");
    await imports.setPeriod(uid(req), param(req, "id"), year, month);
    await detail(req, res);
  });
  app.patch("/api/imports/:id/entries/:entryId", async (req, res) => {
    const b = req.body ?? {};
    if (!isHM(b.start) || !isHM(b.end)) throw new ServiceError(400, "Saat SS:DD biçiminde olmalı.");
    await imports.editEntry(uid(req), param(req, "id"), param(req, "entryId"), pickEntryPatch(b));
    await detail(req, res);
  });
  app.post("/api/imports/:id/entries", async (req, res) => {
    const b = req.body ?? {};
    if (!isDate(b.date) || !isHM(b.start) || !isHM(b.end)) throw new ServiceError(400, "Tarih ve saatleri kontrol et.");
    await imports.editEntry(uid(req), param(req, "id"), null, pickEntryPatch(b));
    await detail(req, res, 201);
  });
  app.post("/api/imports/:id/confirm", async (req, res) => {
    res.json(await imports.confirm(uid(req), param(req, "id"), {
      replaceConflicts: req.body?.replaceConflicts === true, rememberCodes: req.body?.rememberCodes !== false,
    }));
  });
  app.post("/api/imports/:id/discard", async (req, res) => { await imports.discard(uid(req), param(req, "id")); await detail(req, res); });
  app.delete("/api/imports/:id", async (req, res) => {
    const r = await imports.remove(uid(req), param(req, "id"), req.query.deleteShifts === "1");
    res.json({ ok: true, ...r });
  });

  // ---------- takvim ----------
  app.get("/api/shifts", async (req, res) => {
    const from = req.query.from, to = req.query.to;
    if (!isDate(from) || !isDate(to)) return res.status(400).json({ error: "from/to tarihleri gerekli." });
    res.json(await listShifts(db, uid(req), from, to));
  });

  const shiftFromBody = async (req: Request): Promise<ShiftInput> => {
    const b = req.body ?? {};
    const category = b.category as ShiftCategory;
    if (!isDate(b.date)) throw new ServiceError(400, "Geçerli bir tarih seç.");
    if (!(category in CATEGORY_META)) throw new ServiceError(400, "Nöbet türü seç.");
    const work = isWork(category);
    let interval = null;
    if (work) {
      if (!isHM(b.start) || !isHM(b.end) || !b.start || !b.end) throw new ServiceError(400, "Başlangıç ve bitiş saatini gir.");
      interval = buildInterval(b.date, b.start, b.end);
    }
    const code = str(b.code, 12) || CATEGORY_META[category].label;
    const type = (await listShiftTypes(db, uid(req))).find((t) => t.code === code);
    return {
      date: b.date, startAt: interval?.startAt ?? null, endAt: interval?.endAt ?? null, code,
      label: str(b.label, 60) || type?.label || CATEGORY_META[category].label, category, hours: interval?.hours ?? 0,
      isExtra: b.isExtra === true || category === "extra", department: str(b.department, 120), note: str(b.note, 500),
    };
  };

  const conflictsOf = async (req: Request, s: ShiftInput, ignoreId?: string) =>
    (await listShifts(db, uid(req), s.date, s.date)).filter((x) => x.id !== ignoreId).filter((x) => {
      if (s.startAt && s.endAt && x.startAt && x.endAt) return s.startAt < x.endAt && x.startAt < s.endAt;
      return x.date === s.date;
    });

  app.post("/api/shifts", async (req, res) => {
    const s = await shiftFromBody(req);
    const conflicts = await conflictsOf(req, s);
    if (conflicts.length && req.body?.force !== true) return res.status(409).json({ error: "Bu saatlerde takvimde başka bir kayıt var.", conflicts });
    const id = await insertShift(db, uid(req), s, "manual", null);
    res.status(201).json(await getShift(db, uid(req), id));
  });
  app.put("/api/shifts/:id", async (req, res) => {
    if (!(await getShift(db, uid(req), param(req, "id")))) throw new ServiceError(404, "Kayıt bulunamadı.");
    const s = await shiftFromBody(req);
    const conflicts = await conflictsOf(req, s, param(req, "id"));
    if (conflicts.length && req.body?.force !== true) return res.status(409).json({ error: "Bu saatlerde takvimde başka bir kayıt var.", conflicts });
    await updateShift(db, uid(req), param(req, "id"), s);
    res.json(await getShift(db, uid(req), param(req, "id")));
  });
  // Toplu silme: bir tarih aralığındaki (ör. ayın) tüm kayıtlar. Yalnızca o aralıkta BAŞLAYAN kayıtlar silinir.
  app.delete("/api/shifts", async (req, res) => {
    const from = req.query.from, to = req.query.to;
    if (!isDate(from) || !isDate(to) || from > to) return res.status(400).json({ error: "Geçerli bir tarih aralığı gerekli." });
    const removed = await run(db, "DELETE FROM shifts WHERE user_id = ? AND date >= ? AND date <= ?", [uid(req), from, to]);
    res.json({ removed });
  });

  app.delete("/api/shifts/:id", async (req, res) => {
    if (!(await deleteShift(db, uid(req), param(req, "id")))) return res.status(404).json({ error: "Kayıt bulunamadı." });
    res.json({ ok: true });
  });

  // ---------- özet ve istatistik ----------
  const monthShifts = (userId: string, y: number, m: number) => listShifts(db, userId, ymd(y, m, 1), ymd(y, m, daysInMonth(y, m)));

  app.get("/api/stats", async (req, res) => {
    const now = new Date();
    const y = num(req.query.year, 2000, 2100, now.getFullYear()), m = num(req.query.month, 1, 12, now.getMonth() + 1);
    const profile = await getProfile(db, uid(req));
    // 12 aylık seri tek sorguyla
    const first = new Date(y, m - 12, 1);
    const all = await listShifts(db, uid(req), ymd(first.getFullYear(), first.getMonth() + 1, 1), ymd(y, m, daysInMonth(y, m)));
    const series = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(y, m - 1 - i, 1);
      const st = monthStats(all, d.getFullYear(), d.getMonth() + 1, profile);
      series.push({ year: st.year, month: st.month, workHours: st.workHours, shiftCount: st.shiftCount, overtimeHours: st.overtimeHours, nightShifts: st.nightShifts, holidayHours: st.holidayHours, estimatedIncome: st.estimatedIncome });
    }
    res.json({ month: monthStats(all, y, m, profile), series, holidays: holidaysOf(y).filter((h) => +h.date.slice(5, 7) === m) });
  });

  app.get("/api/dashboard", async (req, res) => {
    // Kullanıcının yerel saati (Türkiye UTC+3; tarayıcı gönderirse onu kullan)
    const offset = num(req.query.tz, -840, 840, -180);
    const nowMs = Date.now() - offset * 60_000;
    const nowLocal = fromMs(nowMs);
    const today = nowLocal.slice(0, 10);
    const y = +today.slice(0, 4), m = +today.slice(5, 7);
    const profile = await getProfile(db, uid(req));
    const horizon = await listShifts(db, uid(req), today, ymd(y + 1, m, 1));
    const upcoming = horizon.filter((s) => isWork(s.category) && s.endAt && s.endAt > nowLocal).slice(0, 8);
    const current = upcoming.find((s) => s.startAt! <= nowLocal) ?? null;
    const next = upcoming.find((s) => s.startAt! > nowLocal) ?? null;
    const recent = (await listImports(db, uid(req))).filter((i) => i.status !== "discarded");
    res.json({
      now: nowLocal, current, next, upcoming: upcoming.filter((s) => s !== current).slice(0, 5),
      month: monthStats(await monthShifts(uid(req), y, m), y, m, profile),
      lastImport: recent[0] ?? null,
      pending: recent.filter((i) => i.status === "review" || i.status === "needs_selection" || i.status === "processing").length,
    });
  });

  // ---------- statik arayüz (yalnızca yerel; Vercel'de CDN sunar) ----------
  if (opts.staticDir && fs.existsSync(path.join(opts.staticDir, "index.html"))) {
    app.use(express.static(opts.staticDir, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(opts.staticDir!, "index.html")));
  }

  app.use("/api", (_req, res) => res.status(404).json({ error: "Bulunamadı." }));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ServiceError) return res.status(err.status).json({ error: err.message });
    if ((err as { type?: string }).type === "entity.too.large") return res.status(413).json({ error: "İstek çok büyük." });
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  });

  let timer: ReturnType<typeof setInterval> | undefined;
  if (opts.cleanupInterval) {
    timer = setInterval(() => void imports.cleanup().catch(console.error), 60 * 60_000);
    timer.unref();
    void imports.cleanup().catch(console.error);
  }

  return {
    app, db, imports,
    close() { if (timer) clearInterval(timer); return db.close(); },
  };
}

function pickEntryPatch(b: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of ["date", "code", "label", "category", "start", "end", "note", "department"] as const) {
    if (typeof b[k] === "string") out[k] = (b[k] as string).trim().slice(0, k === "note" ? 500 : 120) || (k === "start" || k === "end" ? null : "");
  }
  for (const k of ["isExtra", "verified", "excluded"] as const) if (typeof b[k] === "boolean") out[k] = b[k];
  return out;
}
