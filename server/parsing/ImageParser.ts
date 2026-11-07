// Fotoğraf ön işleme ve kalite değerlendirmesi (sharp).
// Tablo okuma yapay zekâ (OCR) ile yapılır; burada görüntü düzeltilir ve ölçülür.

import sharp from "sharp";
import type { Quality } from "../../shared/types.js";
import { ParseError } from "./types.js";

type Sharp = ReturnType<typeof sharp>;
type Metadata = Awaited<ReturnType<Sharp["metadata"]>>;

const MAX_PIXELS = 80_000_000;
const OUT_LONG_SIDE = 2400;

export interface PreparedImage { jpeg: Buffer; quality: Quality }

/** Laplace filtresi çıktısının standart sapması: düşükse görüntü bulanıktır. */
async function sharpness(img: Sharp): Promise<number> {
  const { data, info } = await img.clone()
    .greyscale()
    .resize({ width: 1200, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x;
      const lap = data[i - w] + data[i + w] + data[i - 1] + data[i + 1] - 4 * data[i];
      sum += lap; sum2 += lap * lap; n++;
    }
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sum2 / n - mean * mean));
}

export async function prepareImage(buf: Buffer): Promise<PreparedImage> {
  let base: Sharp;
  let meta: Metadata;
  try {
    base = sharp(buf, { limitInputPixels: MAX_PIXELS, failOn: "error" }).rotate(); // EXIF yönünü düzelt
    meta = await base.metadata();
  } catch (e) {
    throw new ParseError(`image: ${(e as Error).message}`, "Görsel açılamadı. JPG veya PNG formatında yeniden yükle.");
  }
  const swap = (meta.orientation ?? 1) >= 5;
  const width = (swap ? meta.height : meta.width) ?? 0;
  const height = (swap ? meta.width : meta.height) ?? 0;

  const stats = await base.clone().greyscale().stats();
  const brightness = stats.channels[0].mean;
  const sharp_ = await sharpness(base);

  const problems: string[] = [];
  if (Math.min(width, height) < 700) problems.push("Fotoğrafın çözünürlüğü düşük. Tabloya daha yakından çek.");
  if (sharp_ < 6) problems.push("Fotoğraf bulanık görünüyor. Telefonu sabit tutup netleştirerek yeniden çek.");
  if (brightness < 60) problems.push("Fotoğraf çok karanlık. Daha aydınlık bir ortamda çek.");
  if (brightness > 240) problems.push("Fotoğraf çok parlak/yansımalı. Işık yansımasını önleyerek çek.");
  const severe = Math.min(width, height) < 400 || sharp_ < 3 || brightness < 35;

  // İyileştirme: kontrast germe, hafif keskinleştirme, makul boyut
  const jpeg = await base.clone()
    .resize({ width: OUT_LONG_SIDE, height: OUT_LONG_SIDE, fit: "inside", withoutEnlargement: true })
    .normalize()
    .sharpen({ sigma: 0.8 })
    .jpeg({ quality: 88 })
    .toBuffer();

  return {
    jpeg,
    quality: {
      level: severe ? "poor" : problems.length ? "fair" : "good",
      problems,
      askReupload: severe,
      metrics: { width, height, sharpness: Math.round(sharp_ * 10) / 10, brightness: Math.round(brightness) },
    },
  };
}
