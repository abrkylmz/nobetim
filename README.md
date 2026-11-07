# Nöbetim

Hemşirelerin hastane nöbet çizelgelerini (PDF, Excel, fotoğraf) yükleyip kendi çalışma programlarını otomatik oluşturduğu uygulama.

**Temel akış:** Çizelge yükle → senin satırın bulunur → nöbetler tarih, saat ve türüyle çıkarılır → kontrol ekranında düzelt → **Onayla** → takvim.

## Vercel'e yayınlama

Uygulama Vercel için hazırdır: arayüz statik olarak CDN'den, API tek bir Vercel Function (`api/index.ts`) olarak çalışır.

| Parça | Vercel'de | Yerelde |
|---|---|---|
| Veritabanı | Turso (libSQL) | `data/nobetim.db` dosyası |
| Yüklenen dosyalar | Vercel Blob, **private**, AES-256-GCM şifreli | `data/uploads/` (şifreli) |
| Arka plan analizi | `waitUntil`, en fazla 300 sn | aynı süreç |
| Saklama süresi temizliği | Vercel Cron (her gün 03:00 UTC) | saatlik zamanlayıcı |
| Yükleme sınırı | istek başına 4 MB (fotoğraflar tarayıcıda küçültülür) | 15 MB |

### Adımlar

1. **Projeyi içe aktar:** Kodu GitHub'a gönder, Vercel'de *Add New → Project* ile seç. `vercel.json` tüm ayarları içerir (Framework: Other, build `npm run build`, çıktı `web/dist`, bölge `dub1` (İrlanda)).
2. **Veritabanı:** Projede *Storage → Marketplace → Turso* entegrasyonunu ekle. Bölge olarak **EU West (Ireland) – dub1** seç (Vercel fonksiyonu da bu bölgede çalışır). Entegrasyon `TURSO_DATABASE_URL` ve `TURSO_AUTH_TOKEN` değişkenlerini ekler. Tablolar ilk istekte otomatik oluşturulur.
3. **Dosya deposu:** *Storage → Create → Blob* ile bir depo oluşturup projeye bağla (`BLOB_READ_WRITE_TOKEN` eklenir).
4. **Diğer ortam değişkenleri** (*Settings → Environment Variables*):
   - `FILE_ENCRYPTION_KEY`: Üretmek için `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Bir kez belirle, değiştirme.** Değişirse önceden yüklenmiş dosyalar okunamaz.
   - `CRON_SECRET`: Rastgele uzun bir değer. Vercel Cron bunu istekle birlikte gönderir.
   - `ANTHROPIC_API_KEY`: Fotoğraf ve taranmış PDF okuma için. Boş bırakılırsa yalnızca Excel ve metin PDF okunur.
   - İsteğe bağlı: `FILE_RETENTION_DAYS` (varsayılan 30).
5. **Deploy et.** Eksik bir değişken varsa API, eksik olanın adını içeren bir hata döner (ör. `Sunucu yapılandırması eksik: FILE_ENCRYPTION_KEY tanımlı değil`).

> **Plan notu:** Analiz fonksiyonu fotoğraflarda 1-2 dakika sürebilir. `maxDuration: 300`, Fluid Compute açıkken Hobby planında da geçerlidir. Cron Hobby planında günde bir kez çalışır; bu temizlik için yeterlidir.

## Yerel geliştirme

```bash
npm install
cp .env.example .env      # yerelde yalnızca ANTHROPIC_API_KEY gerekir (isteğe bağlı)
npm run dev               # arayüz http://localhost:5173, API 8787
# veya derleyip tek sunucu:
npm run build && npm start   # http://localhost:8787
```

Yerelde Turso/Blob değişkenleri verilmezse veriler `data/` klasöründe tutulur.

## Özellikler

| Modül | İçerik |
|---|---|
| Ana sayfa | Bir sonraki nöbet ve geri sayım, şu an nöbette olma durumu, aylık saat ve nöbet sayısı, yaklaşan nöbetler, aylık özet, son çizelge, “Nöbet Listemi Yükle” |
| Dosya okuma | Sürükle-bırak, dosya seçme, telefon kamerası; PDF (metin katmanı + taranmış PDF için OCR, çok sayfa), XLSX/XLS (tüm sayfalar, birleştirilmiş hücreler, tarih başlıkları), JPG/PNG (kalite ölçümü, iyileştirme, OCR) |
| Kişi eşleştirme | Türkçe karakter, büyük/küçük harf, ad sırası, ikinci ad, kısaltma, OCR yazım hatası; aynı isimde sicil/servisle ayırt etme; emin olunmayan eşleşmede seçim ekranı |
| Normalizasyon | Kod sözlüğü + çizelgedeki açıklama + saat aralığı (“08-16”, “20:00-08:00”); ertesi güne sarkma (20:00–08:00 = 12 sa, 08:00–08:00 = 24 sa); ek nöbet; tek hücrede birden çok vardiya |
| Kontrol ekranı | Alan bazlı güven puanı (okuma / tür / saat), Yüksek-Orta-Düşük seviyeler, düzenleme, silme, eksik nöbet ekleme, dönem düzeltme; düşük güvenli kayıt doğrulanmadan onaylanamaz |
| Takvim | Aylık/haftalık görünüm, renk kodları, gece nöbetinin ertesi güne devamı, resmî tatiller, elle ekleme/düzenleme/silme, çakışma uyarısı |
| İstatistik | Nöbet sayısı, toplam saat, gece ve hafta sonu nöbetleri, resmî tatil çalışması, fazla mesai, tahmini gelir, 12 aylık grafik + tablo |
| Dosya geçmişi | Durum, nöbet sayısı, onay, yeniden analiz, silme; aynı dosya tekrar yüklenince uyarı ve mükerrer kayıt engeli |

## Mimari

```
api/index.ts                  Vercel Function: Express uygulamasını sarar (soğuk başlangıçta bir kez kurulur)
server/config.ts              Ortam değişkenleri → ayarlar (Vercel / yerel)
server/app.ts                 Express API
server/db.ts                  libSQL (Turso) erişimi, şema ve göçler
server/fileStore.ts           Şifreli dosya deposu: Vercel Blob (private) veya yerel disk
server/importService.ts       Arka planda analiz, düzenleme, kişi seçimi, onay, temizlik
server/parsing/               ExcelParser, PdfParser, ImageParser, AiExtractor, TableAnalyzer,
                              PersonnelMatcher, ShiftNormalizer, ShiftValidator, pipeline
