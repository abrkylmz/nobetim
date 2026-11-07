// Arayüz duman testi: gerçek tarayıcıda temel akışı sürer ve ekran görüntüsü alır.
// Kullanım: node tests/e2e/smoke.mjs <base-url> <çıktı-klasörü>
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import * as XLSX from "xlsx";

const base = process.argv[2] ?? "http://localhost:8787";
const out = process.argv[3] ?? "e2e-shots";
fs.mkdirSync(out, { recursive: true });
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome"].find(fs.existsSync);

// Örnek çizelge: içinde bulunulan ay, kullanıcı + 2 personel
const now = new Date();
const y = now.getFullYear(), m = now.getMonth() + 1, dim = new Date(y, m, 0).getDate();
const MONTHS = ["OCAK", "ŞUBAT", "MART", "NİSAN", "MAYIS", "HAZİRAN", "TEMMUZ", "AĞUSTOS", "EYLÜL", "EKİM", "KASIM", "ARALIK"];
const pattern = ["G", "N", "", "", "G", "24", "", "İ", "G", "GC", "", "R", "G", "", "08-16", "20:00-08:00", "", "G", "N", "", "EK"];
const row = (name, shift) => [name, "Hemşire", ...Array.from({ length: dim }, (_, i) => pattern[(i + shift) % pattern.length])];
const aoa = [
  ["ÖRNEK EĞİTİM VE ARAŞTIRMA HASTANESİ"],
  [`DAHİLİYE SERVİSİ ${MONTHS[m - 1]} ${y} ÇALIŞMA ÇİZELGESİ`],
  ["Adı Soyadı", "Ünvan", ...Array.from({ length: dim }, (_, i) => i + 1)],
  row("Ayşe Yılmaz", 0), row("Fatma Demir", 3), row("Zeynep Kaya", 7),
  [],
  ["G: Gündüz 08:00-16:00, N: Nöbet 16:00-08:00, GC: Gece 20:00-08:00, İ: İzin, R: Rapor"],
];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Liste");
const xlsxPath = path.resolve(out, "ornek-cizelge.xlsx");
fs.writeFileSync(xlsxPath, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--lang=tr-TR"] });
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 900 });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (msg) => msg.type() === "error" && errors.push(`console: ${msg.text()}`));
const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
const clickText = async (text, sel = "button, a") => {
  await page.waitForFunction((t, s) => [...document.querySelectorAll(s)].some((b) => b.textContent.includes(t) && !b.disabled), { timeout: 20000 }, text, sel);
  await page.evaluate((t, s) => [...document.querySelectorAll(s)].find((b) => b.textContent.includes(t) && !b.disabled).click(), text, sel);
};
const waitText = (text, timeout = 30000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const step = (s) => console.log("✓", s);

try {
  await page.goto(base, { waitUntil: "networkidle0" });
  await shot("01-giris");
  await clickText("Hesap oluştur");
  await page.type('input[type="email"]', `test${Date.now()}@ornek.com`);
  await page.type('input[type="password"]', "parola1234");
  await page.evaluate(() => document.querySelector("form button.btn").click());
  await waitText("Seni tanıyalım");
  step("kayıt");
  const inputs = await page.$$("form input");
  await inputs[0].type("Ayşe Yılmaz");
  await inputs[1].type("Örnek Eğitim ve Araştırma Hastanesi");
  await inputs[2].type("Dahiliye");
  await shot("02-profil");
  await clickText("Devam et");
  await waitText("Nöbet listeni yükle");
  step("profil");
  await shot("03-yukleme");

  const [chooser] = await Promise.all([page.waitForFileChooser(), clickText("Dosya seç")]);
  await chooser.accept([xlsxPath]);
  await waitText("ornek-cizelge.xlsx");
  await clickText("Yükle ve analiz et");
  await waitText("Analiz sonucu", 60000);
  step("yükleme ve analiz");
  await shot("04-analiz-sonucu");

  const summary = await page.evaluate(() => [...document.querySelectorAll(".summary-grid .s")].map((s) => s.innerText.replace(/\n/g, " ")));
  console.log("  özet:", summary.join(" | "));
  const blocked = await page.evaluate(() => [...document.querySelectorAll(".sticky-bar button")].find((b) => b.textContent.includes("Onayla")).disabled);
  console.log("  onay engelli mi (EK saatsiz):", blocked);

  // Hatalı kayıtları filtrele ve EK nöbetine saat gir
  await clickText("Hatalı (");
  await page.waitForSelector(".entry.status-error");
  await shot("05-hatali-kayitlar");
  const errCount = await page.$$eval(".entry.status-error", (l) => l.length);
  for (let i = 0; i < errCount; i++) {
    await page.waitForSelector(".entry.status-error .iconbtn[aria-label='Düzenle']");
    await page.click(".entry.status-error .iconbtn[aria-label='Düzenle']");
    await page.waitForSelector(".entry .edit input[type='time']");
    const times = await page.$$(".entry .edit input[type='time']");
    await times[0].click(); await page.keyboard.type("1600");
    await times[1].click(); await page.keyboard.type("0800");
    await page.evaluate(() => [...document.querySelectorAll(".entry .edit button")].find((b) => b.textContent.includes("Kaydet")).click());
    await page.waitForFunction((n) => document.querySelectorAll(".entry.status-error").length < n, { timeout: 10000 }, errCount - i);
  }
  step(`${errCount} hatalı kayıt düzeltildi`);
  await clickText("Tümü (");
  await shot("06-duzeltilmis");
  await clickText("Onayla ve takvime ekle");
  await waitText("Takvime ekle");
  await shot("07-onay-penceresi");
  await page.evaluate(() => [...document.querySelectorAll(".modal button")].find((b) => b.textContent.trim() === "Onayla").click());
  await waitText("Bu ay", 20000);
  await page.waitForSelector(".cal .pill");
  step("onay ve takvim");
  await shot("08-takvim-aylik");
  const pills = await page.$$eval(".cal .pill", (l) => l.length);
  console.log("  takvimdeki kayıt sayısı:", pills);

  await clickText("Haftalık");
  await page.waitForSelector(".week");
  await shot("09-takvim-haftalik");
  await clickText("Aylık");

  await page.goto(`${base}/#/`, { waitUntil: "networkidle0" });
  await waitText("Bu ay toplam çalışma");
  await new Promise((r) => setTimeout(r, 600));
  await shot("10-ana-sayfa");
  step("ana sayfa");
  await page.goto(`${base}/#/stats`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".chart svg, table.data");
  await new Promise((r) => setTimeout(r, 400));
  await shot("11-istatistik");
  step("istatistik");

  // Aynı dosyayı tekrar yükle → mükerrer uyarısı
  await page.goto(`${base}/#/upload`, { waitUntil: "networkidle0" });
  const [ch2] = await Promise.all([page.waitForFileChooser(), clickText("Dosya seç")]);
  await ch2.accept([xlsxPath]);
  await clickText("Yükle ve analiz et");
  await waitText("Bu dosya daha önce yüklenmiş", 60000);
  await shot("12-mukerrer");
  step("mükerrer yükleme uyarısı");
  // Büyük bir fotoğraf: tarayıcıda küçültülüp sunucu sınırına sığmalı
  const sharp = (await import("sharp")).default;
  const bigPhoto = path.resolve(out, "buyuk-fotograf.jpg");
  await sharp({ create: { width: 4200, height: 3000, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 40 } } }).jpeg({ quality: 92 }).toFile(bigPhoto);
  console.log("  ham fotoğraf boyutu (MB):", (fs.statSync(bigPhoto).size / 1024 / 1024).toFixed(1));
  await page.goto(`${base}/#/upload`, { waitUntil: "networkidle0" });
  const sent = [];
  page.on("request", (r) => r.url().endsWith("/api/imports") && r.method() === "POST" && sent.push(r.postData()?.length ?? 0));
  const [ch3] = await Promise.all([page.waitForFileChooser(), clickText("Dosya seç")]);
  await ch3.accept([bigPhoto]);
  await clickText("Yükle ve analiz et");
  await page.waitForFunction(() => /Çizelge okunamadı|Analiz sonucu|hangisi sensin/.test(document.body.innerText), { timeout: 60000 });
  console.log("  gönderilen istek boyutu (MB):", sent.length ? (sent[0] / 1024 / 1024).toFixed(2) : "?");
  await shot("12b-fotograf-sonucu");
  step("büyük fotoğraf küçültülüp yüklendi");

  await page.goto(`${base}/#/history`, { waitUntil: "networkidle0" });
  await waitText("Dosya geçmişi");
  await shot("13-gecmis");
  step("dosya geçmişi");

  // Mobil + koyu tema
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  // Temayı kullanıcının yaptığı gibi Ayarlar'dan değiştir
  await page.goto(`${base}/#/settings`, { waitUntil: "networkidle0" });
  await waitText("Görünüm");
  await clickText("Koyu", ".seg button");
  await page.goto(`${base}/#/`, { waitUntil: "networkidle0" });
  await waitText("Bu ay toplam çalışma");
  await new Promise((r) => setTimeout(r, 500));
  console.log("  tema:", await page.evaluate(() => [localStorage.getItem("nobetim.theme"), document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor].join(" ")));
  await shot("14-mobil-koyu-ana-sayfa");
  await page.goto(`${base}/#/calendar`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".cal .pill");
  await shot("15-mobil-koyu-takvim");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log("  mobilde yatay taşma (px):", overflow);
  step("mobil ve koyu tema");
} catch (e) {
  await shot("hata").catch(() => {});
  console.error("HATA:", e.message);
  process.exitCode = 1;
} finally {
  if (errors.length) console.log("Tarayıcı hataları:\n" + errors.join("\n"));
  await browser.close();
}
