// Vercel'e özgü parçalar: özel Blob deposu (taklit API ile), Cron yetkisi, ortam yapılandırması.
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import request from "supertest";

const store = new Map<string, Buffer>();
const putOptions: Record<string, unknown>[] = [];
vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (pathname: string, body: Buffer, opts: { access: string }) => {
    expect(opts.access).toBe("private");
    putOptions.push(opts);
    store.set(pathname, Buffer.from(body));
    return { pathname, url: `https://blob.example/${pathname}` };
  }),
  get: vi.fn(async (pathname: string, opts: { access: string }) => {
    expect(opts.access).toBe("private");
    const b = store.get(pathname);
    return b ? { statusCode: 200, stream: new Blob([new Uint8Array(b)]).stream() } : null;
  }),
  del: vi.fn(async (pathname: string) => { store.delete(pathname); }),
}));

const { createBlobFileStore } = await import("../server/fileStore");
const { configFromEnv, ConfigError } = await import("../server/config");
const { makeApp } = await import("./helpers");

describe("Vercel Blob dosya deposu", () => {
  it("dosyayı şifreli ve özel olarak yazar, okur ve siler", async () => {
    const files = createBlobFileStore({ token: "tok" }, randomBytes(32));
    const plain = Buffer.from("Ayşe Yılmaz;G;N;24 — gizli çizelge");
    const ref = await files.save(plain);
    expect(ref).toMatch(/^nobetim\/[0-9a-f-]{36}\.bin$/);
    expect(store.get(ref)!.includes(plain)).toBe(false); // depoda düz metin yok
    expect((await files.read(ref)).equals(plain)).toBe(true);
    await files.remove(ref);
    expect(store.has(ref)).toBe(false);
  });
  it("yeni Blob depolarında anahtar yerine depo kimliğiyle (OIDC) çalışır", async () => {
    const files = createBlobFileStore({ storeId: "store_abc123" }, randomBytes(32));
    const ref = await files.save(Buffer.from("x"));
    expect(putOptions.at(-1)).toMatchObject({ storeId: "store_abc123" });
    expect(putOptions.at(-1)).not.toHaveProperty("token");
    expect((await files.read(ref)).toString()).toBe("x");
  });
  it("geçersiz dosya referanslarını reddeder", async () => {
    const files = createBlobFileStore({ token: "tok" }, randomBytes(32));
    await expect(files.read("../baska/dosya")).rejects.toThrow();
  });
});

describe("Vercel yapılandırması", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it("Vercel'de eksik ortam değişkenlerini açıkça bildirir", () => {
    process.env = { VERCEL: "1" };
    expect(() => configFromEnv()).toThrow(ConfigError);
    process.env.DATABASE_URL = "postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require";
    expect(() => configFromEnv()).toThrow(/FILE_ENCRYPTION_KEY/);
    process.env.FILE_ENCRYPTION_KEY = randomBytes(32).toString("hex");
    expect(() => configFromEnv()).toThrow(/Blob deposu bulunamadı/);
    process.env.BLOB_STORE_ID = "store_abc123"; // yeni depolar: OIDC + depo kimliği
    const c = configFromEnv();
    expect(c.maxUploadBytes).toBe(4 * 1024 * 1024);
    expect(c.secureCookies).toBe(true);
    expect(c.staticDir).toBeUndefined();
  });
});

describe("Marketplace değişken adları", () => {
  it("ön ekli Neon ve Blob değişkenlerini bulur", async () => {
    const { findDatabaseEnv, findBlobToken } = await import("../server/config");
    const env = {
      NOBETIM_DATABASE_URL: "postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require",
      STORE_READ_WRITE_TOKEN: "vercel_blob_rw_abc",
      LEGACY_DATABASE_URL: "libsql://eski.turso.io",
    };
    expect(findDatabaseEnv(env)).toMatchObject({ url: env.NOBETIM_DATABASE_URL });
    expect(findBlobToken(env)).toBe("vercel_blob_rw_abc");
    expect(findDatabaseEnv({ DATABASE_URL: "libsql://x.turso.io" })).toBeUndefined();
    expect(findDatabaseEnv({ POSTGRES_URL: "postgres://a/b" })).toMatchObject({ urlKey: "POSTGRES_URL" });
  });
});

describe("Cron temizlik uç noktası", () => {
  it("yalnızca doğru gizli anahtarla çalışır", async () => {
    const a = await makeApp(undefined, { cronSecret: "s3cret-value" });
    try {
      expect((await request(a.app).get("/api/cron/cleanup")).status).toBe(401);
      expect((await request(a.app).get("/api/cron/cleanup").set("Authorization", "Bearer yanlis")).status).toBe(401);
      const ok = await request(a.app).get("/api/cron/cleanup").set("Authorization", "Bearer s3cret-value");
      expect(ok.status).toBe(200);
      expect(ok.body).toHaveProperty("removedFiles");
    } finally { await a.cleanup(); }
  });

  it("uzun süre 'analiz ediliyor' kalan kayıtları başarısız işaretler", async () => {
    const a = await makeApp();
    try {
      await a.db.query(`INSERT INTO imports (id, user_id, file_name, file_hash, size, status, created_at, processing_started_at)
        VALUES ('x', 'u', 'a.pdf', 'h', 1, 'processing', '2026-01-01', ?)`, [Date.now() - 11 * 60_000]);
      await a.db.query(`INSERT INTO imports (id, user_id, file_name, file_hash, size, status, created_at, processing_started_at)
        VALUES ('y', 'u', 'b.pdf', 'h', 1, 'processing', '2026-01-01', ?)`, [Date.now()]);
      await a.imports.expireStale();
      const rows = (await a.db.query("SELECT id, status FROM imports ORDER BY id")).rows;
      expect(rows.map((r) => r.status)).toEqual(["failed", "processing"]);
    } finally { await a.cleanup(); }
  });
});
