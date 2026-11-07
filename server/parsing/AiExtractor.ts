// Fotoğraf, taranmış PDF ve yerelde çözülemeyen tablolar için Claude ile OCR + tablo çıkarımı.

import Anthropic from "@anthropic-ai/sdk";
import { ParseError } from "./types.js";

export type AiSource =
  | { kind: "image"; images: Buffer[] }
  | { kind: "pdf"; pdf: Buffer }
  | { kind: "text"; text: string };

export interface AiTarget {
  fullName: string;
  staffNo?: string;
  /** Kullanıcı listeden bir kişi seçtiyse yalnızca o satır okunur. */
  selectedName?: string;
}

export type AiConfidence = "high" | "medium" | "low";

export interface AiRosterResult {
  readable: boolean;
  quality: "good" | "fair" | "poor";
  problems: string[];
  year: number;
  month: number;
  hospital: string;
  department: string;
  legend: { code: string; meaning: string }[];
  people: { name: string; staffNo: string; title: string }[];
  targetRows: {
    name: string;
    staffNo: string;
    title: string;
    cells: { day: number; text: string; confidence: AiConfidence; note: string }[];
  }[];
}

export interface AiExtractor {
  readonly available: boolean;
  extract(source: AiSource, target: AiTarget): Promise<AiRosterResult>;
}

const str = { type: "string" } as const;
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["readable", "quality", "problems", "year", "month", "hospital", "department", "legend", "people", "targetRows"],
  properties: {
    readable: { type: "boolean", description: "Tablo okunabilir mi? Hiç okunamıyorsa false." },
    quality: { type: "string", enum: ["good", "fair", "poor"] },
    problems: { type: "array", items: str, description: "Kullanıcıya gösterilecek kısa Türkçe sorunlar: bulanık, eğik, kesik, yansıma, eksik sütun vb." },
    year: { type: "integer", description: "Yıl; bilinmiyorsa 0" },
    month: { type: "integer", description: "Ay 1-12; bilinmiyorsa 0" },
    hospital: str,
    department: str,
    legend: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["code", "meaning"], properties: { code: str, meaning: str } },
    },
    people: {
      type: "array",
      description: "Listedeki tüm kişiler (yalnızca isim, sicil, ünvan).",
      items: { type: "object", additionalProperties: false, required: ["name", "staffNo", "title"], properties: { name: str, staffNo: str, title: str } },
    },
    targetRows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "staffNo", "title", "cells"],
        properties: {
          name: str, staffNo: str, title: str,
          cells: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["day", "text", "confidence", "note"],
              properties: {
                day: { type: "integer" },
                text: str,
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                note: str,
              },
            },
          },
        },
      },
    },
  },
};

const SYSTEM = `Hastane hemşire nöbet/çalışma çizelgelerini okuyan bir veri çıkarma uzmanısın. Girdi fotoğraf, taranmış PDF veya tablo metni olabilir.

Kurallar:
- Tabloyu satır ve sütunlarıyla dikkatle hizala. Fotoğraf eğik, perspektifli, katlanmış veya el yazılı olabilir; satır kaymasına özellikle dikkat et.
- Gün sütunlarını (1, 2, 3… ya da tarihler) bul. Hedef kişinin satırında her dolu gün hücresi için {day, text} yaz. Boş günleri yazma.
- Hücre içeriğini olduğu gibi aktar ("G", "N", "08-16", "16:00-08:00", "16/08", "08/08", "İ", "R", "Yİ", "EK N" gibi). Yorumlama, saat uydurma. "16/08" gibi eğik çizgili saatleri tarih sanma; yazıldığı gibi aktar.
- Tablo "tarih satırlarda, vardiyalar sütunlarda, isimler hücrelerde" biçimindeyse: hedef kişinin adının geçtiği her gün için text olarak o sütunun başlığını (ör. "08:00-16:00" veya "Gece") yaz.
- Her hücre için okuma güvenini ver: high = net okunuyor; medium = okunuyor ama emin değilsin; low = tahmin. medium/low ise note alanına nedenini kısa Türkçe yaz (silik, üstü çizili, el yazısı belirsiz, satır kayması olabilir). Diğer durumlarda note boş.
- Okuyamadığın hücreleri atlama: en olası değeri yaz ve low işaretle.
- Kişiler listesinde (people) tablodaki tüm isimleri yaz. Bu liste yalnızca kişi eşleştirmesi içindir; diğer kişilerin nöbet hücrelerini çıkarma.
- Ay/yılı başlıktan veya tarihlerden çıkar. Kod açıklamaları (lejant) varsa legend'e yaz.
- Görüntü kalitesini değerlendir; sorun varsa problems'a kullanıcıya yönelik kısa Türkçe cümleler yaz (ör. "Tablonun sağ kenarı kesik, 28-31. günler görünmüyor").`;

