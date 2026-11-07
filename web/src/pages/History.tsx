import { useState } from "react";
import { AlertTriangle, Copy, FileClock, FileSpreadsheet, FileText, Image as ImageIcon, RotateCcw, ShieldCheck, Trash2, Upload } from "lucide-react";
import type { ImportStatus, ImportSummary } from "../../../shared/types";
import { api } from "../lib/api";
import { go, useApp, useLoad } from "../lib/app";
import { fmtDateTime, MONTHS } from "../lib/format";
import { Alert, Empty, Modal, Skeleton, Spinner } from "../components/ui";

const STATUS: Record<ImportStatus, { text: string; cls: string }> = {
  processing: { text: "Analiz ediliyor", cls: "info" },
  needs_selection: { text: "Kişi seçimi bekliyor", cls: "warn" },
  review: { text: "Onay bekliyor", cls: "warn" },
  confirmed: { text: "Onaylandı", cls: "ok" },
  failed: { text: "Okunamadı", cls: "err" },
  discarded: { text: "Reddedildi", cls: "neutral" },
};

export const StatusBadge = ({ status }: { status: ImportStatus }) => (
  <span className={`badge ${STATUS[status].cls}`}>{status === "processing" && <Spinner size={12} />}{STATUS[status].text}</span>
);

const sourceIcon = (i: ImportSummary) =>
  /\.(xlsx|xls|csv)$/i.test(i.fileName) ? <FileSpreadsheet size={20} /> : /\.pdf$/i.test(i.fileName) ? <FileText size={20} /> : <ImageIcon size={20} />;

export function HistoryPage() {
  const { toast } = useApp();
  const { data, loading, reload } = useLoad(() => api.imports(), []);
  const [del, setDel] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reanalyze = async (i: ImportSummary) => {
    setBusy(i.id);
    try { await api.reanalyze(i.id); go(`/imports/${i.id}`); } catch (e) { toast((e as Error).message, "err"); } finally { setBusy(null); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Dosya geçmişi</h1>
          <p className="muted">Yüklediğin çizelgeler, analiz ve onay durumları.</p>
        </div>
        <a className="btn" href="#/upload"><Upload size={18} />Yeni çizelge</a>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Alert kind="info" title="Saklama politikası">
          <span className="row" style={{ gap: 6 }}><ShieldCheck size={15} />Dosyalar şifreli saklanır ve 30 gün sonra otomatik silinir. Takvimdeki nöbetlerin silinmez. Diğer personelin bilgileri saklanmaz.</span>
        </Alert>
      </div>

      {loading && !data ? <div className="stack">{[1, 2, 3].map((k) => <Skeleton key={k} h={82} r={16} />)}</div> : !data?.length ? (
        <div className="card"><Empty icon={<FileClock size={28} />} title="Henüz dosya yüklemedin">İlk nöbet çizelgeni yükleyerek başla.</Empty></div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {data.map((i) => (
            <div key={i.id} className="card pad-sm">
              <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
                <span className="kpi-icon">{sourceIcon(i)}</span>
                <a href={`#/imports/${i.id}`} style={{ flex: 1, minWidth: 0, color: "inherit" }}>
                  <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.fileName}</b>
                  <span className="small muted">
                    {fmtDateTime(i.createdAt)}
                    {i.periodMonth && ` · ${MONTHS[i.periodMonth - 1]} ${i.periodYear}`}
                    {i.status !== "failed" && i.status !== "processing" && ` · ${i.shiftCount} nöbet`}
                    {i.personName && ` · ${i.personName}`}
                  </span>
                  <span className="row" style={{ gap: 6, marginTop: 6 }}>
                    <StatusBadge status={i.status} />
                    {i.confirmedAt && <span className="badge neutral">Onay: {fmtDateTime(i.confirmedAt)}</span>}
                    {i.duplicateOf && <span className="badge warn"><Copy size={12} />Olası tekrar yükleme</span>}
                    {!i.fileAvailable && i.status !== "discarded" && <span className="badge neutral">Dosya silindi</span>}
                    {i.status === "failed" && i.error && <span className="small" style={{ color: "var(--err)" }}><AlertTriangle size={13} /> {i.error}</span>}
                  </span>
                </a>
                <div className="row" style={{ gap: 4 }}>
                  {i.fileAvailable && i.status !== "processing" && (
                    <button className="btn ghost sm" disabled={busy === i.id} onClick={() => reanalyze(i)} title="Yeniden analiz et">
                      {busy === i.id ? <Spinner size={14} /> : <RotateCcw size={15} />}<span className="hide-sm">Yeniden analiz</span>
                    </button>
                  )}
                  {i.status !== "processing" && <button className="iconbtn" onClick={() => setDel(i)} aria-label="Sil"><Trash2 size={18} /></button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {del && <DeleteDialog item={del} onClose={() => setDel(null)} onDone={(n) => { setDel(null); void reload(); toast(n ? `Çizelge ve takvimdeki ${n} nöbet silindi.` : "Çizelge silindi."); }} />}
    </div>
  );
}

/** Çizelgeyi tamamen sil: kayıt, saklanan dosya ve (varsayılan olarak) takvime eklenen nöbetler. */
export function DeleteDialog({ item, onClose, onDone }: { item: ImportSummary; onClose: () => void; onDone: (removedShifts: number) => void }) {
  const confirmed = item.status === "confirmed";
  const [shifts, setShifts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Çizelgeyi sil" onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Vazgeç</button>
      <button className="btn danger" disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try { const r = await api.removeImport(item.id, confirmed && shifts); onDone(r.removedShifts); }
        catch (e) { setError((e as Error).message); setBusy(false); }
      }}>{busy ? <Spinner /> : <Trash2 size={17} />}Kalıcı olarak sil</button>
    </>}>
      <p><b>{item.fileName}</b> çizelgesi ve saklanan dosyası kalıcı olarak silinecek.</p>
      {confirmed && (
        <>
          <label className="check" style={{ marginTop: 14 }}>
            <input type="checkbox" checked={shifts} onChange={(e) => setShifts(e.target.checked)} />
            Bu çizelgeden takvime eklenen <b>{item.shiftCount} nöbeti</b> de takvimden kaldır
          </label>
          {!shifts && <p className="small muted" style={{ marginTop: 8 }}>Nöbetler takvimde kalır ve elle eklenmiş gibi görünür.</p>}
        </>
      )}
      {error && <div style={{ marginTop: 12 }}><Alert kind="err">{error}</Alert></div>}
    </Modal>
  );
}
