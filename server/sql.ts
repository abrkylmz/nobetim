// Postgres erişim katmanı.
// Canlıda (Vercel + Neon) `pg` havuzu, yerelde ve testlerde PGlite (uygulama içinde çalışan Postgres) kullanılır.
// Sorgular "?" yer tutucularıyla yazılır; burada Postgres'in $1, $2 … biçimine çevrilir.

export type Row = Record<string, unknown>;
export interface QueryResult { rows: Row[]; rowCount: number }

export interface Exec {
  query(sql: string, params?: unknown[]): Promise<QueryResult>;
}

export interface Database extends Exec {
  readonly kind: "postgres" | "pglite";
  /** Bir işlem içinde çalıştırır; hata olursa geri alır. İçeride yalnızca verilen `t` kullanılmalı. */
  tx<T>(fn: (t: Exec) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** "?" → "$n". Sorgularımızda metin içinde "?" geçmez. */
export const toPg = (sql: string) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

// BIGINT (20) ve NUMERIC (1700) sütunları metin yerine sayı olarak gelsin (ms zaman damgaları, boyutlar)
const toNumber = (v: string) => Number(v);

export async function connectPostgres(url: string): Promise<Database> {
  const { default: pg } = await import("pg");
  pg.types.setTypeParser(20, toNumber);
  pg.types.setTypeParser(1700, toNumber);
  // Sunucusuz ortamda örnek başına az bağlantı; Neon'un havuzlu (-pooler) adresi önerilir
  const pool = new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 });
  pool.on("error", (e) => console.error("pg pool error", e.message));
  const run = async (q: { query: typeof pool.query }, sql: string, params: unknown[] = []): Promise<QueryResult> => {
    const r = await q.query(toPg(sql), params as unknown[]);
    return { rows: r.rows as Row[], rowCount: r.rowCount ?? 0 };
  };
  return {
    kind: "postgres",
    query: (sql, params) => run(pool, sql, params),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const r = await fn({ query: (sql, params) => run(client as unknown as { query: typeof pool.query }, sql, params) });
        await client.query("COMMIT");
        return r;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** dataDir verilmezse bellek içi (testler), verilirse diske kalıcı (yerel geliştirme). */
export async function connectPglite(dataDir?: string): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = await PGlite.create(dataDir, { parsers: { 20: toNumber, 1700: toNumber } });
  const run = async (q: { query: typeof db.query }, sql: string, params: unknown[] = []): Promise<QueryResult> => {
    const r = await q.query<Row>(toPg(sql), params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  return {
    kind: "pglite",
    query: (sql, params) => run(db, sql, params),
    tx: (fn) => db.transaction((t) => fn({ query: (sql, params) => run(t as unknown as { query: typeof db.query }, sql, params) })),
    close: () => db.close(),
  };
}
