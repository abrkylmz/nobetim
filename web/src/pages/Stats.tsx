import { useState } from "react";
import { BarChart3, CalendarRange, ChevronLeft, ChevronRight, Clock3, Flag, Moon, Sun, Table2, TrendingUp, Wallet } from "lucide-react";
import { CATEGORY_META, isWork } from "../../../shared/types";
import { api, type StatsResponse } from "../lib/api";
import { useApp, useLoad } from "../lib/app";
import { fmtDate, fmtMoney, fmtNum, MONTHS, MONTHS_SHORT } from "../lib/format";
import { Alert, Card, Skeleton } from "../components/ui";

export function StatsPage() {
  const { me } = useApp();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const { data, error } = useLoad(() => api.stats(ym.y, ym.m), [ym.y, ym.m]);
  const move = (d: number) => { const x = new Date(ym.y, ym.m - 1 + d, 1); setYm({ y: x.getFullYear(), m: x.getMonth() + 1 }); };
  const s = data?.month;
  const p = me.profile!;

  const kpis = s ? [
    { icon: CalendarRange, label: "Nöbet sayısı", value: String(s.shiftCount), sub: `Bunlardan ${s.byCategory.find((c) => c.category === "extra")?.count ?? 0} tanesi ek nöbet` },
    { icon: Clock3, label: "Toplam çalışma", value: `${fmtNum(s.workHours)} sa`, sub: `Yasal norm ${fmtNum(s.normHours)} sa` },
    { icon: Moon, label: "Gece nöbeti", value: String(s.nightShifts), sub: "00:00–06:00 arasını kapsayan" },
    { icon: Sun, label: "Hafta sonu nöbeti", value: String(s.weekendShifts), sub: "Cumartesi / Pazar başlayan" },
    { icon: Flag, label: "Resmî tatil çalışması", value: `${fmtNum(s.holidayHours)} sa`, sub: `${s.holidayShifts} nöbet` },
    { icon: TrendingUp, label: "Fazla mesai", value: `${fmtNum(s.overtimeHours)} sa`, sub: `Haftalık ${p.weeklyHours} saat normuna göre` },
  ] : [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>İstatistik</h1>
          <p className="muted">Saatler gerçek nöbet aralıklarından hesaplanır; ay sonunu aşan nöbetler iki aya bölünür.</p>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button className="iconbtn" onClick={() => move(-1)} aria-label="Önceki ay"><ChevronLeft size={22} /></button>
          <b style={{ minWidth: 120, textAlign: "center" }}>{MONTHS[ym.m - 1]} {ym.y}</b>
          <button className="iconbtn" onClick={() => move(1)} aria-label="Sonraki ay"><ChevronRight size={22} /></button>
        </div>
      </div>
      {error && <Alert kind="err">{error}</Alert>}

      <div className="grid grid-3">
        {!s ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h={118} r={20} />) : kpis.map((k) => (
          <div className="card kpi" key={k.label}>
            <span className="label"><span className="kpi-icon"><k.icon size={18} /></span>{k.label}</span>
            <span className="value">{k.value}</span>
            <span className="sub">{k.sub}</span>
          </div>
        ))}
      </div>

      <div className="grid dash-grid" style={{ marginTop: 16 }}>
        <Card title="Aylık çalışma saati" icon={<BarChart3 size={18} />}>
          {data ? <HoursChart data={data} selected={ym} onSelect={(y, m) => setYm({ y, m })} /> : <Skeleton h={240} />}
        </Card>
        <div className="stack">
          <Card title="Tahmini nöbet geliri" icon={<Wallet size={18} />}>
            {!s ? <Skeleton h={60} /> : p.overtimeRate > 0 || p.holidayRate > 0 ? (
              <>
                <div className="kpi"><span className="value">{fmtMoney(s.estimatedIncome)}</span></div>
                <p className="small muted" style={{ marginTop: 6 }}>
                  {fmtNum(s.overtimeHours)} sa fazla mesai × {fmtMoney(p.overtimeRate)}
                  {p.holidayRate > 0 && <> + {fmtNum(s.holidayHours)} sa tatil × {fmtMoney(p.holidayRate)}</>}
                </p>
                <p className="tiny faint" style={{ marginTop: 6 }}>Tahminidir; kurumunuzun ödeme kurallarına göre değişebilir.</p>
              </>
            ) : (
              <p className="small muted">Tahmini geliri görmek için <a href="#/settings">Ayarlar</a>'dan saat ücretini gir.</p>
            )}
          </Card>
          <Card title="Dağılım">
            {!s ? <Skeleton h={100} /> : s.byCategory.length === 0 ? <p className="small muted">Bu ay kayıt yok.</p> : (
              <table className="data">
                <thead><tr><th>Tür</th><th className="num">Adet</th><th className="num">Saat</th></tr></thead>
                <tbody>
                  {s.byCategory.map((c) => (
                    <tr key={c.category}>
                      <td><span className="row" style={{ gap: 8 }}><span className="dot" style={{ background: CATEGORY_META[c.category].color }} />{CATEGORY_META[c.category].label}</span></td>
                      <td className="num">{c.count}</td>
                      <td className="num">{isWork(c.category) ? fmtNum(c.hours) : "—"}</td>
                    </tr>
                  ))}
                  <tr><td className="muted">İzin / rapor günü</td><td className="num">{s.leaveDays} / {s.sickDays}</td><td /></tr>
                </tbody>
              </table>
            )}
          </Card>
          {data && data.holidays.length > 0 && (
            <Card title="Bu aydaki resmî tatiller" icon={<Flag size={18} />}>
              <div className="stack" style={{ gap: 6 }}>
                {data.holidays.map((h) => <div key={h.date} className="row between small"><span>{h.name}</span><span className="muted">{fmtDate(h.date)}{h.half && " (yarım gün)"}</span></div>)}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/** Son 12 ayın çalışma saati: tek seri çubuk grafik + üzerine gelince ipucu + tablo görünümü */
function HoursChart({ data, selected, onSelect }: { data: StatsResponse; selected: { y: number; m: number }; onSelect: (y: number, m: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const series = data.series;
  const W = 640, H = 240, pad = { l: 36, r: 8, t: 12, b: 28 };
  const max = Math.max(40, ...series.map((s) => s.workHours));
  const niceMax = Math.ceil(max / 40) * 40;
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const bw = iw / series.length;
  const yOf = (v: number) => pad.t + ih - (v / niceMax) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(niceMax * f));
  const h = hover != null ? series[hover] : null;

  return (
    <div>
      <div className="row between" style={{ marginBottom: 8 }}>
        <span className="small muted">Son 12 ay · saat</span>
        <button className="btn ghost sm" onClick={() => setTable(!table)}>{table ? <BarChart3 size={15} /> : <Table2 size={15} />}{table ? "Grafik" : "Tablo"}</button>
      </div>
      {table ? (
        <table className="data">
          <thead><tr><th>Ay</th><th className="num">Saat</th><th className="num">Nöbet</th><th className="num">Gece</th><th className="num">Fazla mesai</th></tr></thead>
          <tbody>{series.map((s) => (
            <tr key={`${s.year}-${s.month}`}><td>{MONTHS[s.month - 1]} {s.year}</td><td className="num">{fmtNum(s.workHours)}</td><td className="num">{s.shiftCount}</td><td className="num">{s.nightShifts}</td><td className="num">{fmtNum(s.overtimeHours)}</td></tr>
          ))}</tbody>
        </table>
      ) : (
        <div className="chart" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Son 12 ayın aylık çalışma saatleri">
            {ticks.map((t) => (
              <g key={t}>
                <line className="gridline" x1={pad.l} x2={W - pad.r} y1={yOf(t)} y2={yOf(t)} />
                <text className="axis" x={pad.l - 6} y={yOf(t) + 4} textAnchor="end">{t}</text>
              </g>
            ))}
            {series.map((s, i) => {
              const x = pad.l + i * bw + bw * 0.18, w = bw * 0.64;
              const y = yOf(s.workHours), hh = pad.t + ih - y;
              const sel = s.year === selected.y && s.month === selected.m;
              const r = Math.min(4, w / 2, hh);
              return (
                <g key={`${s.year}-${s.month}`}>
                  {hh > 0 && (
                    <path className={`bar ${hover != null && hover !== i ? "dim" : ""} ${sel ? "sel" : ""}`}
                      d={`M${x},${y + hh} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + hh} Z`} />
                  )}
                  <text className="axis" x={x + w / 2} y={H - 8} textAnchor="middle" style={sel ? { fill: "var(--text)", fontWeight: 700 } : undefined}>{MONTHS_SHORT[s.month - 1]}</text>
                  <rect className="hit" x={pad.l + i * bw} y={pad.t} width={bw} height={ih + pad.b}
                    onMouseEnter={() => setHover(i)} onClick={() => onSelect(s.year, s.month)} />
                </g>
              );
            })}
          </svg>
          {h && hover != null && (
            <div className="tooltip" style={{ left: `${((pad.l + hover * bw + bw / 2) / W) * 100}%`, top: `${(yOf(h.workHours) / H) * 100}%` }}>
              {MONTHS[h.month - 1]} {h.year}<br /><b>{fmtNum(h.workHours)} saat</b> · {h.shiftCount} nöbet
            </div>
          )}
        </div>
      )}
    </div>
  );
}
