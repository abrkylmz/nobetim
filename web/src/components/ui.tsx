import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";
import { CATEGORY_META, type Confidence, type FieldScore, type ShiftCategory } from "../../../shared/types";

/** Uygulama logosu: seçili renk temasının renklerini kullanır (turkuaz / pembe, açık / koyu). */
export function Logo({ size = 34, inverted = false }: { size?: number; inverted?: boolean }) {
  // inverted: renkli (tema geçişli) zemin üzerinde beyaz kutu
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden style={{ flexShrink: 0 }}>
      <rect width="64" height="64" rx="16" fill={inverted ? "#FFFFFF" : "var(--primary)"} />
      <g stroke={inverted ? "#8E2C5A" : "var(--primary-ink)"} strokeWidth="4" strokeLinecap="round" fill="none"
        style={inverted ? { stroke: "color-mix(in srgb, var(--primary) 85%, #000)" } : undefined}>
        <rect x="14" y="18" width="36" height="32" rx="6" />
        <path d="M14 28h36M24 12v10M40 12v10" />
      </g>
      <path d="M27 39l4 4 8-9" fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Card({ title, icon, action, children, className = "" }: { title?: ReactNode; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="card-head">
          <h3>{icon}{title}</h3>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Alert({ kind = "info", title, children }: { kind?: "info" | "warn" | "err" | "ok"; title?: ReactNode; children?: ReactNode }) {
  const Icon = { info: Info, warn: AlertTriangle, err: XCircle, ok: CheckCircle2 }[kind];
  return (
    <div className={`alert ${kind}`} role={kind === "err" ? "alert" : undefined}>
      <Icon size={20} />
      <div>{title && <b>{title}</b>}{children && <div className={title ? "small" : ""} style={title ? { marginTop: 2 } : undefined}>{children}</div>}</div>
    </div>
  );
}

export const Spinner = ({ size = 18 }: { size?: number }) => <Loader2 size={size} className="spin" aria-label="Yükleniyor" />;

export function Modal({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", on);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", on); document.body.style.overflow = ""; };
  }, [onClose]);
  // Belgenin köküne yerleştirilir: sayfadaki animasyon/transform pencerenin ekran konumunu bozmasın
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
        <div className="modal-head"><h2>{title}</h2><button className="iconbtn" onClick={onClose} aria-label="Kapat"><X size={20} /></button></div>
        {children}
        {footer && <div className="row" style={{ justifyContent: "flex-end", marginTop: 20 }}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

const LEVEL_TEXT: Record<Confidence, string> = { high: "Yüksek", medium: "Orta", low: "Düşük" };

export function ConfidenceBadge({ score, showPct = true }: { score: FieldScore; showPct?: boolean }) {
  const cls = score.level === "high" ? "ok" : score.level === "medium" ? "warn" : "err";
  return (
    <span className={`badge ${cls}`} title={score.reason}>
      <span className={`conf ${score.level}`} aria-hidden><i /><i /><i /></span>
      {LEVEL_TEXT[score.level]}{showPct && ` · %${Math.round(score.score * 100)}`}
    </span>
  );
}

export function CategoryDot({ category, color }: { category: ShiftCategory; color?: string }) {
  return <span className="dot" style={{ background: color ?? CATEGORY_META[category].color }} aria-hidden />;
}

export function CodeChip({ code, color }: { code: string; color: string }) {
  return <span className="code-chip" style={{ ["--c" as string]: color }}>{code}</span>;
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ic">{icon}</div>
      <h3 style={{ color: "var(--text)" }}>{title}</h3>
      {children && <div className="small" style={{ marginTop: 6 }}>{children}</div>}
    </div>
  );
}

export function Skeleton({ h = 18, w = "100%", r }: { h?: number; w?: number | string; r?: number }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field">{label}{children}{hint && <span className="hint">{hint}</span>}</label>;
}
