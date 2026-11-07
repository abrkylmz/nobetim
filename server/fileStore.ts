// Yüklenen dosyalar AES-256-GCM ile şifrelenip saklanır.
// Yerelde diske, Vercel'de özel (private) Vercel Blob deposuna yazılır.

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface FileStore {
  save(buf: Buffer): Promise<string>;
  read(ref: string): Promise<Buffer>;
  remove(ref: string): Promise<void>;
}

export function parseKey(envKey: string): Buffer {
  const k = /^[0-9a-f]{64}$/i.test(envKey) ? Buffer.from(envKey, "hex") : Buffer.from(envKey, "base64");
  if (k.length !== 32) throw new Error("FILE_ENCRYPTION_KEY 32 bayt olmalı (64 hex karakter).");
  return k;
}

/** Yerel geliştirme: anahtar verilmemişse veri klasöründe üretilip saklanır. */
export function localKey(dataDir: string): Buffer {
  const keyFile = path.join(dataDir, ".filekey");
  if (fs.existsSync(keyFile)) return Buffer.from(fs.readFileSync(keyFile, "utf8").trim(), "hex");
  fs.mkdirSync(dataDir, { recursive: true });
  const k = randomBytes(32);
  fs.writeFileSync(keyFile, k.toString("hex"), { mode: 0o600 });
  return k;
}

function encrypt(key: Buffer, buf: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}

function decrypt(key: Buffer, data: Buffer): Buffer {
  const d = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
  d.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([d.update(data.subarray(28)), d.final()]);
}

export function createLocalFileStore(dir: string, key: Buffer): FileStore {
  fs.mkdirSync(dir, { recursive: true });
  const resolve = (ref: string) => {
    if (!/^[0-9a-f-]{36}\.bin$/.test(ref)) throw new Error("invalid file ref");
    return path.join(dir, ref);
  };
  return {
    async save(buf) {
      const ref = `${randomUUID()}.bin`;
      await fs.promises.writeFile(resolve(ref), encrypt(key, buf), { mode: 0o600 });
      return ref;
    },
    async read(ref) {
      return decrypt(key, await fs.promises.readFile(resolve(ref)));
    },
    async remove(ref) {
      await fs.promises.rm(resolve(ref), { force: true }).catch(() => {});
    },
  };
}

const BLOB_PREFIX = "nobetim/";

export function createBlobFileStore(token: string, key: Buffer): FileStore {
  const check = (ref: string) => {
    if (!new RegExp(`^${BLOB_PREFIX}[0-9a-f-]{36}\\.bin$`).test(ref)) throw new Error("invalid file ref");
    return ref;
  };
  const blob = () => import("@vercel/blob");
  return {
    async save(buf) {
      const { put } = await blob();
      const ref = `${BLOB_PREFIX}${randomUUID()}.bin`;
      await put(ref, encrypt(key, buf), {
        access: "private", token, addRandomSuffix: false, contentType: "application/octet-stream",
      });
      return ref;
    },
    async read(ref) {
      const { get } = await blob();
      const r = await get(check(ref), { access: "private", token, useCache: false });
      if (!r || r.statusCode !== 200) throw new Error("blob not found");
      return decrypt(key, Buffer.from(await new Response(r.stream).arrayBuffer()));
    },
    async remove(ref) {
      const { del } = await blob();
      await del(check(ref), { token }).catch(() => {});
    },
  };
}
