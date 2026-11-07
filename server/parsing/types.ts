import type { Quality, SourceKind } from "../../shared/types.js";

export type GridValue = string | number | boolean | Date | null | undefined;
export type Grid = GridValue[][];

export interface RosterCell {
  day: number;       // ayın günü
  raw: string;       // hücre içeriği
  readScore: number; // okuma güveni 0-1 (Excel/metin PDF: 1)
  note?: string;
}

export interface RosterRow {
  key: string;            // satır kimliği (eşleştirme / seçim için)
  name: string;
  staffNo?: string;
  title?: string;
  department?: string;
  cells: RosterCell[];
  /** Yapay zekâ yalnızca hedef kişinin hücrelerini çıkarır; diğerleri için false. */
  cellsLoaded: boolean;
}

export interface Legend { code: string; meaning: string }

export interface Roster {
  source: SourceKind;
  year: number | null;
  month: number | null;
  hospital?: string;
  department?: string;
  rows: RosterRow[];
  legend: Legend[];
  quality: Quality | null;
  notes: string[];
}

export class ParseError extends Error {
  constructor(message: string, readonly userMessage: string = message) { super(message); }
}
