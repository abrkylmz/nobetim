import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import {
  AYSE, FATMA, badPhoto, emptyAi, excelBuffer, hasFont, makeApp, mockAi, okPhoto, patch, pdfBuffer, post,
  rosterGrid, scannedPdf, signedIn, uploadAndWait,
} from "./helpers";

let apps: Awaited<ReturnType<typeof makeApp>>[] = [];
const app = async (ai = mockAi()) => { const a = await makeApp(ai); apps.push(a); return a; };
afterEach(() => { apps.forEach((a) => a.cleanup()); apps = []; });

const novExcel = () => excelBuffer({ Kasım: rosterGrid([{ name: "Ayşe Yılmaz", days: AYSE }, { name: "Fatma Demir", days: FATMA }]) });

describe("Temel akış: yükle → otomatik çıkar → kontrol → onay → takvim", () => {
  it("Excel (senaryo 4) ve gece nöbetinin ertesi güne sarkması (senaryo 10)", async () => {
    const a = await app();
    const agent = await signedIn(a);
    const { res, detail } = await uploadAndWait(a, agent, [{ name: "kasım listesi.xlsx", buffer: novExcel() }]);
    expect(res.status).toBe(202);
    expect(detail.status).toBe("review");
    expect(detail.fileName).toBe("kasım listesi.xlsx");
    expect(detail.personName).toBe("Ayşe Yılmaz");
    expect([detail.periodYear, detail.periodMonth]).toEqual([2026, 11]);
    expect(detail.draft).toHaveLength(Object.keys(AYSE).length);

    // Çizelgedeki lejant (G: 08:00-16:00 ...) saatleri yüksek güvenle kullanıldı
    const g = detail.draft.find((e: any) => e.date === "2026-11-01");
    expect(g).toMatchObject({ category: "day", startAt: "2026-11-01T08:00", endAt: "2026-11-01T16:00", status: "ok" });

    // Onay öncesi takvim boş
    expect((await agent.get("/api/shifts?from=2026-11-01&to=2026-11-30")).body).toHaveLength(0);

    const c = await post(agent, `/api/imports/${detail.id}/confirm`, {});
    expect(c.status).toBe(200);
    expect(c.body.saved).toBe(Object.keys(AYSE).length);

    const shifts = (await agent.get("/api/shifts?from=2026-11-01&to=2026-11-30")).body;
    const n30 = shifts.find((s: any) => s.date === "2026-11-30");
    expect(n30).toMatchObject({ startAt: "2026-11-30T16:00", endAt: "2026-12-01T08:00", hours: 16 });
    const gc = shifts.find((s: any) => s.date === "2026-11-16");
    expect(gc.hours).toBe(12);

    // Aralık başında 30 Kasım nöbetinden sarkan 8 saat Aralık'a sayılır
    const dec = (await agent.get("/api/stats?year=2026&month=12")).body.month;
    expect(dec.workHours).toBe(8);
    const nov = (await agent.get("/api/stats?year=2026&month=11")).body.month;
    expect(nov.leaveDays).toBe(1);
    expect(nov.sickDays).toBe(1);
    expect(nov.nightShifts).toBeGreaterThanOrEqual(4);
  });

  it.runIf(hasFont)("metin katmanlı ve çok sayfalı PDF (senaryo 1, 3)", async () => {
    const a = await app();
    const agent = await signedIn(a);
    const pdf = await pdfBuffer([
      rosterGrid([{ name: "Ayşe Yılmaz", days: AYSE }, { name: "Fatma Demir", days: FATMA }], 1, 15),
      rosterGrid([{ name: "Ayşe Yılmaz", days: AYSE }], 16, 30),
    ]);
    const { detail } = await uploadAndWait(a, agent, [{ name: "liste.pdf", buffer: pdf }]);
    expect(detail.source).toBe("pdf-text");
    expect(detail.status).toBe("review");
    expect(detail.draft.map((e: any) => +e.date.slice(8))).toEqual(Object.keys(AYSE).map(Number));
    expect((a as any).imports && true).toBe(true);
  });

  it("taranmış PDF OCR ile okunur (senaryo 2)", async () => {
    const ai = mockAi(() => emptyAi({
      people: [{ name: "Ayşe Yılmaz", staffNo: "", title: "Hemşire" }, { name: "Fatma Demir", staffNo: "", title: "" }],
      targetRows: [{ name: "Ayşe Yılmaz", staffNo: "", title: "Hemşire", cells: [
        { day: 1, text: "G", confidence: "high", note: "" },
        { day: 2, text: "N", confidence: "medium", note: "silik" },
      ] }],
      legend: [{ code: "N", meaning: "Nöbet 16:00-08:00" }, { code: "G", meaning: "Gündüz 08:00-16:00" }],
    }));
    const a = await app(ai);
    const agent = await signedIn(a);
    const { detail } = await uploadAndWait(a, agent, [{ name: "tarama.pdf", buffer: await scannedPdf() }]);
    expect(ai.calls[0].source.kind).toBe("pdf");
    expect(ai.calls[0].target.fullName).toBe("Ayşe Yılmaz");
    expect(detail.source).toBe("pdf-scan");
    expect(detail.status).toBe("review");
    const n = detail.draft.find((e: any) => e.code === "N");
    expect(n.confidence.read.level).toBe("medium");
    expect(n.status).toBe("check");
  });

  it("fotoğraf OCR ile okunur, alan bazlı güven puanı taşır (senaryo 6)", async () => {
    const ai = mockAi(() => emptyAi({
      people: [{ name: "Ayşe Yılmaz", staffNo: "", title: "" }],
      targetRows: [{ name: "Ayşe Yılmaz", staffNo: "", title: "", cells: [
        { day: 3, text: "G", confidence: "high", note: "" },
        { day: 4, text: "6", confidence: "low", note: "el yazısı belirsiz" },
      ] }],
    }));
    const a = await app(ai);
    const agent = await signedIn(a);
    const { detail } = await uploadAndWait(a, agent, [{ name: "foto.jpg", buffer: await okPhoto() }]);
    expect(ai.calls[0].source.kind).toBe("image");
    expect(detail.quality).toBeTruthy();
    const low = detail.draft.find((e: any) => e.date === "2026-11-04");
    expect(low.confidence.read.level).toBe("low");
    expect(low.status).toBe("error");
    // Düşük güvenli kayıt düzeltilmeden onay yok
    expect((await post(agent, `/api/imports/${detail.id}/confirm`)).status).toBe(422);
    await patch(agent, `/api/imports/${detail.id}/entries/${low.id}`, { code: "G" }).expect(200);
    expect((await post(agent, `/api/imports/${detail.id}/confirm`)).status).toBe(200);
  });

  it("eğik ve düşük kaliteli fotoğrafta yeniden çekim istenir (senaryo 7)", async () => {
    const ai = mockAi();
    const a = await app(ai);
    const agent = await signedIn(a);
    const { detail } = await uploadAndWait(a, agent, [{ name: "kotu.jpg", buffer: await badPhoto() }]);
    expect(detail.status).toBe("failed");
    expect(detail.error).toMatch(/düşük kalitede/);
    expect(ai.calls).toHaveLength(0); // gereksiz OCR çağrısı yapılmaz
  });
});

