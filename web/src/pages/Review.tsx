import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowLeft, Check, CheckCircle2, Copy, FileSearch, Pencil, Plus, RefreshCw, RotateCcw, Trash2, UserRoundSearch, X, XCircle,
} from "lucide-react";
import { CATEGORY_META, isWork, type DraftEntry, type ShiftCategory, type ShiftType } from "../../../shared/types";
import { daysInMonth, weekday } from "../../../shared/time";
import { api, type ReviewDetail } from "../lib/api";
import { go, useApp } from "../lib/app";
import { fmtDate, fmtNum, initials, MONTHS, WEEKDAYS_SHORT } from "../lib/format";
import { Alert, CodeChip, ConfidenceBadge, Empty, Field, Modal, Skeleton, Spinner } from "../components/ui";

const SOURCE_TEXT: Record<string, string> = { excel: "Excel", "pdf-text": "PDF (metin)", "pdf-scan": "Taranmış PDF (OCR)", image: "Fotoğraf (OCR)" };

export function ReviewPage({ id }: { id: string }) {
  const [d, setD] = useState<ReviewDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [types, setTypes] = useState<ShiftType[]>([]);
  const [nonce, setNonce] = useState(0);

  useEffect(() => { api.shiftTypes().then(setTypes).catch(() => {}); }, []);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const x = await api.import(id);
        if (stop) return;
        setD(x);
        if (x.status === "processing") timer = setTimeout(poll, 1200);
      } catch (e) { if (!stop) setError((e as Error).message); }
    };
    void poll();
    return () => { stop = true; clearTimeout(timer); };
  }, [id, nonce]);

  const restart = (x: ReviewDetail) => { setD(x); setNonce((n) => n + 1); };

  if (error) return <div className="page"><Alert kind="err">{error}</Alert></div>;
  if (!d) return <div className="page"><Skeleton h={28} w={240} /><div style={{ height: 16 }} /><Skeleton h={220} r={20} /></div>;

  return (
    <div className="page">
      <a href="#/history" className="small row" style={{ gap: 6, marginBottom: 10 }}><ArrowLeft size={16} />Dosya geçmişi</a>
      {d.status === "processing" && <Processing d={d} />}
      {d.status === "failed" && <Failed d={d} onRestart={restart} />}
      {d.status === "discarded" && <Alert kind="info" title="Bu çizelge reddedildi">Dosya ve çıkarılan veriler silindi.</Alert>}
      {d.status === "needs_selection" && <Selection d={d} onRestart={restart} />}
      {(d.status === "review" || d.status === "confirmed") && <ReviewView d={d} setD={setD} types={types} />}
    </div>
  );
}

// ---------- analiz sürüyor ----------

const STEPS = ["Dosya güvenlik kontrolü", "Tablo yapısı okunuyor", "Kişi satırı aranıyor", "Nöbetler çıkarılıyor"];

function Processing({ d }: { d: ReviewDetail }) {
  const p = (d.progress ?? "").toLowerCase();
  const active = /satırı okunuyor|kişi/.test(p) ? 2 : /ocr|okunuyor|incelen|çözüml|değerlendir/.test(p) ? 1 : 0;
  return (
    <div className="card" style={{ maxWidth: 560, margin: "20px auto", textAlign: "center", padding: 32 }}>
      <div className="scan" aria-hidden>{[18, 34, 50, 66, 82, 98].map((t) => <i key={t} style={{ top: t }} />)}</div>
      <h2>Çizelgen analiz ediliyor</h2>
      <p className="muted small" style={{ marginTop: 4 }}>{d.fileName}</p>
      <div className="steps" style={{ textAlign: "left", marginTop: 24 }}>
        {STEPS.map((s, i) => (
          <div key={s} className={`step ${i < active ? "done" : i === active ? "active" : ""}`}>
            <span className="bullet">{i < active && <Check size={15} />}</span>
            <span>{i === active && d.progress ? d.progress : s}</span>
          </div>
        ))}
      </div>
      <p className="small faint" style={{ marginTop: 20 }}>Fotoğraf ve taranmış PDF'lerde bu işlem 1-2 dakika sürebilir. Sayfadan ayrılabilirsin.</p>
    </div>
  );
}

