// Ortam değişkenlerinden uygulama ayarları. Yerel geliştirme ve Vercel için ortak.

import path from "node:path";
import { createClaudeExtractor } from "./parsing/AiExtractor.js";
import { createBlobFileStore, createLocalFileStore, localKey, parseKey, type FileStore } from "./fileStore.js";
import type { AppOptions } from "./app.js";

export class ConfigError extends Error {}

export const onVercel = () => !!process.env.VERCEL;

type Env = Record<string, string | undefined>;

/**
 * Vercel Marketplace entegrasyonları değişkenleri ön ekle ekleyebilir (ör. NOBETIM_DATABASE_URL).
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

/** Neon/Postgres bağlantı adresi. Neon entegrasyonu DATABASE_URL (havuzlu) ve POSTGRES_URL ekler. */
export function findDatabaseEnv(env: Env) {
  const url = findEnv(env,
    ["DATABASE_URL", "POSTGRES_URL", "NEON_DATABASE_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"],
    ["_DATABASE_URL", "_POSTGRES_URL", "_DATABASE_URL_UNPOOLED"],
    /^postgres(ql)?:\/\//i);
  return url ? { url: url.value, urlKey: url.key } : undefined;
}

export function findBlobToken(env: Env) {
  return findEnv(env, ["BLOB_READ_WRITE_TOKEN"], ["_BLOB_READ_WRITE_TOKEN", "_READ_WRITE_TOKEN"], /^vercel_blob_rw_/)?.value
    ?? (env.BLOB_READ_WRITE_TOKEN || undefined);
}

/** Teşhis için yalnızca ilgili değişkenlerin ADLARI (değerleri asla) günlüğe yazılır. */
function logEnvNames(env: Env) {
  const names = Object.keys(env).filter((k) => /DATABASE|POSTGRES|^PG|NEON|BLOB|STORAGE|ENCRYPTION|CRON/i.test(k)).sort();
  console.error(`Tanımlı ilgili ortam değişkeni adları: ${names.length ? names.join(", ") : "(hiçbiri)"}`);
}

export function configFromEnv(): AppOptions {
  const env = process.env;
  const vercel = onVercel();
  const dataDir = path.resolve(env.DATA_DIR ?? "data");

  const found = findDatabaseEnv(env);
  // Yerelde Neon adresi verilmezse veriler data/pg altında PGlite ile tutulur
  const dbUrl = found?.url ?? (vercel ? "" : `pglite:${path.join(dataDir, "pg")}`);
  if (!dbUrl) {
    logEnvNames(env);
    throw new ConfigError("Veritabanı adresi bulunamadı (DATABASE_URL). Neon veritabanının bu projeye bağlı olduğunu kontrol edip yeniden yayınlayın.");
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