describe("Kişi eşleştirme", () => {
  it("Türkçe karakter farkı otomatik eşleşir (senaryo 8)", async () => {
    const a = await app();
    const agent = await signedIn(a, { fullName: "Sukran Caglayan" });
    const buf = excelBuffer({ L: rosterGrid([{ name: "ŞÜKRAN ÇAĞLAYAN", days: { 1: "G" } }, { name: "Fatma Demir", days: FATMA }]) });
    const { detail } = await uploadAndWait(a, agent, [{ name: "l.xlsx", buffer: buf }]);
    expect(detail.status).toBe("review");
    expect(detail.personName).toBe("ŞÜKRAN ÇAĞLAYAN");
  });

  it("aynı isimli personelde seçim istenir (senaryo 9)", async () => {
    const a = await app();
    const agent = await signedIn(a);
    const buf = excelBuffer({ L: rosterGrid([
      { name: "Ayşe Yılmaz", staffNo: "1001", days: { 1: "G" } },
      { name: "Ayşe Yılmaz", staffNo: "2002", days: { 2: "N", 3: "G" } },
    ]) });
    const { detail } = await uploadAndWait(a, agent, [{ name: "l.xlsx", buffer: buf }]);
    expect(detail.status).toBe("needs_selection");
    expect(detail.candidates.map((c: any) => c.staffNo)).toEqual(expect.arrayContaining(["1001", "2002"]));
    const key = detail.candidates.find((c: any) => c.staffNo === "2002").key;
    await post(agent, `/api/imports/${detail.id}/select`, { key }).expect(202);
    await a.imports.idle();
    const d2 = (await agent.get(`/api/imports/${detail.id}`)).body;
    expect(d2.status).toBe("review");
    expect(d2.draft.map((e: any) => e.date)).toEqual(["2026-11-02", "2026-11-03"]);
  });

  it("yanlış kişi otomatik seçilmez; OCR'da seçilen kişinin satırı yeniden okunur (senaryo 14)", async () => {
    const ai = mockAi((_s, t) => t.selectedName
      ? emptyAi({ targetRows: [{ name: t.selectedName, staffNo: "", title: "", cells: [{ day: 5, text: "G", confidence: "high", note: "" }] }] })
      : emptyAi({ people: [{ name: "Ayşe Yılmazer", staffNo: "", title: "" }, { name: "Ayten Yıldız", staffNo: "", title: "" }] }));
    const a = await app(ai);
    const agent = await signedIn(a);
    const { detail } = await uploadAndWait(a, agent, [{ name: "f.jpg", buffer: await okPhoto() }]);
    expect(detail.status).toBe("needs_selection");
    expect(detail.draft).toHaveLength(0);
    const key = detail.candidates.find((c: any) => c.name === "Ayşe Yılmazer").key;
    await post(agent, `/api/imports/${detail.id}/select`, { key }).expect(202);
    await a.imports.idle();
    const d2 = (await agent.get(`/api/imports/${detail.id}`)).body;
    expect(ai.calls.at(-1)!.target.selectedName).toBe("Ayşe Yılmazer");
    expect(d2.status).toBe("review");
    expect(d2.draft[0].date).toBe("2026-11-05");
  });
});

