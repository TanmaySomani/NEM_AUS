export interface Row {
  time: string;
  price: number | null;
  demand: number | null;
  forecastDemand: number | null;
  solar: number | null;
  temperature: number | null;
  maxPrice: number | null;
  minPrice: number | null;
  prediction: number | null;
  persistence: number | null;
  previousDay: number | null;
  previousWeek: number | null;
  risk: number | null;
}
export interface Model {
  name: string;
  mae: number;
  rmse: number;
  bias: number;
}
export interface Dataset {
  rows: Row[];
  region: string;
  intervalMinutes: number;
  timezone: string;
  quality: {
    sources: {
      file: string;
      rows: number;
      uniqueTimestamps: number;
      sha256: string;
    }[];
    expectedIntervals: number;
    completePrices: number;
    solarAlternativesResolved: number;
    missing: Record<string, number>;
    rawPriceIntervals: number;
    fiveMinuteSpikes: number;
    weatherOffsetHours: number;
    solarSatelliteFallbacks: number;
    first: string;
    last: string;
  };
  benchmark: {
    train: { start: string; end: string; count: number };
    validation: { start: string; end: string; count: number };
    test: { start: string; end: string; count: number };
    horizonMinutes: number;
    chosenLoss: string;
    models: Model[];
    importance: { feature: string; importance: number }[];
    bandWidth: number;
    bandTestCoverage: number;
    classifier: {
      threshold: number;
      probabilityCutoff: number;
      precision: number;
      recall: number;
      f1: number;
      averagePrecision: number;
      prevalence: number;
      confusion: number[][];
    };
    features: string[];
  };
}
export type Season = "All seasons" | "Summer" | "Autumn" | "Winter" | "Spring";
export type Granularity = "Auto" | "30 minutes" | "Hourly" | "Daily";
export const seasonOf = (time: string): Season => {
  const month = Number(time.slice(5, 7));
  return [12, 1, 2].includes(month)
    ? "Summer"
    : month <= 5
      ? "Autumn"
      : month <= 8
        ? "Winter"
        : "Spring";
};
export const mean = (values: (number | null)[]) => {
  const valid = values.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
};
export const quantile = (values: number[], q: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b),
    pos = (sorted.length - 1) * q,
    lo = Math.floor(pos);
  return sorted[lo] + (sorted[Math.ceil(pos)] - sorted[lo]) * (pos - lo);
};
export function filterRows(
  rows: Row[],
  start: string,
  end: string,
  season: Season,
) {
  return rows.filter(
    (r) =>
      r.time.slice(0, 10) >= start &&
      r.time.slice(0, 10) <= end &&
      (season === "All seasons" || seasonOf(r.time) === season),
  );
}
export function aggregate(rows: Row[], granularity: Granularity): Row[] {
  const days = rows.length
    ? (Date.parse(rows.at(-1)!.time + "+10:00") -
        Date.parse(rows[0].time + "+10:00")) /
      86400000
    : 0;
  const mode =
    granularity === "Auto"
      ? days > 90
        ? "Daily"
        : days > 7
          ? "Hourly"
          : "30 minutes"
      : granularity;
  if (mode === "30 minutes") return rows;
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = mode === "Daily" ? r.time.slice(0, 10) : r.time.slice(0, 13);
    const group = groups.get(key) || [];
    group.push(r);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([time, group]) => {
    const result = { time } as Row;
    for (const key of Object.keys(group[0]) as (keyof Row)[]) {
      if (key === "time") continue;
      const valid = group
        .map((r) => r[key])
        .filter((v): v is number => v !== null);
      result[key] =
        key === "maxPrice"
          ? valid.length
            ? Math.max(...valid)
            : null
          : key === "minPrice"
            ? valid.length
              ? Math.min(...valid)
              : null
            : mean(valid);
    }
    return result;
  });
}
/** A gap ends the smoothing segment. EMA uses only current/past prices. */
export function smooth(
  rows: Row[],
  mode: "ema" | "gaussian",
  span: number,
): (number | null)[] {
  if (mode === "ema") {
    let prev: number | null = null;
    return rows.map((r, i) => {
      const gap =
        i &&
        Date.parse(r.time + "+10:00") -
          Date.parse(rows[i - 1].time + "+10:00") !==
          1800000;
      if (r.price === null) {
        prev = null;
        return null;
      }
      prev =
        prev === null || gap
          ? r.price
          : (2 / (span + 1)) * r.price + (1 - 2 / (span + 1)) * prev;
      return prev;
    });
  }
  const radius = Math.ceil(span * 3);
  let segment = 0;
  const segments = rows.map((r, i) => {
    if (
      r.price === null ||
      (i &&
        Date.parse(r.time + "+10:00") -
          Date.parse(rows[i - 1].time + "+10:00") !==
          1800000)
    )
      segment++;
    return segment;
  });
  return rows.map((r, i) => {
    if (r.price === null) return null;
    let sum = 0,
      weights = 0;
    for (
      let j = Math.max(0, i - radius);
      j <= Math.min(rows.length - 1, i + radius);
      j++
    ) {
      if (segments[j] !== segments[i]) continue;
      const value = rows[j].price;
      if (value === null) continue;
      const w = Math.exp(-0.5 * ((j - i) / span) ** 2);
      sum += value * w;
      weights += w;
    }
    return weights ? sum / weights : null;
  });
}
export interface Episode {
  time: string;
  end: string;
  price: number;
  peakDispatch: number | null;
  intervals: number;
  demand: number | null;
  solar: number | null;
  temperature: number | null;
}
export function episodes(rows: Row[], threshold: number): Episode[] {
  const result: Episode[] = [];
  for (const r of rows) {
    if (r.price === null || r.price < threshold) continue;
    const last = result.at(-1);
    if (
      last &&
      Date.parse(r.time + "+10:00") - Date.parse(last.end + "+10:00") ===
        1800000
    ) {
      last.end = r.time;
      last.intervals++;
      if (r.price > last.price)
        Object.assign(last, {
          price: r.price,
          demand: r.demand,
          solar: r.solar,
          temperature: r.temperature,
        });
      last.peakDispatch = Math.max(
        last.peakDispatch ?? -Infinity,
        r.maxPrice ?? -Infinity,
      );
    } else
      result.push({
        time: r.time,
        end: r.time,
        price: r.price,
        peakDispatch: r.maxPrice,
        intervals: 1,
        demand: r.demand,
        solar: r.solar,
        temperature: r.temperature,
      });
  }
  return result.sort((a, b) => b.price - a.price);
}
export function metrics(
  rows: Row[],
  key: "prediction" | "persistence" | "previousDay" | "previousWeek",
) {
  const paired = rows.filter((r) => r.price !== null && r[key] !== null);
  return {
    count: paired.length,
    mae: mean(paired.map((r) => Math.abs(r[key]! - r.price!))),
    rmse: paired.length
      ? Math.sqrt(mean(paired.map((r) => (r[key]! - r.price!) ** 2))!)
      : null,
  };
}
export function dayOffset(date: string, amount: number) {
  return new Date(Date.parse(date + "T12:00:00Z") + amount * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function displayDate(time: string, withTime = false) {
  return new Date(
    time.length === 10 ? time + "T12:00:00+10:00" : time + "+10:00",
  ).toLocaleString("en-AU", {
    timeZone: "Australia/Brisbane",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  });
}
export const num = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("en-AU", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
export const money = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined
    ? "—"
    : `${value < 0 ? "−" : ""}$${num(Math.abs(value), digits)}`;
export async function loadData(): Promise<Dataset> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/market.json`);
  if (!response.ok) throw new Error("The market dataset could not be loaded.");
  const raw = await response.json();
  if (raw.schemaVersion !== 1 || !raw.rows?.length)
    throw new Error("The market dataset has an unsupported format.");
  return {
    ...raw,
    rows: raw.rows.map((row: (string | number | null)[]) =>
      Object.fromEntries(
        raw.columns.map((c: string, i: number) => [c, row[i]]),
      ),
    ),
  };
}
export function downloadCsv(rows: Row[], filename: string) {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]) as (keyof Row)[];
  // Keep CSV rectangular; market timezone is encoded in the timestamp column heading.
  const csv = [
    columns.map((c) => (c === "time" ? "time_AEST_UTC_plus_10" : c)).join(","),
    ...rows.map((r) => columns.map((k) => r[k] ?? "").join(",")),
  ].join("\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8;" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
