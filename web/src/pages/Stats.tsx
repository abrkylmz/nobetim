import { useState } from "react";
import { BarChart3, CalendarRange, ChevronLeft, ChevronRight, Clock3, Flag, Minus, Moon, Sun, Table2, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { CATEGORY_META, isWork } from "../../../shared/types";
import { api, type StatsResponse } from "../lib/api";
import { useApp, useLoad } from "../lib/app";
import { fmtDate, fmtMoney, fmtNum, MONTHS, MONTHS_SHORT } from "../lib/format";
import { Alert, Card, Skeleton } from "../components/ui";

type Metric = "hours" | "income";
type MonthPoint = StatsResponse["series"][number];

export function StatsPage() {
  const { me } = useApp();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const { data, error } = useLoad(() => api.stats(ym.y, ym.m), [ym.y, ym.m]);
  const move = (d: number) => { const x = new Date(ym.y, ym.m - 1 + d, 1); setYm({ y: x.getFullYear(), m: x.getMonth() + 1 }); };
  const s = data?.month;
  const p = me.profile!;
  const incomeEnabled = !!p.payGroup || p.overtimeRate > 0 || p.holidayRate > 0;
  const [metric, setMetric] = useState<Metric>(incomeEnabled ? "income" : "hours");

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
        <Card title={metric === "income" ? "Aylık gelir karşılaştırması" : "Aylık çalışma saati"} icon={<BarChart3 size={18} />}>
          {data ? (
            <MonthlyChart data={data} selected={ym} onSelect={(y, m) => setYm({ y, m })} metric={metric} setMetric={setMetric} incomeEnabled={incomeEnabled} />
          ) : <Skeleton h={240} />}
        </Card>
        <div className="stack">
          <Card title="Tahmini nöbet geliri" icon={<Wallet size={18} />}>
            {!s ? <Skeleton h={60} /> : incomeEnabled ? (
              <>
                <div className="kpi"><span className="value">{fmtMoney(s.estimatedIncome)}</span></div>
                {s.pay ? (
                  <>
                    <p className="small muted" style={{ marginTop: 6 }}>
                      {fmtNum(s.overtimeHours)} sa fazla mesai × ort. {fmtRate(s.pay.avgRate)}
                    </p>
                    <p className="tiny faint" style={{ marginTop: 2 }}>{s.pay.groupLabel}{s.pay.risky && " · riskli birim"} · {s.pay.periodLabel}</p>
                    {s.workHours > 0 && (
                      <div className="stack" style={{ gap: 4, marginTop: 8 }}>
                        {s.pay.buckets.filter((b) => b.hours > 0).map((b) => (
                          <div key={b.kind} className="row between tiny">
                            <span className="muted">{BUCKET_LABEL[b.kind]}</span>
                            <span>{fmtNum(b.hours)} sa · {fmtRate(b.rate)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="small muted" style={{ marginTop: 6 }}>
                    {fmtNum(s.overtimeHours)} sa fazla mesai × {fmtRate(p.overtimeRate)}
                    {p.holidayRate > 0 && <> + {fmtNum(s.holidayHours)} sa tatil × {fmtRate(p.holidayRate)}</>}
                  </p>
                )}
                {data && <IncomeCompare data={data} ym={ym} />}
                <p className="tiny faint" style={{ marginTop: 10 }}>{s.pay ? "Tahminidir; ücretli saatlerin gündüz/gece/bayram dağılımı ayın tüm çalışma saatleriyle aynı varsayılır. Kesin tutar için bordronu kontrol et." : "Tahminidir; tüm aylar bugünkü saat ücretinle hesaplanır ve kurumunun ödeme kurallarına göre değişebilir."}</p>
              </>
            ) : (
              <p className="small muted">Tahmini geliri görmek için <a href="#/settings">Ayarlar</a>'dan nöbet ücreti tablonu seç ya da saat ücretini gir.</p>
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

const BUCKET_LABEL = { day: "Gündüz", night: "Gece (20:00–08:00)", holiday: "Bayram gündüz", holidayNight: "Bayram gece" } as const;

/** Saat ücreti: kuruş varsa göster (185,75 ₺ → ₺185,75) */
const fmtRate = (n: number) => n.toLocaleString("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
const compactMoney =(n: number) => (n === 0 ? "0" : "₺" + n.toLocaleString("tr-TR", { notation: "compact", maximumFractionDigits: 1 }));

/** Gelir ekseni için 1-2-5 dizisinden yuvarlak adım (4 aralık) */
function niceStep(max: number) {
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}

/** Kaydı olan ayların ortalaması (boş aylar ortalamayı düşürmesin) */
function average(series: MonthPoint[], val: (s: MonthPoint) => number) {
  const filled = series.filter((s) => val(s) > 0);
  return filled.length ? filled.reduce((a, s) => a + val(s), 0) / filled.length : 0;
}

/** Son 12 ay: saat veya tahmini gelir. Tek seri çubuk grafik, ortalama çizgisi, ipucu ve tablo görünümü */
function MonthlyChart({ data, selected, onSelect, metric, setMetric, incomeEnabled }: {
  data: StatsResponse; selected: { y: number; m: number }; onSelect: (y: number, m: number) => void;
  metric: Metric; setMetric: (m: Metric) => void; incomeEnabled: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const series = data.series;
  const income = metric === "income";
  const val = (s: MonthPoint) => (income ? s.estimatedIncome : s.workHours);
  const W = 640, H = 240, pad = { l: income ? 54 : 36, r: 8, t: 18, b: 28 };
  const top = Math.max(...series.map(val), 0);
  const step = income ? niceStep(Math.max(top, 1000)) : 40;
  const niceMax = Math.max(step * 4, Math.ceil(top / step) * step);
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const bw = iw / series.length;
  const yOf = (v: number) => pad.t + ih - (v / niceMax) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => niceMax * f);
  const avg = average(series, val);
  const h = hover != null ? series[hover] : null;
  const label = (n: number) => (income ? compactMoney(n) : String(Math.round(n)));

  return (
    <div>
      <div className="row between" style={{ marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
        <div className="seg" role="tablist" aria-label="Gösterilen değer">
          <button role="tab" aria-selected={!income} className={!income ? "on" : ""} onClick={() => setMetric("hours")}>Saat</button>
          <button role="tab" aria-selected={income} className={income ? "on" : ""} onClick={() => setMetric("income")}>Gelir</button>
        </div>
        <button className="btn ghost sm" onClick={() => setTable(!table)}>{table ? <BarChart3 size={15} /> : <Table2 size={15} />}{table ? "Grafik" : "Tablo"}</button>
      </div>
      {income && !incomeEnabled ? (
        <p className="small muted" style={{ padding: "24px 0" }}>Aylık gelir karşılaştırması için <a href="#/settings">Ayarlar</a>'dan nöbet ücreti tablonu seç ya da saat ücretini gir.</p>
      ) : table ? (
        <div style={{ overflowX: "auto" }}>
          <table className="data">
            <thead><tr><th>Ay</th><th className="num">Saat</th><th className="num">Nöbet</th><th className="num">Fazla mesai</th><th className="num">Tatil</th><th className="num">Tahmini gelir</th></tr></thead>
            <tbody>{series.map((s) => (
              <tr key={`${s.year}-${s.month}`}>
                <td>{MONTHS_SHORT[s.month - 1]} {s.year}</td><td className="num">{fmtNum(s.workHours)}</td><td className="num">{s.shiftCount}</td>
                <td className="num">{fmtNum(s.overtimeHours)}</td><td className="num">{fmtNum(s.holidayHours)}</td>
                <td className="num">{incomeEnabled ? fmtMoney(s.estimatedIncome) : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div className="chart" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={income ? "Son 12 ayın tahmini nöbet geliri" : "Son 12 ayın aylık çalışma saatleri"}>
            {ticks.map((t) => (
              <g key={t}>
                <line className="gridline" x1={pad.l} x2={W - pad.r} y1={yOf(t)} y2={yOf(t)} />
                <text className="axis" x={pad.l - 6} y={yOf(t) + 4} textAnchor="end">{label(t)}</text>
              </g>
            ))}
            {series.map((s, i) => {
              const x = pad.l + i * bw + bw * 0.18, w = bw * 0.64;
              const y = yOf(val(s)), hh = pad.t + ih - y;
              const sel = s.year === selected.y && s.month === selected.m;
              const r = Math.min(4, w / 2, hh);
              return (
                <g key={`${s.year}-${s.month}`}>
                  {hh > 0 && (
                    <path className={`bar ${hover != null && hover !== i ? "dim" : ""} ${sel ? "sel" : ""}`}
                      d={`M${x},${y + hh} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + hh} Z`} />
                  )}
                  <text className="axis" x={x + w / 2} y={H - 8} textAnchor="middle" style={sel ? { fill: "var(--text)", fontWeight: 700 } : undefined}>{MONTHS_SHORT[s.month - 1]}</text>
                </g>
              );
            })}
            {avg > 0 && (
              <g pointerEvents="none">
                <line className="norm" x1={pad.l} x2={W - pad.r} y1={yOf(avg)} y2={yOf(avg)} />
                <text className="axis" x={pad.l + 4} y={yOf(avg) - 6} textAnchor="start"
                  style={{ paintOrder: "stroke", stroke: "var(--surface)", strokeWidth: 4, strokeLinejoin: "round" }}>ort. {label(avg)}</text>
              </g>
            )}
            {series.map((s, i) => (
              <rect key={`hit-${s.year}-${s.month}`} className="hit" x={pad.l + i * bw} y={pad.t} width={bw} height={ih + pad.b}
                onMouseEnter={() => setHover(i)} onClick={() => onSelect(s.year, s.month)} />
            ))}
          </svg>
          {h && hover != null && (
            <div className="tooltip" style={{ left: `${((pad.l + hover * bw + bw / 2) / W) * 100}%`, top: `${(yOf(val(h)) / H) * 100}%` }}>
              {MONTHS[h.month - 1]} {h.year}<br />
              <b>{income ? fmtMoney(h.estimatedIncome) : `${fmtNum(h.workHours)} saat`}</b>
              {income ? <> · {fmtNum(h.overtimeHours)} sa fazla mesai</> : <> · {h.shiftCount} nöbet</>}
            </div>
          )}
        </div>
      )}
      {!(income && !incomeEnabled) && !table && (
        <p className="tiny faint" style={{ marginTop: 6 }}>Bir aya dokunarak o ayın ayrıntısını aç. Kesikli çizgi, kaydı olan ayların ortalaması.</p>
      )}
    </div>
  );
}

/** Seçili ayın gelirini önceki ay, 12 aylık ortalama ve en yüksek ayla karşılaştırır */
function IncomeCompare({ data, ym }: { data: StatsResponse; ym: { y: number; m: number } }) {
  const series = data.series;
  const i = series.findIndex((s) => s.year === ym.y && s.month === ym.m);
  const cur = series[i];
  if (!cur) return null;
  const prev = i > 0 ? series[i - 1] : undefined;
  const avg = average(series, (s) => s.estimatedIncome);
  const best = series.reduce<MonthPoint | undefined>((b, s) => (s.estimatedIncome > 0 && (!b || s.estimatedIncome > b.estimatedIncome) ? s : b), undefined);
  const total = series.reduce((a, s) => a + s.estimatedIncome, 0);
  const diff = prev ? cur.estimatedIncome - prev.estimatedIncome : 0;
  const pct = prev && prev.estimatedIncome > 0 ? Math.round((diff / prev.estimatedIncome) * 100) : null;
  const Icon = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus;
  return (
    <div className="stack" style={{ gap: 8, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
      {prev && (
        <div className="row between small">
          <span className="muted">{MONTHS[prev.month - 1]} ayına göre</span>
          <span className="row" style={{ gap: 4, fontWeight: 600 }}>
            <Icon size={15} aria-hidden />
            {diff === 0 ? "Değişmedi" : <>{diff > 0 ? "+" : "−"}{fmtMoney(Math.abs(diff))}{pct != null && ` (%${Math.abs(pct)})`}</>}
          </span>
        </div>
      )}
      <div className="row between small"><span className="muted">12 ay ortalaması</span><b>{fmtMoney(Math.round(avg))}</b></div>
      {best && <div className="row between small"><span className="muted">En yüksek ay</span><b>{MONTHS[best.month - 1]} {best.year} · {fmtMoney(best.estimatedIncome)}</b></div>}
      <div className="row between small"><span className="muted">Son 12 ay toplamı</span><b>{fmtMoney(total)}</b></div>
    </div>
  );
}
