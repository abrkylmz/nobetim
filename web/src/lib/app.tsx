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
const THEME_KEY = "nobetim.theme";

function applyTheme(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0D1720" : "#087F8C");
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => {
    try { return (localStorage.getItem(THEME_KEY) as ThemePref) || "system"; } catch { return "system"; }
  });
  useEffect(() => {
    applyTheme(pref);
    try { localStorage.setItem(THEME_KEY, pref); } catch { /* yok say */ }
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => pref === "system" && applyTheme("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [pref]);
  return [pref, setPref] as const;
}

// ---------- uygulama bağlamı ----------

interface Toast { id: number; text: string; kind: "ok" | "err" }
interface Ctx {
  me: MeResponse;
  refreshMe: () => Promise<void>;
  toast: (text: string, kind?: Toast["kind"]) => void;
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
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
