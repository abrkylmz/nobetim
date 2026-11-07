import { useEffect, useRef, useState } from "react";
import { Camera, FileSpreadsheet, FileText, FolderOpen, Image as ImageIcon, Lightbulb, Trash2, UploadCloud } from "lucide-react";
import { api } from "../lib/api";
import { go, useApp } from "../lib/app";
import { Alert, Card, Spinner } from "../components/ui";
import { prepareForUpload } from "../lib/compress";

const ACCEPT = ".pdf,.xlsx,.xls,.csv,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png";
const MAX_PHOTO = 30 * 1024 * 1024; // ham fotoğraf; yüklemeden önce küçültülür
const isImage = (f: File) => /\.(jpe?g|png|webp)$/i.test(f.name) || f.type.startsWith("image/");
const extOk = (f: File) => /\.(pdf|xlsx|xls|csv|jpe?g|png|webp)$/i.test(f.name);

function fileIcon(f: File) {
  if (/\.(xlsx|xls|csv)$/i.test(f.name)) return <FileSpreadsheet size={22} />;
  if (/\.pdf$/i.test(f.name)) return <FileText size={22} />;
  return <ImageIcon size={22} />;
}

/** Kamera görüntüsünün dosya adı genelde "image.jpg" olur; anlamlı bir ad ver. */
function named(f: File): File {
  if (!/^image\.(jpe?g|png)$/i.test(f.name)) return f;
  const d = new Date();
  return new File([f], `Fotograf-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${d.getHours()}${d.getMinutes()}.jpg`, { type: f.type });
}

