import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { MeResponse } from "./api";

// ---------- yönlendirme (hash tabanlı) ----------

export function useRoute(): string {
  const [route, setRoute] = useState(() => location.hash.slice(1) || "/");
  useEffect(() => {
    const on = () => { setRoute(location.hash.slice(1) || "/"); window.scrollTo({ top: 0 }); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
export const go = (path: string) => { location.hash = path; };

// ---------- tema ----------

export type ThemePref = "system" | "light" | "dark";
/** Renk teması: açık/koyu tercihinden bağımsızdır (pembe tema da koyu modda çalışır). */
export type Palette = "teal" | "pink";
const THEME_KEY = "nobetim.theme";
const PALETTE_KEY = "nobetim.palette";

// Tarayıcı çubuğunun rengi (mobilde adres çubuğu)
const BAR_COLOR: Record<Palette, { light: string; dark: string }> = {
  teal: { light: "#087F8C", dark: "#0D1720" },
  pink: { light: "#B83E74", dark: "#1A1116" },
};

const read = <T extends string>(key: string, fallback: T): T => {
  try { return (localStorage.getItem(key) as T) || fallback; } catch { return fallback; }
};

function applyTheme(pref: ThemePref, palette: Palette) {
  const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.palette = palette;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR_COLOR[palette][dark ? "dark" : "light"]);
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => read<ThemePref>(THEME_KEY, "system"));
  const [palette, setPalette] = useState<Palette>(() => (read<Palette>(PALETTE_KEY, "teal") === "pink" ? "pink" : "teal"));
  useEffect(() => {
    applyTheme(pref, palette);
    try { localStorage.setItem(THEME_KEY, pref); localStorage.setItem(PALETTE_KEY, palette); } catch { /* yok say */ }
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => pref === "system" && applyTheme("system", palette);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [pref, palette]);
  return { pref, setPref, palette, setPalette };
}

// ---------- uygulama bağlamı ----------

interface Toast { id: number; text: string; kind: "ok" | "err" }
interface Ctx {
  me: MeResponse;
  refreshMe: () => Promise<void>;
  toast: (text: string, kind?: Toast["kind"]) => void;
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
  palette: Palette;
  setPalette: (p: Palette) => void;
}
const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppCtx)!;

export function AppProvider({ value, children }: { value: Omit<Ctx, "toast">; children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const toast = useCallback((text: string, kind: Toast["kind"] = "ok") => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);
  return (
    <AppCtx.Provider value={{ ...value, toast }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind === "err" ? "err" : ""}`}>{t.text}</div>)}
      </div>
    </AppCtx.Provider>
  );
}

// ---------- veri yükleme ----------

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try { setData(await fn()); setError(null); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void reload(); }, [reload]);
  return { data, setData, error, loading, reload };
}

/** Her `ms` milisaniyede bir yeniden çizer (geri sayım için). */
export function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(t); }, [ms]);
}
