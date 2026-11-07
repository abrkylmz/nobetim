import { useCallback, useEffect, useState } from "react";
import { BarChart3, CalendarDays, FileClock, Home, Settings, Upload } from "lucide-react";
import { api, ApiError, type MeResponse } from "./lib/api";
import { AppProvider, go, useRoute, useTheme } from "./lib/app";
import { Spinner } from "./components/ui";
import { AuthPage } from "./pages/Auth";
import { OnboardingPage } from "./pages/Onboarding";
import { DashboardPage } from "./pages/Dashboard";
import { UploadPage } from "./pages/Upload";
import { ReviewPage } from "./pages/Review";
import { CalendarPage } from "./pages/Calendar";
import { StatsPage } from "./pages/Stats";
import { HistoryPage } from "./pages/History";
import { SettingsPage } from "./pages/Settings";

const NAV = [
  { path: "/", label: "Ana sayfa", short: "Ana sayfa", icon: Home },
  { path: "/calendar", label: "Takvim", short: "Takvim", icon: CalendarDays },
  { path: "/upload", label: "Nöbet listesi yükle", short: "Yükle", icon: Upload },
  { path: "/stats", label: "İstatistik", short: "İstatistik", icon: BarChart3 },
  { path: "/history", label: "Dosya geçmişi", short: "Geçmiş", icon: FileClock },
];

export function App() {
  const route = useRoute();
  const [theme, setTheme] = useTheme();
  const [me, setMe] = useState<MeResponse | null | undefined>(undefined);

  const refreshMe = useCallback(async () => {
    try { setMe(await api.me()); }
    catch (e) { if (e instanceof ApiError && e.status === 401) setMe(null); else throw e; }
  }, []);
  useEffect(() => { void refreshMe().catch(() => setMe(null)); }, [refreshMe]);

  if (me === undefined) return <div style={{ display: "grid", placeItems: "center", height: "100vh" }}><Spinner size={28} /></div>;
  if (me === null) return <AuthPage onDone={refreshMe} />;
  const ctx = { me, refreshMe, theme, setTheme };
  if (!me.profile) return <AppProvider value={ctx}><OnboardingPage /></AppProvider>;

  const [, section, id] = route.split("/");
  let page;
  switch (section) {
    case "": page = <DashboardPage />; break;
    case "upload": page = <UploadPage />; break;
    case "imports": page = id ? <ReviewPage key={id} id={id} /> : <HistoryPage />; break;
    case "calendar": page = <CalendarPage />; break;
    case "stats": page = <StatsPage />; break;
    case "history": page = <HistoryPage />; break;
    case "settings": page = <SettingsPage />; break;
    default: go("/"); page = null;
  }
  const active = section === "imports" ? "/history" : `/${section}`;

  return (
    <AppProvider value={ctx}>
      <div className="app">
        <aside className="sidebar">
          <div className="brand"><img src="/favicon.svg" alt="" />Nöbetim</div>
          {NAV.map((n) => (
            <a key={n.path} href={`#${n.path}`} className={`navlink ${active === n.path ? "on" : ""}`}>
              <n.icon size={19} />{n.label}
            </a>
          ))}
          <div className="spacer" />
          <a href="#/settings" className={`navlink ${active === "/settings" ? "on" : ""}`}><Settings size={19} />Ayarlar</a>
          <div className="small faint" style={{ padding: "8px 12px" }}>{me.profile.fullName}<br />{me.profile.department || me.profile.hospital}</div>
        </aside>
        <div className="main">
          <header className="topbar">
            <div className="brand" style={{ padding: 0 }}><img src="/favicon.svg" alt="" style={{ width: 30, height: 30 }} />Nöbetim</div>
            <a href="#/settings" className="iconbtn" aria-label="Ayarlar"><Settings size={22} /></a>
          </header>
          {page}
        </div>
        <nav className="bottomnav" aria-label="Ana menü">
          {NAV.map((n) => n.path === "/upload" ? (
            <a key={n.path} href="#/upload" aria-label={n.label}><span className="fab"><Upload size={24} /></span></a>
          ) : (
            <a key={n.path} href={`#${n.path}`} className={active === n.path ? "on" : ""}><n.icon size={22} />{n.short}</a>
          ))}
        </nav>
      </div>
    </AppProvider>
  );
}