describe("Doğrulama", () => {
  it("eksik saat bilgisi onayı engeller, düzeltilince onaylanır (senaryo 11)", async () => {
    const a = await app();
    const agent = await signedIn(a);
    const buf = excelBuffer({ L: rosterGrid([{ name: "Ayşe Yılmaz", days: { 1: "G", 2: "EK", 3: "Q7" } }]) });
    const { detail } = await uploadAndWait(a, agent, [{ name: "l.xlsx", buffer: buf }]);
    const ek = detail.draft.find((e: any) => e.date === "2026-11-02");
    const q = detail.draft.find((e: any) => e.date === "2026-11-03");
    expect(ek.startAt).toBeNull();
    expect(ek.status).toBe("error");
    expect(q.issues.map((i: any) => i.code)).toContain("unknown_code");
    expect((await post(agent, `/api/imports/${detail.id}/confirm`)).status).toBe(422);

    await patch(agent, `/api/imports/${detail.id}/entries/${ek.id}`, { start: "16:00", end: "08:00" }).expect(200);
    await patch(agent, `/api/imports/${detail.id}/entries/${q.id}`, { excluded: true }).expect(200);
    const c = await post(agent, `/api/imports/${detail.id}/confirm`);
    expect(c.status).toBe(200);
    expect(c.body.saved).toBe(2);
    const shifts = (await agent.get("/api/shifts?from=2026-11-01&to=2026-11-30")).body;
    expect(shifts.find((s: any) => s.date === "2026-11-02")).toMatchObject({ isExtra: true, hours: 16 });
  });

  it("çakışan nöbetler işaretlenir (senaryo 12)", async () => {
    const a = await app();
    const agent = await signedIn(a);
    await post(agent, "/api/shifts", { date: "2026-11-01", category: "day", code: "G", start: "08:00", end: "16:00" }).expect(201);
    const buf = excelBuffer({ L: rosterGrid([{ name: "Ayşe Yılmaz", days: { 1: "24", 5: "24 + G" } }]) });
    const { detail } = await uploadAndWait(a, agent, [{ name: "l.xlsx", buffer: buf }]);
    const d1 = detail.draft.find((e: any) => e.date === "2026-11-01");
    expect(d1.issues.map((i: any) => i.code)).toContain("existing_conflict");
    const d5 = detail.draft.filter((e: any) => e.date === "2026-11-05");
    expect(d5).toHaveLength(2);
    expect(d5.every((e: any) => e.issues.some((i: any) => i.code === "overlap"))).toBe(true);

    // Elle eklemede çakışma 409 döner
    expect((await post(agent, "/api/shifts", { date: "2026-11-01", category: "day", start: "10:00", end: "14:00" })).status).toBe(409);

    await post(agent, `/api/imports/${detail.id}/confirm`, { replaceConflicts: true }).expect(200);
    const nov1 = (await agent.get("/api/shifts?from=2026-11-01&to=2026-11-01")).body.filter((s: any) => s.date === "2026-11-01");
    expect(nov1).toHaveLength(1);
    expect(nov1[0].hours).toBe(24);
  });

  it("aynı dosya tekrar yüklenirse uyarılır ve mükerrer nöbet oluşmaz (senaryo 13)", async () => {
    const a = await app();
    const agent = await signedIn(a);
    const first = await uploadAndWait(a, agent, [{ name: "l.xlsx", buffer: novExcel() }]);
    await post(agent, `/api/imports/${first.detail.id}/confirm`).expect(200);

    const second = await uploadAndWait(a, agent, [{ name: "l (1).xlsx", buffer: novExcel() }]);
    expect(second.res.body.duplicateOf?.id).toBe(first.detail.id);
    expect(second.detail.duplicateOf).toBe(first.detail.id);
    expect(second.detail.draft.every((e: any) => e.status === "duplicate")).toBe(true);
    const c = await post(agent, `/api/imports/${second.detail.id}/confirm`);
    expect(c.body).toMatchObject({ saved: 0, skipped: Object.keys(AYSE).length });
    expect((await agent.get("/api/shifts?from=2026-11-01&to=2026-11-30")).body).toHaveLength(Object.keys(AYSE).length);

    // Onaylanmış çizelgeyi yeniden analiz edip onaylamak da kayıtları çoğaltmaz
    await post(agent, `/api/imports/${first.detail.id}/reanalyze`).expect(202);
    await a.imports.idle();
    await post(agent, `/api/imports/${first.detail.id}/confirm`).expect(200);
    expect((await agent.get("/api/shifts?from=2026-11-01&to=2026-11-30")).body).toHaveLength(Object.keys(AYSE).length);
  });

  it("dönem değiştirilebilir", async () => {
    const a = await app();
    const agent = await signedIn(a);
    const { detail } = await uploadAndWait(a, agent, [{ name: "l.xlsx", buffer: novExcel() }]);
    const r = await post(agent, `/api/imports/${detail.id}/period`, { year: 2027, month: 2 });
    expect(r.body.draft.every((e: any) => e.date.startsWith("2027-02"))).toBe(true);
    expect(r.body.draft.some((e: any) => e.date === "2027-02-30")).toBe(false);
  });
});

