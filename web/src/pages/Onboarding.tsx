import { useState } from "react";
import { UserRound } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../lib/app";
import { Alert } from "../components/ui";
import { ProfileForm, emptyProfile } from "../components/ProfileForm";

export function OnboardingPage() {
  const { refreshMe } = useApp();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="page" style={{ maxWidth: 620, paddingTop: 48 }}>
      <div className="kpi-icon" style={{ width: 56, height: 56, borderRadius: 18 }}><UserRound size={28} /></div>
      <h1 style={{ marginTop: 16 }}>Seni tanıyalım</h1>
      <p className="muted" style={{ marginTop: 6 }}>
        Yüklediğin çizelgede kendi satırını bulabilmemiz için adını <b>listede yazdığı gibi</b> gir.
        Aynı isimde başka bir personel varsa sicil numaran ve servisin ayırt etmeye yardım eder.
      </p>
      <div className="card" style={{ marginTop: 22 }}>
        <ProfileForm
          initial={emptyProfile}
          submitLabel="Devam et"
          compact
          onSubmit={async (p) => {
            setError(null);
            try { await api.saveProfile(p); await refreshMe(); location.hash = "/upload"; }
            catch (e) { setError((e as Error).message); }
          }}
        />
        {error && <div style={{ marginTop: 12 }}><Alert kind="err">{error}</Alert></div>}
      </div>
    </div>
  );
}
