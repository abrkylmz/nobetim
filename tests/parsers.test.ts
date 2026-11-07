import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseExcel } from "../server/parsing/ExcelParser";
import { parsePdf } from "../server/parsing/PdfParser";
import { prepareImage } from "../server/parsing/ImageParser";
import { matchPersonnel, nameScore } from "../server/parsing/PersonnelMatcher";
import { normalizeCells, parseTimeRange, categoryFromTimes } from "../server/parsing/ShiftNormalizer";
import { validateDraft, blockingEntries } from "../server/parsing/ShiftValidator";
import { validateFile, FileRejected } from "../server/security/fileValidation";
import { DEFAULT_SHIFT_TYPES } from "../server/db";
import { buildInterval } from "../shared/time";
import { holidayHours } from "../shared/holidays";
import { toMs } from "../shared/time";
import type { RosterRow } from "../server/parsing/types";
import type { Shift, ShiftType } from "../shared/types";
import { AYSE, FATMA, badPhoto, excelBuffer, hasFont, okPhoto, pdfBuffer, rosterGrid, scannedPdf } from "./helpers";

const types: ShiftType[] = DEFAULT_SHIFT_TYPES.map((t, i) => ({ ...t, id: String(i), verified: false }));
const ctx = { year: 2026, month: 11, shiftTypes: types, legend: [], department: "Dahiliye" };
const row = (name: string, extra: Partial<RosterRow> = {}): RosterRow => ({ key: name, name, cells: [], cellsLoaded: true, ...extra });

describe("Saat hesapları (senaryo 10)", () => {
  it("20:00-08:00 ertesi güne sarkar ve 12 saattir", () => {
    const i = buildInterval("2026-11-16", "20:00", "08:00")!;
    expect(i).toMatchObject({ startAt: "2026-11-16T20:00", endAt: "2026-11-17T08:00", hours: 12, overnight: true });
  });
  it("08:00-08:00 24 saattir", () => {
    expect(buildInterval("2026-11-06", "08:00", "08:00")).toMatchObject({ endAt: "2026-11-07T08:00", hours: 24 });
  });
  it("ay sonundaki gece nöbeti yeni aya geçer", () => {
    expect(buildInterval("2026-11-30", "16:00", "08:00")).toMatchObject({ endAt: "2026-12-01T08:00", hours: 16 });
  });
  it("16:00-24:00 aynı gün biter", () => {
    expect(buildInterval("2026-11-02", "16:00", "24:00")).toMatchObject({ endAt: "2026-11-03T00:00", hours: 8, overnight: false });
  });
  it("vardiya türleri saatten sınıflandırılır", () => {
    expect(categoryFromTimes("08:00", "16:00")).toBe("day");
    expect(categoryFromTimes("16:00", "24:00")).toBe("evening");
    expect(categoryFromTimes("20:00", "08:00")).toBe("night");
    expect(categoryFromTimes("08:00", "08:00")).toBe("24h");
    expect(parseTimeRange("8-16")).toEqual({ start: "08:00", end: "16:00" });
    expect(parseTimeRange("20.00 - 08.00")).toEqual({ start: "20:00", end: "08:00" });
  });
  it("resmî tatil saatleri gerçek aralıktan hesaplanır (28 Ekim arifesi 13:00'ten)", () => {
    expect(holidayHours(toMs("2026-10-28T08:00"), toMs("2026-10-29T08:00"))).toBe(19);
  });
});

