import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIcon,
  ArrowDownIcon,
  ArrowUpRightIcon,
  CalendarBlankIcon,
  ChartLineUpIcon,
  CheckIcon,
  DatabaseIcon,
  DownloadSimpleIcon,
  GithubLogoIcon,
  InfoIcon,
  LightningIcon,
  LinkSimpleIcon,
  SlidersHorizontalIcon,
  TrendUpIcon,
  WaveformIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Chart, axes, palette, timeline } from "./components/Chart";
import {
  aggregate,
  dayOffset,
  displayDate,
  downloadCsv,
  episodes,
  filterRows,
  loadData,
  mean,
  metrics,
  money,
  num,
  quantile,
  smooth,
} from "./lib/data";
import type { Dataset, Episode, Granularity, Row, Season } from "./lib/data";
import type { EChartsCoreOption } from "echarts/core";

type View = "overview" | "volatility" | "forecast" | "methods";
const views: { id: View; label: string; icon: typeof ActivityIcon }[] = [
  { id: "overview", label: "Market overview", icon: ChartLineUpIcon },
  { id: "volatility", label: "Volatility lab", icon: WaveformIcon },
  { id: "forecast", label: "Forecasting", icon: TrendUpIcon },
  { id: "methods", label: "Data & methods", icon: DatabaseIcon },
];
const titles: Record<View, [string, string]> = {
  overview: [
    "A clearer view of the energy market.",
    "Explore the relationship between price, demand and rooftop solar in New South Wales.",
  ],
  volatility: [
    "Look beyond the price spikes.",
    "Explore extreme intervals, seasonal patterns and the trade-offs of smoothing.",
  ],
  forecast: [
    "Forecasts, with the evidence.",
    "Compare next-interval predictions with simple baselines on held-out observations.",
  ],
  methods: [
    "Good analysis starts with good data.",
    "Trace every source, transformation and modelling decision behind the dashboard.",
  ],
};
function Panel({
  title,
  subtitle,
  children,
  className = "",
  action,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Metric({
  label,
  value,
  unit,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  unit?: string;
  detail: ReactNode;
  icon: typeof ActivityIcon;
}) {
  return (
    <article className="metric">
      <div className="metric-label">
        {label}
        <Icon size={18} weight="regular" />
      </div>
      <div className="metric-value">
        {value}
        <span>{unit}</span>
      </div>
      <div className="metric-detail">{detail}</div>
    </article>
  );
}
function Legend({ items }: { items: [string, string, boolean?][] }) {
  return (
    <div className="legend">
      {items.map(([label, color, dashed]) => (
        <span key={label}>
          <i
            style={{
              background: dashed ? "none" : color,
              borderTop: dashed ? `2px dashed ${color}` : undefined,
            }}
          />
          {label}
        </span>
      ))}
    </div>
  );
}
function Note({ children, tone = "" }: { children: ReactNode; tone?: string }) {
  return (
    <div className={`note ${tone}`}>
      <InfoIcon size={18} />
      <div>{children}</div>
    </div>
  );
}
function Empty({
  title = "No observations in this selection.",
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <DatabaseIcon size={32} weight="light" />
      <h3>{title}</h3>
      <p>
        {children ||
          "Choose another date range or season to continue exploring."}
      </p>
    </div>
  );
}
const line = (
  name: string,
  data: (number | null)[],
  color: string,
  extra = {},
) => ({
  name,
  type: "line",
  data,
  showSymbol: false,
  connectNulls: false,
  lineStyle: { width: 2, color },
  itemStyle: { color },
  emphasis: { focus: "series" },
  ...extra,
});
const featureNames: Record<string, string> = {
  price_lag_1: "Price · 30 min ago",
  price_lag_2: "Price · 1 hour ago",
  price_lag_48: "Price · previous day",
  price_lag_336: "Price · previous week",
  price_mean_6: "Price · trailing 3 hours",
  price_mean_48: "Price · trailing 24 hours",
  demand_lag_1: "Demand · 30 min ago",
  solar_lag_1: "Solar · 30 min ago",
  temperature_lag_1: "Temperature · 30 min ago",
  hour_sin: "Time of day · sine",
  hour_cos: "Time of day · cosine",
  weekday_sin: "Weekday · sine",
  weekday_cos: "Weekday · cosine",
  month_sin: "Month · sine",
  month_cos: "Month · cosine",
};

function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null),
    [error, setError] = useState("");
  const [view, setView] = useState<View>("overview"),
    [start, setStart] = useState(""),
    [end, setEnd] = useState("");
  const [season, setSeason] = useState<Season>("All seasons"),
    [granularity, setGranularity] = useState<Granularity>("Auto");
  const [threshold, setThreshold] = useState(300),
    [toast, setToast] = useState(""),
    [retry, setRetry] = useState(0);
  const [event, setEvent] = useState<Episode | null>(null),
    [peaks, setPeaks] = useState(false);
  const [smoothing, setSmoothing] = useState<"ema" | "gaussian">("ema"),
    [span, setSpan] = useState(6);
  const [baseline, setBaseline] = useState<
      "persistence" | "previousDay" | "previousWeek"
    >("persistence"),
    [band, setBand] = useState(false);
  useEffect(() => {
    let active = true;
    setError("");
    loadData()
      .then((data) => {
        if (!active) return;
        const params = new URLSearchParams(location.search),
          last = data.quality.last.slice(0, 10),
          first = data.quality.first.slice(0, 10);
        const validDate = (v: string | null) =>
          !!v &&
          /^\d{4}-\d{2}-\d{2}$/.test(v) &&
          v >= first &&
          v <= last &&
          !isNaN(Date.parse(v));
        const s = params.get("from"),
          e = params.get("to");
        setDataset(data);
        setStart(
          validDate(s) && validDate(e) && s! <= e! ? s! : dayOffset(last, -29),
        );
        setEnd(validDate(s) && validDate(e) && s! <= e! ? e! : last);
        const v = params.get("view");
        if (views.some((x) => x.id === v)) setView(v as View);
        const se = params.get("season");
        if (
          ["All seasons", "Summer", "Autumn", "Winter", "Spring"].includes(
            se || "",
          )
        )
          setSeason(se as Season);
        const t = Number(params.get("threshold"));
        if ([100, 300, 1000, 5000].includes(t)) setThreshold(t);
        const g = params.get("resolution");
        if (["Auto", "30 minutes", "Hourly", "Daily"].includes(g || ""))
          setGranularity(g as Granularity);
        const ba = params.get("baseline");
        if (["persistence", "previousDay", "previousWeek"].includes(ba || ""))
          setBaseline(ba as typeof baseline);
        if (params.get("smoothing") === "gaussian") setSmoothing("gaussian");
        const strength = Number(params.get("span"));
        if (strength >= 2 && strength <= 12) setSpan(strength);
        setPeaks(params.get("peaks") === "true");
        setBand(params.get("band") === "true");
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [retry]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (!event) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEvent(null);
      if (e.key !== "Tab") return;
      const targets = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".event-dialog button, .event-dialog a, .event-dialog input",
        ),
      );
      const first = targets[0],
        last = targets.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [event]);
  const invalidRange = !!start && !!end && start > end;
  const rows = useMemo(
    () =>
      dataset && !invalidRange
        ? filterRows(dataset.rows, start, end, season)
        : [],
    [dataset, start, end, season, invalidRange],
  );
  const sampled = useMemo(
    () => aggregate(rows, granularity),
    [rows, granularity],
  );
  const events = useMemo(() => episodes(rows, threshold), [rows, threshold]);
  const smoothed = useMemo(
    () => (view === "volatility" ? smooth(rows, smoothing, span) : []),
    [rows, smoothing, span, view],
  );
  const smoothSample = useMemo(
    () =>
      aggregate(
        rows.map((r, i) => ({ ...r, prediction: smoothed[i] ?? null })),
        granularity,
      ),
    [rows, smoothed, granularity],
  );
  const values = rows.flatMap((r) => (r.price === null ? [] : [r.price])),
    avg = mean(values);
  const max = values.length ? Math.max(...values) : null,
    negatives = values.filter((v) => v < 0).length,
    spikes = values.filter((v) => v >= threshold).length;
  const meanDemand = mean(rows.map((r) => r.demand)),
    meanSolar = mean(rows.map((r) => r.solar));
  const forecastRows = useMemo(
    () => rows.filter((r) => r.prediction !== null),
    [rows],
  );
  const forecastSample = useMemo(
    () => aggregate(forecastRows, granularity),
    [forecastRows, granularity],
  );
  const preset = (days: number | "all" | "test") => {
    if (!dataset) return;
    const last = dataset.quality.last.slice(0, 10);
    setEnd(last);
    setStart(
      days === "all"
        ? dataset.quality.first.slice(0, 10)
        : days === "test"
          ? "2024-01-01"
          : dayOffset(last, -(days - 1)),
    );
    setEvent(null);
  };
  const reset = () => {
    preset(30);
    setSeason("All seasons");
    setThreshold(300);
    setGranularity("Auto");
  };
  const share = async () => {
    const params = new URLSearchParams({
      from: start,
      to: end,
      view,
      season,
      threshold: String(threshold),
      resolution: granularity,
      baseline,
      smoothing,
      span: String(span),
      peaks: String(peaks),
      band: String(band),
    });
    const url = `${location.origin}${location.pathname}?${params}`;
    history.replaceState(null, "", url);
    try {
      await navigator.clipboard.writeText(url);
      setToast("Link copied with your current filters.");
    } catch {
      setToast("Filters saved in the address bar. Copy the URL to share.");
    }
  };
  const rangeDays = rows.length
    ? Math.round(
        (Date.parse(rows.at(-1)!.time + "+10:00") -
          Date.parse(rows[0].time + "+10:00")) /
          86400000,
      )
    : 0;
  const resolution =
    granularity === "Auto"
      ? rangeDays > 90
        ? "Daily"
        : rangeDays > 7
          ? "Hourly"
          : "30-minute"
      : granularity === "30 minutes"
        ? "30-minute"
        : granularity;
  const basePriceOption = (
    data: Row[],
    key: "price" | "prediction" = "price",
  ) => ({
    ...timeline(
      data.map((r) => r.time),
      "AUD / MWh",
    ),
    series: [
      line(
        "Spot price",
        data.map((r) => r[key]),
        palette.teal,
        { areaStyle: { color: "rgba(8,126,114,.07)" } },
      ),
    ],
  });
  const overview = () => {
    const hours = Array.from({ length: 24 }, (_, hour) =>
      mean(
        rows
          .filter((r) => Number(r.time.slice(11, 13)) === hour)
          .map((r) => r.price),
      ),
    );
    const peakHour = hours.indexOf(
      Math.max(...hours.map((v) => v ?? -Infinity)),
    );
    const priceOption: EChartsCoreOption = {
      ...basePriceOption(sampled),
      series: [
        line(
          "Spot price",
          sampled.map((r) => r.price),
          palette.teal,
          {
            areaStyle: { color: "rgba(8,126,114,.07)" },
            markLine: {
              silent: true,
              symbol: "none",
              label: { show: false },
              lineStyle: { type: "dashed", color: "#d6a887" },
              data: [{ yAxis: threshold }],
            },
          },
        ),
        ...(peaks
          ? [
              line(
                "Peak 5-minute price",
                sampled.map((r) => r.maxPrice),
                palette.orange,
                {
                  lineStyle: {
                    type: "dotted",
                    width: 1.5,
                    color: palette.orange,
                  },
                },
              ),
            ]
          : []),
      ],
    };
    const profileOption: EChartsCoreOption = {
      grid: { left: 40, right: 10, top: 30, bottom: 30 },
      tooltip: {
        trigger: "axis",
        confine: true,
        valueFormatter: (v: unknown) => money(v as number),
      },
      xAxis: {
        type: "category",
        data: Array.from(
          { length: 24 },
          (_, i) => `${String(i).padStart(2, "0")}:00`,
        ),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { interval: 5, color: palette.muted },
      },
      yAxis: axes("$ / MWh"),
      series: [
        {
          type: "bar",
          data: hours.map((value, i) => ({
            value,
            itemStyle: {
              color: i === peakHour ? palette.teal : "#d5e7df",
              borderRadius: [3, 3, 0, 0],
            },
          })),
          barWidth: "65%",
        },
      ],
    };
    const demandOption: EChartsCoreOption = {
      ...timeline(
        sampled.map((r) => r.time),
        "MW",
      ),
      series: [
        line(
          "Operational demand",
          sampled.map((r) => r.demand),
          palette.ink,
        ),
        line(
          "Demand forecast · POE50",
          sampled.map((r) => r.forecastDemand),
          palette.blue,
          { lineStyle: { width: 1.5, color: palette.blue, type: "dashed" } },
        ),
        line(
          "Rooftop solar",
          sampled.map((r) => r.solar),
          palette.orange,
          { areaStyle: { color: "rgba(223,149,98,.12)" } },
        ),
      ],
    };
    return (
      <>
        <div className="metric-grid">
          <Metric
            label="Average spot price"
            value={money(avg)}
            unit="/ MWh"
            icon={ChartLineUpIcon}
            detail={
              <>
                <span className="tiny-dot" />
                Median {money(quantile(values, 0.5))}
              </>
            }
          />
          <Metric
            label="Average demand"
            value={num(meanDemand === null ? null : meanDemand / 1000, 2)}
            unit="GW"
            icon={LightningIcon}
            detail={<>Grid operational demand</>}
          />
          <Metric
            label="Average rooftop solar"
            value={num(meanSolar === null ? null : meanSolar / 1000, 2)}
            unit="GW"
            icon={ActivityIcon}
            detail={<>One production estimate per interval</>}
          />
          <Metric
            label="High-price intervals"
            value={num(spikes)}
            unit="intervals"
            icon={WaveformIcon}
            detail={
              <>
                <span className="tiny-dot amber" />
                {num(values.length ? (spikes / values.length) * 100 : null, 1)}%
                at or above {money(threshold, 0)}
              </>
            }
          />
        </div>
        <div className="overview-grid">
          <Panel
            title="Spot price over time"
            subtitle={`${resolution} averages · AUD/MWh · AEST`}
            className="price-panel"
            action={
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={peaks}
                  onChange={(e) => setPeaks(e.target.checked)}
                />
                5-min peaks
              </label>
            }
          >
            <Legend
              items={[
                ["Spot price", palette.teal],
                ...(peaks
                  ? [["5-min peak", palette.orange] as [string, string]]
                  : []),
                [`${money(threshold, 0)} threshold`, "#d6a887", true],
              ]}
            />
            <Chart
              option={priceOption}
              label="NSW spot electricity prices over the selected period. Use the slider to zoom."
              height={308}
            />
            <div className="chart-footer">
              <span>Drag the range handles to explore a shorter period</span>
              <span>
                Peak half-hour <strong>{money(max)}</strong>
              </span>
            </div>
          </Panel>
          <Panel
            title="The daily rhythm"
            subtitle="Average spot price by hour"
            className="profile-panel"
          >
            <Chart
              option={profileOption}
              label="Mean electricity price by hour of day"
              height={255}
            />
            <div className="insight">
              <div className="insight-icon">
                <TrendUpIcon size={18} />
              </div>
              <div>
                <strong>
                  {String(peakHour).padStart(2, "0")}:00 is the highest-priced
                  hour
                </strong>
                <p>
                  {money(hours[peakHour])}/MWh on average in this selection.
                  Hourly means include extreme prices.
                </p>
              </div>
            </div>
          </Panel>
        </div>
        <div className="lower-grid">
          <Panel
            title="Demand meets rooftop solar"
            subtitle={`${resolution} averages · MW`}
          >
            <Legend
              items={[
                ["Operational demand", palette.ink],
                ["POE50 demand forecast", palette.blue, true],
                ["Rooftop solar", palette.orange],
              ]}
            />
            <Chart
              option={demandOption}
              label="Operational demand, recorded demand forecast and rooftop solar generation"
              height={270}
            />
            <p className="footnote">
              Rooftop solar is behind-the-meter generation. It is not the
              region’s full generation mix. Recorded demand forecasts have no
              issue-time metadata.
            </p>
          </Panel>
          <Panel
            title="Inside this selection"
            subtitle="Price distribution at 30-minute resolution"
          >
            <div className="stat-list">
              <div>
                <span>Lowest price</span>
                <strong>
                  {money(values.length ? Math.min(...values) : null)}
                </strong>
              </div>
              <div>
                <span>95th percentile</span>
                <strong>{money(quantile(values, 0.95))}</strong>
              </div>
              <div>
                <span>Negative-price intervals</span>
                <strong>
                  {num(negatives)}{" "}
                  <small>
                    (
                    {num(
                      values.length ? (negatives / values.length) * 100 : null,
                      1,
                    )}
                    %)
                  </small>
                </strong>
              </div>
              <div>
                <span>High-price episodes</span>
                <strong>{num(events.length)}</strong>
              </div>
              <div>
                <span>Valid price observations</span>
                <strong>
                  {num(values.length)} <small>/ {num(rows.length)}</small>
                </strong>
              </div>
            </div>
            <div className="mini-note">
              Averages can hide short, sharp events. Open the volatility lab to
              examine them.
            </div>
            <button
              className="text-button"
              onClick={() => setView("volatility")}
            >
              Explore volatility <ArrowUpRightIcon size={16} />
            </button>
          </Panel>
        </div>
        <EventTable events={events} threshold={threshold} onSelect={setEvent} />
      </>
    );
  };
  const volatility = () => {
    const option: EChartsCoreOption = {
      ...timeline(
        sampled.map((r) => r.time),
        "AUD / MWh",
      ),
      series: [
        line(
          "Observed price",
          sampled.map((r) => r.price),
          "#a4b5ae",
          { lineStyle: { width: 1.3, color: "#a4b5ae" } },
        ),
        line(
          smoothing === "ema" ? "Trailing EMA" : "Centered Gaussian",
          smoothSample.map((r) => r.prediction),
          palette.teal,
        ),
      ],
    };
    const heatValues: [number, number, number | null][] = [];
    for (let day = 0; day < 7; day++)
      for (let hour = 0; hour < 24; hour++) {
        const subset = rows.filter(
          (r) =>
            (new Date(r.time.slice(0, 10) + "T12:00:00Z").getUTCDay() + 6) %
              7 ===
              day && Number(r.time.slice(11, 13)) === hour,
        );
        heatValues.push([hour, day, mean(subset.map((r) => r.price))]);
      }
    const heat: EChartsCoreOption = {
      grid: { top: 12, left: 45, right: 10, bottom: 65 },
      tooltip: {
        position: "top",
        confine: true,
        formatter: (p: { value: [number, number, number] }) =>
          `${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][p.value[1]]} ${p.value[0]}:00 · ${money(p.value[2])}/MWh`,
      },
      xAxis: {
        type: "category",
        data: Array.from({ length: 24 }, (_, i) => `${i}`),
        splitArea: { show: false },
        axisLabel: { interval: 2, color: palette.muted },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: "category",
        data: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        inverse: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: palette.muted },
      },
      visualMap: {
        min: Math.floor(Math.min(...heatValues.map((r) => r[2] ?? Infinity))),
        max: Math.ceil(Math.max(...heatValues.map((r) => r[2] ?? -Infinity))),
        calculable: true,
        orient: "horizontal",
        left: "center",
        bottom: 0,
        itemHeight: 160,
        itemWidth: 8,
        inRange: { color: ["#e9f3ed", "#9bcbb9", "#087e72", "#16463f"] },
        textStyle: { color: palette.muted },
      },
      series: [
        {
          type: "heatmap",
          data: heatValues.filter((v) => v[2] !== null),
          itemStyle: { borderWidth: 3, borderColor: "#fff", borderRadius: 4 },
          emphasis: { itemStyle: { borderColor: palette.orange } },
        },
      ],
    };
    const scatterRows = rows
      .filter((r) => r.price !== null && r.temperature !== null)
      .filter((_, i, a) => i % Math.max(1, Math.ceil(a.length / 1800)) === 0);
    const scatter: EChartsCoreOption = {
      grid: { top: 35, bottom: 40, left: 65, right: 25 },
      tooltip: {
        confine: true,
        formatter: (p: { value: [number, number, string] }) =>
          `${p.value[2].replace("T", " ")} AEST<br/>${num(p.value[0], 1)}°C · ${money(p.value[1])}/MWh`,
      },
      xAxis: { ...axes("Sydney temperature · °C"), min: "dataMin" },
      yAxis: axes("AUD / MWh"),
      series: [
        {
          type: "scatter",
          symbolSize: 5,
          data: scatterRows.map((r) => [r.temperature, r.price, r.time]),
          itemStyle: { color: palette.teal, opacity: 0.38 },
        },
      ],
    };
    return (
      <>
        <div className="metric-grid">
          <Metric
            label="Peak half-hour price"
            value={money(max)}
            unit="/ MWh"
            icon={TrendUpIcon}
            detail={<>Unsmoothed observations</>}
          />
          <Metric
            label="High-price episodes"
            value={num(events.length)}
            icon={WaveformIcon}
            detail={<>Contiguous intervals ≥ {money(threshold, 0)}</>}
          />
          <Metric
            label="Negative-price share"
            value={
              num(values.length ? (negatives / values.length) * 100 : null, 1) +
              "%"
            }
            icon={ArrowDownIcon}
            detail={<>{num(negatives)} half-hour intervals below $0</>}
          />
          <Metric
            label="95th percentile"
            value={money(quantile(values, 0.95))}
            unit="/ MWh"
            icon={ChartLineUpIcon}
            detail={<>95% of valid half-hour prices below this</>}
          />
        </div>
        <Panel
          title="Smoothing workbench"
          subtitle="Compare the original signal with a transparent transformation"
          action={
            <div className="smoothing-controls">
              <select
                aria-label="Smoothing method"
                value={smoothing}
                onChange={(e) =>
                  setSmoothing(e.target.value as "ema" | "gaussian")
                }
              >
                <option value="ema">Trailing EMA</option>
                <option value="gaussian">Centered Gaussian</option>
              </select>
              <label>
                {smoothing === "ema" ? "Span" : "Sigma"}{" "}
                <input
                  aria-label="Smoothing strength"
                  type="range"
                  min="2"
                  max="12"
                  value={span}
                  onChange={(e) => setSpan(Number(e.target.value))}
                />
                <strong>{span}</strong>
              </label>
            </div>
          }
        >
          <Legend
            items={[
              ["Observed price", "#a4b5ae"],
              [
                smoothing === "ema" ? "Trailing EMA" : "Centered Gaussian",
                palette.teal,
              ],
            ]}
          />
          <Chart
            option={option}
            label="Observed price compared with selected smoothing transformation"
            height={310}
          />
          <Note>
            {smoothing === "ema"
              ? `EMA span is ${span} half-hour intervals. Each point uses the current and preceding observations. It is a descriptive trend, not a future forecast.`
              : `Gaussian sigma is ${span} half-hour intervals. This centered filter uses future values and is for retrospective exploration only.`}{" "}
            Smoothing never changes the recorded price, spike counts or model
            targets.
          </Note>
        </Panel>
        <div className="equal-grid">
          <Panel
            title="When prices run high"
            subtitle="Mean price by weekday and hour · AEST"
          >
            <Chart
              option={heat}
              label="Heatmap of average electricity price by weekday and hour"
              height={290}
            />
          </Panel>
          <Panel
            title="Weather and price"
            subtitle="Sydney temperature against the half-hour price"
          >
            <Chart
              option={scatter}
              label="Scatter plot of Sydney temperature and observed NSW electricity price"
              height={290}
            />
            <p className="footnote">
              {num(scatterRows.length)} regularly sampled points for clarity.
              Association does not establish a cause. Missing temperatures are
              excluded.
            </p>
          </Panel>
        </div>
        <EventTable events={events} threshold={threshold} onSelect={setEvent} />
      </>
    );
  };
  const forecasting = () => {
    if (!dataset) return null;
    const b = dataset.benchmark,
      local = metrics(forecastRows, "prediction"),
      base = metrics(forecastRows, baseline),
      c = b.classifier;
    const modelName =
      baseline === "persistence"
        ? "Last interval"
        : baseline === "previousDay"
          ? "Previous day"
          : "Previous week";
    const option: EChartsCoreOption = {
      ...timeline(
        forecastSample.map((r) => r.time),
        "AUD / MWh",
      ),
      series: [
        line(
          "Observed price",
          forecastSample.map((r) => r.price),
          palette.ink,
        ),
        line(
          "Gradient boosting",
          forecastSample.map((r) => r.prediction),
          palette.teal,
        ),
        line(
          modelName,
          forecastSample.map((r) => r[baseline]),
          palette.orange,
          { lineStyle: { width: 1.3, type: "dashed", color: palette.orange } },
        ),
        ...(band
          ? [
              line(
                "Upper error reference",
                forecastSample.map((r) =>
                  r.prediction === null ? null : r.prediction + b.bandWidth,
                ),
                "#b2cfc4",
                { lineStyle: { width: 1, color: "#b2cfc4", type: "dotted" } },
              ),
              line(
                "Lower error reference",
                forecastSample.map((r) =>
                  r.prediction === null ? null : r.prediction - b.bandWidth,
                ),
                "#b2cfc4",
                { lineStyle: { width: 1, color: "#b2cfc4", type: "dotted" } },
              ),
            ]
          : []),
      ],
    };
    const features = b.importance.slice(0, 7).reverse();
    const importance: EChartsCoreOption = {
      grid: { left: 155, right: 35, top: 15, bottom: 30 },
      tooltip: {
        trigger: "axis",
        confine: true,
        valueFormatter: (v: unknown) => `${money(v as number)} MAE increase`,
      },
      xAxis: {
        ...axes("MAE increase · $/MWh"),
        nameLocation: "middle",
        nameGap: 22,
      },
      yAxis: {
        type: "category",
        data: features.map((f) => featureNames[f.feature]),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: "#65766e", fontSize: 11 },
      },
      series: [
        {
          type: "bar",
          data: features.map((f) => f.importance),
          barWidth: 10,
          itemStyle: { color: "#83b6a4", borderRadius: [0, 3, 3, 0] },
        },
      ],
    };
    const risk: EChartsCoreOption = {
      ...timeline(
        forecastSample.map((r) => r.time),
        "Score · 0–1",
        false,
      ),
      yAxis: { ...axes("Score · 0–1"), min: 0, max: 1 },
      series: [
        line(
          "Spike score",
          forecastSample.map((r) => r.risk),
          palette.teal,
          {
            areaStyle: { color: "rgba(8,126,114,.08)" },
            markLine: {
              symbol: "none",
              label: { formatter: "Decision cutoff", position: "insideEndTop" },
              lineStyle: { color: palette.orange, type: "dashed" },
              data: [{ yAxis: c.probabilityCutoff }],
            },
          },
        ),
      ],
    };
    const best = [...b.models].sort((a, z) => a.mae - z.mae)[0];
    return (
      <>
        <Note tone="strong">
          <strong>The simple baseline wins on the full test period.</strong>{" "}
          {best.name} achieves {money(best.mae)}/MWh MAE, compared with{" "}
          {money(b.models[0].mae)} for gradient boosting. Extreme prices remain
          difficult to forecast. These are rolling one-step predictions using
          observed history, with models fixed before 2024.
        </Note>
        {!forecastRows.length ? (
          <Panel
            title="Historical backtest"
            subtitle="Test observations begin on 1 January 2024"
          >
            <Empty title="This selection falls outside the test period.">
              <button
                className="button primary"
                onClick={() => {
                  preset("test");
                  setSeason("All seasons");
                }}
              >
                View the 2024 test period <ArrowUpRightIcon size={16} />
              </button>
            </Empty>
          </Panel>
        ) : (
          <>
            <div className="metric-grid">
              <Metric
                label="Model MAE"
                value={money(local.mae)}
                unit="/ MWh"
                icon={TrendUpIcon}
                detail={<>Mean absolute error · selected test rows</>}
              />
              <Metric
                label="Baseline MAE"
                value={money(base.mae)}
                unit="/ MWh"
                icon={ChartLineUpIcon}
                detail={<>{modelName} · same observations</>}
              />
              <Metric
                label="Model RMSE"
                value={money(local.rmse)}
                unit="/ MWh"
                icon={WaveformIcon}
                detail={<>Larger misses carry more weight</>}
              />
              <Metric
                label="Test predictions"
                value={num(local.count)}
                icon={CheckIcon}
                detail={<>30-minute-ahead rolling backtest</>}
              />
            </div>
            <Panel
              title="Actual prices vs predictions"
              subtitle={`${resolution} averages · evaluation metrics use original half-hours`}
              action={
                <select
                  aria-label="Forecast baseline"
                  value={baseline}
                  onChange={(e) =>
                    setBaseline(e.target.value as typeof baseline)
                  }
                >
                  <option value="persistence">Last interval baseline</option>
                  <option value="previousDay">Previous day baseline</option>
                  <option value="previousWeek">Previous week baseline</option>
                </select>
              }
            >
              <Legend
                items={[
                  ["Observed price", palette.ink],
                  ["Gradient boosting", palette.teal],
                  [modelName, palette.orange, true],
                ]}
              />
              <Chart
                option={option}
                label="Observed price, gradient boosting prediction and selected baseline on held-out test data"
                height={320}
              />
              <div className="chart-footer">
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={band}
                    onChange={(e) => setBand(e.target.checked)}
                  />
                  Show validation error reference ±{money(b.bandWidth)}
                </label>
                <span>{num(b.bandTestCoverage, 1)}% full-test coverage</span>
              </div>
              <p className="footnote">
                The reference width is the 80th percentile of absolute
                validation errors. It is not a calibrated prediction interval;
                coverage may change. No multi-step future forecast is implied.
              </p>
            </Panel>
          </>
        )}
        <div className="equal-grid">
          <Panel
            title="The honest leaderboard"
            subtitle="Full held-out test · 1 Jan–24 Jul 2024 · all eligible rows"
          >
            <div className="table-scroll">
              <table className="leaderboard">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>MAE ↓</th>
                    <th>RMSE ↓</th>
                  </tr>
                </thead>
                <tbody>
                  {[...b.models]
                    .sort((a, z) => a.mae - z.mae)
                    .map((m, i) => (
                      <tr key={m.name}>
                        <td>
                          <span className="rank">{i + 1}</span>
                          {m.name}
                          {!i && <span className="small-badge">Best</span>}
                        </td>
                        <td>{money(m.mae)}</td>
                        <td>{money(m.rmse)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="footnote">
              AUD/MWh. No shuffled split, price clipping or test-set tuning.
              Test rows need available price lags; missing rows remain excluded.
            </p>
          </Panel>
          <Panel
            title="What the model uses"
            subtitle="Permutation importance · validation period"
          >
            <Chart
              option={importance}
              label="Top seven features ranked by increase in validation mean absolute error after permutation"
              height={230}
            />
            <p className="footnote">
              Higher values indicate a larger validation error when a feature is
              shuffled. Correlated features can share importance.
            </p>
          </Panel>
        </div>
        <Panel
          title="Detecting high-price intervals"
          subtitle="Random forest classifier · next half-hour average ≥ $300/MWh"
        >
          <div className="classification-grid">
            <div>
              <div className="score-grid">
                {[
                  ["Precision", c.precision],
                  ["Recall", c.recall],
                  ["F1 score", c.f1],
                  ["Average precision", c.averagePrecision],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <span>{label}</span>
                    <strong>
                      {num(Number(value) * 100, 1)}
                      <small>%</small>
                    </strong>
                  </div>
                ))}
              </div>
              <p className="footnote">
                Full-test metrics. Positive prevalence:{" "}
                {num(c.prevalence * 100, 1)}%. Decision cutoff{" "}
                {num(c.probabilityCutoff, 3)}, chosen on validation F1. Scores
                are not calibrated probabilities. The exploratory spike
                threshold above does not retrain this model.
              </p>
            </div>
            <div className="confusion">
              <div className="confusion-heading">
                Full-test confusion matrix
              </div>
              <div className="confusion-grid">
                {[
                  ["True negatives", c.confusion[0][0]],
                  ["False positives", c.confusion[0][1]],
                  ["False negatives", c.confusion[1][0]],
                  ["True positives", c.confusion[1][1]],
                ].map(([label, value], i) => (
                  <div
                    key={label}
                    className={i === 0 || i === 3 ? "correct" : ""}
                  >
                    <span>{label}</span>
                    <strong>{num(Number(value))}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {forecastRows.length > 0 && (
            <>
              <div className="subchart-label">
                Spike scores · selected test observations ·{" "}
                {resolution.toLowerCase()} means
              </div>
              <Chart
                option={risk}
                label="Classifier spike scores and fixed decision cutoff"
                height={190}
              />
            </>
          )}
        </Panel>
      </>
    );
  };
  const methods = () => {
    if (!dataset) return null;
    const q = dataset.quality,
      b = dataset.benchmark;
    return (
      <>
        <div className="methods-intro">
          <div>
            <span className="eyebrow">Rebuilt from the source</span>
            <h2>One dataset. A traceable process.</h2>
            <p>
              The original research lives alongside this app. The rebuilt
              analysis uses the five supplied NSW source files, resolves
              duplicate solar estimates and preserves extreme market prices.
              Every chart is backed by real observations.
            </p>
            <a
              className="text-button"
              href="https://github.com/TanmaySomani/NEM_AUS"
              target="_blank"
              rel="noreferrer"
            >
              Explore the original repository <ArrowUpRightIcon size={16} />
            </a>
          </div>
          <div className="dataset-facts">
            <div>
              <strong>2022–2024</strong>
              <span>
                {displayDate(q.first.slice(0, 10))} –{" "}
                {displayDate(q.last.slice(0, 10))}
              </span>
            </div>
            <div>
              <strong>{num(q.expectedIntervals)}</strong>
              <span>half-hour positions on a regular time grid</span>
            </div>
            <div>
              <strong>NSW1</strong>
              <span>The supplied electricity data covers NSW only</span>
            </div>
          </div>
        </div>
        <Panel
          title="Source inventory"
          subtitle="Original CSV files are unchanged · checksums in the generated dataset"
        >
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Source file</th>
                  <th>Original rows</th>
                  <th>Unique timestamps</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {q.sources.map((s) => (
                  <tr key={s.file}>
                    <td className="file-name">{s.file}</td>
                    <td>{num(s.rows)}</td>
                    <td>{num(s.uniqueTimestamps)}</td>
                    <td>
                      {
                        {
                          "nsw_prices.csv": "5-minute regional reference price",
                          "nsw_demand_actual.csv":
                            "Half-hour operational demand",
                          "nsw_demand_forecast.csv":
                            "Recorded POE50 demand forecast",
                          "nsw_solar.csv":
                            "Alternative rooftop solar estimates",
                          "CCtemps.csv":
                            "Hourly capital-city temperature · Sydney 66214",
                        }[s.file]
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <div className="equal-grid">
          <Panel
            title="Cleaning decisions"
            subtitle="Make the assumptions visible"
          >
            <ol className="decisions">
              <li>
                <span>01</span>
                <div>
                  <strong>Align interval endings</strong>
                  <p>
                    Price at t is the mean of six dispatch observations in (t −
                    30 min, t]. Incomplete bins remain missing.
                  </p>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>
                    Resolve {num(q.solarAlternativesResolved)} solar
                    alternatives
                  </strong>
                  <p>
                    Use MEASUREMENT; fall back to SATELLITE only when a
                    measurement is absent. Never add the two together.
                  </p>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>Convert weather UTC to AEST</strong>
                  <p>
                    Parse day-first dates, add ten hours, then carry the most
                    recent weather observation for at most one hour. Missing
                    temperatures stay missing.
                  </p>
                </div>
              </li>
              <li>
                <span>04</span>
                <div>
                  <strong>Preserve the market’s extremes</strong>
                  <p>
                    Keep negative prices and spikes. No outlier removal, global
                    mean filling or backward filling of price targets.
                  </p>
                </div>
              </li>
            </ol>
          </Panel>
          <Panel
            title="Coverage & missing values"
            subtitle="Counts before any filtering"
          >
            <div className="coverage-summary">
              <strong>
                {num((q.completePrices / q.expectedIntervals) * 100, 2)}
                <small>%</small>
              </strong>
              <span>complete six-observation price intervals</span>
            </div>
            <div className="stat-list">
              {[
                ["Price", "price"],
                ["Operational demand", "demand"],
                ["Recorded demand forecast", "forecastDemand"],
                ["Rooftop solar", "solar"],
                ["Sydney temperature", "temperature"],
              ].map(([label, key]) => (
                <div key={key}>
                  <span>{label}</span>
                  <strong>
                    {num(q.missing[key])} <small>missing</small>
                  </strong>
                </div>
              ))}
            </div>
            <p className="footnote">
              Charts leave gaps for missing values. Aggregated means use the
              available observations, and averages can cover incomplete buckets.
            </p>
          </Panel>
        </div>
        <Panel
          title="A chronological evaluation"
          subtitle="Decisions happen before the test period"
        >
          <div className="split-timeline">
            <div className="split-train">
              <span>01 · Train</span>
              <strong>Jan 2022 – Jun 2023</strong>
              <small>{num(b.train.count)} eligible rows</small>
            </div>
            <div className="split-valid">
              <span>02 · Validate</span>
              <strong>Jul – Dec 2023</strong>
              <small>{num(b.validation.count)} eligible rows</small>
            </div>
            <div className="split-test">
              <span>03 · Test</span>
              <strong>Jan – Jul 2024</strong>
              <small>{num(b.test.count)} eligible rows</small>
            </div>
          </div>
          <div className="method-columns">
            <div>
              <h3>Features available in the past</h3>
              <p>
                Price lags at 30 minutes, one hour, one day and one week;
                trailing means; lagged demand, solar and temperature; calendar
                cycles. Same-interval actuals never enter the predictors.
                Recorded demand forecasts are excluded because issue times are
                absent.
              </p>
            </div>
            <div>
              <h3>Select, then freeze</h3>
              <p>
                Choose gradient boosting loss by validation MAE. Select the
                forest’s classification cutoff by validation F1. Refit on train
                and validation, then freeze the models before the rolling
                one-step test. This does not establish performance for
                multi-step forecasts.
              </p>
            </div>
            <div>
              <h3>A meaningful spike definition</h3>
              <p>
                The classifier targets a half-hour mean ≥ $300/MWh. This is an
                analytical threshold, not a regulatory cap. Overview and lab
                thresholds are adjustable. Five-minute extremes can exist inside
                a half-hour average below the threshold.
              </p>
            </div>
          </div>
        </Panel>
        <Note>
          <strong>Scope and limitations.</strong> This is a historical NSW
          research dashboard, not a live NEM feed. The source CSVs do not
          include price timestamp timezone declarations; market timestamps are
          assumed to use AEST. Original source provenance and publication times
          are incomplete. Satellite fallback and hourly weather carry-forward
          are descriptive assumptions. No causal effect, price stabilisation or
          trading performance is claimed.
        </Note>
        <div className="source-links">
          <span>Reference documentation</span>
          <a
            href="https://markets-portal-help.docs.public.aemo.com.au/Content/MarketsPortal/UsingMarketsPortal.htm"
            target="_blank"
            rel="noreferrer"
          >
            AEMO market time <ArrowUpRightIcon />
          </a>
          <a
            href="https://www.aemo.com.au/energy-systems/electricity/national-electricity-market-nem/data-nem"
            target="_blank"
            rel="noreferrer"
          >
            AEMO data <ArrowUpRightIcon />
          </a>
          <a
            href="https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.HistGradientBoostingRegressor.html"
            target="_blank"
            rel="noreferrer"
          >
            Model documentation <ArrowUpRightIcon />
          </a>
        </div>
      </>
    );
  };
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to dashboard
      </a>
      <header className="header">
        <div className="header-inner">
          <a
            className="brand"
            href={location.pathname}
            aria-label="NEM Observatory home"
          >
            <span className="brand-mark">
              <ActivityIcon size={27} weight="bold" />
            </span>
            <span>
              <strong>
                NEM<span className="brand-light"> observatory</span>
              </strong>
              <small>AUSTRALIAN ENERGY INTELLIGENCE</small>
            </span>
          </a>
          <div className="header-actions">
            <span className="region-tag">
              <span className="tiny-dot" />
              New South Wales <span className="muted">/ NSW1</span>
            </span>
            <a
              className="icon-button"
              href="https://github.com/TanmaySomani/NEM_AUS"
              target="_blank"
              rel="noreferrer"
              title="Original project on GitHub"
              aria-label="Original project on GitHub"
            >
              <GithubLogoIcon size={21} />
            </a>
          </div>
        </div>
      </header>
      <nav className="nav" aria-label="Dashboard views">
        <div className="nav-inner">
          {views.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              aria-current={view === id ? "page" : undefined}
              onClick={() => {
                setView(id);
                setEvent(null);
              }}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
          <span className="archive-label">
            <span />
            Historical dataset · 2022–2024
          </span>
        </div>
      </nav>
      <main id="main" className="main">
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              <span className="tiny-dot" />
              THE NSW ELECTRICITY MARKET
            </div>
            <h1>{titles[view][0]}</h1>
            <p>{titles[view][1]}</p>
          </div>
          <div className="page-actions">
            <button className="button" onClick={share} disabled={!dataset}>
              <LinkSimpleIcon size={17} />
              Share view
            </button>
            <button
              className="button primary"
              disabled={view === "methods" ? !dataset : !rows.length}
              onClick={() => {
                const exported = view === "methods" ? dataset!.rows : rows;
                downloadCsv(
                  exported,
                  view === "methods"
                    ? "nem-nsw-all-data.csv"
                    : `nem-nsw-${start}-${end}.csv`,
                );
                setToast(`${num(exported.length)} observations exported.`);
              }}
            >
              <DownloadSimpleIcon size={17} />
              {view === "methods" ? "Export all data" : "Export CSV"}
            </button>
          </div>
        </div>
        {error ? (
          <div className="error-state">
            <InfoIcon size={30} />
            <h2>We couldn’t load the market data.</h2>
            <p>{error}</p>
            <button
              className="button primary"
              onClick={() => setRetry((v) => v + 1)}
            >
              Try again
            </button>
          </div>
        ) : !dataset ? (
          <div className="loading" aria-live="polite">
            <p>Preparing the NSW market dataset…</p>
            <div className="loading-metrics">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="skeleton" />
              ))}
            </div>
            <div className="skeleton skeleton-chart" />
          </div>
        ) : (
          <>
            {view !== "methods" && (
              <>
                <section className="filters" aria-label="Market filters">
                  <div className="date-filters">
                    <CalendarBlankIcon size={18} />
                    <label>
                      <span className="sr-only">Start date</span>
                      <input
                        aria-label="Start date"
                        type="date"
                        min={dataset.quality.first.slice(0, 10)}
                        max={dataset.quality.last.slice(0, 10)}
                        value={start}
                        onInput={(e) => {
                          if (e.currentTarget.value)
                            setStart(e.currentTarget.value);
                        }}
                      />
                    </label>
                    <span className="date-arrow">→</span>
                    <label>
                      <span className="sr-only">End date</span>
                      <input
                        aria-label="End date"
                        type="date"
                        min={dataset.quality.first.slice(0, 10)}
                        max={dataset.quality.last.slice(0, 10)}
                        value={end}
                        onInput={(e) => {
                          if (e.currentTarget.value)
                            setEnd(e.currentTarget.value);
                        }}
                      />
                    </label>
                  </div>
                  <div className="presets">
                    {([7, 30, 90, "all"] as const).map((d) => (
                      <button
                        key={d}
                        className={
                          end === dataset.quality.last.slice(0, 10) &&
                          start ===
                            (d === "all"
                              ? dataset.quality.first.slice(0, 10)
                              : dayOffset(end, -(d - 1)))
                            ? "selected"
                            : ""
                        }
                        onClick={() => preset(d)}
                      >
                        {d === "all" ? "All" : `${d}D`}
                      </button>
                    ))}
                  </div>
                  <span className="filter-divider" />
                  <select
                    aria-label="Season"
                    value={season}
                    onChange={(e) => setSeason(e.target.value as Season)}
                  >
                    {[
                      "All seasons",
                      "Summer",
                      "Autumn",
                      "Winter",
                      "Spring",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                  <select
                    aria-label="Chart resolution"
                    value={granularity}
                    onChange={(e) =>
                      setGranularity(e.target.value as Granularity)
                    }
                  >
                    {["Auto", "30 minutes", "Hourly", "Daily"].map((s) => (
                      <option key={s} value={s}>
                        {s === "Auto" ? "Auto resolution" : s}
                      </option>
                    ))}
                  </select>
                  <label className="threshold">
                    <SlidersHorizontalIcon size={16} />
                    <span>Spike ≥</span>
                    <select
                      aria-label="Spike price threshold"
                      value={threshold}
                      onChange={(e) => setThreshold(Number(e.target.value))}
                    >
                      {[100, 300, 1000, 5000].map((t) => (
                        <option key={t} value={t}>
                          {money(t, 0)}
                        </option>
                      ))}
                    </select>
                  </label>
                </section>
                <div className="selection-caption">
                  <span>
                    {invalidRange
                      ? "Start date must be on or before the end date."
                      : `${displayDate(start)} – ${displayDate(end)} · ${num(rows.length)} half-hour positions${season === "All seasons" ? "" : ` · ${season}`}`}
                  </span>
                  <button onClick={reset}>Reset filters</button>
                </div>
              </>
            )}
            {view === "methods" ? (
              methods()
            ) : !rows.length || !values.length ? (
              <Panel title="Your market selection">
                <Empty
                  title={
                    invalidRange
                      ? "The selected dates are in the wrong order."
                      : undefined
                  }
                />
              </Panel>
            ) : view === "overview" ? (
              overview()
            ) : view === "volatility" ? (
              volatility()
            ) : (
              forecasting()
            )}
            <footer>
              <div className="footer-brand">
                <ActivityIcon size={17} />
                <strong>NEM observatory</strong>
                <span>A rebuild of Tanmay Somani’s NEM_AUS research.</span>
              </div>
              <span>Historical observations · AEST (UTC+10) · AUD</span>
            </footer>
          </>
        )}
      </main>
      {toast && (
        <div className="toast" role="status">
          <CheckIcon size={18} />
          {toast}
        </div>
      )}
      {event && (
        <div className="dialog-backdrop" onClick={() => setEvent(null)}>
          <section
            className="event-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="event-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEvent(null);
            }}
          >
            <button
              autoFocus
              className="icon-button close-dialog"
              aria-label="Close event details"
              onClick={() => setEvent(null)}
            >
              <XIcon size={20} />
            </button>
            <span className="eyebrow">HIGH-PRICE EPISODE</span>
            <h2 id="event-title">{displayDate(event.time, true)} AEST</h2>
            <p>
              {event.intervals} contiguous half-hour intervals at or above{" "}
              {money(threshold, 0)}/MWh
            </p>
            <div className="event-price">
              {money(event.price)}
              <span>peak half-hour average / MWh</span>
            </div>
            <div className="stat-list">
              <div>
                <span>Peak five-minute dispatch price</span>
                <strong>{money(event.peakDispatch)}</strong>
              </div>
              <div>
                <span>Duration</span>
                <strong>{num(event.intervals * 30)} min</strong>
              </div>
              <div>
                <span>Demand at half-hour peak</span>
                <strong>{num(event.demand)} MW</strong>
              </div>
              <div>
                <span>Rooftop solar at half-hour peak</span>
                <strong>{num(event.solar)} MW</strong>
              </div>
              <div>
                <span>Sydney temperature at peak</span>
                <strong>{num(event.temperature, 1)} °C</strong>
              </div>
            </div>
            <button
              className="button primary"
              onClick={() => {
                setStart(event.time.slice(0, 10));
                setEnd(event.end.slice(0, 10));
                setSeason("All seasons");
                setGranularity("30 minutes");
                setView("overview");
                setEvent(null);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              Explore this day <ArrowUpRightIcon size={17} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
function EventTable({
  events,
  threshold,
  onSelect,
}: {
  events: Episode[];
  threshold: number;
  onSelect: (e: Episode) => void;
}) {
  const [page, setPage] = useState(0),
    pageSize = 6;
  useEffect(() => setPage(0), [events]);
  return (
    <Panel
      title="High-price episodes"
      subtitle={`Contiguous half-hours ≥ ${money(threshold, 0)}/MWh · ranked by peak average`}
      action={
        <span className="count-badge">{num(events.length)} episodes</span>
      }
    >
      {!events.length ? (
        <div className="table-empty">
          <CheckIcon size={22} />
          <div>
            <strong>No high-price episodes in this selection.</strong>
            <p>Try a lower spike threshold or a wider date range.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="events-table">
              <thead>
                <tr>
                  <th>Episode starts · AEST</th>
                  <th>Peak average</th>
                  <th>Duration</th>
                  <th>Demand at peak</th>
                  <th>Solar at peak</th>
                  <th>
                    <span className="sr-only">Explore</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {events
                  .slice(page * pageSize, (page + 1) * pageSize)
                  .map((e) => (
                    <tr key={e.time}>
                      <td>
                        <span className="event-dot" />
                        {displayDate(e.time, true)}
                      </td>
                      <td className="price-cell">
                        {money(e.price)}
                        <small> / MWh</small>
                      </td>
                      <td>{num(e.intervals * 30)} min</td>
                      <td>
                        {num(e.demand)} <small>MW</small>
                      </td>
                      <td>
                        {num(e.solar)} <small>MW</small>
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label={`Explore episode on ${displayDate(e.time, true)}`}
                          onClick={() => onSelect(e)}
                        >
                          <ArrowUpRightIcon size={17} />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span>
              Showing {page * pageSize + 1}–
              {Math.min((page + 1) * pageSize, events.length)} of{" "}
              {num(events.length)}
            </span>
            <div>
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <button
                disabled={(page + 1) * pageSize >= events.length}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}
export default App;
