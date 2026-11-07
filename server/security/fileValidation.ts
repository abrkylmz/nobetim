// Yüklenen dosyanın uzantısını ve gerçek içeriğini (sihirli baytlar) doğrular.

export type FileKind = "pdf" | "xlsx" | "xls" | "csv" | "jpeg" | "png" | "webp";

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_IMAGES_PER_IMPORT = 6;
const MAX_ZIP_UNCOMPRESSED = 120 * 1024 * 1024;

const EXT_KIND: Record<string, FileKind> = {
  pdf: "pdf", xlsx: "xlsx", xls: "xls", csv: "csv", jpg: "jpeg", jpeg: "jpeg", png: "png", webp: "webp",
};

export class FileRejected extends Error {}

const startsWith = (b: Buffer, bytes: number[], offset = 0) => bytes.every((x, i) => b[offset + i] === x);

function sniff(buf: Buffer): FileKind | "zip" | null {
  if (buf.length < 8) return null;
  if (buf.subarray(0, 1024).includes("%PDF-")) return "pdf";
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "xls";
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) return "zip";
  return null;
}

/** Zip merkez dizinindeki açılmış boyutları toplayarak sıkıştırma bombalarını engeller. */
function zipInfo(buf: Buffer): { uncompressed: number; names: string[] } {
  let total = 0;
  const names: string[] = [];
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) !== 0x06054b50) continue;
    const count = buf.readUInt16LE(i + 10);
    let p = buf.readUInt32LE(i + 16);
    for (let k = 0; k < count && p + 46 <= buf.length; k++) {
      if (buf.readUInt32LE(p) !== 0x02014b50) break;
      total += buf.readUInt32LE(p + 24);
      const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
      names.push(buf.subarray(p + 46, p + 46 + nameLen).toString("utf8"));
      p += 46 + nameLen + extra + comment;
    }
    break;
  }
  return { uncompressed: total, names };
}

export function validateFile(fileName: string, buf: Buffer, maxBytes = MAX_FILE_BYTES): FileKind {
  if (!buf.length) throw new FileRejected("Dosya boş.");
  if (buf.length > maxBytes) throw new FileRejected(`Dosya ${Math.round(maxBytes / 1024 / 1024)} MB sınırını aşıyor.`);
  const ext = (/\.([a-z0-9]+)$/i.exec(fileName)?.[1] ?? "").toLowerCase();
  const expected = EXT_KIND[ext];
  if (!expected) throw new FileRejected("Desteklenmeyen dosya türü. PDF, Excel (XLSX/XLS) veya fotoğraf (JPG/PNG) yükle.");

  const actual = sniff(buf);
  if (expected === "csv") {
    if (actual && actual !== "zip") throw new FileRejected("Dosyanın içeriği uzantısıyla uyuşmuyor.");
    if (buf.subarray(0, 4096).includes(0)) throw new FileRejected("CSV dosyası geçersiz.");
    return "csv";
  }
  if (expected === "xlsx") {
    if (actual !== "zip") throw new FileRejected("Dosyanın içeriği uzantısıyla uyuşmuyor (geçerli bir XLSX değil).");
    const info = zipInfo(buf);
    if (!info.names.some((n) => n.startsWith("xl/"))) throw new FileRejected("Geçerli bir Excel çalışma kitabı değil.");
    if (info.names.some((n) => /vbaProject\.bin$/i.test(n))) throw new FileRejected("Makro içeren Excel dosyaları kabul edilmiyor. Makrosuz (.xlsx) olarak kaydet.");
    if (info.uncompressed > MAX_ZIP_UNCOMPRESSED) throw new FileRejected("Excel dosyası çok büyük.");
    return "xlsx";
  }
  if (actual !== expected) throw new FileRejected("Dosyanın içeriği uzantısıyla uyuşmuyor.");
  return expected;
}

export const isImageKind = (k: FileKind) => k === "jpeg" || k === "png" || k === "webp";