describe("ExcelParser (senaryo 4, 5)", () => {
  it("tek sayfalı listeden personel, günler, dönem ve lejantı çıkarır", () => {
    const buf = excelBuffer({ Kasım: rosterGrid([{ name: "Ayşe Yılmaz", days: AYSE }, { name: "Fatma Demir", days: FATMA }]) });
    const r = parseExcel(buf);
    expect(r.year).toBe(2026);
    expect(r.month).toBe(11);
    expect(r.rows.map((x) => x.name)).toEqual(["Ayşe Yılmaz", "Fatma Demir"]);
    expect(r.rows[0].title).toBe("Hemşire");
    expect(r.rows[0].cells.find((c) => c.day === 16)?.raw).toBe("20:00-08:00");
    expect(r.legend.map((l) => l.code)).toEqual(expect.arrayContaining(["G", "N", "GC", "İ", "R"]));
  });

  it("birden çok sayfayı ve iki parçaya bölünmüş ayı birleştirir", () => {
    const buf = excelBuffer({
      "1-15": rosterGrid([{ name: "Ayşe Yılmaz", days: AYSE }], 1, 15),
      "16-30": rosterGrid([{ name: "AYŞE YILMAZ", days: AYSE }], 16, 30),
      Açıklama: [["Bu sayfada tablo yok"]],
    });
    const r = parseExcel(buf);
    expect(r.sheetCount).toBe(3);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].cells.map((c) => c.day)).toEqual(Object.keys(AYSE).map(Number));
  });

  it("birleştirilmiş hücreleri (ör. 5 günlük yıllık izin) yayar", () => {
    const grid = rosterGrid([{ name: "Ayşe Yılmaz", days: { 1: "G", 10: "YILLIK İZİN" } }]);
    // satır 4 (0 tabanlı), 10-14. günler → sütun 4+9 .. 4+13
    const buf = excelBuffer({ Liste: grid }, "xlsx", [{ s: { r: 4, c: 13 }, e: { r: 4, c: 17 } }]);
    const cells = parseExcel(buf).rows[0].cells;
    expect(cells.filter((c) => c.raw === "YILLIK İZİN").map((c) => c.day)).toEqual([10, 11, 12, 13, 14]);
  });

  it("eski XLS biçimini ve tarih başlıklı sütunları okur", () => {
    const head = ["Personel", ...Array.from({ length: 31 }, (_, i) => new Date(Date.UTC(2026, 11, i + 1)))];
    const buf = excelBuffer({ Aralık: [head, ["Ayşe Yılmaz", "G", "N"], ["", ""], ["Toplam", 3]] }, "xls");
    const r = parseExcel(buf);
    expect([r.year, r.month]).toEqual([2026, 12]);
    expect(r.rows.map((x) => x.name)).toEqual(["Ayşe Yılmaz"]);
  });

  describe("kayma ve Excel dönüşümlerine karşı", () => {
    const head = (extra: unknown[] = []) => ["Adı Soyadı", ...extra, ...Array.from({ length: 30 }, (_, i) => i + 1)];
    const book = (ws: XLSX.WorkSheet, more?: (wb: XLSX.WorkBook) => void) => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Liste");
      more?.(wb);
      return XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true }) as Buffer;
    };
    const cellsOf = (buf: Buffer, name = "Ayşe Yılmaz") =>
      Object.fromEntries(parseExcel(buf).rows.find((r) => r.name === name)!.cells.map((c) => [c.day, c.raw]));

    it("gizli sütun ve satırları atlar (günler kaymaz)", () => {
      const ws = XLSX.utils.aoa_to_sheet([
        ["KASIM 2026"],
        head(["gizli"]),
        ["Ayşe Yılmaz", "x", "G", "N", "", "İ"],
        ["Eski Personel", "x", "G", "G", "G", "G"],
      ]);
      ws["!cols"] = [{}, { hidden: true }];
      ws["!rows"] = [{}, {}, {}, { hidden: true }];
      const r = parseExcel(book(ws));
      expect(r.rows.map((x) => x.name)).toEqual(["Ayşe Yılmaz"]);
      expect(cellsOf(book(ws))).toEqual({ 1: "G", 2: "N", 4: "İ" });
    });

    it("iki satırlı personelde alt satırı (saatler) ayrı kişi ya da nöbet saymaz", () => {
      const ws = XLSX.utils.aoa_to_sheet([
        ["KASIM 2026"],
        head(),
        ["Ayşe Yılmaz", "16/08", "08/16", "", "08/08"],
        ["", 16, 8, "", 24],
        ["Fatma Demir", "08/16"],
        ["", 8],
      ]);
      ws["!merges"] = [{ s: { r: 2, c: 0 }, e: { r: 3, c: 0 } }, { s: { r: 4, c: 0 }, e: { r: 5, c: 0 } }];
      const buf = book(ws);
      expect(parseExcel(buf).rows.map((x) => x.name)).toEqual(["Ayşe Yılmaz", "Fatma Demir"]);
      expect(cellsOf(buf)).toEqual({ 1: "16/08", 2: "08/16", 4: "08/08" });
    });

    it("iki alt sütunu kapsayan gün başlıklarını tek gün olarak okur", () => {
      const header: unknown[] = ["Adı Soyadı"];
      const merges: XLSX.Range[] = [];
      for (let d = 1; d <= 30; d++) {
        header.push(d, "");
        merges.push({ s: { r: 1, c: 2 * d - 1 }, e: { r: 1, c: 2 * d } });
      }
      const row: unknown[] = ["Ayşe Yılmaz", "G", "", "", "N", "08/08", ""];
      const ws = XLSX.utils.aoa_to_sheet([["KASIM 2026"], header, row]);
      ws["!merges"] = merges;
      expect(cellsOf(book(ws))).toEqual({ 1: "G", 2: "N", 3: "08/08" });
    });

    it("Excel'in sayıya/tarihe çevirdiği kodları geri kazanır", () => {
      const ws = XLSX.utils.aoa_to_sheet([["KASIM 2026"], head(), ["Ayşe Yılmaz", "G"]]);
      const at = (day: number) => XLSX.utils.encode_cell({ r: 2, c: day });
      ws[at(2)] = { t: "n", v: 16.08, z: "0.00" };            // "16,08" ondalık
      ws[at(3)] = { t: "n", v: 8.16, z: "0.00" };             // "8,16"
      ws[at(4)] = { t: "n", v: 42583, z: "mmm-yy" };          // "08-16" → Ağustos 2016
      ws[at(5)] = { t: "n", v: 46250, z: "m/d" };             // ABD biçimi: "8/16" → 16 Ağustos
      ws[at(6)] = { t: "n", v: 7.5, z: "0.0" };               // gerçek ondalık (7,5) saat sanılmaz
      ws["!ref"] = "A1:AE3";
      const c = cellsOf(book(ws));
      expect(c).toMatchObject({ 1: "G", 2: "16/08", 3: "08/16", 4: "08/16", 5: "08/16" });
      expect(c[6]).not.toMatch(/\//);
    });

    it("gizli çalışma sayfalarını okumaz", () => {
      const ws = XLSX.utils.aoa_to_sheet([["KASIM 2026"], head(), ["Ayşe Yılmaz", "G"]]);
      const old = XLSX.utils.aoa_to_sheet([["EKİM 2026"], head(), ["Ayşe Yılmaz", "N", "N"]]);
      const buf = book(ws, (wb) => {
        XLSX.utils.book_append_sheet(wb, old, "Eski");
        wb.Workbook = { Sheets: [{ name: "Liste", Hidden: 0 }, { name: "Eski", Hidden: 1 }] };
      });
      const r = parseExcel(buf);
      expect(r.sheetCount).toBe(1);
      expect(cellsOf(buf)).toEqual({ 1: "G" });
    });
  });

  it("tarihler satırda, isimler hücrede olan günlük listeyi okur", () => {
    const grid: unknown[][] = [["KASIM 2026 NÖBET LİSTESİ"], ["Tarih", "Gün", "08:00-16:00", "16:00-08:00"]];
    for (let d = 1; d <= 30; d++) grid.push([`${String(d).padStart(2, "0")}.11.2026`, "", d % 2 ? "Ayşe Yılmaz, Fatma Demir" : "Zeynep Kaya", d % 3 ? "" : "Ayşe Yılmaz"]);
    const r = parseExcel(excelBuffer({ Liste: grid }));
    const ayse = r.rows.find((x) => x.name === "Ayşe Yılmaz")!;
    expect(ayse.cells.find((c) => c.day === 3)?.raw).toBe("08:00-16:00 + 16:00-08:00");
    expect(ayse.cells.find((c) => c.day === 6)?.raw).toBe("16:00-08:00");
  });
});