// ---------- hata ----------

function Failed({ d, onRestart }: { d: ReviewDetail; onRestart: (x: ReviewDetail) => void }) {
  const [busy, setBusy] = useState(false);
  const { toast } = useApp();
  return (
    <div className="card" style={{ maxWidth: 620, margin: "20px auto", padding: 28 }}>
      <div className="kpi-icon" style={{ background: "var(--err-bg)", color: "var(--err)", width: 52, height: 52, borderRadius: 16 }}><XCircle size={26} /></div>
      <h2 style={{ marginTop: 14 }}>Çizelge okunamadı</h2>
      <p className="muted small" style={{ marginTop: 2 }}>{d.fileName}</p>
      <div style={{ marginTop: 16 }}><Alert kind="err">{d.error ?? "Bilinmeyen hata"}</Alert></div>
      {d.quality && d.quality.problems.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Alert kind="warn" title="Fotoğrafta tespit edilen sorunlar"><ul>{d.quality.problems.map((p) => <li key={p}>{p}</li>)}</ul></Alert>
        </div>
      )}
      <div className="row" style={{ marginTop: 20 }}>
        <button className="btn" onClick={() => go("/upload")}><RefreshCw size={18} />Yeni dosya / fotoğraf yükle</button>
        {d.fileAvailable && (
          <button className="btn ghost" disabled={busy} onClick={async () => {
            setBusy(true);
            try { onRestart(await api.reanalyze(d.id)); } catch (e) { toast((e as Error).message, "err"); } finally { setBusy(false); }
          }}>{busy ? <Spinner /> : <RotateCcw size={18} />}Yeniden analiz et</button>
        )}
      </div>
    </div>
  );
}

// ---------- kişi seçimi ----------

