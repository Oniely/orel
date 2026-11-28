export type DateKind = "date" | "time" | "datetime";

export interface DateColumnType {
  kind: DateKind;
  /** timestamptz / timetz: values carry a UTC offset that must be kept */
  withTimeZone: boolean;
}

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

export interface TimeParts {
  hour: number;
  minute: number;
  second: number;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?/;
const DATETIME_RE = /^(\d{4}-\d{2}-\d{2})([T ])(\d{2}):(\d{2})(?::(\d{2}))?/;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

const formatDate = ({ year, month, day }: DateParts) => `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

const formatTime = ({ hour, minute, second }: TimeParts) => `${pad(hour)}:${pad(minute)}:${pad(second)}`;

/** Local UTC offset like "+08:00" for the given moment */
export function localOffset(at: Date): string {
  const minutes = -at.getTimezoneOffset();
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * Date/time column types across Postgres (date, time, timetz, timestamp, timestamptz),
 * MySQL (date, time, datetime, timestamp) and SQLite declared types (DATE, DATETIME, ...).
 */
export function dateColumnType(dataType: string | undefined): DateColumnType | null {
  const t = (dataType ?? "").toLowerCase().replace(/\(\d+\)/g, "").trim();
  if (t.endsWith("[]")) return null;
  const withTimeZone = /tz$|with time zone/.test(t);
  if (/timestamp|datetime/.test(t)) return { kind: "datetime", withTimeZone };
  if (t.startsWith("date")) return { kind: "date", withTimeZone: false };
  if (t.startsWith("time")) return { kind: "time", withTimeZone };
  return null;
}

/** The calendar date in a value's text, or null when it has none (empty, NULL, unparseable) */
export function parseDateParts(value: string): DateParts | null {
  const m = DATE_RE.exec(value.trim());
  if (!m) return null;
  const parts = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  // MySQL zero dates like 0000-00-00 can't be shown on a calendar
  if (parts.year < 1 || parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return null;
  return parts;
}

/** The wall-clock time in a value's text */
export function parseTimeParts(value: string, kind: DateKind): TimeParts | null {
  const text = value.trim();
  const m = kind === "time" ? TIME_RE.exec(text) : DATETIME_RE.exec(text);
  if (!m) return null;
  const [hour, minute, second] = kind === "time" ? m.slice(1) : m.slice(3);
  return { hour: Number(hour), minute: Number(minute), second: Number(second ?? 0) };
}

/** Replace the date part of `current`, keeping its time, fractional seconds and offset as-is */
export function mergeDate(current: string, column: DateColumnType, date: DateParts, now = new Date()): string {
  const text = current.trim();
  if (column.kind === "date") return formatDate(date);
  if (DATE_RE.test(text)) return formatDate(date) + text.slice(10);
  const offset = column.withTimeZone ? localOffset(now) : "";
  return `${formatDate(date)} 00:00:00${offset}`;
}

/** Replace the hh:mm:ss part of `current`, keeping its date, fractional seconds and offset as-is */
export function mergeTime(current: string, column: DateColumnType, time: TimeParts, now = new Date()): string {
  const text = current.trim();
  const offset = column.withTimeZone ? localOffset(now) : "";
  if (column.kind === "time") {
    const m = TIME_RE.exec(text);
    return m ? formatTime(time) + text.slice(m[0].length) : formatTime(time) + offset;
  }
  const m = DATETIME_RE.exec(text);
  if (m) return `${m[1]}${m[2]}${formatTime(time)}${text.slice(m[0].length)}`;
  const date = parseDateParts(text);
  const datePart = date ? formatDate(date) : formatDate({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
  return `${datePart} ${formatTime(time)}${offset}`;
}

/** The current local date/time formatted for the column type; tz-aware types get the local offset */
export function nowValue(column: DateColumnType, now = new Date()): string {
  const date = formatDate({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
  const time = formatTime({ hour: now.getHours(), minute: now.getMinutes(), second: now.getSeconds() });
  const offset = column.withTimeZone ? localOffset(now) : "";
  if (column.kind === "date") return date;
  if (column.kind === "time") return time + offset;
  return `${date} ${time}${offset}`;
}
