import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import {
  LineChart,
  BarChart,
  ScatterChart,
  HeatmapChart,
} from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  VisualMapComponent,
  MarkLineComponent,
  AriaComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";
echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  VisualMapComponent,
  MarkLineComponent,
  AriaComponent,
  CanvasRenderer,
]);
export const palette = {
  teal: "#087e72",
  tealLight: "#cbe7df",
  orange: "#df9562",
  blue: "#8296b0",
  ink: "#213b37",
  muted: "#7f8c88",
};
export function Chart({
  option,
  label,
  height = 300,
}: {
  option: EChartsCoreOption;
  label: string;
  height?: number;
}) {
  const element = useRef<HTMLDivElement>(null),
    chart = useRef<echarts.EChartsType | null>(null);
  useEffect(() => {
    if (!element.current) return;
    chart.current = echarts.init(element.current, undefined, {
      renderer: "canvas",
    });
    const resize = new ResizeObserver(() => chart.current?.resize());
    resize.observe(element.current);
    return () => {
      resize.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);
  useEffect(() => {
    chart.current?.setOption(
      {
        ...option,
        aria: { enabled: true },
        textStyle: {
          fontFamily: "Avenir Next, Segoe UI, sans-serif",
          fontSize: 11,
          color: palette.muted,
        },
        animationDuration: 350,
      },
      { notMerge: true },
    );
  }, [option]);
  return (
    <div
      ref={element}
      className="chart"
      role="img"
      aria-label={label}
      style={{ height }}
    />
  );
}
export function axes(unit: string, secondary?: string) {
  const axis = (name: string) => ({
    type: "value",
    name,
    nameTextStyle: {
      color: palette.muted,
      align: "left",
      padding: [0, 0, 10, 0],
      fontSize: 10,
    },
    axisLabel: {
      color: palette.muted,
      formatter: (v: number) =>
        Math.abs(v) >= 1000
          ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k`
          : String(v),
    },
    splitLine: { lineStyle: { color: "#edf1ef", type: "dashed" } },
  });
  return secondary
    ? [axis(unit), { ...axis(secondary), splitLine: { show: false } }]
    : axis(unit);
}
export function timeline(
  times: string[],
  unit: string,
  zoom = true,
): EChartsCoreOption {
  return {
    grid: { left: 55, right: 22, top: 35, bottom: zoom ? 64 : 30 },
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: "#fff",
      borderColor: "#dce5e0",
      textStyle: { color: palette.ink },
      valueFormatter: (v: unknown) =>
        v === null
          ? "Missing"
          : typeof v === "number"
            ? v.toLocaleString("en-AU", { maximumFractionDigits: 2 })
            : String(v),
    },
    xAxis: {
      type: "category",
      data: times.map((t) => t.replace("T", " ")),
      boundaryGap: false,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#e0e7e3" } },
      axisLabel: {
        color: palette.muted,
        hideOverlap: true,
        formatter: (v: string) =>
          v.slice(8, 10) +
          "/" +
          v.slice(5, 7) +
          (times[0]?.slice(0, 4) !== times.at(-1)?.slice(0, 4)
            ? "\n" + v.slice(0, 4)
            : v.length > 10
              ? "\n" + v.slice(11, 16).padEnd(5, ":00")
              : ""),
      },
    },
    yAxis: axes(unit),
    ...(zoom
      ? {
          dataZoom: [
            { type: "inside", filterMode: "none", zoomOnMouseWheel: "shift" },
            {
              type: "slider",
              bottom: 4,
              height: 21,
              borderColor: "transparent",
              backgroundColor: "#f3f6f4",
              fillerColor: "rgba(8,126,114,.09)",
              handleStyle: { color: "#087e72", borderWidth: 0 },
              textStyle: { color: palette.muted },
              showDetail: false,
            },
          ],
        }
      : {}),
  };
}
