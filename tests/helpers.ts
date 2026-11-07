import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import sharp from "sharp";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createLocalFileStore } from "../server/fileStore";
import { createApp, type AppOptions } from "../server/app";
import type { AiExtractor, AiRosterResult, AiSource, AiTarget } from "../server/parsing/AiExtractor";

// ---------- sahte yapay zekâ ----------

export interface MockAi extends AiExtractor {
  calls: { source: AiSource; target: AiTarget }[];
  respond: (source: AiSource, target: AiTarget) => AiRosterResult;
}

export function mockAi(respond: MockAi["respond"] = () => emptyAi()): MockAi {
  const ai: MockAi = {
    available: true,
    calls: [],
    respond,
    async extract(source, target) {
      ai.calls.push({ source, target });
      return ai.respond(source, target);
    },
  };
  return ai;
}

export const emptyAi = (over: Partial<AiRosterResult> = {}): AiRosterResult => ({
  readable: true, quality: "good", problems: [], year: 2026, month: 11, hospital: "", department: "",
  legend: [], people: [], targetRows: [], ...over,
});

// ---------- örnek çizelge verisi ----------

export const DAYS_NOV = 30;
/** Ayşe'nin Kasım 2026 nöbetleri (gün → kod) */
export const AYSE: Record<number, string> = {
  1: "G", 2: "N", 4: "İ", 5: "G", 6: "24", 9: "GC", 10: "G", 12: "R", 15: "08-16", 16: "20:00-08:00", 20: "G", 30: "N",
};
export const FATMA: Record<number, string> = { 1: "N", 3: "G", 7: "G", 8: "24" };

export function rosterGrid(people: { name: string; title?: string; staffNo?: string; days: Record<number, string> }[], from = 1, to = DAYS_NOV) {
  const head = ["S.No", "Adı Soyadı", "Sicil No", "Ünvan", ...Array.from({ length: to - from + 1 }, (_, i) => from + i)];
  return [
    ["SAĞLIK BİLİMLERİ ÜNİVERSİTESİ ÖRNEK EĞİTİM VE ARAŞTIRMA HASTANESİ"],
    ["DAHİLİYE SERVİSİ KASIM 2026 HEMŞİRE ÇALIŞMA ÇİZELGESİ"],
    [],
    head,
    ...people.map((p, i) => [i + 1, p.name, p.staffNo ?? "", p.title ?? "Hemşire",
      ...Array.from({ length: to - from + 1 }, (_, k) => p.days[from + k] ?? "")]),
    [],
    ["G: Gündüz 08:00-16:00, N: Nöbet 16:00-08:00, GC: Gece 20:00-08:00, İ: İzin, R: Rapor"],
    ["Sorumlu Hemşire", "", "", "İmza"],
  ];
}

export function excelBuffer(sheets: Record<string, unknown[][]>, bookType: "xlsx" | "xls" = "xlsx", merges?: XLSX.Range[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    if (merges) ws["!merges"] = merges;
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: "buffer", bookType }) as Buffer;
}

const FONT = ["C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/Library/Fonts/Arial Unicode.ttf"].find((f) => fs.existsSync(f));
export const hasFont = !!FONT;

/** Metin katmanlı PDF: her sayfa bir ızgara */
export async function pdfBuffer(pages: unknown[][][]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fs.readFileSync(FONT!), { subset: true });
  for (const grid of pages) {
    const page = doc.addPage([842, 595]);
    let y = 560;
    for (const row of grid) {
      const cols = row.length;
      row.forEach((v, c) => {
        if (v === "" || v == null) return;
        const text = String(v);
        let x: number;
        if (cols <= 1) x = 30;
        else if (c < 4) x = [20, 48, 160, 210][c];
        else x = 255 + (c - 4) * 18.5;
        const size = c >= 4 ? Math.min(7, 30 / Math.max(1, text.length)) : 8; // hücreye sığdır
        page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) });
      });
      y -= 16;
    }
  }
  return Buffer.from(await doc.save());
}

