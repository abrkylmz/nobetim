// Nöbetim — iPhone widget'ı (Scriptable)
// Kurulum: Nöbetim > Ayarlar > iPhone widget'ı. Bu betiği oradaki "Betiği kopyala" düğmesiyle al;
// bağlantı anahtarı içine yerleştirilmiş olarak gelir.
// Widget parametresi: "pembe" yazarsan pastel pembe tema, boş bırakırsan turkuaz.

const BASE = "__BASE__";
const TOKEN = "__TOKEN__";

const param = String(args.widgetParameter || "").toLowerCase();
const PINK = /pembe|pink/.test(param);
const C = PINK
  ? { primary: dyn("#B83E74", "#F29BC1"), soft: dyn("#FBE3EE", "#3B1F2E"), bg: dyn("#FFFFFF", "#24171E"), text: dyn("#3D2733", "#F7E9EF"), text2: dyn("#7A5868", "#D1B4C2"), line: dyn("#F4DCE6", "#3D2A34") }
  : { primary: dyn("#087F8C", "#22A6B3"), soft: dyn("#DFF5EF", "#123A3B"), bg: dyn("#FFFFFF", "#15222D"), text: dyn("#263746", "#E4ECF2"), text2: dyn("#55697A", "#A4B5C3"), line: dyn("#E3EAF0", "#243645") };

const DAYS = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const CACHE = "nobetim-widget.json";

