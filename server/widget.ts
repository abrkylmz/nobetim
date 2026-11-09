// iPhone ana ekran widget'ı (Scriptable) için salt okunur erişim.
// Kullanıcı Ayarlar'dan kişiye özel bir anahtar oluşturur; veritabanında yalnızca SHA-256 özeti tutulur.
// Anahtar yalnızca yaklaşan nöbetleri okuyabilir; yenilenince ya da kapatılınca eski anahtar çalışmaz.

import { createHash, randomBytes } from "node:crypto";
import { isWork, type Shift } from "../shared/types.js";
import { fromMs, ymd } from "../shared/time.js";
import { one, run, type DB } from "./db.js";

const PREFIX = "nbw_";
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function widgetTokenStatus(db: DB, userId: string) {
  const r = await one(db, "SELECT created_at, last_used_at FROM widget_tokens WHERE user_id = ?", [userId]);
  return r ? { active: true, createdAt: r.created_at as string, lastUsedAt: (r.last_used_at as string | null) ?? null } : { active: false, createdAt: null, lastUsedAt: null };
}

/** Yeni anahtar üretir (varsa eskisinin yerine geçer) ve düz metnini yalnızca bir kez döndürür. */
export async function createWidgetToken(db: DB, userId: string) {
  const token = PREFIX + randomBytes(24).toString("base64url");
  await run(db, `INSERT INTO widget_tokens (user_id, token_hash, created_at, last_used_at) VALUES (?, ?, ?, NULL)
    ON CONFLICT (user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, created_at = EXCLUDED.created_at, last_used_at = NULL`,
  [userId, hashToken(token), new Date().toISOString()]);
  return token;
}

export async function revokeWidgetToken(db: DB, userId: string) {
  await run(db, "DELETE FROM widget_tokens WHERE user_id = ?", [userId]);
}

/** Anahtarın sahibini bulur; son kullanım zamanını en fazla 10 dakikada bir günceller. */
export async function userForWidgetToken(db: DB, token: string): Promise<string | null> {
  if (!token.startsWith(PREFIX) || token.length > 80) return null;
  const r = await one(db, "SELECT user_id, last_used_at FROM widget_tokens WHERE token_hash = ?", [hashToken(token)]);
  if (!r) return null;
  const last = r.last_used_at ? Date.parse(r.last_used_at as string) : 0;
  if (Date.now() - last > 10 * 60_000) {
    await run(db, "UPDATE widget_tokens SET last_used_at = ? WHERE user_id = ?", [new Date().toISOString(), r.user_id]);
  }
  return r.user_id as string;
}

export type WidgetShift = Pick<Shift, "date" | "startAt" | "endAt" | "code" | "label" | "category" | "hours" | "isExtra" | "color">;
const slim = (s: Shift): WidgetShift => ({
  date: s.date, startAt: s.startAt, endAt: s.endAt, code: s.code, label: s.label, category: s.category, hours: s.hours, isExtra: s.isExtra, color: s.color,
});

/**
 * Widget verisi: şu an süren nöbet, sıradaki nöbet ve sonraki birkaç nöbet.
 * Saatler kullanıcının yerel saatiyle ("YYYY-MM-DDTHH:MM") döner; offset dakika cinsinden (Türkiye = -180).
 */
export function widgetPayload(shifts: Shift[], nowUtcMs: number, offsetMin: number, month: { shiftCount: number; workHours: number }) {
  const nowLocal = fromMs(nowUtcMs - offsetMin * 60_000);
  const work = shifts.filter((s) => isWork(s.category) && s.startAt && s.endAt && s.endAt > nowLocal);
  const current = work.find((s) => s.startAt! <= nowLocal) ?? null;
  const rest = work.filter((s) => s !== current);
  return {
    now: nowLocal,
    current: current && slim(current),
    next: rest[0] ? slim(rest[0]) : null,
    upcoming: rest.slice(1, 6).map(slim),
    month,
  };
}

export const horizonEnd = (today: string) => ymd(+today.slice(0, 4) + 1, +today.slice(5, 7), 1);
