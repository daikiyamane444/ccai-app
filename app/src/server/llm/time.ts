// 日本時間（JST, UTC+9。夏時間なし）の日・月の区切り（SPEC-000b AC-5）
const JST_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function jstDayRange(at: Date): { start: Date; end: Date } {
  const start = Math.floor((at.getTime() + JST_MS) / DAY_MS) * DAY_MS - JST_MS;
  return { start: new Date(start), end: new Date(start + DAY_MS) };
}

/** 日本時間の年月（例: "2026-10"） */
export function jstMonth(at: Date): string {
  const d = new Date(at.getTime() + JST_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** 日本時間の "YYYYMMDD-HHMM"（評価結果のファイル名） */
export function jstStamp(at: Date): string {
  const d = new Date(at.getTime() + JST_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

export function jstIso(at: Date): string {
  const d = new Date(at.getTime() + JST_MS);
  return d.toISOString().replace("Z", "+09:00");
}
