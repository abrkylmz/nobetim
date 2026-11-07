// Ortam değişkenlerinden uygulama ayarları. Yerel geliştirme ve Vercel için ortak.

import path from "node:path";
import { createClaudeExtractor } from "./parsing/AiExtractor.js";
import { createBlobFileStore, createLocalFileStore, localKey, parseKey, type FileStore } from "./fileStore.js";
import type { AppOptions } from "./app.js";

export class ConfigError extends Error {}

export const onVercel = () => !!process.env.VERCEL;

type Env = Record<string, string | undefined>;

/**
 * Vercel Marketplace entegrasyonları değişkenleri ön ekle ekleyebilir (ör. NOBETIM_TURSO_DATABASE_URL).
 * Önce bilinen adlara, sonra bu adlarla biten anahtarlara, en son değerin biçimine bakılır.
 */
function findEnv(env: Env, names: string[], suffixes: string[], valueTest: RegExp): { key: string; value: string } | undefined {
  for (const k of names) if (env[k] && valueTest.test(env[k]!)) return { key: k, value: env[k]! };
  const keys = Object.keys(env).sort();
  for (const s of suffixes) {
    const k = keys.find((x) => x.endsWith(s) && env[x] && valueTest.test(env[x]!));
    if (k) return { key: k, value: env[k]! };
  }
  const k = keys.find((x) => env[x] && valueTest.test(env[x]!) && !/^(npm_|VERCEL_)/i.test(x));
  return k ? { key: k, value: env[k]! } : undefined;
}

export function findDatabaseEnv(env: Env) {
  const url = findEnv(env,
    ["TURSO_DATABASE_URL", "TURSO_URL", "TURSO_CONNECTION_URL", "LIBSQL_URL", "DATABASE_URL"],
    ["_TURSO_DATABASE_URL", "_DATABASE_URL", "_TURSO_URL", "_LIBSQL_URL"],
    /^(libsql|https?|wss?):\/\/\S+\.turso\.io|^libsql:\/\//i);
  if (!url) return undefined;
  // Token, adresle aynı ön eki taşıyan anahtardan alınır
  const prefix = url.key.replace(/(TURSO_)?(DATABASE_|CONNECTION_|LIBSQL_)?URL$/i, "");
  const tokenKeys = [`${prefix}TURSO_AUTH_TOKEN`, `${prefix}AUTH_TOKEN`, `${prefix}DATABASE_AUTH_TOKEN`, `${prefix}TOKEN`,
    "TURSO_AUTH_TOKEN", "TURSO_TOKEN", "LIBSQL_AUTH_TOKEN", "DATABASE_AUTH_TOKEN"];
  const tokenKey = tokenKeys.find((k) => env[k]) ?? Object.keys(env).find((k) => /TURSO/i.test(k) && /TOKEN$/i.test(k) && env[k]);
  return { url: url.value, urlKey: url.key, authToken: tokenKey ? env[tokenKey] : undefined, tokenKey };
}

export function findBlobToken(env: Env) {
  return findEnv(env, ["BLOB_READ_WRITE_TOKEN"], ["_BLOB_READ_WRITE_TOKEN", "_READ_WRITE_TOKEN"], /^vercel_blob_rw_/)?.value
    ?? (env.BLOB_READ_WRITE_TOKEN || undefined);
}

/** Teşhis için yalnızca ilgili değişkenlerin ADLARI (değerleri asla) günlüğe yazılır. */
function logEnvNames(env: Env) {
  const names = Object.keys(env).filter((k) => /TURSO|LIBSQL|DATABASE|BLOB|STORAGE|ENCRYPTION|CRON/i.test(k)).sort();
  console.error(`Tanımlı ilgili ortam değişkeni adları: ${names.length ? names.join(", ") : "(hiçbiri)"}`);
}

export function configFromEnv(): AppOptions {
  const env = process.env;
  const vercel = onVercel();
  const dataDir = path.resolve(env.DATA_DIR ?? "data");

  const found = findDatabaseEnv(env);
  const dbUrl = found?.url ?? (vercel ? "" : `file:${path.join(dataDir, "nobetim.db").replace(/\\/g, "/")}`);
  if (!dbUrl) {
    logEnvNames(env);
    throw new ConfigError("Veritabanı adresi bulunamadı (TURSO_DATABASE_URL). Turso'nun bu projeye bağlı olduğunu kontrol edip yeniden yayınlayın.");
  }

  let key: Buffer;
  if (env.FILE_ENCRYPTION_KEY) key = parseKey(env.FILE_ENCRYPTION_KEY.trim());
  else if (vercel) { logEnvNames(env); throw new ConfigError("FILE_ENCRYPTION_KEY tanımlı değil (64 karakter hex)."); }
  else key = localKey(dataDir);

  const blobToken = findBlobToken(env);
  let files: FileStore;
  if (blobToken) files = createBlobFileStore(blobToken, key);
  else if (vercel) { logEnvNames(env); throw new ConfigError("BLOB_READ_WRITE_TOKEN tanımlı değil. Vercel'de bir Blob deposu bağlayıp yeniden yayınlayın."); }
  else files = createLocalFileStore(path.join(dataDir, "uploads"), key);

  return {
    dbUrl,
    dbAuthToken: found?.authToken,
    files,
    ai: createClaudeExtractor(env.ANTHROPIC_API_KEY ?? ""),
    retentionDays: Number(env.FILE_RETENTION_DAYS ?? 30),
    secureCookies: vercel || env.NODE_ENV === "production" || env.SECURE_COOKIES === "1",
    trustProxy: vercel,
    // Vercel'de istek gövdesi 4,5 MB ile sınırlı; çok parçalı başlıklar için pay bırakılır
    maxUploadBytes: vercel ? 4 * 1024 * 1024 : 15 * 1024 * 1024,
    cronSecret: env.CRON_SECRET,
    staticDir: vercel ? undefined : path.resolve("web/dist"),
  };
}