describe.runIf(hasFont)("PdfParser (senaryo 1, 2, 3)", () => {
  it("metin katmanlı PDF tablosunu koordinatlardan kurar", async () => {
    const pdf = await pdfBuffer([rosterGrid([{ name: "Ayşe Yılmaz", days: AYSE }, { name: "Fatma Demir", days: FATMA }])]);
    const r = await parsePdf(pdf);
    expect(r.scanned).toBe(false);
    expect([r.year, r.month]).toEqual([2026, 11]);
    const ayse = r.rows.find((x) => x.name === "Ayşe Yılmaz")!;
    expect(Object.fromEntries(ayse.cells.map((c) => [c.day, c.raw]))).toEqual(Object.fromEntries(Object.entries(AYSE)));
    expect(r.rows.find((x) => x.name === "Fatma Demir")?.cells.map((c) => c.day)).toEqual([1, 3, 7, 8]);
  });

  it("birden fazla sayfadaki kayıtları birleştirir", async () => {
    const pdf = await pdfBuffer([
      rosterGrid([{ name: "Ayşe Yılmaz", days: AYSE }], 1, 15),
      rosterGrid([{ name: "Ayşe Yılmaz", days: AYSE }, { name: "Fatma Demir", days: FATMA }], 16, 30),
    ]);
    const r = await parsePdf(pdf);
    expect(r.pageCount).toBe(2);
    expect(r.rows.find((x) => x.name === "Ayşe Yılmaz")?.cells.map((c) => c.day)).toEqual(Object.keys(AYSE).map(Number));
  });

  it("taranmış PDF'i metin katmanı olmadığı için OCR'a yönlendirir", async () => {
    const r = await parsePdf(await scannedPdf());
    expect(r.scanned).toBe(true);
  });
});

