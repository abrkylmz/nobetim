import { useEffect, useState } from "react";
import { BadgeCheck, LogOut, Monitor, Moon, Palette, Plus, ShieldCheck, Sun, Tags, Trash2, UserRound } from "lucide-react";
import { CATEGORY_META, isWork, type ShiftCategory, type ShiftType } from "../../../shared/types";
import { api } from "../lib/api";
import { useApp, type ThemePref } from "../lib/app";
import { Alert, Card, Field, Modal, Spinner } from "../components/ui";
import { ProfileForm } from "../components/ProfileForm";

export function SettingsPage() {
  const { me, refreshMe, toast, theme, setTheme } = useApp();
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head"><div><h1>Ayarlar</h1><p className="muted">{me.email}</p></div></div>
      <div className="stack">
        <Card title="Profil" icon={<UserRound size={18} />}>
          <ProfileForm initial={me.profile!} submitLabel="Kaydet" onSubmit={async (p) => {
            try { await api.saveProfile(p); await refreshMe(); toast("Profil kaydedildi."); } catch (e) { toast((e as Error).message, "err"); }
          }} />
        </Card>
        <ShiftTypesCard />
        <Card title="Görünüm" icon={<Palette size={18} />}>
          <div className="seg">
            {([["system", "Sistem", Monitor], ["light", "Açık", Sun], ["dark", "Koyu", Moon]] as [ThemePref, string, typeof Sun][]).map(([k, t, I]) => (
              <button key={k} className={theme === k ? "on" : ""} onClick={() => setTheme(k)}><span className="row" style={{ gap: 6 }}><I size={15} />{t}</span></button>
            ))}
          </div>
        </Card>
        <Card title="Gizlilik ve veriler" icon={<ShieldCheck size={18} />}>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
            <li>Yüklediğin dosyalar sunucuda AES-256 ile şifreli saklanır ve en geç 30 gün sonra otomatik silinir. İstediğin an Dosya geçmişi'nden silebilirsin.</li>
            <li>Çizelgedeki diğer personelin nöbetleri çıkarılmaz ve saklanmaz. Kişi seçimi için okunan isim listesi onaydan sonra silinir.</li>
            <li>Fotoğraf ve taranmış PDF'ler, okunması için yalnızca yapay zekâ OCR servisine (Anthropic) gönderilir.</li>
          </ul>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn ghost" onClick={async () => { await api.logout(); location.hash = "/"; location.reload(); }}><LogOut size={18} />Çıkış yap</button>
            <DeleteAccount />
          </div>
        </Card>
      </div>
    </div>
  );
}

type Row = Omit<ShiftType, "id"> & { key: string };

function ShiftTypesCard() {
  const { toast } = useApp();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.shiftTypes().then((t) => setRows(t.map((x) => ({ ...x, key: x.id })))).catch(() => setRows([])); }, []);
  const set = (k: string, patch: Partial<Row>) => setRows((r) => r!.map((x) => (x.key === k ? { ...x, ...patch } : x)));

  return (
    <Card title="Vardiya kodları" icon={<Tags size={18} />}>
      <p className="small muted" style={{ marginBottom: 14 }}>
        Çizelgende kullanılan kısaltmaları ve saatlerini tanımla. Bitiş saati başlangıçtan küçükse nöbet ertesi güne sarkar (ör. 20:00–08:00 = 12 saat).
        <b> Onaysız</b> kodların saatleri varsayılandır; bu kodlarla okunan nöbetler “kontrol et” olarak işaretlenir.
      </p>
      {!rows ? <Spinner /> : (
        <div style={{ overflowX: "auto" }}>
          <table className="data" style={{ minWidth: 680 }}>
            <thead><tr><th>Kod</th><th>Ad</th><th>Tür</th><th>Başlangıç</th><th>Bitiş</th><th>Renk</th><th>Durum</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td><input className="input sm" style={{ width: 64 }} value={r.code} onChange={(e) => set(r.key, { code: e.target.value })} aria-label="Kod" /></td>
                  <td><input className="input sm" value={r.label} onChange={(e) => set(r.key, { label: e.target.value })} aria-label="Ad" /></td>
                  <td>
                    <select className="select sm" value={r.category} onChange={(e) => set(r.key, { category: e.target.value as ShiftCategory })} aria-label="Tür">
                      {Object.entries(CATEGORY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </td>
                  <td>{isWork(r.category) ? <input className="input sm" type="time" value={r.start ?? ""} onChange={(e) => set(r.key, { start: e.target.value || null, verified: true })} aria-label="Başlangıç" /> : <span className="faint">—</span>}</td>
                  <td>{isWork(r.category) ? <input className="input sm" type="time" value={r.end === "24:00" ? "00:00" : r.end ?? ""} onChange={(e) => set(r.key, { end: e.target.value || null, verified: true })} aria-label="Bitiş" /> : <span className="faint">—</span>}</td>
                  <td><input type="color" value={r.color} onChange={(e) => set(r.key, { color: e.target.value })} aria-label="Renk" style={{ width: 36, height: 30, border: 0, background: "none" }} /></td>
                  <td>{r.verified ? <span className="badge ok"><BadgeCheck size={12} />Onaylı</span> : (
                    <button className="btn ghost sm" onClick={() => set(r.key, { verified: true })}>Onayla</button>
                  )}</td>
                  <td><button className="iconbtn" onClick={() => setRows(rows.filter((x) => x.key !== r.key))} aria-label="Sil"><Trash2 size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn ghost sm" onClick={() => setRows([...(rows ?? []), { key: crypto.randomUUID(), code: "", label: "", category: "day", start: "08:00", end: "16:00", color: CATEGORY_META.day.color, verified: true }])}><Plus size={15} />Kod ekle</button>
        <button className="btn sm" disabled={busy || !rows} onClick={async () => {
          setBusy(true);
          try {
            const saved = await api.saveShiftTypes(rows!.filter((r) => r.code.trim()).map(({ key: _k, ...r }) => r));
            setRows(saved.map((x) => ({ ...x, key: x.id })));
            toast("Vardiya kodları kaydedildi.");
          } catch (e) { toast((e as Error).message, "err"); } finally { setBusy(false); }
        }}>{busy && <Spinner size={14} />}Kodları kaydet</button>
      </div>
    </Card>
  );
}

function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button className="btn danger" onClick={() => setOpen(true)}><Trash2 size={18} />Hesabımı ve tüm verilerimi sil</button>
      {open && (
        <Modal title="Hesabı sil" onClose={() => setOpen(false)} footer={<>
          <button className="btn ghost" onClick={() => setOpen(false)}>Vazgeç</button>
          <button className="btn danger" onClick={async () => {
            try { await api.deleteAccount(pw); location.hash = "/"; location.reload(); } catch (e) { setErr((e as Error).message); }
          }}>Kalıcı olarak sil</button>
        </>}>
          <p>Tüm nöbetlerin, yüklediğin dosyalar ve profilin kalıcı olarak silinir. Bu işlem geri alınamaz.</p>
          <div style={{ marginTop: 14 }}><Field label="Onay için parolan"><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field></div>
          {err && <div style={{ marginTop: 12 }}><Alert kind="err">{err}</Alert></div>}
        </Modal>
      )}
    </>
  );
}