/** Yalnızca görüntü içeren (taranmış) PDF */
export async function scannedPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const png = await tableImage(1600, 1000);
  const img = await doc.embedPng(png);
  const page = doc.addPage([842, 595]);
  page.drawImage(img, { x: 0, y: 0, width: 842, height: 595 });
  return Buffer.from(await doc.save());
}

/** Tablo fotoğrafı yerine geçen PNG (SVG'den) */
export async function tableImage(w = 2000, h = 1200): Promise<Buffer> {
  const rows = ["Ayşe Yılmaz", "Fatma Demir", "Zeynep Kaya", "Elif Şahin"];
  const cells = rows.map((r, i) => `<text x="40" y="${200 + i * 120}" font-size="44" font-family="Arial">${r}</text>` +
    Array.from({ length: 15 }, (_, d) => `<text x="${520 + d * 95}" y="${200 + i * 120}" font-size="44" font-family="Arial">${["G", "N", "", "İ"][(d + i) % 4]}</text>`).join("")).join("");
  const grid = Array.from({ length: 16 }, (_, d) => `<line x1="${500 + d * 95}" y1="80" x2="${500 + d * 95}" y2="700" stroke="black" stroke-width="3"/>`).join("") +
    Array.from({ length: 6 }, (_, r) => `<line x1="20" y1="${80 + r * 120}" x2="1930" y2="${80 + r * 120}" stroke="black" stroke-width="3"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 2000 1200"><rect width="100%" height="100%" fill="white"/>
    <text x="40" y="60" font-size="48" font-family="Arial">KASIM 2026 NÖBET LİSTESİ</text>${grid}${cells}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function badPhoto(): Promise<Buffer> {
  const img = await tableImage(2000, 1200);
  return sharp(img).rotate(9, { background: "#888" }).resize(360).blur(6).modulate({ brightness: 0.35 }).jpeg({ quality: 40 }).toBuffer();
}

export async function okPhoto(): Promise<Buffer> {
  return sharp(await tableImage()).rotate(3, { background: "#eee" }).jpeg({ quality: 85 }).toBuffer();
}

// ---------- test uygulaması ----------

export async function makeApp(ai: AiExtractor = mockAi(), extra: Partial<AppOptions> = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nobetim-test-"));
  const ctx = await createApp({
    dbUrl: `file:${path.join(dataDir, "test.db").replace(/\\/g, "/")}`,
    files: createLocalFileStore(path.join(dataDir, "uploads"), randomBytes(32)),
    ai, retentionDays: 30, ...extra,
  });
  return {
    ...ctx, dataDir,
    cleanup() {
      ctx.close();
      // Windows libSQL dosya tutamacını geç bırakabilir; geçici klasör silinemezse sorun değil
      try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* yok say */ }
    },
  };
}

export async function signedIn(app: Awaited<ReturnType<typeof makeApp>>, profile: Record<string, unknown> = { fullName: "Ayşe Yılmaz", department: "Dahiliye", hospital: "Örnek Hastanesi" }) {
  const agent = request.agent(app.app);
  const email = `u${Math.random().toString(36).slice(2)}@ornek.com`;
  await agent.post("/api/auth/register").set("X-Nobetim", "1").send({ email, password: "parola1234" }).expect(201);
  await agent.put("/api/profile").set("X-Nobetim", "1").send(profile).expect(200);
  return agent;
}

export async function uploadAndWait(app: Awaited<ReturnType<typeof makeApp>>, agent: request.Agent, files: { name: string; buffer: Buffer }[]) {
  let req = agent.post("/api/imports").set("X-Nobetim", "1");
  for (const f of files) req = req.attach("files", f.buffer, f.name);
  const res = await req;
  if (res.status !== 202) return { res, detail: null as any };
  await app.imports.idle();
  const detail = (await agent.get(`/api/imports/${res.body.id}`)).body;
  return { res, detail };
}

export const post = (agent: request.Agent, url: string, body: unknown = {}) => agent.post(url).set("X-Nobetim", "1").send(body as object);
export const patch = (agent: request.Agent, url: string, body: unknown = {}) => agent.patch(url).set("X-Nobetim", "1").send(body as object);
