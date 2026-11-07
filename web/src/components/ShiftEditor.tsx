import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { CATEGORY_META, isWork, type Shift, type ShiftCategory, type ShiftType } from "../../../shared/types";
import { buildInterval } from "../../../shared/time";
import { api, ApiError } from "../lib/api";
import { useApp } from "../lib/app";
import { fmtDate, shiftRange } from "../lib/format";
import { Alert, Field, Modal, Spinner } from "./ui";

export function ShiftEditor({ shift, date, onClose, onSaved }: { shift?: Shift; date: string; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [types, setTypes] = useState<ShiftType[]>([]);
  const [f, setF] = useState({
    date: shift?.date ?? date, code: shift?.code ?? "", category: (shift?.category ?? "day") as ShiftCategory,
    start: shift?.startAt?.slice(11) ?? "08:00", end: shift?.endAt?.slice(11) ?? "16:00",
    isExtra: shift?.isExtra ?? false, note: shift?.note ?? "",
  });
  const [conflicts, setConflicts] = useState<Shift[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.shiftTypes().then((t) => {
      setTypes(t);
      if (!shift) {
        const g = t.find((x) => x.category === "day" && x.start);
        if (g) setF((p) => ({ ...p, code: g.code, start: g.start!, end: g.end! }));
      }
    }).catch(() => {});
  }, [shift]);

  const work = isWork(f.category);
  const interval = work ? buildInterval(f.date, f.start, f.end) : null;

  async function save(force = false) {
    setBusy(true); setError(null);
    const body = { ...f, start: work ? f.start : null, end: work ? f.end : null, force };
    try {
      if (shift) await api.updateShift(shift.id, body); else await api.addShift(body);
      toast(shift ? "Nöbet güncellendi." : "Nöbet eklendi.");
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflicts(e.body?.conflicts ?? []);
      else setError((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <Modal title={shift ? "Nöbeti düzenle" : "Nöbet ekle"} onClose={onClose} footer={<>
      {shift && <button className="btn danger" style={{ marginRight: "auto" }} onClick={async () => {
        if (!confirm("Bu nöbet silinsin mi?")) return;
        await api.deleteShift(shift.id); toast("Nöbet silindi."); onSaved();
      }}><Trash2 size={17} />Sil</button>}
      <button className="btn ghost" onClick={onClose}>Vazgeç</button>
      {conflicts ? (
        <button className="btn accent" disabled={busy} onClick={() => save(true)}>{busy && <Spinner />}Yine de kaydet</button>
      ) : (
        <button className="btn" disabled={busy} onClick={() => save()}>{busy && <Spinner />}Kaydet</button>
      )}
    </>}>
      <div className="grid grid-2">
        <Field label="Tarih"><input className="input" type="date" value={f.date} onChange={(e) => { setF({ ...f, date: e.target.value }); setConflicts(null); }} /></Field>
        <Field label="Kod">
          <select className="select" value={types.some((t) => t.code === f.code) ? f.code : ""} onChange={(e) => {
            const t = types.find((x) => x.code === e.target.value);
            if (t) setF({ ...f, code: t.code, category: t.category, start: t.start ?? f.start, end: t.end ?? f.end, isExtra: t.category === "extra" || f.isExtra });
            setConflicts(null);
          }}>
            <option value="">Kodsuz</option>
            {types.map((t) => <option key={t.id} value={t.code}>{t.code} · {t.label}</option>)}
          </select>
        </Field>
        <Field label="Nöbet türü">
          <select className="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as ShiftCategory })}>
            {Object.entries(CATEGORY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
        {work && <label className="check" style={{ alignSelf: "end", paddingBottom: 10 }}><input type="checkbox" checked={f.isExtra} onChange={(e) => setF({ ...f, isExtra: e.target.checked })} />Ek nöbet</label>}
        {work && <Field label="Başlangıç"><input className="input" type="time" value={f.start} onChange={(e) => { setF({ ...f, start: e.target.value }); setConflicts(null); }} /></Field>}
        {work && <Field label="Bitiş"><input className="input" type="time" value={f.end} onChange={(e) => { setF({ ...f, end: e.target.value }); setConflicts(null); }} /></Field>}
      </div>
      <div style={{ marginTop: 12 }}><Field label="Not"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="İsteğe bağlı" /></Field></div>
      {interval && (
        <p className="small muted" style={{ marginTop: 12 }}>
          Süre: <b style={{ color: "var(--text)" }}>{interval.hours} saat</b>
          {interval.overnight && <> · ertesi gün ({fmtDate(interval.endAt.slice(0, 10))}) {interval.endAt.slice(11)}'de biter</>}
        </p>
      )}
      {conflicts && (
        <div style={{ marginTop: 12 }}>
          <Alert kind="warn" title="Bu saatlerde başka kayıt var">
            <ul>{conflicts.map((c) => <li key={c.id}>{fmtDate(c.date)} · {c.label} · {shiftRange(c)}</li>)}</ul>
          </Alert>
        </div>
      )}
      {error && <div style={{ marginTop: 12 }}><Alert kind="err">{error}</Alert></div>}
    </Modal>
  );
}