const MODEL = "claude-opus-5-5";

export function createClaudeExtractor(apiKey: string): AiExtractor {
  const client = apiKey ? new Anthropic({ apiKey, maxRetries: 2, timeout: 5 * 60_000 }) : null;
  return {
    available: !!client,
    async extract(source, target) {
      if (!client) {
        throw new ParseError("ai: no api key",
          "Bu dosya türünü okumak için sunucuda yapay zekâ (OCR) yapılandırılmamış. Yönetici ANTHROPIC_API_KEY tanımlamalı.");
      }
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (source.kind === "image") {
        for (const img of source.images) {
          content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: img.toString("base64") } });
        }
      } else if (source.kind === "pdf") {
        content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: source.pdf.toString("base64") } });
      } else {
        content.push({ type: "text", text: `<cizelge>\n${source.text}\n</cizelge>` });
      }
      const who = target.selectedName
        ? `Hedef kişi: "${target.selectedName}". targetRows'a yalnızca bu kişinin satırını yaz.`
        : `Kullanıcının adı: "${target.fullName}"${target.staffNo ? `, sicil no: ${target.staffNo}` : ""}. ` +
          "targetRows'a bu isimle aynı veya ona benzeyen (Türkçe karakter, büyük/küçük harf, kısaltma, ikinci ad farkı) TÜM satırları yaz. " +
          "Benzer satır yoksa targetRows boş kalsın.";
      content.push({ type: "text", text: `Bu nöbet çizelgesini oku. ${who}` });

      let msg: Anthropic.Beta.BetaMessage;
      try {
        const stream = client.beta.messages.stream({
          model: MODEL,
          max_tokens: 32000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
          system: SYSTEM,
          messages: [{ role: "user", content }],
        });
        msg = await stream.finalMessage();
      } catch (e) {
        throw new ParseError(`ai: ${describeApiError(e)}`, aiUserMessage(e));
      }
      if (msg.stop_reason === "refusal") throw new ParseError("ai: refusal", "Dosya yapay zekâ tarafından işlenemedi. Farklı bir fotoğrafla dene.");
      if (msg.stop_reason === "max_tokens") throw new ParseError("ai: max_tokens", "Çizelge beklenenden uzun. Yalnızca ilgili sayfayı yükle.");
      const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      try {
        return JSON.parse(text) as AiRosterResult;
      } catch {
        throw new ParseError("ai: invalid json", "Çizelge okunamadı. Tekrar dene.");
      }
    },
  };
}

function describeApiError(e: unknown): string {
  if (e instanceof Anthropic.APIError) return `${e.status ?? ""} ${e.message}`;
  return (e as Error)?.message ?? String(e);
}

function aiUserMessage(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return "Yapay zekâ servisine erişilemedi (yetkilendirme). Yöneticiye bildir.";
  }
  if (e instanceof Anthropic.RateLimitError) return "Yapay zekâ servisi şu an yoğun. Birkaç dakika sonra yeniden analiz et.";
  if (e instanceof Anthropic.BadRequestError) return "Dosya yapay zekâ servisine gönderilemedi (boyut veya biçim). Daha küçük bir dosya dene.";
  if (e instanceof Anthropic.APIConnectionError) return "Yapay zekâ servisine bağlanılamadı. Daha sonra yeniden analiz et.";
  if (e instanceof Anthropic.APIError) return "Yapay zekâ servisinde geçici bir hata oluştu. Yeniden analiz et.";
  return "Çizelge okunurken beklenmeyen bir hata oluştu.";
}