describe("Güvenlik ve gizlilik", () => {
  it("diğer personelin verileri onaydan sonra saklanmaz", async () => {
    const a = await app();
    const agent = await signedIn(a);
    const { detail } = await uploadAndWait(a, agent, [{ name: "l.xlsx", buffer: novExcel() }]);
    await post(agent, `/api/imports/${detail.id}/confirm`).expect(200);
    const rows = (await a.db.execute("SELECT * FROM imports")).rows;
    expect(JSON.stringify(rows)).not.toContain("Fatma");
    // Saklanan dosya şifreli
    const files = fs.readdirSync(path.join(a.dataDir, "uploads"));
    expect(files).toHaveLength(1);
    const raw = fs.readFileSync(path.join(a.dataDir, "uploads", files[0]));
    expect(raw.includes(Buffer.from("xl/"))).toBe(false);
  });

  it("başka kullanıcının kayıtlarına erişilemez", async () => {
    const a = await app();
    const u1 = await signedIn(a);
    const u2 = await signedIn(a, { fullName: "Fatma Demir" });
    const { detail } = await uploadAndWait(a, u1, [{ name: "l.xlsx", buffer: novExcel() }]);
    expect((await u2.get(`/api/imports/${detail.id}`)).status).toBe(404);
    expect((await post(u2, `/api/imports/${detail.id}/confirm`)).status).toBe(404);
    expect((await request(a.app).get("/api/imports")).status).toBe(401);
  });

  it("geçersiz dosya, CSRF başlığı eksikliği ve saklama süresi", async () => {
    const a = await app();
    const agent = await signedIn(a);
    const bad = await agent.post("/api/imports").set("X-Nobetim", "1").attach("files", Buffer.from("<script>"), "liste.pdf");
    expect(bad.status).toBe(400);
    expect((await agent.post("/api/shifts").send({})).status).toBe(403);

    const { detail } = await uploadAndWait(a, agent, [{ name: "l.xlsx", buffer: novExcel() }]);
    expect(detail.fileAvailable).toBe(true);
    await a.imports.cleanup(Date.now() + 31 * 86_400_000);
    const after = (await agent.get(`/api/imports/${detail.id}`)).body;
    expect(after.fileAvailable).toBe(false);
    expect(fs.readdirSync(path.join(a.dataDir, "uploads"))).toHaveLength(0);
    expect((await post(agent, `/api/imports/${detail.id}/reanalyze`)).status).toBe(410);
  });
});
