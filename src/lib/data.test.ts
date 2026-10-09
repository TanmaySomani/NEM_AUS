import { describe, expect, it } from "vitest";
import {
  aggregate,
  dayOffset,
  episodes,
  filterRows,
  mean,
  metrics,
  seasonOf,
  smooth,
} from "./data";
import type { Row } from "./data";
const row = (
  time: string,
  price: number | null,
  extra: Partial<Row> = {},
): Row => ({
  time,
  price,
  demand: null,
  forecastDemand: null,
  solar: null,
  temperature: null,
  maxPrice: price,
  minPrice: price,
  prediction: null,
  persistence: null,
  previousDay: null,
  previousWeek: null,
  risk: null,
  ...extra,
});
const sample = [
  row("2024-01-01T00:00", 100),
  row("2024-01-01T00:30", 400),
  row("2024-01-01T01:00", -20),
  row("2024-01-01T01:30", null),
];
describe("data semantics", () => {
  it("preserves negative prices and excludes missing values from means", () => {
    expect(mean([-10, 20, null])).toBe(5);
    expect(mean([null])).toBeNull();
  });
  it("keeps extrema while averaging available half-hours", () => {
    const hourly = aggregate(sample, "Hourly");
    expect(hourly[0].price).toBe(250);
    expect(hourly[0].maxPrice).toBe(400);
    expect(hourly[1].price).toBe(-20);
  });
  it("uses Australian seasons and inclusive date filtering", () => {
    expect(seasonOf("2024-01-01")).toBe("Summer");
    expect(seasonOf("2024-06-01")).toBe("Winter");
    expect(
      filterRows(sample, "2024-01-01", "2024-01-01", "Summer"),
    ).toHaveLength(4);
    expect(
      filterRows(sample, "2024-01-01", "2024-01-01", "Winter"),
    ).toHaveLength(0);
  });
  it("never labels a half-hour spike from a dispatch peak alone", () => {
    expect(
      episodes([row("2024-01-01T00:00", 80, { maxPrice: 1000 })], 300),
    ).toHaveLength(0);
  });
  it("does not join episodes over a time gap", () => {
    expect(
      episodes(
        [row("2024-01-01T00:00", 400), row("2024-01-01T01:00", 500)],
        300,
      ),
    ).toHaveLength(2);
  });
  it("reports event conditions at the peak rather than the first interval", () => {
    const e = episodes(
      [
        row("2024-01-01T00:00", 400, { demand: 7000 }),
        row("2024-01-01T00:30", 500, { demand: 8000 }),
      ],
      300,
    );
    expect(e[0].intervals).toBe(2);
    expect(e[0].demand).toBe(8000);
  });
  it("scores paired forecasts only and leaves unavailable errors null", () => {
    expect(metrics(sample, "prediction").mae).toBeNull();
    const m = metrics(
      [
        row("2024-01-01T00:00", -10, { prediction: 10 }),
        row("2024-01-01T00:30", null, { prediction: 500 }),
      ],
      "prediction",
    );
    expect(m.count).toBe(1);
    expect(m.mae).toBe(20);
  });
  it("uses date arithmetic independent of machine timezone", () => {
    expect(dayOffset("2024-03-01", -1)).toBe("2024-02-29");
  });
});
describe("smoothing boundaries", () => {
  it("EMA cannot be changed by a future price", () => {
    const modified = sample.map((r, i) => ({
      ...r,
      price: i >= 2 ? 99999 : r.price,
    }));
    expect(smooth(sample, "ema", 3).slice(0, 2)).toEqual(
      smooth(modified, "ema", 3).slice(0, 2),
    );
  });
  it("both smoothers restart at missing intervals", () => {
    const data = [
      row("2024-01-01T00:00", 100),
      row("2024-01-01T00:30", null),
      row("2024-01-01T01:00", 500),
    ];
    expect(smooth(data, "ema", 3)).toEqual([100, null, 500]);
    expect(smooth(data, "gaussian", 3)).toEqual([100, null, 500]);
  });
  it("both smoothers restart across seasonal or timestamp gaps", () => {
    const data = [row("2024-01-01T00:00", 100), row("2024-06-01T00:00", 500)];
    expect(smooth(data, "ema", 3)).toEqual([100, 500]);
    expect(smooth(data, "gaussian", 3)).toEqual([100, 500]);
  });
});
