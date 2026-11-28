import { describe, expect, it } from "vitest";
import { dateColumnType, localOffset, mergeDate, mergeTime, nowValue, parseDateParts, parseTimeParts } from "./dateValue";

const date = { kind: "date", withTimeZone: false } as const;
const time = { kind: "time", withTimeZone: false } as const;
const timetz = { kind: "time", withTimeZone: true } as const;
const datetime = { kind: "datetime", withTimeZone: false } as const;
const timestamptz = { kind: "datetime", withTimeZone: true } as const;

// Fixed local moment: 2025-03-09 07:05:04
const now = new Date(2025, 2, 9, 7, 5, 4);
const offset = localOffset(now);

describe("dateColumnType", () => {
  it.each([
    ["date", date],
    ["time", time],
    ["timetz", timetz],
    ["timestamp", datetime],
    ["timestamptz", timestamptz],
    ["datetime", datetime],
    ["DATETIME", datetime],
    ["TIMESTAMP", datetime],
    ["datetime(6)", datetime],
    ["timestamp with time zone", timestamptz],
    ["time with time zone", timetz],
    ["timestamp without time zone", datetime],
  ])("detects %s", (type, expected) => {
    expect(dateColumnType(type)).toEqual(expected);
  });

  it.each(["text", "varchar", "integer", "interval", "year", "timestamp[]", "date[]", "jsonb", "", undefined])(
    "ignores %s",
    (type) => {
      expect(dateColumnType(type)).toBeNull();
    },
  );
});

describe("localOffset", () => {
  it("formats the offset as +HH:MM / -HH:MM", () => {
    expect(offset).toMatch(/^[+-]\d{2}:\d{2}$/);
    const minutes = -now.getTimezoneOffset();
    const [h, m] = offset.slice(1).split(":").map(Number);
    expect((offset[0] === "-" ? -1 : 1) * (h * 60 + m)).toBe(minutes);
  });
});

describe("parseDateParts / parseTimeParts", () => {
  it("reads the date from date, datetime and ISO timestamptz text", () => {
    expect(parseDateParts("2024-01-15")).toEqual({ year: 2024, month: 1, day: 15 });
    expect(parseDateParts("2024-01-15 10:30:00")).toEqual({ year: 2024, month: 1, day: 15 });
    expect(parseDateParts(" 2024-01-15T10:30:00.123+05:30 ")).toEqual({ year: 2024, month: 1, day: 15 });
  });

  it("returns null for empty, NULL, zero and garbage dates", () => {
    expect(parseDateParts("")).toBeNull();
    expect(parseDateParts("NULL")).toBeNull();
    expect(parseDateParts("0000-00-00")).toBeNull();
    expect(parseDateParts("2024-13-01")).toBeNull();
    expect(parseDateParts("tomorrow")).toBeNull();
  });

  it("reads the time from time and datetime text", () => {
    expect(parseTimeParts("10:30:15", "time")).toEqual({ hour: 10, minute: 30, second: 15 });
    expect(parseTimeParts("10:30+02", "time")).toEqual({ hour: 10, minute: 30, second: 0 });
    expect(parseTimeParts("2024-01-15 23:59:58.5", "datetime")).toEqual({ hour: 23, minute: 59, second: 58 });
    expect(parseTimeParts("2024-01-15T01:02:03+00:00", "datetime")).toEqual({ hour: 1, minute: 2, second: 3 });
    expect(parseTimeParts("2024-01-15", "datetime")).toBeNull();
    expect(parseTimeParts("", "time")).toBeNull();
  });
});

describe("mergeDate", () => {
  const picked = { year: 2026, month: 2, day: 3 };

  it("formats a plain date", () => {
    expect(mergeDate("2024-01-15", date, picked)).toBe("2026-02-03");
    expect(mergeDate("", date, picked)).toBe("2026-02-03");
  });

  it("keeps time and fractional seconds when only the date changes", () => {
    expect(mergeDate("2024-01-15 10:30:15.123456", datetime, picked)).toBe("2026-02-03 10:30:15.123456");
    expect(mergeDate("2024-01-15T10:30:15", datetime, picked)).toBe("2026-02-03T10:30:15");
  });

  it("keeps the stored offset of a timestamptz instead of converting to local time", () => {
    expect(mergeDate("2024-01-15T10:30:00.5+05:30", timestamptz, picked, now)).toBe("2026-02-03T10:30:00.5+05:30");
    expect(mergeDate("2024-01-15 22:00:00-08", timestamptz, picked, now)).toBe("2026-02-03 22:00:00-08");
  });

  it("starts an empty value at midnight, with the local offset for tz-aware types", () => {
    expect(mergeDate("", datetime, picked, now)).toBe("2026-02-03 00:00:00");
    expect(mergeDate("NULL", timestamptz, picked, now)).toBe(`2026-02-03 00:00:00${offset}`);
  });
});

describe("mergeTime", () => {
  const picked = { hour: 8, minute: 9, second: 10 };

  it("replaces hh:mm:ss of a time, keeping fraction and offset", () => {
    expect(mergeTime("10:30:15.25+02", timetz, picked, now)).toBe("08:09:10.25+02");
    expect(mergeTime("10:30", time, picked)).toBe("08:09:10");
    expect(mergeTime("", time, picked)).toBe("08:09:10");
    expect(mergeTime("", timetz, picked, now)).toBe(`08:09:10${offset}`);
  });

  it("replaces the time of a datetime, keeping date, separator, fraction and offset", () => {
    expect(mergeTime("2024-01-15T10:30:15.123+05:30", timestamptz, picked, now)).toBe("2024-01-15T08:09:10.123+05:30");
    expect(mergeTime("2024-01-15 10:30:15", datetime, picked)).toBe("2024-01-15 08:09:10");
  });

  it("fills in a missing date with the given date or today", () => {
    expect(mergeTime("2024-01-15", datetime, picked, now)).toBe("2024-01-15 08:09:10");
    expect(mergeTime("", datetime, picked, now)).toBe("2025-03-09 08:09:10");
    expect(mergeTime("", timestamptz, picked, now)).toBe(`2025-03-09 08:09:10${offset}`);
  });
});

describe("nowValue", () => {
  it("formats the current local time per column type", () => {
    expect(nowValue(date, now)).toBe("2025-03-09");
    expect(nowValue(time, now)).toBe("07:05:04");
    expect(nowValue(timetz, now)).toBe(`07:05:04${offset}`);
    expect(nowValue(datetime, now)).toBe("2025-03-09 07:05:04");
    expect(nowValue(timestamptz, now)).toBe(`2025-03-09 07:05:04${offset}`);
  });
});
