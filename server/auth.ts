import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";
import { hit, one, run, type DB } from "./db.js";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1 };
const SESSION_DAYS = 30;
export const COOKIE = "nobetim_sid";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, 64, SCRYPT);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const calc = await scrypt(pw, Buffer.from(salt, "hex"), 64, SCRYPT);
  const expected = Buffer.from(hash, "hex");
  return expected.length === calc.length && timingSafeEqual(calc, expected);
}

export async function createUser(db: DB, email: string, password: string): Promise<string> {
  const id = randomUUID();
  await run(db, "INSERT INTO users (id, email, pass_hash, created_at) VALUES (?, ?, ?, ?)", [id, email, await hashPassword(password), new Date().toISOString()]);
  return id;
}

export async function findUserByEmail(db: DB, email: string) {
  return (await one(db, "SELECT id, email, pass_hash FROM users WHERE email = ?", [email])) as { id: string; email: string; pass_hash: string } | undefined;
}

export async function createSession(db: DB, userId: string): Promise<{ token: string; maxAge: number }> {
  const token = randomBytes(32).toString("base64url");
  const maxAge = SESSION_DAYS * 86_400_000;
  await run(db, "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", [sha256(token), userId, Date.now() + maxAge]);
  return { token, maxAge };
}

export async function destroySession(db: DB, token: string | undefined) {
  if (token) await run(db, "DELETE FROM sessions WHERE token_hash = ?", [sha256(token)]);
}

export interface AuthedRequest extends Request { userId: string }

export function requireAuth(db: DB) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies?.[COOKIE] as string | undefined;
    if (token) {
      const row = await one(db, "SELECT user_id, expires_at FROM sessions WHERE token_hash = ?", [sha256(token)]);
      if (row && Number(row.expires_at) > Date.now()) {
        (req as AuthedRequest).userId = row.user_id as string;
        return next();
      }
    }
    res.status(401).json({ error: "Oturum açman gerekiyor." });
  };
}

/** Veritabanında tutulan sabit pencereli hız sınırı: tüm sunucu örnekleri aynı sayacı paylaşır. */
export function rateLimit(db: DB, limit: number, windowMs: number, keyFn: (req: Request) => string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { n, reset } = await hit(db, keyFn(req), windowMs);
    if (n > limit) {
      res.setHeader("Retry-After", Math.max(1, Math.ceil((reset - Date.now()) / 1000)));
      return res.status(429).json({ error: "Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene." });
    }
    next();
  };
}
