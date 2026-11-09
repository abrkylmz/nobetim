import { useEffect, useState } from "react";

/** Sayı kutusu: 0 değerini boş gösterir (yazınca başa 0 eklenmez), virgüllü ondalığı kabul eder. */
export function NumberInput({ value, onChange, min = 0, max, decimals = 2, emptyAs = 0, ...rest }: {
  value: number; onChange: (n: number) => void; min?: number; max?: number; decimals?: number;
  /** Kutu boş bırakılırsa kullanılacak değer */
  emptyAs?: number;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "min" | "max">) {
  const show = (n: number) => (n ? String(n).replace(".", ",") : "");
  const [text, setText] = useState(show(value));
  // Dışarıdan değer değişirse (ör. profil yüklendi) kutuyu güncelle
  useEffect(() => { if ((text === "" ? emptyAs : parse(text)) !== value) setText(show(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const pattern = decimals > 0 ? new RegExp(String.raw`^\d*([.,]\d{0,` + decimals + String.raw`})?$`) : /^\d*$/;
  return (
    <input {...rest} className={rest.className ?? "input"} type="text" inputMode={decimals > 0 ? "decimal" : "numeric"} placeholder={rest.placeholder ?? "0"}
      value={text}
      onChange={(e) => {
        const t = e.target.value.replace(/\s/g, "");
        if (!pattern.test(t)) return;
        setText(t);
        let n = t === "" ? emptyAs : parse(t);
        if (max != null) n = Math.min(max, n);
        onChange(Math.max(min, n));
      }}
      onBlur={() => setText(show(value))} />
  );
}

function parse(t: string) {
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
