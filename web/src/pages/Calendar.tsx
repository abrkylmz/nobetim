import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Eraser, FileText, Plus } from "lucide-react";
import { CATEGORY_META, isWork, type Shift } from "../../../shared/types";
import { addDays, daysInMonth, toMs, weekday, ymd, HOUR } from "../../../shared/time";
import { holidayOn } from "../../../shared/holidays";
import { api } from "../lib/api";
import { useApp, useLoad } from "../lib/app";
import { fmtDate, fmtHours, fmtNum, MONTHS, shiftRange, shortCode, todayStr, WEEKDAYS_SHORT } from "../lib/format";
import { Alert, CodeChip, Modal, Spinner } from "../components/ui";
import { ShiftEditor } from "../components/ShiftEditor";

type View = "month" | "week";

/** Bir günde görünen kayıtlar: o gün başlayanlar + önceki günden sarkanlar */
function dayItems(shifts: Shift[], date: string) {
  const start = shifts.filter((s) => s.date === date);
  const cont = shifts.filter((s) => s.date !== date && s.startAt && s.endAt && s.endAt.slice(0, 10) >= date && s.startAt.slice(0, 10) < date && s.endAt > `${date}T00:00`);
  return { start, cont };
}

export function CalendarPage() {
  const t = todayStr();
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(t);
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ shift?: Shift; date: string } | null>(null);

  const y = +cursor.slice(0, 4), m = +cursor.slice(5, 7);
  const weekStart = addDays(cursor, -weekday(cursor));
  const range = view === "month"
    ? { from: addDays(ymd(y, m, 1), -weekday(ymd(y, m, 1))), to: addDays(ymd(y, m, daysInMonth(y, m)), 6 - weekday(ymd(y, m, daysInMonth(y, m)))) }
    : { from: weekStart, to: addDays(weekStart, 6) };
  const { data: shifts, reload, error } = useLoad(() => api.shifts(range.from, range.to), [range.from, range.to]);
  const list = shifts ?? [];

  const monthHours = useMemo(() => list.filter((s) => s.date.startsWith(cursor.slice(0, 7)) && isWork(s.category)).reduce((n, s) => n + s.hours, 0), [list, cursor]);

  const move = (dir: number) => {
    if (view === "month") { const d = new Date(Date.UTC(y, m - 1 + dir, 1)); setCursor(ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); }
    else setCursor(addDays(cursor, dir * 7));
  };
  const title = view === "month" ? `${MONTHS[m - 1]} ${y}` : `${fmtDate(weekStart)} – ${fmtDate(addDays(weekStart, 6), { year: true })}`;
  const days: string[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) days.push(d);

  const done = () => { setEditor(null); setDayOpen(null); void reload(); };

  // Ayı temizle: yalnızca bu ayda başlayan kayıtlar (önceki aydan sarkan gece nöbeti hariç)
  const [clearing, setClearing] = useState(false);
  const monthList = list.filter((s) => s.date.startsWith(cursor.slice(0, 7)));
  const monthCount = monthList.length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Takvim</h1>
          <p className="muted">{view === "month" ? `Bu ay ${fmtNum(monthHours)} saat çalışma planlandı` : "Haftalık görünüm"}</p>
        </div>
        <div className="row">
          <div className="seg">
            <button className={view === "month" ? "on" : ""} onClick={() => setView("month")}>Aylık</button>
            <button className={view === "week" ? "on" : ""} onClick={() => setView("week")}>Haftalık</button>
          </div>
          {view === "month" && monthCount > 0 && (
            <button className="btn danger" onClick={() => setClearing(true)}><Eraser size={17} />Ayı temizle</button>
          )}
          <button className="btn" onClick={() => setEditor({ date: cursor.slice(0, 7) === t.slice(0, 7) ? t : cursor })}><Plus size={18} />Nöbet ekle</button>
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div className="row between" style={{ marginBottom: 14 }}>
          <div className="row" style={{ gap: 4 }}>
            <button className="iconbtn" onClick={() => move(-1)} aria-label="Önceki"><ChevronLeft size={22} /></button>
            <button className="iconbtn" onClick={() => move(1)} aria-label="Sonraki"><ChevronRight size={22} /></button>
            <h2 style={{ marginLeft: 6 }}>{title}</h2>
          </div>
          <button className="btn ghost sm" onClick={() => setCursor(t)}>Bugün</button>
        </div>
        {error && <Alert kind="err">{error}</Alert>}
        {view === "month" ? (
          <div className="cal">
            {WEEKDAYS_SHORT.map((w) => <div key={w} className="wd">{w}</div>)}
            {days.map((d) => {
              const { start, cont } = dayItems(list, d);
              const hol = holidayOn(d);
              return (
                <button key={d} className={`day ${d.slice(0, 7) !== cursor.slice(0, 7) ? "out" : ""} ${d === t ? "today" : ""} ${weekday(d) >= 5 ? "weekend" : ""}`} onClick={() => setDayOpen(d)}
                  aria-label={`${fmtDate(d, { weekday: true })}: ${start.map((s) => s.label).join(", ") || "kayıt yok"}`}>
                  <span className="num"><b>{+d.slice(8)}</b></span>
                  {hol && <span className="hol" title={hol.name}>{hol.name}</span>}
                  {cont.map((s) => (
                    <span key={s.id + "c"} className="pill cont" style={{ ["--c" as string]: s.color }}>↳<span className="t">{s.endAt!.slice(11)}'e kadar</span></span>
                  ))}
                  {start.slice(0, 3).map((s) => (
                    <span key={s.id} className="pill" style={{ ["--c" as string]: s.color }} title={s.code}>{shortCode(s.code)}<span className="t">{s.startAt ? s.startAt.slice(11) : s.label}</span></span>
                  ))}
                  {start.length > 3 && <span className="tiny muted">+{start.length - 3}</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <WeekView days={days} shifts={list} today={t} onDay={setDayOpen} onShift={(s) => setEditor({ shift: s, date: s.date })} />
        )}
        <div className="row" style={{ marginTop: 14, gap: 14 }}>
          {(Object.keys(CATEGORY_META) as (keyof typeof CATEGORY_META)[]).filter((c) => list.some((s) => s.category === c)).map((c) => (
            <span key={c} className="row small muted" style={{ gap: 6 }}><span className="dot" style={{ background: CATEGORY_META[c].color }} />{CATEGORY_META[c].label}</span>
          ))}
        </div>
      </div>

      {dayOpen && !editor && (
        <DaySheet date={dayOpen} shifts={list} onClose={() => setDayOpen(null)} onEdit={(s) => setEditor({ shift: s, date: s.date })} onAdd={() => setEditor({ date: dayOpen })} />
      )}
      {editor && <ShiftEditor shift={editor.shift} date={editor.date} onClose={() => setEditor(null)} onSaved={done} />}
      {clearing && (
        <ClearMonthDialog year={y} month={m} shifts={monthList} onClose={() => setClearing(false)} onDone={() => { setClearing(false); void reload(); }} />
      )}
    </div>
  );
}

function ClearMonthDialog({ year, month, shifts, onClose, onDone }: { year: number; month: number; shifts: Shift[]; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const fromRoster = shifts.filter((s) => s.importId).length;
  const manual = shifts.length - fromRoster;
  return (
    <Modal title={`${MONTHS[month - 1]} ${year} temizlensin mi?`} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Vazgeç</button>
      <button className="btn danger" disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          const r = await api.clearShifts(ymd(year, month, 1), ymd(year, month, daysInMonth(year, month)));
          toast(`${r.removed} kayıt takvimden kaldırıldı.`);
          onDone();
        } catch (e) { toast((e as Error).message, "err"); setBusy(false); }
      }}>{busy ? <Spinner /> : <Eraser size={17} />}{shifts.length} kaydı sil</button>
    </>}>
      <p>Bu ayda başlayan <b>{shifts.length} kayıt</b> takvimden kalıcı olarak silinecek:</p>
      <ul className="small" style={{ margin: "10px 0 0", paddingLeft: 18 }}>
        <li>{fromRoster} kayıt çizelgeden</li>
        <li>{manual} kayıt elle eklenmiş</li>
      </ul>
      <p className="small muted" style={{ marginTop: 12 }}>
        Yüklediğin çizelgeler dosya geçmişinde kalır; istersen oradan yeniden analiz edip tekrar ekleyebilirsin.
      </p>
    </Modal>
  );
}