function dyn(light, dark) { return Color.dynamic(new Color(light), new Color(dark)); }
function toDate(s) {
  const [d, t = "00:00"] = s.split("T");
  const [y, m, dd] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  return new Date(y, m - 1, dd, h, mi);
}
const hm = (s) => s.slice(11, 16);
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
function dayLabel(s, now) {
  const d = toDate(s);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (sameDay(d, now)) return "Bugün";
  if (sameDay(d, tomorrow)) return "Yarın";
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
const fmtHours = (h) => `${String(Math.round(h * 10) / 10).replace(".", ",")} sa`;
function symbolFor(s) {
  if (s.category === "24h") return "clock.fill";
  if (s.category === "night" || s.startAt.slice(0, 10) !== s.endAt.slice(0, 10)) return "moon.fill";
  if (s.category === "evening") return "sunset.fill";
  return "sun.max.fill";
}
const title = (s) => (s.isExtra ? `${s.label} · ek` : s.label);

// ---------- veri ----------
async function load() {
  const fm = FileManager.local();
  const path = fm.joinPath(fm.documentsDirectory(), CACHE);
  try {
    const req = new Request(`${BASE}/api/widget?tz=${new Date().getTimezoneOffset()}`);
    req.headers = { Authorization: `Bearer ${TOKEN}` };
    req.timeoutInterval = 15;
    const body = await req.loadJSON();
    const status = req.response && req.response.statusCode;
    if (status === 401) return { error: "Bağlantı geçersiz", hint: "Nöbetim > Ayarlar'dan yeni bağlantı oluştur." };
    if (status !== 200) throw new Error(`HTTP ${status}`);
    fm.writeString(path, JSON.stringify(body));
    return { data: body, offline: false };
  } catch (e) {
    if (fm.fileExists(path)) return { data: JSON.parse(fm.readString(path)), offline: true };
    return { error: "Bağlanılamadı", hint: "İnternet bağlantını kontrol et." };
  }
}

/** Sunucu yanıtını şimdiki zamana göre yeniden değerlendir (önbellekten gelse de doğru kalsın) */
function arrange(data, now) {
  const all = [data.current, data.next, ...(data.upcoming || [])].filter(Boolean);
  const live = all.filter((s) => toDate(s.endAt) > now);
  const current = live.find((s) => toDate(s.startAt) <= now) || null;
  const rest = live.filter((s) => s !== current);
  return { current, next: rest[0] || null, later: rest.slice(1), month: data.month };
}

// ---------- çizim yardımcıları ----------
function text(stack, str, size, weight, color, opts = {}) {
  const t = stack.addText(str);
  t.font = weight === "bold" ? Font.boldRoundedSystemFont(size) : weight === "semi" ? Font.semiboldRoundedSystemFont(size) : weight === "med" ? Font.mediumSystemFont(size) : Font.systemFont(size);
  t.textColor = color;
  t.lineLimit = opts.lines || 1;
  t.minimumScaleFactor = opts.scale || 0.7;
  return t;
}
function icon(stack, name, size, color) {
  const sym = SFSymbol.named(name);
  if (!sym) return;
  const img = stack.addImage(sym.image);
  img.imageSize = new Size(size, size);
  img.tintColor = color;
}
function header(stack, label, symbol) {
  const h = stack.addStack();
  h.centerAlignContent();
  icon(h, symbol, 11, C.primary);
  h.addSpacer(4);
  text(h, label.toLocaleUpperCase("tr-TR"), 10, "semi", C.primary);
}
function relative(stack, date, prefix, size = 11, timer = false) {
  const row = stack.addStack();
  row.centerAlignContent();
  if (prefix) { text(row, prefix, size, "med", C.text2); row.addSpacer(3); }
  const d = row.addDate(date);
  if (timer) d.applyTimerStyle(); else d.applyRelativeStyle();
  d.font = Font.semiboldSystemFont(size);
  d.textColor = C.primary;
  d.lineLimit = 1;
  d.minimumScaleFactor = 0.7;
}
function progress(stack, s, now, width) {
  const a = toDate(s.startAt).getTime(), b = toDate(s.endAt).getTime();
  const f = Math.max(0.04, Math.min(1, (now.getTime() - a) / (b - a)));
  const track = stack.addStack();
  track.size = new Size(width, 6);
  track.cornerRadius = 3;
  track.backgroundColor = C.soft;
  const fill = track.addStack();
  fill.size = new Size(Math.round(width * f), 6);
  fill.cornerRadius = 3;
  fill.backgroundColor = C.primary;
  track.addSpacer();
}

/** Ana blok: şu anki ya da sıradaki nöbet */
function mainBlock(stack, v, now, width) {
  const s = v.current || v.next;
  if (!s) {
    header(stack, "Sıradaki nöbet", "calendar");
    stack.addSpacer(8);
    text(stack, "Yaklaşan nöbet yok", 16, "bold", C.text, { lines: 2 });
    stack.addSpacer(4);
    text(stack, "Yeni çizelgeni Nöbetim'e yükle.", 11, "", C.text2, { lines: 2 });
    return;
  }
  if (v.current) {
    header(stack, "Şu an nöbettesin", symbolFor(s));
    stack.addSpacer(6);
    text(stack, `Bitiş ${hm(s.endAt)}`, 22, "bold", C.text);
    stack.addSpacer(2);
    text(stack, `${title(s)} · ${fmtHours(s.hours)}`, 12, "med", C.text2);
    stack.addSpacer(8);
    progress(stack, s, now, width);
    stack.addSpacer(6);
    relative(stack, toDate(s.endAt), "Kalan:", 11, true);
  } else {
    header(stack, "Sıradaki nöbet", symbolFor(s));
    stack.addSpacer(6);
    text(stack, dayLabel(s.startAt, now), 22, "bold", C.text);
    stack.addSpacer(2);
    text(stack, `${hm(s.startAt)} → ${hm(s.endAt)}`, 16, "semi", C.text);
    stack.addSpacer(2);
    text(stack, `${title(s)} · ${fmtHours(s.hours)}`, 12, "med", C.text2);
    stack.addSpacer();
    relative(stack, toDate(s.startAt), "");
  }
}

function listRow(stack, s, now) {
  const row = stack.addStack();
  row.centerAlignContent();
  const dot = row.addStack();
  dot.size = new Size(4, 26);
  dot.cornerRadius = 2;
  dot.backgroundColor = new Color(s.color || "#8496A6");
  row.addSpacer(8);
  const col = row.addStack();
  col.layoutVertically();
  text(col, dayLabel(s.startAt, now), 12, "semi", C.text);
  text(col, `${hm(s.startAt)} → ${hm(s.endAt)} · ${fmtHours(s.hours)}`, 10, "", C.text2);
  row.addSpacer();
}

function footer(stack, v, offline) {
  const f = stack.addStack();
  f.centerAlignContent();
  if (v.month) text(f, `Bu ay ${v.month.shiftCount} nöbet · ${fmtHours(v.month.workHours)}`, 10, "med", C.text2);
  f.addSpacer();
  if (offline) text(f, "çevrimdışı", 9, "", C.text2);
}

// ---------- widget boyutları ----------
function build(family, res, now) {
  const w = new ListWidget();
  w.url = `${BASE}/#/calendar`;

  if (res.error) {
    if (family.startsWith("accessory")) { text(w, res.error, 12, "semi", Color.white()); return w; }
    w.backgroundColor = C.bg;
    w.setPadding(14, 14, 14, 14);
    header(w, "Nöbetim", "exclamationmark.triangle.fill");
    w.addSpacer(6);
    text(w, res.error, 16, "bold", C.text, { lines: 2 });
    w.addSpacer(4);
    text(w, res.hint, 11, "", C.text2, { lines: 3 });
    w.refreshAfterDate = new Date(now.getTime() + 15 * 60_000);
    return w;
  }

  const v = arrange(res.data, now);
  const s = v.current || v.next;
  // Bir sonraki değişimde (nöbet başlangıcı/bitişi) ya da en geç 30 dakikada bir yenile
  const edges = [now.getTime() + 30 * 60_000];
  if (v.current) edges.push(toDate(v.current.endAt).getTime());
  if (v.next) edges.push(toDate(v.next.startAt).getTime());
  w.refreshAfterDate = new Date(Math.max(now.getTime() + 5 * 60_000, Math.min(...edges)));

  if (family === "accessoryInline") {
    text(w, !s ? "Yaklaşan nöbet yok" : v.current ? `Nöbette · bitiş ${hm(s.endAt)}` : `Nöbet: ${dayLabel(s.startAt, now)} ${hm(s.startAt)}`, 12, "semi", Color.white());
    return w;
  }
  if (family === "accessoryCircular") {
    w.addAccessoryWidgetBackground = true;
    const c = w.addStack();
    c.layoutVertically();
    c.centerAlignContent();
    const top = c.addStack(); top.addSpacer(); icon(top, s ? symbolFor(s) : "calendar", 12, Color.white()); top.addSpacer();
    const mid = c.addStack(); mid.addSpacer();
    text(mid, s ? (v.current ? hm(s.endAt) : hm(s.startAt)) : "—", 13, "bold", Color.white()); mid.addSpacer();
    const bot = c.addStack(); bot.addSpacer();
    text(bot, s ? (v.current ? "biter" : dayLabel(s.startAt, now).split(" ")[0]) : "", 9, "med", Color.white()); bot.addSpacer();
    return w;
  }
  if (family === "accessoryRectangular") {
    if (!s) { text(w, "Yaklaşan nöbet yok", 13, "semi", Color.white()); return w; }
    const h = w.addStack(); h.centerAlignContent();
    icon(h, symbolFor(s), 12, Color.white()); h.addSpacer(4);
    text(h, v.current ? "Nöbettesin" : dayLabel(s.startAt, now), 14, "bold", Color.white());
    text(w, `${hm(s.startAt)} → ${hm(s.endAt)} · ${fmtHours(s.hours)}`, 12, "med", Color.white());
    const d = w.addDate(toDate(v.current ? s.endAt : s.startAt));
    d.applyRelativeStyle();
    d.font = Font.systemFont(12);
    d.textColor = Color.white();
    return w;
  }

  w.backgroundColor = C.bg;
  w.setPadding(14, 14, 14, 14);

  if (family === "small") {
    mainBlock(w, v, now, 120);
    return w;
  }

  if (family === "medium") {
    const row = w.addStack();
    const left = row.addStack();
    left.layoutVertically();
    left.size = new Size(140, 0);
    mainBlock(left, v, now, 128);
    row.addSpacer(12);
    const sep = row.addStack(); sep.size = new Size(1, 0); sep.backgroundColor = C.line;
    row.addSpacer(12);
    const right = row.addStack();
    right.layoutVertically();
    text(right, "SONRAKİLER", 10, "semi", C.text2);
    right.addSpacer(6);
    const later = v.current ? [v.next, ...v.later].filter(Boolean) : v.later;
    if (!later.length) text(right, "Başka nöbet yok", 11, "", C.text2);
    later.slice(0, 3).forEach((x, i) => { if (i) right.addSpacer(5); listRow(right, x, now); });
    right.addSpacer();
    return w;
  }

  // large ve extraLarge
  const top = w.addStack();
  top.layoutVertically();
  mainBlock(top, v, now, 280);
  w.addSpacer(12);
  const sep = w.addStack(); sep.size = new Size(0, 1); sep.backgroundColor = C.line;
  w.addSpacer(10);
  text(w, "SONRAKİ NÖBETLER", 10, "semi", C.text2);
  w.addSpacer(6);
  const later = v.current ? [v.next, ...v.later].filter(Boolean) : v.later;
  if (!later.length) text(w, "Başka nöbet yok", 12, "", C.text2);
  later.slice(0, 5).forEach((x, i) => { if (i) w.addSpacer(6); listRow(w, x, now); });
  w.addSpacer();
  footer(w, v, res.offline);
  return w;
}

// ---------- çalıştır ----------
const now = new Date();
const res = await load();
if (config.runsInWidget || config.runsInAccessoryWidget) {
  Script.setWidget(build(config.widgetFamily || "small", res, now));
} else {
  // Uygulama içinden çalıştırınca önizleme göster
  const a = new Alert();
  a.title = "Nöbetim widget'ı";
  a.message = res.error ? `${res.error}. ${res.hint}` : "Önizlemek istediğin boyutu seç.";
  ["Küçük", "Orta", "Büyük"].forEach((x) => a.addAction(x));
  a.addCancelAction("Kapat");
  const i = await a.presentSheet();
  if (i === 0) await build("small", res, now).presentSmall();
  if (i === 1) await build("medium", res, now).presentMedium();
  if (i === 2) await build("large", res, now).presentLarge();
}
Script.complete();
