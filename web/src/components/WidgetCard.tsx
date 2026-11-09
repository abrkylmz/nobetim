import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, RefreshCw, Smartphone, Unplug } from "lucide-react";
import { api, type WidgetStatus } from "../lib/api";
import { useApp } from "../lib/app";
import { Card, Modal, Spinner } from "./ui";

const SCRIPTABLE_URL = "https://apps.apple.com/app/scriptable/id1405459188";

async function buildScript(token: string) {
  const r = await fetch("/nobetim-widget.js", { cache: "no-store" });
  if (!r.ok) throw new Error("Widget betiği alınamadı.");
  return (await r.text()).replace("__BASE__", location.origin).replace("__TOKEN__", token);
}

/** Panoya kopyala. Safari, kullanıcı dokunuşundan sonra beklenen işlerde ClipboardItem + Promise ister. */
async function copyPromise(text: Promise<string>) {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": text.then((t) => new Blob([t], { type: "text/plain" })) })]);
      return true;
    }
    await navigator.clipboard.writeText(await text);
    return true;
  } catch {
    return false;
  }
}

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("tr-TR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "henüz yok");

export function WidgetCard() {
  const { toast } = useApp();
  const [status, setStatus] = useState<WidgetStatus | null>(null);
  const [script, setScript] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"rotate" | "revoke" | null>(null);

  useEffect(() => { api.widgetStatus().then(setStatus).catch(() => setStatus({ active: false, createdAt: null, lastUsedAt: null })); }, []);

  const create = async () => {
    setBusy(true); setConfirm(null); setCopied(false);
    const created = api.createWidgetToken();
    const text = created.then((c) => buildScript(c.token));
    const ok = await copyPromise(text);
    try {
      const c = await created;
      setStatus(c);
      setScript(await text);
      setCopied(ok);
      toast(ok ? "Betik kopyalandı. Şimdi Scriptable'a yapıştır." : "Bağlantı hazır. Betiği aşağıdan kopyala.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const copyAgain = async () => {
    if (!script) return;
    const ok = await copyPromise(Promise.resolve(script));
    setCopied(ok);
    toast(ok ? "Betik kopyalandı." : "Kopyalanamadı; metni seçip elle kopyala.", ok ? "ok" : "err");
  };

  const revoke = async () => {
    setBusy(true); setConfirm(null);
    try { await api.revokeWidgetToken(); setStatus({ active: false, createdAt: null, lastUsedAt: null }); setScript(null); toast("Widget bağlantısı kapatıldı."); }
    catch (e) { toast((e as Error).message, "err"); }
    finally { setBusy(false); }
  };

  return (
    <Card title="iPhone widget'ı" icon={<Smartphone size={18} />}>
      <p className="small muted" style={{ marginBottom: 14 }}>
        Sıradaki nöbetin ana ekranda ve kilit ekranında görünsün. Ücretsiz <b>Scriptable</b> uygulamasıyla çalışır; pembe ya da turkuaz temalıdır.
      </p>

      {status?.active && (
        <div className="widget-status">
          <span className="badge ok"><KeyRound size={13} />Bağlantı açık</span>
          <span className="tiny muted">Oluşturuldu: {fmtTime(status.createdAt)} · Son kullanım: {fmtTime(status.lastUsedAt)}</span>
        </div>
      )}

      <ol className="howto">
        <li>App Store'dan <a href={SCRIPTABLE_URL} target="_blank" rel="noreferrer">Scriptable</a> uygulamasını yükle.</li>
        <li>
          Aşağıdaki düğmeyle sana özel betiği kopyala.
          <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
            {!status?.active ? (
              <button className="btn" disabled={busy || !status} onClick={create}>{busy ? <Spinner /> : <Copy size={17} />}Betiği oluştur ve kopyala</button>
            ) : script ? (
              <button className="btn" onClick={copyAgain}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? "Kopyalandı" : "Betiği kopyala"}</button>
            ) : (
              <button className="btn" disabled={busy} onClick={() => setConfirm("rotate")}><RefreshCw size={17} />Yeni betik oluştur ve kopyala</button>
            )}
            {status?.active && (
              <button className="btn ghost" disabled={busy} onClick={() => setConfirm("revoke")}><Unplug size={17} />Bağlantıyı kapat</button>
            )}
          </div>
          {script && !copied && (
            <textarea className="input mono" readOnly rows={4} value={script} onFocus={(e) => e.currentTarget.select()} style={{ marginTop: 8, fontSize: 11 }} />
          )}
        </li>
        <li>Scriptable'ı aç, sağ üstteki <b>+</b> ile yeni betik oluştur ve yapıştır. Üstteki adı <b>Nöbetim</b> yap, <b>Bitti</b>'ye dokun.</li>
        <li>Ana ekranda boş bir yere basılı tut → <b>Düzenle</b> → <b>Widget Ekle</b> → <b>Scriptable</b> → boyutu seç.</li>
        <li>Eklenen widget'a basılı tut → <b>Widget'ı Düzenle</b> → Script: <b>Nöbetim</b>. Pembe tema için <b>Parameter</b> alanına <code>pembe</code> yaz.</li>
      </ol>
      <p className="tiny faint" style={{ marginTop: 10 }}>
        Kilit ekranı için: kilit ekranına basılı tut → Özelleştir → Kilit Ekranı → widget alanı → Scriptable.
        Betik sana özel bir anahtar içerir ve yalnızca nöbet saatlerini okuyabilir; kimseyle paylaşma. Telefonunu kaybedersen buradan bağlantıyı kapat.
      </p>

      {confirm && (
        <Modal title={confirm === "rotate" ? "Yeni betik oluşturulsun mu?" : "Bağlantı kapatılsın mı?"} onClose={() => setConfirm(null)}
          footer={<>
            <button className="btn ghost" onClick={() => setConfirm(null)}>Vazgeç</button>
            {confirm === "rotate"
              ? <button className="btn" onClick={create}><RefreshCw size={17} />Oluştur ve kopyala</button>
              : <button className="btn danger" onClick={revoke}><Unplug size={17} />Kapat</button>}
          </>}>
          <p className="small">
            {confirm === "rotate"
              ? "Eski betik çalışmayı bırakır. Yeni betiği Scriptable'daki Nöbetim betiğinin yerine yapıştırman gerekir."
              : "Telefonundaki widget nöbetleri göstermeyi bırakır. İstediğin zaman yeniden açabilirsin."}
          </p>
        </Modal>
      )}
    </Card>
  );
}
