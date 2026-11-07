import type {
  ImportDetail, ImportSummary, Me, MonthStats, Profile, Shift, ShiftCategory, ShiftType,
} from "../../../shared/types";
import type { Holiday } from "../../../shared/holidays";

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body: any) { super(message); }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: { "X-Nobetim": "1", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "Bir hata oluştu.", data);
  return data as T;
}

export interface MeResponse extends Me { aiAvailable: boolean; uploadLimitBytes: number }
export interface ReviewDetail extends ImportDetail { periodGuessed: boolean; personTitle: string | null; personStaffNo: string | null }
export interface Dashboard {
  now: string; current: Shift | null; next: Shift | null; upcoming: Shift[]; month: MonthStats;
  lastImport: ImportSummary | null; pending: number;
}
export interface StatsResponse {
  month: MonthStats;
  series: { year: number; month: number; workHours: number; shiftCount: number; overtimeHours: number; nightShifts: number }[];
  holidays: Holiday[];
}
export interface ShiftBody {
  date: string; category: ShiftCategory; code?: string; label?: string; start?: string | null; end?: string | null;
  isExtra?: boolean; note?: string; department?: string; force?: boolean;
}

export const api = {
  me: () => call<MeResponse>("GET", "/api/me"),
  login: (email: string, password: string) => call<Me>("POST", "/api/auth/login", { email, password }),
  register: (email: string, password: string) => call<Me>("POST", "/api/auth/register", { email, password }),
  logout: () => call("POST", "/api/auth/logout", {}),
  deleteAccount: (password: string) => call("DELETE", "/api/account", { password }),
  saveProfile: (p: Profile) => call<Profile>("PUT", "/api/profile", p),
  shiftTypes: () => call<ShiftType[]>("GET", "/api/shift-types"),
  saveShiftTypes: (t: Omit<ShiftType, "id">[]) => call<ShiftType[]>("PUT", "/api/shift-types", t),
  dashboard: () => call<Dashboard>("GET", `/api/dashboard?tz=${new Date().getTimezoneOffset()}`),
  stats: (year: number, month: number) => call<StatsResponse>("GET", `/api/stats?year=${year}&month=${month}`),
  shifts: (from: string, to: string) => call<Shift[]>("GET", `/api/shifts?from=${from}&to=${to}`),
  addShift: (b: ShiftBody) => call<Shift>("POST", "/api/shifts", b),
  updateShift: (id: string, b: ShiftBody) => call<Shift>("PUT", `/api/shifts/${id}`, b),
  deleteShift: (id: string) => call("DELETE", `/api/shifts/${id}`),
  imports: () => call<ImportSummary[]>("GET", "/api/imports"),
  import: (id: string) => call<ReviewDetail>("GET", `/api/imports/${id}`),
  select: (id: string, key: string) => call<ReviewDetail>("POST", `/api/imports/${id}/select`, { key }),
  reanalyze: (id: string) => call<ReviewDetail>("POST", `/api/imports/${id}/reanalyze`, {}),
  setPeriod: (id: string, year: number, month: number) => call<ReviewDetail>("POST", `/api/imports/${id}/period`, { year, month }),
  editEntry: (id: string, entryId: string, patch: Record<string, unknown>) => call<ReviewDetail>("PATCH", `/api/imports/${id}/entries/${entryId}`, patch),
  addEntry: (id: string, body: Record<string, unknown>) => call<ReviewDetail>("POST", `/api/imports/${id}/entries`, body),
  confirm: (id: string, opts: { replaceConflicts: boolean; rememberCodes: boolean }) =>
    call<{ saved: number; skipped: number; replaced: number }>("POST", `/api/imports/${id}/confirm`, opts),
  discard: (id: string) => call<ReviewDetail>("POST", `/api/imports/${id}/discard`, {}),
  removeImport: (id: string, deleteShifts: boolean) => call("DELETE", `/api/imports/${id}${deleteShifts ? "?deleteShifts=1" : ""}`),

  /** Dosya yükleme: ilerleme yüzdesi için XMLHttpRequest kullanılır. */
  upload(files: File[], onProgress: (pct: number) => void): Promise<{ id: string; duplicateOf: ImportSummary | null }> {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      for (const f of files) fd.append("files", f, f.name);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/imports");
      xhr.setRequestHeader("X-Nobetim", "1");
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
      xhr.onload = () => {
        let data: any = null;
        try { data = JSON.parse(xhr.responseText); } catch { /* boş */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new ApiError(xhr.status, data?.error ?? "Dosya yüklenemedi.", data));
      };
      xhr.onerror = () => reject(new ApiError(0, "Bağlantı hatası. İnternetini kontrol et.", null));
      xhr.send(fd);
    });
  },
};