describe("ImageParser (senaryo 6, 7)", () => {
  it("normal fotoğrafı kabul eder ve iyileştirir", async () => {
    const p = await prepareImage(await okPhoto());
    expect(p.quality.askReupload).toBe(false);
    expect(p.jpeg.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });
  it("eğik, bulanık ve karanlık fotoğrafta yeniden çekim ister", async () => {
    const p = await prepareImage(await badPhoto());
    expect(p.quality.level).toBe("poor");
    expect(p.quality.askReupload).toBe(true);
    expect(p.quality.problems.join(" ")).toMatch(/bulanık|çözünürlüğü|karanlık/);
  });
});

describe("PersonnelMatcher (senaryo 8, 9, 14)", () => {
  it("Türkçe karakter ve büyük/küçük harf farklarını eşler", () => {
    expect(nameScore("Şükran Çağlayan Öztürk", "SUKRAN CAGLAYAN OZTURK").score).toBe(1);
    expect(nameScore("İrem Işık", "irem ışık").score).toBe(1);
    expect(nameScore("Ayşe Nur Yılmaz", "Ayşe Yılmaz").score).toBeGreaterThanOrEqual(0.9);
    expect(nameScore("Ayşe Yılmaz", "Yılmaz Ayşe").score).toBeGreaterThanOrEqual(0.95);
    expect(nameScore("Ayşe Yılmaz", "Hem. Ayşe YILMAZ").score).toBe(1);
  });
  it("tek güçlü eşleşmeyi otomatik seçer", () => {
    const m = matchPersonnel([row("Fatma Demir"), row("AYSE YILMAZ")], { fullName: "Ayşe Yılmaz" });
    expect(m.selected?.name).toBe("AYSE YILMAZ");
  });
  it("aynı isimli personelde otomatik seçim yapmaz, sicil ile ayırt eder", () => {
    const rows = [row("Ayşe Yılmaz", { key: "a", staffNo: "1001", department: "Acil" }), row("Ayşe Yılmaz", { key: "b", staffNo: "2002", department: "Dahiliye" })];
    const m = matchPersonnel(rows, { fullName: "Ayşe Yılmaz" });
    expect(m.selected).toBeNull();
    expect(m.candidates.map((c) => c.key)).toEqual(expect.arrayContaining(["a", "b"]));
    expect(matchPersonnel(rows, { fullName: "Ayşe Yılmaz", staffNo: "2002" }).selected?.key).toBe("b");
    expect(matchPersonnel(rows, { fullName: "Ayşe Yılmaz", department: "Dahiliye" }).selected?.key).toBe("b");
  });
  it("benzer ama farklı kişiyi otomatik seçmez", () => {
    const m = matchPersonnel([row("Ayşe Yılmazer"), row("Ayten Yılmaz"), row("Fatma Demir")], { fullName: "Ayşe Yılmaz" });
    expect(m.selected).toBeNull();
    const m2 = matchPersonnel([row("Ayşe Kaya"), row("Fatma Yılmaz")], { fullName: "Ayşe Yılmaz" });
    expect(m2.selected).toBeNull();
  });
});

describe("ShiftNormalizer ve ShiftValidator (senaryo 10, 11, 12)", () => {
  const cells = (o: Record<number, string>, score = 1) => Object.entries(o).map(([d, raw]) => ({ day: +d, raw, readScore: score }));

  it("kodları türe ve gerçek saat aralığına çevirir", () => {
    const e = normalizeCells(cells({ 2: "N", 6: "24", 4: "İ", 16: "20-08" }), ctx);
    const by = Object.fromEntries(e.map((x) => [x.date.slice(8), x]));
    expect(by["02"]).toMatchObject({ category: "night", startAt: "2026-11-02T16:00", endAt: "2026-11-03T08:00", hours: 16 });
    expect(by["06"]).toMatchObject({ category: "24h", hours: 24 });
    expect(by["04"]).toMatchObject({ category: "leave", hours: 0, startAt: null });
    expect(by["16"]).toMatchObject({ category: "night", hours: 12, overnight: true });
    expect(by["16"].confidence.time.level).toBe("high");
    expect(by["02"].confidence.time.level).toBe("medium"); // onaysız varsayılan saat
  });

  it("eğik çizgili saat kodlarını okur: 16/08, 08/16, 08/08", () => {
    const e = validateDraft(normalizeCells(cells({ 2: "16/08", 3: "08/16", 4: "08/08", 5: "Ek 16/08", 6: "G/N" }), ctx), []);
    const by = (d: string) => e.filter((x) => x.date === `2026-11-0${d}`);
    expect(by("2")[0]).toMatchObject({ start: "16:00", end: "08:00", startAt: "2026-11-02T16:00", endAt: "2026-11-03T08:00", hours: 16, overnight: true, category: "night" });
    expect(by("3")[0]).toMatchObject({ start: "08:00", end: "16:00", hours: 8, overnight: false, category: "day" });
    expect(by("4")[0]).toMatchObject({ endAt: "2026-11-05T08:00", hours: 24, category: "24h" });
    expect(by("5")[0]).toMatchObject({ hours: 16, isExtra: true });
    for (const x of [...by("2"), ...by("3"), ...by("4")]) {
      expect(x.confidence.time.level).toBe("high"); // saat hücrede yazılı
      expect(x.status).toBe("ok");
    }
    expect(by("6")).toHaveLength(2); // "G/N" kod birleşimi yine iki vardiyaya ayrılır
    expect(parseTimeRange("01/11/2026")).toBeNull(); // tarih saat sanılmaz
  });

  it("Excel'in tarihe çevirdiği 16/08 ve 08/08 hücrelerini geri kazanır", () => {
    const head = ["Adı Soyadı", ...Array.from({ length: 30 }, (_, i) => i + 1)];
    const row: unknown[] = ["Ayşe Yılmaz", ...Array(30).fill("")];
    row[1] = "08/16"; // ay 16 olamayacağı için Excel metin bırakır
    const grid = [["KASIM 2026"], head, row];
    const ws = XLSX.utils.aoa_to_sheet(grid);
    // Türkçe Excel'in yaptığı gibi: "16/08" → 16 Ağustos, "08/08" → 8 Ağustos (gün/ay biçimli tarih)
    ws[XLSX.utils.encode_cell({ r: 2, c: 2 })] = { t: "n", v: 46250, z: "dd/mm" };
    ws[XLSX.utils.encode_cell({ r: 2, c: 3 })] = { t: "n", v: 46242, z: "dd/mm" };
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "L");
    const r = parseExcel(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
    expect(r.rows[0].cells.map((c) => c.raw)).toEqual(["08/16", "16/08", "08/08"]);
  });

  it("çizelgedeki lejant saatlerini varsayılanların önüne koyar", () => {
    const e = normalizeCells(cells({ 2: "N" }), { ...ctx, legend: [{ code: "N", meaning: "Nöbet 20:00-08:00" }] });
    expect(e[0]).toMatchObject({ start: "20:00", end: "08:00", hours: 12 });
    expect(e[0].confidence.time.level).toBe("high");
  });

  it("saat bilgisi olmayan ve tanınmayan kodlar için saat uydurmaz", () => {
    const e = validateDraft(normalizeCells(cells({ 3: "EK", 5: "X9", 7: "Gece nöbeti" }), ctx), []);
    for (const x of e) {
      expect(x.startAt).toBeNull();
      expect(x.status).toBe("error");
    }
    expect(e[0].isExtra).toBe(true);
    expect(e[1].issues.map((i) => i.code)).toContain("unknown_code");
    expect(blockingEntries(e)).toHaveLength(3);
  });

  it("aynı hücredeki iki vardiyayı ayırır ve çakışmayı işaretler", () => {
    const e = validateDraft(normalizeCells(cells({ 6: "24 + G" }), ctx), []);
    expect(e).toHaveLength(2);
    expect(e.every((x) => x.issues.some((i) => i.code === "overlap"))).toBe(true);
    expect(e.every((x) => x.status === "check")).toBe(true);
  });

  it("takvimdeki aynı nöbeti mükerrer, farklı olanı çakışma olarak işaretler", () => {
    const existing: Shift[] = [
      { id: "1", date: "2026-11-01", startAt: "2026-11-01T08:00", endAt: "2026-11-01T16:00", code: "G", label: "Gündüz", category: "day", hours: 8, isExtra: false, department: "", note: "", source: "import", importId: "x", color: "" },
      { id: "2", date: "2026-11-02", startAt: "2026-11-02T08:00", endAt: "2026-11-02T16:00", code: "G", label: "Gündüz", category: "day", hours: 8, isExtra: false, department: "", note: "", source: "manual", importId: null, color: "" },
    ];
    const e = validateDraft(normalizeCells(cells({ 1: "G", 2: "24" }), ctx), existing);
    expect(e[0].status).toBe("duplicate");
    expect(e[1].issues.map((i) => i.code)).toContain("existing_conflict");
  });

  it("düşük okuma güvenli hücre elle doğrulanmadan onaylanamaz", () => {
    const e = validateDraft(normalizeCells([{ day: 1, raw: "G", readScore: 0.35, note: "silik" }], ctx), []);
    expect(e[0].confidence.overall.level).toBe("low");
    expect(e[0].status).toBe("error");
    e[0].verified = true;
    validateDraft(e, []);
    expect(e[0].status).toBe("ok");
  });
});

describe("Dosya doğrulama (güvenlik)", () => {
  it("uzantısı ile içeriği uyuşmayan dosyayı reddeder", () => {
    expect(() => validateFile("liste.pdf", Buffer.from("<html><script>alert(1)</script></html>"))).toThrow(FileRejected);
    expect(() => validateFile("foto.jpg", Buffer.from("%PDF-1.7 ...."))).toThrow(FileRejected);
    expect(() => validateFile("x.exe", Buffer.from("MZ......"))).toThrow(/Desteklenmeyen/);
  });
  it("makrolu Excel'i reddeder, gerçek XLSX'i kabul eder", () => {
    expect(validateFile("liste.xlsx", excelBuffer({ A: [["a"]] }))).toBe("xlsx");
    expect(() => validateFile("liste.xlsx", Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)]))).toThrow(FileRejected);
  });
});