function DaySheet({ date, shifts, onClose, onEdit, onAdd }: { date: string; shifts: Shift[]; onClose: () => void; onEdit: (s: Shift) => void; onAdd: () => void }) {
  const { start, cont } = dayItems(shifts, date);
  const hol = holidayOn(date);
  return (
    <Modal title={fmtDate(date, { weekday: true, year: true })} onClose={onClose} footer={<button className="btn" onClick={onAdd}><Plus size={18} />Bu güne nöbet ekle</button>}>
      {hol && <div style={{ marginBottom: 12 }}><Alert kind="info">Resmî tatil: {hol.name}{hol.half && " (13:00'ten itibaren)"}</Alert></div>}
      {start.length === 0 && cont.length === 0 && <p className="muted">Bu gün için kayıt yok.</p>}
      <div className="stack" style={{ gap: 10 }}>
        {cont.map((s) => (
          <div key={s.id + "c"} className="list-item" style={{ opacity: .75 }}>
            <CodeChip code={s.code} color={s.color} />
            <div style={{ flex: 1 }}><b>{s.label}</b><div className="small muted">Önceki günden devam ediyor · {s.endAt!.slice(11)}'de biter</div></div>
          </div>
        ))}
        {start.map((s) => (
          <div key={s.id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
            <button className="list-item" style={{ background: "none", border: 0, width: "100%", textAlign: "left", cursor: "pointer", color: "inherit" }} onClick={() => onEdit(s)}>
              <CodeChip code={s.code} color={s.color} />
              <div style={{ flex: 1 }}>
                <b>{s.label}</b>{s.isExtra && <span className="badge warn" style={{ marginLeft: 6 }}>Ek nöbet</span>}
                <div className="small muted">{shiftRange(s)}{isWork(s.category) && ` · ${fmtHours(s.hours)}`}{s.department && ` · ${s.department}`}</div>
                {s.note && <div className="small">{s.note}</div>}
              </div>
              <span className="badge neutral">{s.importId ? "Çizelgeden" : "Elle eklendi"}</span>
            </button>
            {s.importId && (
              <a className="small row" style={{ gap: 4, paddingLeft: 52 }} href={`#/imports/${s.importId}`}>
                <FileText size={14} />Kaynak çizelgeyi aç (tüm çizelgeyi silmek için)
              </a>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

const ROW = 40; // her saat 40px (CSS ile aynı)

function WeekView({ days, shifts, today, onDay, onShift }: { days: string[]; shifts: Shift[]; today: string; onDay: (d: string) => void; onShift: (s: Shift) => void }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <div className="week" style={{ minWidth: 640 }}>
        <div className="head" />
        {days.map((d) => (
          <div key={d} className={`head ${d === today ? "today" : ""}`}>{WEEKDAYS_SHORT[weekday(d)]}<b>{+d.slice(8)}</b></div>
        ))}
        <div className="hours" style={{ height: ROW * 24 }}>
          {Array.from({ length: 23 }, (_, h) => <span key={h} style={{ top: (h + 1) * ROW }}>{String(h + 1).padStart(2, "0")}:00</span>)}
        </div>
        {days.map((d) => {
          const day0 = toMs(d);
          const blocks = shifts.filter((s) => s.startAt && s.endAt && toMs(s.startAt) < day0 + 24 * HOUR && toMs(s.endAt) > day0);
          const allDay = shifts.filter((s) => s.date === d && !s.startAt);
          return (
            <div key={d} className="col" style={{ height: ROW * 24 }} onClick={() => onDay(d)}>
              {allDay.map((s, i) => (
                <div key={s.id} className="block" style={{ top: 2 + i * 26, height: 24, ["--c" as string]: s.color }} onClick={(e) => { e.stopPropagation(); onShift(s); }}>{s.label}</div>
              ))}
              {blocks.map((s) => {
                const a = Math.max(toMs(s.startAt!), day0), b = Math.min(toMs(s.endAt!), day0 + 24 * HOUR);
                const top = ((a - day0) / HOUR) * ROW, h = ((b - a) / HOUR) * ROW;
                const continued = toMs(s.startAt!) < day0;
                return (
                  <div key={s.id} className="block" title={`${s.label} ${shiftRange(s)}`}
                    style={{ top: top + 1, height: Math.max(18, h - 2), ["--c" as string]: s.color, borderLeftStyle: continued ? "dashed" : "solid" }}
                    onClick={(e) => { e.stopPropagation(); onShift(s); }}>
                    {s.code} · {continued ? `↳ ${s.endAt!.slice(11)}` : `${s.startAt!.slice(11)}–${s.endAt!.slice(11)}`}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
