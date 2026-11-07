# Nöbetim – Teknik Plan

## Mevcut durum (analiz)
İlk sürüm tek sayfalık bir Vite + TypeScript tarayıcı uygulamasıydı: Excel tarayıcıda okunuyor, fotoğraflar
tarayıcıdan doğrudan Claude'a gidiyor, veriler localStorage'da. Yeni gereksinimler (sunucu tarafı analiz,
yetkisiz erişime kapalı dosyalar, saklama/silme politikası, dosya geçmişi, çok ekranlı arayüz) bu yapıyla
karşılanamaz. Dil (TypeScript) ve araç (Vite) korunur; şu eklemeler yapılır:

| Katman | Seçim | Gerekçe |
|---|---|---|
| Sunucu | Node 24 + Express 5 + TypeScript (tsx) | Analiz sunucuda; API anahtarı tarayıcıya hiç inmez |
| Veritabanı | Postgres: Vercel'de Neon, yerelde PGlite | Vercel Storage ile birinci sınıf entegrasyon; testler gerçek Postgres motorunda koşar |
| Arayüz | React 19 + Vite + lucide-react + Inter | Çok ekranlı, düzenlenebilir formlar için bileşen yapısı |
| Excel | SheetJS (resmî dağıtım, 0.20.x) | Tüm sayfalar, birleştirilmiş hücreler, tarih hücreleri |
| PDF metni | pdfjs-dist (konum bilgili metin) | Tablo satır/sütunlarını koordinattan yeniden kurmak için |
| Görüntü | sharp | EXIF döndürme, kalite ölçümü (bulanıklık/ışık/çözünürlük), iyileştirme |
| OCR / taranmış PDF | Claude (`claude-opus-5-5`, görüntü + PDF girişi) | El yazısı/eğik tablolarda Tesseract yetersiz; hücre bazlı güven puanı döndürür |
| Test | Vitest | Parser, eşleştirme, normalizasyon, doğrulama ve uçtan uca API testleri |

## Analiz hattı (server/parsing)
```
dosya → FileValidator (uzantı + sihirli bayt + boyut)
      → ExcelParser | PdfParser | ImageParser  → RosterTable (kişi satırları, gün hücreleri, lejant, dönem)
      → PersonnelMatcher (profil adı/sicil ↔ satırlar)  → otomatik seçim / kullanıcı seçimi
      → ShiftNormalizer (kod → tür, saat, ertesi güne sarkma, süre)
      → ShiftValidator (çakışma, eksik saat, takvimdeki tekrarlar)
      → taslak (draft)  → kullanıcı kontrolü → Onayla → takvim
```
- Excel ve metin katmanlı PDF yerelde, deterministik çözülür. Tablo çözülemezse veya PDF taranmışsa Claude'a gider.
- Fotoğraflar sharp ile ön işlenir ve kalite ölçülür, ardından Claude ile okunur. Model okunamayan hücreleri
  ve fotoğraf sorunlarını bildirir; kötü kalitede kullanıcıdan kırpıp yeniden çekmesi istenir.
- Güven puanı (0–1) alan bazındadır: okuma (OCR), kod eşleme, saat. ≥0,85 yüksek, ≥0,60 orta, altı düşük.
  Düşük güvenli kayıtlar elle doğrulanmadan onaylanamaz.
- Saat bilgisi olmayan bilinmeyen kodlar için saat uydurulmaz; kayıt "eksik" olarak işaretlenir.

## Gizlilik ve güvenlik
- E-posta + parola (scrypt), httpOnly/SameSite=Strict oturum çerezi; tüm sorgular kullanıcıya göre filtrelenir.
- Yüklenen dosyalar diskte AES-256-GCM ile şifreli; varsayılan 30 gün sonra (veya kullanıcı silince) silinir.
- Diğer personellerin verileri saklanmaz: yalnızca kişi seçimi bitene kadar isim listesi tutulur, onayda silinir.
- 15 MB sınır, izinli türler, içerik imzası kontrolü, Excel satır/sayfa sınırı, görüntü piksel sınırı, yükleme hız sınırı.
- Aynı dosya (SHA-256) tekrar yüklenirse uyarılır; takvimde aynısı olan kayıtlar mükerrer oluşturulmaz.
