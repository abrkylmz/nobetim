import { useState } from "react";
import type { Profile } from "../../../shared/types";
import { Field, Spinner } from "./ui";
import { PaySettings } from "./PaySettings";

export const emptyProfile: Profile = { fullName: "", hospital: "", department: "", staffNo: "", weeklyHours: 40, overtimeRate: 0, holidayRate: 0, payGroup: "", payRisky: false };

export function ProfileForm({ initial, onSubmit, submitLabel, compact }: {
  initial: Profile; onSubmit: (p: Profile) => Promise<void>; submitLabel: string; compact?: boolean;
}) {
  const [p, setP] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((x) => ({ ...x, [k]: v }));
  return (
    <form className="stack" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await onSubmit(p); } finally { setBusy(false); } }}>
      <Field label="Ad soyad" hint="Çizelgede yazdığı gibi, ör. Ayşe Nur Yılmaz">
        <input className="input" required value={p.fullName} onChange={(e) => set("fullName", e.target.value)} autoComplete="name" />
      </Field>
      <div className="grid grid-2">
        <Field label="Hastane"><input className="input" value={p.hospital} onChange={(e) => set("hospital", e.target.value)} /></Field>
        <Field label="Servis"><input className="input" value={p.department} onChange={(e) => set("department", e.target.value)} placeholder="ör. Dahiliye" /></Field>
      </div>
      <Field label="Sicil numarası (isteğe bağlı)" hint="Aynı isimli personel varsa doğru satırı seçmek için kullanılır">
        <input className="input" inputMode="numeric" value={p.staffNo} onChange={(e) => set("staffNo", e.target.value)} />
      </Field>
      {!compact && (
        <PaySettings p={p} set={set} />
      )}
      <div><button className="btn" disabled={busy}>{busy && <Spinner />}{submitLabel}</button></div>
    </form>
  );
}
