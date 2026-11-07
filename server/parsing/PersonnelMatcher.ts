// Çizelgedeki satırlar ile kullanıcının profilini eşleştirir.
// Emin olunmayan durumda otomatik seçim yapılmaz; aday listesi döner.

import type { Candidate } from "../../shared/types.js";
import type { RosterRow } from "./types.js";
import { foldWords, levenshtein } from "./text.js";

export interface MatchProfile { fullName: string; staffNo?: string; department?: string }

export interface MatchResult {
  selected: RosterRow | null;
  candidates: Candidate[];
  note: string | null;
}

const TITLES = new Set(["hem", "hems", "hemsire", "sor", "sorumlu", "ebe", "dr", "uzm", "sag", "mem", "saglik", "memuru",
  "bashemsire", "yrd", "op", "prof", "doc", "sb", "att", "atu", "ss"]);

export const nameTokens = (s: string) => foldWords(s).split(" ").filter((t) => t && !TITLES.has(t) && !/^\d+$/.test(t));

const digits = (s?: string) => (s ?? "").replace(/\D/g, "");

function tokenSim(a: string, b: string): number {
  if (a === b) return 1;
  // Baş harf: "A." ↔ "Ayşe"
  if ((a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b))) return 0.7;
  const d = levenshtein(a, b);
  const len = Math.max(a.length, b.length);
  if (len >= 4 && d === 1) return 0.85; // OCR/yazım hatası (Aysel ↔ Aysel, Yılmaz ↔ Yilmaz zaten aynı)
  if (len >= 7 && d === 2) return 0.7;
  return 0;
}

/** 0-1 isim benzerliği ve açıklaması */
export function nameScore(profileName: string, rowName: string): { score: number; reason: string } {
  const p = nameTokens(profileName), r = nameTokens(rowName);
  if (!p.length || !r.length) return { score: 0, reason: "" };
  if (p.join(" ") === r.join(" ")) return { score: 1, reason: "Ad soyad birebir eşleşti" };
  if ([...p].sort().join(" ") === [...r].sort().join(" ")) return { score: 0.96, reason: "Ad ve soyad farklı sırada" };

  // Her profil kelimesi için satırdaki en iyi eşleşme
  const used = new Set<number>();
  const sims = p.map((pt) => {
    let best = 0, bi = -1;
    r.forEach((rt, i) => { if (!used.has(i)) { const s = tokenSim(pt, rt); if (s > best) { best = s; bi = i; } } });
    if (bi >= 0 && best > 0) used.add(bi);
    return best;
  });
  const surnameP = p[p.length - 1], surnameR = r[r.length - 1];
  const surnameSim = tokenSim(surnameP, surnameR);
  const firstSim = tokenSim(p[0], r[0]);

  const matched = sims.filter((s) => s > 0).length;
  const avg = sims.reduce((a, b) => a + b, 0) / p.length;

  // İkinci ad farkı: "Ayşe Nur Yılmaz" ↔ "Ayşe Yılmaz"
  if (surnameSim === 1 && firstSim === 1 && (p.length !== r.length)) return { score: 0.9, reason: "İkinci ad farklı" };
  if (surnameSim === 1 && firstSim === 0.7) return { score: 0.78, reason: "Soyad aynı, ad kısaltılmış" };
  if (matched === p.length && avg >= 0.85) return { score: 0.8 + (avg - 0.85), reason: "Küçük yazım farkı" };
  if (surnameSim === 1 && firstSim === 0) return { score: 0.4, reason: "Yalnızca soyad aynı" };
  if (firstSim === 1 && surnameSim === 0) return { score: 0.35, reason: "Yalnızca ad aynı" };
  return { score: Math.min(0.6, avg * 0.6), reason: "Kısmi benzerlik" };
}

export function matchPersonnel(rows: RosterRow[], profile: MatchProfile): MatchResult {
  const staff = digits(profile.staffNo);
  const scored = rows.map((row) => {
    let { score, reason } = nameScore(profile.fullName, row.name);
    if (staff && digits(row.staffNo) === staff) { score = Math.max(score, 0.99); reason = "Sicil numarası eşleşti"; }
    else if (staff && digits(row.staffNo) && score > 0.5) { score = Math.min(score, 0.55); reason += " (sicil numarası farklı)"; }
    return { row, score: Math.round(score * 100) / 100, reason };
  }).sort((a, b) => b.score - a.score);

  const toCandidate = (s: (typeof scored)[number]): Candidate => ({
    key: s.row.key, name: s.row.name, staffNo: s.row.staffNo, title: s.row.title, department: s.row.department,
    score: s.score, reason: s.reason,
  });

  const strong = scored.filter((s) => s.score >= 0.75);
  if (strong.length === 1 && strong[0].score >= 0.9) {
    return { selected: strong[0].row, candidates: strong.map(toCandidate), note: strong[0].reason };
  }
  if (strong.length > 1) {
    // Aynı isimli personel: bölüm bilgisiyle ayırt etmeye çalış
    const dep = foldWords(profile.department ?? "");
    const byDept = dep ? strong.filter((s) => s.row.department && foldWords(s.row.department).includes(dep)) : [];
    if (byDept.length === 1 && byDept[0].score >= 0.9 && strong.filter((s) => s.score >= 0.9).length > 1) {
      return { selected: byDept[0].row, candidates: strong.map(toCandidate), note: "Aynı isimli personel servis bilgisiyle ayırt edildi" };
    }
    const top = strong.filter((s) => s.score >= 0.9);
    return {
      selected: null,
      candidates: (strong.length ? strong : scored).map(toCandidate),
      note: top.length > 1 ? "Listede aynı veya çok benzer isimli birden fazla personel var. Hangisinin sen olduğunu seç." : "Birden fazla olası eşleşme bulundu. Doğru kişiyi seç.",
    };
  }
  if (strong.length === 1) {
    return { selected: null, candidates: [toCandidate(strong[0]), ...scored.slice(1, 6).map(toCandidate)], note: "İsim tam eşleşmedi. Doğru kişi olduğunu onayla." };
  }
  return {
    selected: null,
    candidates: scored.map(toCandidate),
    note: rows.length ? "Profilindeki isim listede bulunamadı. Listeden kendini seç." : "Çizelgede personel satırı bulunamadı.",
  };
}