function Selection({ d, onRestart }: { d: ReviewDetail; onRestart: (x: ReviewDetail) => void }) {
  const { me, toast } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const list = d.candidates.filter((c) => c.name.toLocaleLowerCase("tr").includes(q.toLocaleLowerCase("tr")));
  const choose = async (key: string) => {
    setBusy(key);
    try { onRestart(await api.select(d.id, key)); } catch (e) { toast((e as Error).message, "err"); setBusy(null); }
  };
  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div className="page-head">
        <div>
          <h1>Çizelgede hangisi sensin?</h1>
          <p className="muted">{d.matchNote ?? "Kendini seç."} Profilindeki ad: <b>{me.profile!.fullName}</b>{me.profile!.staffNo && ` · Sicil ${me.profile!.staffNo}`}</p>
        </div>
      </div>
      <Alert kind="info">Emin olmadığımız eşleşmeleri otomatik seçmiyoruz. Seçtiğin kişinin nöbetleri çıkarılacak; diğer personelin bilgileri saklanmaz.</Alert>
      {d.candidates.length > 8 && (
        <input className="input" style={{ marginTop: 14 }} placeholder="İsim ara…" value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      <div className="stack" style={{ marginTop: 14, gap: 10 }}>
        {list.length === 0 && <Empty icon={<UserRoundSearch size={26} />} title="Çizelgede personel bulunamadı">Farklı bir dosya veya daha net bir fotoğraf yükle.</Empty>}
        {list.map((c) => (
          <button key={c.key} className="candidate" onClick={() => choose(c.key)} disabled={!!busy}>
            <span className="avatar">{initials(c.name)}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b style={{ display: "block" }}>{c.name}</b>
              <span className="small muted">{[c.title, c.staffNo && `Sicil ${c.staffNo}`, c.department].filter(Boolean).join(" · ") || "Ek bilgi yok"}</span>
              {c.score >= 0.3 && <span className="small" style={{ display: "block", color: "var(--text-2)" }}>{c.reason}</span>}
            </span>
            {c.score >= 0.3 && <span className={`badge ${c.score >= 0.9 ? "ok" : c.score >= 0.75 ? "warn" : "neutral"}`}>%{Math.round(c.score * 100)} benzerlik</span>}
            {busy === c.key && <Spinner />}
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 18 }}>
        <a className="btn ghost" href="#/settings">Profildeki adımı düzenle</a>
        <button className="btn danger" onClick={async () => { await api.discard(d.id); go("/upload"); }}>Listede yokum, reddet</button>
      </div>
    </div>
  );
}

// ---------- kontrol ekranı ----------

type Filter = "all" | "check" | "error" | "duplicate";

function ReviewView({ d, setD, types }: { d: ReviewDetail; setD: (x: ReviewDetail) => void; types: ShiftType[] }) {
  const { toast } = useApp();
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const readonly = d.status === "confirmed";

  const active = d.draft.filter((e) => !e.excluded);
  const counts = {
    total: active.filter((e) => e.status !== "duplicate").length,
    ok: active.filter((e) => e.status === "ok").length,
    check: active.filter((e) => e.status === "check").length,
    error: active.filter((e) => e.status === "error").length,
    duplicate: active.filter((e) => e.status === "duplicate").length,
    hours: active.filter((e) => e.status !== "duplicate").reduce((n, e) => n + (e.hours ?? 0), 0),
  };
  const conflicts = active.filter((e) => e.issues.some((i) => i.code === "existing_conflict")).length;
  const shown = useMemo(() => {
    const list = filter === "all" ? d.draft : d.draft.filter((e) => !e.excluded && e.status === filter);
    return [...list].sort((a, b) => (a.startAt ?? a.date).localeCompare(b.startAt ?? b.date));
  }, [d.draft, filter]);

  async function edit(entryId: string, patch: Record<string, unknown>) {
    try { setD(await api.editEntry(d.id, entryId, patch)); return true; }
    catch (e) { toast((e as Error).message, "err"); return false; }
  }

  async function changePeriod(year: number, month: number) {
    if (d.draft.some((e) => e.edited) && !confirm("Dönemi değiştirirsen yaptığın düzenlemeler sıfırlanır. Devam edilsin mi?")) return;
    try { setD(await api.setPeriod(d.id, year, month)); toast(`Dönem ${MONTHS[month - 1]} ${year} olarak güncellendi.`); }
    catch (e) { toast((e as Error).message, "err"); }
  }

  const years = [new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{readonly ? "Onaylanan çizelge" : "Analiz sonucu"}</h1>
          <p className="muted">{readonly ? "Bu kayıtlar takviminde." : "Kayıtları kontrol et. Onaylamadan takvime hiçbir şey eklenmez."}</p>
        </div>
        {readonly && <a className="btn secondary" href="#/calendar">Takvimde gör</a>}
      </div>

      <div className="card">
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
            <span className="avatar">{initials(d.personName ?? "?")}</span>
            <div>
              <div className="small muted">Bulunan personel</div>
              <b style={{ fontSize: 17 }}>{d.personName}</b>
              <div className="small muted">{[d.personTitle, d.personStaffNo && `Sicil ${d.personStaffNo}`].filter(Boolean).join(" · ")}</div>
              {d.matchNote && <div className="small" style={{ color: "var(--text-2)" }}>{d.matchNote}</div>}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="small muted">Dosya</div>
            <b className="small" style={{ display: "block", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.fileName}</b>
            <span className="badge neutral">{SOURCE_TEXT[d.source ?? ""] ?? d.source}</span>
          </div>
        </div>
        <div className="divider" />
        <div className="row" style={{ marginBottom: 14 }}>
          <span className="small muted">Dönem</span>
          {readonly ? <b>{MONTHS[d.periodMonth! - 1]} {d.periodYear}</b> : (
            <>
              <select className="select sm" style={{ width: "auto" }} value={d.periodMonth ?? 1} onChange={(e) => changePeriod(d.periodYear!, +e.target.value)} aria-label="Ay">
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <select className="select sm" style={{ width: "auto" }} value={d.periodYear ?? years[1]} onChange={(e) => changePeriod(+e.target.value, d.periodMonth!)} aria-label="Yıl">
                {[...new Set([...years, d.periodYear!])].sort().map((y) => <option key={y}>{y}</option>)}
              </select>
            </>
          )}
          {d.periodGuessed && !readonly && <span className="badge warn"><AlertTriangle size={13} />Tahmin edildi, kontrol et</span>}
        </div>
        <div className="summary-grid">
          <div className="s"><b>{counts.total}</b><span>Bulunan nöbet / kayıt</span></div>
          <div className="s"><b>{fmtNum(counts.hours)}</b><span>Toplam çalışma saati</span></div>
          <div className="s ok"><b>{counts.ok}</b><span>Başarılı okunan</span></div>
          <div className="s warn"><b>{counts.check}</b><span>Kontrol önerilen</span></div>
          <div className="s err"><b>{counts.error}</b><span>Hatalı / eksik</span></div>
          <div className="s"><b>{counts.duplicate}</b><span>Takvimde zaten var</span></div>
        </div>
      </div>

      <div className="stack" style={{ marginTop: 14, gap: 10 }}>
        {d.duplicateOf && <Alert kind="warn" title="Bu dosya daha önce yüklenmiş">Takvimde zaten olan nöbetler “mükerrer” işaretlendi ve tekrar eklenmeyecek. <a href={`#/imports/${d.duplicateOf}`}>Önceki yükleme</a></Alert>}
        {d.quality && d.quality.problems.length > 0 && (
          <Alert kind={d.quality.level === "poor" ? "err" : "warn"} title="Görüntü kalitesi">
            <ul>{d.quality.problems.map((p) => <li key={p}>{p}</li>)}</ul>
            {d.quality.level === "poor" && <div style={{ marginTop: 6 }}>Daha iyi bir sonuç için fotoğrafı kırpıp <a href="#/upload">yeniden yükle</a>.</div>}
          </Alert>
        )}
        {d.notes.length > 0 && <Alert kind="info">{d.notes.join(" ")}</Alert>}
      </div>

      <div className="row between" style={{ marginTop: 22, marginBottom: 12 }}>
        <div className="chips" role="tablist">
          {([["all", `Tümü (${d.draft.length})`], ["check", `Kontrol (${counts.check})`], ["error", `Hatalı (${counts.error})`], ["duplicate", `Mükerrer (${counts.duplicate})`]] as [Filter, string][]).map(([k, t]) => (
            <button key={k} className={`chip-btn ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)} role="tab" aria-selected={filter === k}>{t}</button>
          ))}
        </div>
        {!readonly && <button className="btn ghost sm" onClick={() => setAdding(true)}><Plus size={16} />Eksik nöbet ekle</button>}
      </div>

      <div className="stack" style={{ gap: 10 }}>
        {shown.length === 0 && <Empty icon={<FileSearch size={26} />} title="Bu filtrede kayıt yok" />}
        {shown.map((e) => (
          <EntryCard key={e.id} e={e} types={types} readonly={readonly} editing={editing === e.id}
            onEdit={() => setEditing(editing === e.id ? null : e.id)}
            onSave={async (patch) => { if (await edit(e.id, patch)) setEditing(null); }}
            onPatch={(patch) => edit(e.id, patch)} />
        ))}
      </div>

      {!readonly && (
        <div className="sticky-bar">
          <div style={{ flex: 1, minWidth: 200 }}>
            {counts.error > 0
              ? <span className="small" style={{ color: "var(--err)", fontWeight: 600 }}>{counts.error} kayıt düzeltilmeli veya doğrulanmalı</span>
              : <span className="small"><b>{counts.total}</b> kayıt takvime eklenecek{counts.duplicate ? `, ${counts.duplicate} mükerrer atlanacak` : ""}</span>}
          </div>
          <button className="btn danger" onClick={async () => {
            if (!confirm("Bu çizelge reddedilsin mi? Dosya ve çıkarılan veriler silinir.")) return;
            setD(await api.discard(d.id)); toast("Çizelge reddedildi.");
          }}><X size={18} />Reddet</button>
          <button className="btn" disabled={counts.error > 0 || busy} onClick={() => setConfirming(true)}><CheckCircle2 size={18} />Onayla ve takvime ekle</button>
        </div>
      )}

      {confirming && (
        <ConfirmDialog conflicts={conflicts} total={counts.total} duplicate={counts.duplicate} onClose={() => setConfirming(false)} onConfirm={async (opts) => {
          setBusy(true);
          try {
            const r = await api.confirm(d.id, opts);
            toast(`${r.saved} kayıt takvime eklendi${r.skipped ? `, ${r.skipped} mükerrer atlandı` : ""}.`);
            setD(await api.import(d.id));
            go("/calendar");
          } catch (err) { toast((err as Error).message, "err"); setD(await api.import(d.id)); }
          finally { setBusy(false); setConfirming(false); }
        }} />
      )}
      {adding && d.periodYear && d.periodMonth && (
        <AddEntry year={d.periodYear} month={d.periodMonth} types={types} onClose={() => setAdding(false)} onAdd={async (body) => {
          try { setD(await api.addEntry(d.id, body)); setAdding(false); } catch (err) { toast((err as Error).message, "err"); }
        }} />
      )}
    </>
  );
}

function ConfirmDialog({ conflicts, total, duplicate, onClose, onConfirm }: {
  conflicts: number; total: number; duplicate: number; onClose: () => void; onConfirm: (o: { replaceConflicts: boolean; rememberCodes: boolean }) => Promise<void>;
}) {
  const [replace, setReplace] = useState(true);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Takvime ekle" onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Vazgeç</button>
      <button className="btn" disabled={busy} onClick={async () => { setBusy(true); await onConfirm({ replaceConflicts: replace, rememberCodes: remember }); }}>{busy && <Spinner />}Onayla</button>
    </>}>
      <p><b>{total}</b> kayıt takvimine eklenecek.{duplicate > 0 && ` Takvimde zaten olan ${duplicate} kayıt tekrar eklenmeyecek.`}</p>
      {conflicts > 0 && (
        <div style={{ marginTop: 14 }}>
          <Alert kind="warn" title={`${conflicts} kayıt takvimdeki farklı kayıtlarla çakışıyor`}>
            <label className="check" style={{ marginTop: 8 }}><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />Çakışan eski kayıtları bu çizelgeyle değiştir</label>
          </Alert>
        </div>
      )}
      <label className="check" style={{ marginTop: 14 }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Düzelttiğim yeni kodları sonraki çizelgeler için hatırla</label>
    </Modal>
  );
}

// ---------- tek kayıt ----------

function EntryCard({ e, types, readonly, editing, onEdit, onSave, onPatch }: {
  e: DraftEntry; types: ShiftType[]; readonly: boolean; editing: boolean;
  onEdit: () => void; onSave: (p: Record<string, unknown>) => Promise<void>; onPatch: (p: Record<string, unknown>) => Promise<boolean>;
}) {
  const color = types.find((t) => t.code === e.code)?.color ?? CATEGORY_META[e.category].color;
  const day = +e.date.slice(8);
  const hard = e.issues.some((i) => i.severity === "error" && ["missing_time", "invalid_time"].includes(i.code));
  const canVerify = !readonly && !e.excluded && !e.verified && (e.status === "check" || (e.status === "error" && !hard && !e.issues.some((i) => i.code === "unknown_code")));
  return (
    <div className={`entry status-${e.excluded ? "excluded" : e.status} ${e.excluded ? "excluded" : ""}`}>
      <div className="date-tile"><b>{day}</b><span>{WEEKDAYS_SHORT[weekday(e.date)]}</span></div>
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 8 }}>
          <CodeChip code={e.code || "?"} color={color} />
          <b>{e.label}</b>
          <span className="badge neutral">{CATEGORY_META[e.category].label}</span>
          {e.isExtra && <span className="badge warn">Ek nöbet</span>}
          {e.status === "duplicate" && <span className="badge neutral"><Copy size={12} />Takvimde var</span>}
          {e.excluded && <span className="badge neutral">Silindi</span>}
          {e.verified && !e.excluded && <span className="badge ok"><Check size={12} />{e.edited ? "Düzenlendi" : "Doğrulandı"}</span>}
        </div>
        <div className="small muted" style={{ marginTop: 4 }}>
          {fmtDate(e.date, { weekday: true })} ·{" "}
          {isWork(e.category)
            ? e.startAt ? <><b className="tnum" style={{ color: "var(--text)" }}>{e.start} – {e.end}</b>{e.overnight && <span className="badge info" style={{ marginLeft: 6 }}>ertesi gün {e.end}</span>} · {fmtNum(e.hours ?? 0)} saat</> : <span style={{ color: "var(--err)" }}>saat eksik</span>
            : "tüm gün"}
          {e.raw && <> · Çizelgede: <b>“{e.raw}”</b></>}
        </div>
        {!e.excluded && (
          <div className="row" style={{ gap: 6, marginTop: 8 }}>
            <span className="tiny muted">Güven:</span>
            <ConfidenceBadge score={e.confidence.overall} />
            <span className="tiny faint" title={e.confidence.read.reason}>okuma %{Math.round(e.confidence.read.score * 100)}</span>
            <span className="tiny faint" title={e.confidence.type.reason}>tür %{Math.round(e.confidence.type.score * 100)}</span>
            <span className="tiny faint" title={e.confidence.time.reason}>saat %{Math.round(e.confidence.time.score * 100)}</span>
          </div>
        )}
        {e.issues.length > 0 && !e.excluded && (
          <ul className="issues">
            {e.issues.map((i, k) => (
              <li key={k} style={{ color: i.severity === "error" ? "var(--err)" : "var(--warn)" }}>
                {i.severity === "error" ? <XCircle size={15} /> : <AlertTriangle size={15} />}<span style={{ color: "var(--text-2)" }}>{i.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!readonly && (
        <div className="actions">
          {e.excluded ? (
            <button className="btn ghost sm" onClick={() => onPatch({ excluded: false })}><RotateCcw size={15} />Geri al</button>
          ) : (
            <>
              {canVerify && <button className="btn secondary sm" onClick={() => onPatch({ verified: true })} title="Okunan değer doğru"><Check size={15} />Doğru</button>}
              <button className="iconbtn" onClick={onEdit} aria-label="Düzenle"><Pencil size={17} /></button>
              <button className="iconbtn" onClick={() => onPatch({ excluded: true })} aria-label="Sil"><Trash2 size={17} /></button>
            </>
          )}
        </div>
      )}
      {editing && <EntryEditor e={e} types={types} onCancel={onEdit} onSave={onSave} />}
    </div>
  );
}

function EntryEditor({ e, types, onCancel, onSave }: { e: DraftEntry; types: ShiftType[]; onCancel: () => void; onSave: (p: Record<string, unknown>) => Promise<void> }) {
  const [f, setF] = useState({ code: e.code, category: e.category, start: e.start ?? "", end: e.end ?? "", isExtra: e.isExtra, note: e.note, date: e.date });
  const [busy, setBusy] = useState(false);
  const work = isWork(f.category);
  const known = types.find((t) => t.code === f.code);
  return (
    <form className="edit" onSubmit={async (ev) => {
      ev.preventDefault(); setBusy(true);
      await onSave({ ...f, start: work ? f.start || null : null, end: work ? f.end || null : null });
      setBusy(false);
    }}>
      <Field label="Tarih"><input className="input sm" type="date" value={f.date} onChange={(x) => setF({ ...f, date: x.target.value })} /></Field>
      <Field label="Kod">
        <select className="select sm" value={known ? f.code : "__custom"} onChange={(x) => {
          const t = types.find((t) => t.code === x.target.value);
          if (t) setF({ ...f, code: t.code, category: t.category, start: t.start ?? "", end: t.end ?? "", isExtra: t.category === "extra" || f.isExtra });
          else setF({ ...f, code: e.raw || f.code });
        }}>
          {types.map((t) => <option key={t.id} value={t.code}>{t.code} · {t.label}</option>)}
          <option value="__custom">Diğer: “{e.raw || f.code}”</option>
        </select>
      </Field>
      <Field label="Nöbet türü">
        <select className="select sm" value={f.category} onChange={(x) => setF({ ...f, category: x.target.value as ShiftCategory })}>
          {Object.entries(CATEGORY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </Field>
      {work && <Field label="Başlangıç"><input className="input sm" type="time" required value={f.start} onChange={(x) => setF({ ...f, start: x.target.value })} /></Field>}
      {work && <Field label="Bitiş" hint={f.start && f.end && f.end <= f.start ? "Ertesi gün biter" : undefined}><input className="input sm" type="time" required value={f.end} onChange={(x) => setF({ ...f, end: x.target.value })} /></Field>}
      {work && <label className="check" style={{ alignSelf: "end", paddingBottom: 8 }}><input type="checkbox" checked={f.isExtra} onChange={(x) => setF({ ...f, isExtra: x.target.checked })} />Ek nöbet</label>}
      <Field label="Not"><input className="input sm" value={f.note} onChange={(x) => setF({ ...f, note: x.target.value })} /></Field>
      <div className="row" style={{ alignSelf: "end" }}>
        <button className="btn sm" disabled={busy}>{busy && <Spinner size={14} />}Kaydet</button>
        <button type="button" className="btn ghost sm" onClick={onCancel}>Vazgeç</button>
      </div>
    </form>
  );
}

function AddEntry({ year, month, types, onClose, onAdd }: { year: number; month: number; types: ShiftType[]; onClose: () => void; onAdd: (b: Record<string, unknown>) => Promise<void> }) {
  const first = types.find((t) => isWork(t.category) && t.start);
  const [f, setF] = useState({ date: `${year}-${String(month).padStart(2, "0")}-01`, code: first?.code ?? "", category: (first?.category ?? "day") as ShiftCategory, start: first?.start ?? "08:00", end: first?.end ?? "16:00", isExtra: false });
  const work = isWork(f.category);
  const max = `${year}-${String(month).padStart(2, "0")}-${daysInMonth(year, month)}`;
  return (
    <Modal title="Eksik nöbet ekle" onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Vazgeç</button>
      <button className="btn" onClick={() => onAdd({ ...f, start: work ? f.start : null, end: work ? f.end : null })}>Ekle</button>
    </>}>
      <div className="grid grid-2">
        <Field label="Tarih"><input className="input" type="date" min={max.slice(0, 8) + "01"} max={max} value={f.date} onChange={(x) => setF({ ...f, date: x.target.value })} /></Field>
        <Field label="Kod">
          <select className="select" value={f.code} onChange={(x) => {
            const t = types.find((t) => t.code === x.target.value)!;
            setF({ ...f, code: t.code, category: t.category, start: t.start ?? f.start, end: t.end ?? f.end });
          }}>{types.map((t) => <option key={t.id} value={t.code}>{t.code} · {t.label}</option>)}</select>
        </Field>
        {work && <Field label="Başlangıç"><input className="input" type="time" value={f.start} onChange={(x) => setF({ ...f, start: x.target.value })} /></Field>}
        {work && <Field label="Bitiş"><input className="input" type="time" value={f.end} onChange={(x) => setF({ ...f, end: x.target.value })} /></Field>}
      </div>
    </Modal>
  );
}

