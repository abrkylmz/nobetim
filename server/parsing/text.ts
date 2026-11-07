// Türkçe metin normalizasyonu.

export const MONTHS_TR = ["ocak", "subat", "mart", "nisan", "mayis", "haziran", "temmuz",
  "agustos", "eylul", "ekim", "kasim", "aralik"];

/** Küçük harf + Türkçe karakter sadeleştirme: "Ayşe ÇİÇEK" → "ayse cicek" */
export function fold(s: string): string {
  return s
    .replace(/İ/g, "i").replace(/I/g, "ı")
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g")
    .replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c")
    .normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Harf ve rakam dışındakileri boşluğa çevirir. */
export const foldWords = (s: string) => fold(s).replace(/[^a-z0-9]+/g, " ").trim();

/** Vardiya kodu karşılaştırması: "yi" ve "Yİ" aynı, boşluk/nokta yok sayılır. */
export const codeKey = (s: string) => fold(s).replace(/[\s.]+/g, "");

export const hasLetters = (s: unknown) => typeof s === "string" && /\p{L}{2,}/u.test(s);

export function cellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    // Excel'de yalnızca saat içeren hücreler 1899-12-30 tarihli gelir.
    if (v.getUTCFullYear() < 1901) return `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`;
    return v.toISOString().slice(0, 10);
  }
  return String(v).replace(/\s+/g, " ").trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}
