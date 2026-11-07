// Ortam değişkenlerinden uygulama ayarları. Yerel geliştirme ve Vercel için ortak.

import path from "node:path";
import { createClaudeExtractor } from "./parsing/AiExtractor.js";
import { createBlobFileStore, createLocalFileStore, localKey, parseKey, type FileStore } from "./fileStore.js";
import type { AppOptions } from "./app.js";

export class ConfigError extends Error {}

export const onVercel = () => !!process.env.VERCEL;

export function configFromEnv(): AppOptions {
  const env = process.env;
  const vercel = onVercel();
  const dataDir = path.resolve(env.DATA_DIR ?? "data");

  const dbUrl = env.TURSO_DATABASE_URL ?? env.DATABASE_URL ?? (vercel ? "" : `file:${path.join(dataDir, "nobetim.db").replace(/\\/g, "/")}`);
  if (!dbUrl) throw new ConfigError("TURSO_DATABASE_URL tanımlı değil. Vercel'de Turso entegrasyonunu ekleyin.");

  let key: Buffer;
  if (env.FILE_ENCRYPTION_KEY) key = parseKey(env.FILE_ENCRYPTION_KEY);
  else if (vercel) throw new ConfigError("FILE_ENCRYPTION_KEY tanımlı değil (64 karakter hex).");
  else key = localKey(dataDir);

  let files: FileStore;
  if (env.BLOB_READ_WRITE_TOKEN) files = createBlobFileStore(env.BLOB_READ_WRITE_TOKEN, key);
  else if (vercel) throw new ConfigError("BLOB_READ_WRITE_TOKEN tanımlı değil. Vercel'de bir Blob deposu bağlayın.");
  else files = createLocalFileStore(path.join(dataDir, "uploads"), key);

  return {
    dbUrl,
    dbAuthToken: env.TURSO_AUTH_TOKEN ?? env.DATABASE_AUTH_TOKEN,
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
