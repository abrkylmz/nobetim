import type { Profile } from "../../../shared/types";
import { PAY_PERIODS, ratesOf } from "../../../shared/payRates";
import { Field } from "./ui";
import { NumberInput } from "./NumberInput";

const fmtRate = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";

/** Nöbet ücreti: hazır tablodan (öğrenim + kadro) seç ya da elle gir */
export function PaySettings({ p, set }: { p: Profile; set: <K extends keyof Profile>(k: K, v: Profile[K]) => void }) {
  const period = PAY_PERIODS[PAY_PERIODS.length - 1];
  const group = period.groups.find((g) => g.id === p.payGroup);
  const rates = group && ratesOf(group, p.payRisky);

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="grid grid-2">
        <Field label="Haftalık çalışma saati" hint="Fazla mesai hesabı için">
          <NumberInput value={p.weeklyHours} max={80} decimals={1} emptyAs={40} placeholder="40" onChange={(n) => set("weeklyHours", n)} />
        </Field>
        <Field label="Nöbet ücreti" hint={group ? period.label : "Tablodan seç ya da kendi ücretini gir"}>
          <select className="select" value={p.payGroup} onChange={(e) => set("payGroup", e.target.value)}>
            <option value="">Elle gireceğim</option>
            {period.groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </Field>
      </div>

      {group && rates ? (
        <div className="pay-box">
          <label className="check">
            <input type="checkbox" checked={p.payRisky} onChange={(e) => set("payRisky", e.target.checked)} />
            Riskli birimde çalışıyorum (acil servis, yoğun bakım, 112 vb.)
          </label>
          <table className="data" style={{ marginTop: 10 }}>
            <thead><tr><th>Saatlik ücret</th><th className="num">Gündüz</th><th className="num">Gece</th></tr></thead>
            <tbody>
              <tr><td>{p.payRisky ? "Riskli" : "Normal"}</td><td className="num">{fmtRate(rates.normal[0])}</td><td className="num">{fmtRate(rates.normal[1])}</td></tr>
              <tr><td>{p.payRisky ? "Riskli bayram" : "Bayram"}</td><td className="num">{fmtRate(rates.holiday[0])}</td><td className="num">{fmtRate(rates.holiday[1])}</td></tr>
            </tbody>
          </table>
          <p className="tiny faint" style={{ marginTop: 8 }}>
            Gece: 20:00–08:00 arası (%10 artırımlı). Bayram: Ramazan ve Kurban bayramı günleri.
            Tahmini gelir, fazla mesai saatlerine bu ücretlerin ayın çalışma saatlerine göre ağırlıklı ortalaması uygulanarak hesaplanır.
          </p>
        </div>
      ) : (
        <div className="grid grid-2">
          <Field label="Fazla mesai ücreti (₺/saat)" hint="Tahmini gelir için">
            <NumberInput value={p.overtimeRate} max={100000} placeholder="ör. 85,50" onChange={(n) => set("overtimeRate", n)} />
          </Field>
          <Field label="Resmî tatil ek ücreti (₺/saat)">
            <NumberInput value={p.holidayRate} max={100000} placeholder="ör. 40" onChange={(n) => set("holidayRate", n)} />
          </Field>
        </div>
      )}
    </div>
  );
}