export function UploadPage() {
  const { me, toast } = useApp();
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const limit = me.uploadLimitBytes;
  const limitMb = Math.round(limit / 1024 / 1024);

  useEffect(() => () => Object.values(previews).forEach(URL.revokeObjectURL), [previews]);

  function add(list: FileList | File[]) {
    setError(null);
    const incoming = [...list].map(named);
    const bad = incoming.find((f) => !extOk(f));
    if (bad) return setError(`"${bad.name}" desteklenmiyor. PDF, Excel (XLSX/XLS) veya fotoğraf (JPG/PNG) yükle.`);
    const big = incoming.find((f) => f.size > (isImage(f) ? MAX_PHOTO : limit));
    if (big) return setError(isImage(big)
      ? `"${big.name}" çok büyük. Daha düşük çözünürlükte çek.`
      : `"${big.name}" ${limitMb} MB sınırını aşıyor. Yalnızca ilgili sayfaları içeren bir PDF veya Excel yükle.`);
    const next = [...files.filter(isImage), ...incoming];
    // Excel/PDF tek başına yüklenir; fotoğraflar (aynı listenin parçaları) birlikte
    const docs = next.filter((f) => !isImage(f));
    const final = docs.length ? [docs[docs.length - 1]] : next.slice(0, 6);
    if (docs.length && next.length > 1) toast("Excel ve PDF dosyaları tek tek yüklenir; son seçilen dosya alındı.");
    setFiles(final);
    const pv: Record<string, string> = {};
    for (const f of final) if (isImage(f)) pv[f.name + f.size] = URL.createObjectURL(f);
    setPreviews(pv);
  }

  async function submit() {
    setError(null);
    setProgress(0);
    try {
      const ready = await prepareForUpload(files, limit);
      if (ready.reduce((n, f) => n + f.size, 0) > limit) {
        setProgress(null);
        return setError(`Seçilen dosyalar toplamda ${limitMb} MB sınırını aşıyor. Daha az fotoğraf seç.`);
      }
      const res = await api.upload(ready, setProgress);
      if (res.duplicateOf) toast("Bu dosya daha önce de yüklenmiş. Takvimde zaten olan nöbetler tekrar eklenmeyecek.");
      go(`/imports/${res.id}`);
    } catch (e) {
      setError((e as Error).message);
      setProgress(null);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div>
          <h1>Nöbet listeni yükle</h1>
          <p className="muted">Servisinde paylaşılan çizelgeyi yükle; <b>{me.profile!.fullName}</b> satırını bulup nöbetlerini çıkaralım.</p>
        </div>
      </div>

      <div
        className={`dropzone ${over ? "over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
        onClick={() => pick.current?.click()}
        role="button" tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && pick.current?.click()}
        aria-label="Dosya seç veya buraya sürükle"
      >
        <div className="ic"><UploadCloud size={34} /></div>
        <h2>Dosyayı buraya sürükle</h2>
        <p className="muted" style={{ marginTop: 4 }}>ya da aşağıdan seç</p>
        <div className="row" style={{ justifyContent: "center", marginTop: 16 }} onClick={(e) => e.stopPropagation()}>
          <button className="btn" onClick={() => pick.current?.click()}><FolderOpen size={18} />Dosya seç</button>
          <button className="btn secondary" onClick={() => cam.current?.click()}><Camera size={18} />Fotoğraf çek</button>
        </div>
        <div className="formats">
          {["PDF", "XLSX", "XLS", "JPG", "PNG"].map((f) => <span key={f} className="badge neutral">{f}</span>)}
          <span className="badge neutral">PDF/Excel en fazla {limitMb} MB</span>
        </div>
        <input ref={pick} type="file" hidden multiple accept={ACCEPT} onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ""; }} />
        <input ref={cam} type="file" hidden accept="image/*" capture="environment" onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ""; }} />
      </div>

      {error && <div style={{ marginTop: 14 }}><Alert kind="err">{error}</Alert></div>}

      {files.length > 0 && (
        <div className="stack" style={{ marginTop: 18, gap: 10 }}>
          {files.map((f) => (
            <div className="file-row" key={f.name + f.size}>
              {previews[f.name + f.size] ? <img className="thumb" src={previews[f.name + f.size]} alt="" /> : <span className="thumb">{fileIcon(f)}</span>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</b>
                <span className="small muted">{(f.size / 1024 / 1024).toFixed(2)} MB</span>
              </div>
              {progress === null && <button className="iconbtn" onClick={() => setFiles(files.filter((x) => x !== f))} aria-label="Kaldır"><Trash2 size={18} /></button>}
            </div>
          ))}
          {files.length > 1 && <p className="small muted">{files.length} fotoğraf aynı çizelgenin parçaları olarak birlikte okunacak.</p>}
          {progress !== null && (
            <div>
              <div className="row between small" style={{ marginBottom: 6 }}><span>{progress < 100 ? "Yükleniyor…" : "Analiz başlatılıyor…"}</span><span className="tnum">%{progress}</span></div>
              <div className="progress"><div style={{ width: `${progress}%` }} /></div>
            </div>
          )}
          <button className="btn xl block" onClick={submit} disabled={progress !== null}>
            {progress !== null ? <Spinner /> : <UploadCloud size={20} />}Yükle ve analiz et
          </button>
        </div>
      )}

      {files.some(isImage) && !me.aiAvailable && (
        <div style={{ marginTop: 14 }}>
          <Alert kind="warn" title="Fotoğraf okuma şu an kapalı">Sunucuda OCR yapılandırılmamış. Mümkünse çizelgenin Excel veya PDF hâlini yükle.</Alert>
        </div>
      )}

      <div className="grid grid-2" style={{ marginTop: 22 }}>
        <Card title="İyi bir fotoğraf için" icon={<Lightbulb size={18} />}>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
            <li>Çizelgeyi düz bir yüzeye koy, tam üstten çek.</li>
            <li>Yalnızca tabloyu kadraja al; kenarları kesme.</li>
            <li>Işık yansımasını ve gölgeyi önle, netleşmesini bekle.</li>
            <li>Tablo büyükse iki parça hâlinde çekip birlikte yükleyebilirsin.</li>
          </ul>
        </Card>
        <Card title="Sonra ne olacak?" icon={<FileText size={18} />}>
          <ol className="small muted" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
            <li>Dosya okunur, çizelgede senin satırın bulunur.</li>
            <li>Nöbetlerin tarih, saat ve türüyle çıkarılır; her kayda güven puanı verilir.</li>
            <li>Kontrol ekranında düzeltirsin; <b>onaylayınca</b> takvime eklenir.</li>
          </ol>
        </Card>
      </div>
    </div>
  );
}
