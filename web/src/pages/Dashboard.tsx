import { ArrowRight, CalendarClock, Clock3, FileText, Moon, TrendingUp, Upload } from "lucide-react";
import { CATEGORY_META, isWork, type Shift } from "../../../shared/types";
import { api } from "../lib/api";
import { useApp, useLoad, useTick } from "../lib/app";
import { fmtDate, fmtDateTime, fmtHours, fmtNum, firstName, greeting, MONTHS, nowLocal, shiftRange, untilText } from "../lib/format";
import { Alert, Card, CodeChip, Empty, Skeleton } from "../components/ui";
import { StatusBadge } from "./History";

function NextShiftHero({ current, next }: { current: Shift | null; next: Shift | null }) {
  useTick(30_000);
  const now = nowLocal();
  if (current && current.endAt && current.endAt > now) {
    const left = untilText(now, current.endAt);
    return (
      <div className="hero">
        <div className="eyebrow"><Clock3 size={15} />Şu an nöbettesin</div>
        <div className="big">{current.label}</div>
        <div className="when">{shiftRange(current)} · bitişe {left.text}</div>
      </div>
    );
  }
  if (!next || !next.startAt) {
    return (
      <div className="hero">
        <div className="eyebrow"><CalendarClock size={15} />Bir sonraki nöbet</div>
        <div className="big" style={{ fontSize: 24 }}>Planlanmış nöbet yok</div>
        <div className="when">Yeni ayın çizelgesini yükleyerek takvimini oluştur.</div>
      </div>
    );
  }
  const u = untilText(now, next.startAt);
  return (
    <div className="hero">
      <div className="eyebrow"><CalendarClock size={15} />Bir sonraki nöbet</div>
      <div className="big">{fmtDate(next.date, { weekday: true })}</div>
      <div className="row" style={{ gap: 8, marginTop: 6, position: "relative", zIndex: 1 }}>
        <span className="chip">{next.label}</span>
        <span className="chip">{shiftRange(next)}</span>
        <span className="chip">{fmtHours(next.hours)}</span>
      </div>
      <div className="countdown" aria-label={`Nöbete ${u.text} kaldı`}>
        <div><b>{u.d}</b><span>gün</span></div>
        <div><b>{u.h}</b><span>saat</span></div>
        <div><b>{u.m}</b><span>dakika</span></div>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { me } = useApp();
  const { data, loading, error } = useLoad(() => api.dashboard(), []);
  const m = data?.month;
  const totalCatHours = m ? Math.max(1, ...m.byCategory.map((c) => c.hours)) : 1;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{greeting()}, {firstName(me.profile!.fullName)}</h1>
          <p className="muted">{[me.profile!.hospital, me.profile!.department].filter(Boolean).join(" · ") || "Nöbet takibine hoş geldin"}</p>
        </div>
      </div>

      <button className="upload-cta" onClick={() => (location.hash = "/upload")} style={{ marginBottom: 16 }}>
        <span className="ic"><Upload size={26} /></span>
        <span style={{ flex: 1 }}>
          <b>Nöbet Listemi Yükle</b>
          <span className="small">PDF, Excel ya da fotoğraf. Senin nöbetlerin otomatik çıkarılır.</span>
        </span>
        <ArrowRight size={22} />
      </button>

      {error && <Alert kind="err">{error}</Alert>}
      {data && data.pending > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Alert kind="warn" title={`${data.pending} çizelge onayını bekliyor`}>
            Kontrol edip onaylamadığın kayıtlar takvime eklenmez. <a href="#/history">Dosya geçmişine git</a>
          </Alert>
        </div>
      )}

      <div className="grid dash-grid">
        <div className="stack">
          {loading || !data ? <Skeleton h={190} r={20} /> : <NextShiftHero current={data.current} next={data.next} />}

          <div className="grid grid-2">
            <div className="card kpi">
              <span className="label"><span className="kpi-icon"><Clock3 size={18} /></span>Bu ay toplam çalışma</span>
              {m ? <span className="value">{fmtNum(m.workHours)}<small>saat</small></span> : <Skeleton h={34} w={90} />}
              {m && <span className="sub">Norm {fmtNum(m.normHours)} sa · {m.overtimeHours > 0 ? `${fmtNum(m.overtimeHours)} sa fazla` : "fazla mesai yok"}</span>}
            </div>
            <div className="card kpi">
              <span className="label"><span className="kpi-icon"><Moon size={18} /></span>Bu ay nöbet sayısı</span>
              {m ? <span className="value">{m.shiftCount}<small>nöbet</small></span> : <Skeleton h={34} w={90} />}
              {m && <span className="sub">{m.nightShifts} gece · {m.weekendShifts} hafta sonu</span>}
            </div>
          </div>

          <Card title="Yaklaşan nöbetler" icon={<CalendarClock size={18} />} action={<a href="#/calendar" className="small">Takvim</a>}>
            {!data ? <Skeleton h={120} /> : data.upcoming.length === 0 && !data.next ? (
              <Empty icon={<CalendarClock size={26} />} title="Yaklaşan nöbet yok">Çizelgeni yüklediğinde burada görünecek.</Empty>
            ) : (
              <div>
                {[data.next, ...data.upcoming].filter((s, i, a): s is Shift => !!s && a.findIndex((x) => x?.id === s.id) === i).slice(0, 5).map((s) => (
                  <div className="list-item" key={s.id}>
                    <div className="date-tile"><b>{+s.date.slice(8)}</b><span>{MONTHS[+s.date.slice(5, 7) - 1].slice(0, 3)}</span></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 650 }}>{s.label}{s.isExtra && <span className="badge warn" style={{ marginLeft: 6 }}>Ek nöbet</span>}</div>
                      <div className="small muted">{fmtDate(s.date, { weekday: true })} · {shiftRange(s)}</div>
                    </div>
                    <span className="small tnum muted">{fmtHours(s.hours)}</span>
                    <CodeChip code={s.code} color={s.color} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="stack">
          <Card title={`${m ? MONTHS[m.month - 1] : ""} özeti`} icon={<TrendingUp size={18} />} action={<a href="#/stats" className="small">Detay</a>}>
            {!m ? <Skeleton h={140} /> : m.byCategory.length === 0 ? (
              <p className="muted small">Bu ay için kayıt yok.</p>
            ) : (
              <div className="stack" style={{ gap: 12 }}>
                {m.byCategory.map((c) => (
                  <div key={c.category}>
                    <div className="row between small" style={{ marginBottom: 4 }}>
                      <span className="row" style={{ gap: 8 }}><span className="dot" style={{ background: CATEGORY_META[c.category].color }} />{CATEGORY_META[c.category].label}</span>
                      <span className="tnum muted">{c.count} {isWork(c.category) ? `· ${fmtNum(c.hours)} sa` : "gün"}</span>
                    </div>
                    {isWork(c.category) && <div className="bar-track"><div className="bar-fill" style={{ width: `${(c.hours / totalCatHours) * 100}%`, ["--c" as string]: CATEGORY_META[c.category].color }} /></div>}
                  </div>
                ))}
                <div className="divider" style={{ margin: "4px 0" }} />
                <div className="row between small"><span className="muted">İzin / rapor</span><b className="tnum">{m.leaveDays} / {m.sickDays} gün</b></div>
                <div className="row between small"><span className="muted">Resmî tatilde çalışma</span><b className="tnum">{fmtNum(m.holidayHours)} sa</b></div>
              </div>
            )}
          </Card>

          <Card title="Son yüklenen çizelge" icon={<FileText size={18} />}>
            {!data ? <Skeleton h={60} /> : !data.lastImport ? (
              <p className="muted small">Henüz çizelge yüklemedin.</p>
            ) : (
              <a href={`#/imports/${data.lastImport.id}`} className="row" style={{ color: "inherit", gap: 12 }}>
                <span className="kpi-icon"><FileText size={18} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{data.lastImport.fileName}</b>
                  <span className="small muted">{fmtDateTime(data.lastImport.createdAt)} · {data.lastImport.shiftCount} kayıt</span>
                </span>
                <StatusBadge status={data.lastImport.status} />
              </a>
            )}
          </Card>

          {!me.aiAvailable && (
            <Alert kind="info" title="Fotoğraf okuma kapalı">
              Sunucuda yapay zekâ (OCR) yapılandırılmadığı için şu an Excel ve metin içeren PDF dosyaları okunabiliyor.
            </Alert>
          )}
        </div>
      </div>
    </div>
  );
}
