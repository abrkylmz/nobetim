import { useEffect, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";
import { CATEGORY_META, type Confidence, type FieldScore, type ShiftCategory } from "../../../shared/types";

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
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
        <div className="modal-head"><h2>{title}</h2><button className="iconbtn" onClick={onClose} aria-label="Kapat"><X size={20} /></button></div>
        {children}
        {footer && <div className="row" style={{ justifyContent: "flex-end", marginTop: 20 }}>{footer}</div>}
      </div>
    </div>
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