server/security/              Dosya türü ve içerik doğrulaması
shared/                       Ortak tipler, saat hesapları, resmî tatiller
web/                          React arayüzü (Vite)
tests/                        Birim + API + Vercel testleri, tarayıcı duman testi (tests/e2e)
```

## Güvenlik ve gizlilik

- E-posta + parola (scrypt), httpOnly / Secure / SameSite=Strict oturum çerezi, CSRF başlığı.
- Giriş ve yükleme hız sınırları veritabanında tutulur, tüm sunucu örneklerinde ortaktır.
- Her istek kullanıcıya göre filtrelenir; başka kullanıcının kaydı 404 döner.
- Dosyalar için uzantı ve içerik imzası eşleşmeli; makrolu Excel ve sıkıştırma bombaları reddedilir.
- Dosyalar şifreli ve özel (private) Blob'da, rastgele adla saklanır; **30 gün** sonra (ya da kullanıcı silince) silinir.
- Diğer personelin nöbetleri çıkarılmaz/saklanmaz; kişi seçimi için okunan isim listesi onaydan sonra silinir.
- Fotoğraf ve taranmış PDF'ler yalnızca OCR için Anthropic API'ye gönderilir; anahtar yalnızca sunucuda tutulur.
- Fonksiyon ve veritabanı İrlanda’da (AB) çalışır. Kişisel veri işlendiği için yayına almadan önce KVKK aydınlatma metni ve açık rıza ihtiyacını değerlendirin.

## Testler

```bash
npm test                      # 48 birim + API + Vercel testi
npm start & npm run test:e2e  # gerçek tarayıcıda (Chrome/Edge) temel akış + ekran görüntüleri
npx tsx tests/e2e/vercel-handler.ts 8788   # Vercel fonksiyonunu yerelde çalıştırır (duman testi bu adrese yönlendirilebilir)
```

İstenen 14 senaryonun hepsi testlerde var. Fotoğraf ve taranmış PDF senaryolarında yapay zekâ yanıtı sahte (mock) servisle verilir. Vercel Blob da taklit API ile test edilir.

## Bilinen sınırlar

- Fotoğraf/taranmış PDF okuma `ANTHROPIC_API_KEY` gerektirir. Canlı OCR doğruluğu gerçek çizelgelerle ayrıca denenmelidir.
- Vercel'de PDF/Excel dosyaları 4 MB ile sınırlı. Fotoğraflar otomatik küçültülür; çok büyük PDF'lerde yalnızca ilgili sayfalar yüklenmelidir.
- Eğik fotoğraflar geometrik olarak düzeltilmez; EXIF yönü ve kontrast düzeltilir, eğiklik OCR modelince tolere edilir.
- Dinî bayram tarihleri 2025–2027 için tanımlı (`shared/holidays.ts`); sonraki yıllar eklenmelidir.
- Fazla mesai, haftalık normdan (varsayılan 40 saat) hesaplanan bir tahmindir.
