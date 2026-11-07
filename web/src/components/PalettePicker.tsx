import { Check } from "lucide-react";
import type { Palette } from "../lib/app";

const OPTIONS: { id: Palette; name: string; desc: string; swatch: string[] }[] = [
  { id: "teal", name: "Turkuaz", desc: "Sakin, klinik tonlar", swatch: ["#087F8C", "#DFF5EF", "#F4A261", "#F5F8FA"] },
  { id: "pink", name: "Pastel pembe", desc: "Yumuşak pembe ve lavanta", swatch: ["#B83E74", "#FBE3EE", "#CFBDF4", "#FFF6F9"] },
];

/** Renk teması seçici: her seçenek kendi renk örnekleriyle gösterilir, tıklayınca anında uygulanır. */
export function PalettePicker({ value, onChange }: { value: Palette; onChange: (p: Palette) => void }) {
  return (
    <div className="palette-picker" role="radiogroup" aria-label="Renk teması">
      {OPTIONS.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id}
          className={`palette-option ${value === o.id ? "on" : ""}`} onClick={() => onChange(o.id)}>
          <span className="swatches" aria-hidden>
            {o.swatch.map((c) => <span key={c} style={{ background: c }} />)}
          </span>
          <span className="txt"><b>{o.name}</b><span className="small muted">{o.desc}</span></span>
          {value === o.id && <span className="tick"><Check size={14} /></span>}
        </button>
      ))}
    </div>
  );
}
