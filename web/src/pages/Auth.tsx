import { useState } from "react";
import { CalendarCheck, FileSpreadsheet, ShieldCheck, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { Alert, Field, Spinner } from "../components/ui";

export function AuthPage({ onDone }: { onDone: () => Promise<void> }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (mode === "login") await api.login(email, password);
      else await api.register(email, password);
      await onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div className="auth">
      <div className="art">
        <div className="brand" style={{ padding: 0, color: "#fff" }}><img src="/favicon.svg" alt="" />Nöbetim</div>
        <div>
          <h1>Nöbet listeni yükle, takvimin kendiliğinden oluşsun.</h1>
          <ul>
            <li><span><FileSpreadsheet size={18} /></span>PDF, Excel veya fotoğraf: hepsini okur</li>
            <li><span><Sparkles size={18} /></span>Senin satırını bulur, saatleri hesaplar</li>
            <li><span><CalendarCheck size={18} /></span>Sen onaylamadan takvime hiçbir şey eklenmez</li>
            <li><span><ShieldCheck size={18} /></span>Dosyaların şifreli saklanır, diğer personelin verisi tutulmaz</li>
          </ul>
        </div>
        <p className="small" style={{ opacity: .75 }}>Hemşireler için kişisel nöbet takibi</p>
      </div>
      <div className="form">
        <div>
          <div className="seg" style={{ marginBottom: 22 }}>
            <button className={mode === "login" ? "on" : ""} onClick={() => setMode("login")}>Giriş yap</button>
            <button className={mode === "register" ? "on" : ""} onClick={() => setMode("register")}>Hesap oluştur</button>
          </div>
          <h1>{mode === "login" ? "Tekrar hoş geldin" : "Hesabını oluştur"}</h1>
          <p className="muted" style={{ marginTop: 6 }}>{mode === "login" ? "Nöbetlerini görmek için giriş yap." : "Bir dakikada kur, ilk listeni hemen yükle."}</p>
          <form className="stack" style={{ marginTop: 22 }} onSubmit={submit}>
            <Field label="E-posta"><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Parola" hint={mode === "register" ? "En az 8 karakter" : undefined}>
              <input className="input" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error && <Alert kind="err">{error}</Alert>}
            <button className="btn xl block" disabled={busy}>{busy && <Spinner />}{mode === "login" ? "Giriş yap" : "Hesap oluştur"}</button>
          </form>
        </div>
      </div>
    </div>
  );
}
