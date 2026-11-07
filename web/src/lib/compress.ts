// Fotoğrafları yüklemeden önce tarayıcıda küçültür.
// Sunucu OCR için zaten en fazla 2400 piksele indiriyor; aynı boyutta göndermek kaliteyi düşürmez,
// yüklemeyi hızlandırır ve Vercel'in istek boyutu sınırına (4,5 MB) sığar.

const isImage = (f: File) => /\.(jpe?g|png|webp)$/i.test(f.name) || f.type.startsWith("image/");

async function toJpeg(file: File, maxSide: number, quality: number): Promise<File> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; // saydam PNG'ler için beyaz zemin
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Görsel işlenemedi."))), "image/jpeg", quality));
  return new File([blob], file.name.replace(/\.(png|webp|jpe?g)$/i, "") + ".jpg", { type: "image/jpeg" });
}

/**
 * Fotoğrafları toplam boyut sınırın altına inecek şekilde sıkıştırır.
 * Excel/PDF dokunulmadan döner. Sınır aşılırsa adım adım boyut/kaliteyi düşürür.
 */
export async function prepareForUpload(files: File[], limitBytes: number): Promise<File[]> {
  const docs = files.filter((f) => !isImage(f));
  const images = files.filter(isImage);
  if (!images.length) return files;
  const budget = limitBytes * 0.92 - docs.reduce((n, f) => n + f.size, 0);
  const steps: [number, number][] = [[2400, 0.88], [2000, 0.82], [1700, 0.78], [1400, 0.72]];
  let out: File[] = images;
  for (const [side, q] of steps) {
    out = await Promise.all(images.map((f) => toJpeg(f, side, q)));
    if (out.reduce((n, f) => n + f.size, 0) <= budget) break;
  }
  return [...docs, ...out];
}
